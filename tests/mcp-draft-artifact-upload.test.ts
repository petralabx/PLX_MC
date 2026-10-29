// mc_upload_draft_artifact (TASK-4130): an agent uploads a file for a draft it
// wrote. MC stores it under Drafts/DRF-n/ in the Mission Control library and adds
// it to the draft's research artifacts as a link. The real routes, actions,
// capabilities and drafts store (its process-local fallback) run; SharePoint
// (Microsoft Graph) and the live-state reads are mocked. Nothing is stored for a
// draft that refuses the upload.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS: Record<string, string> = {
  sp_mcp_claude_code: "claude-key",
  sp_mcp_codex: "codex-key",
};

const h = vi.hoisted(() => ({
  uploads: [] as { driveId: string; path: string; size: number; contentType: string }[],
  uploadError: null as Error | null,
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: vi.fn(async () => "1") }));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  appendEvent: vi.fn(async () => "1"),
}));
vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getRepos: vi.fn(async () => [
    { id: "plx-mc", name: "PLX_MC", owner: "petralabx" },
    { id: "agentic-swarm", name: "agentic-swarm", owner: "petralabx" },
  ]),
  getProjects: vi.fn(async () => []),
  getBuckets: vi.fn(async () => []),
  getEntities: vi.fn(async () => []),
}));
vi.mock("@/lib/sync/graph", async () => {
  const { GraphError } = await vi.importActual<typeof import("@/lib/sync/graph")>("@/lib/sync/graph");
  return {
    GraphError,
    siteIdByPath: vi.fn(async (path: string) => `site:${path}`),
    driveIdByName: vi.fn(async () => "drive-mc"),
    uploadSmallDriveFile: vi.fn(async (driveId: string, path: string, bytes: Uint8Array, contentType: string) => {
      if (h.uploadError) throw h.uploadError;
      h.uploads.push({ driveId, path, size: bytes.length, contentType });
      // SharePoint encodes the library name's space in webUrl.
      return { id: `item-${h.uploads.length}`, webUrl: `https://petrasoap.sharepoint.com/sites/PLXSite/Mission%20Control/${path}`, size: bytes.length };
    }),
  };
});

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as saveRoute } from "@/app/api/cursor/drafts/route";
import { GET as getRoute } from "@/app/api/cursor/drafts/[id]/route";
import { POST as submitRoute } from "@/app/api/cursor/drafts/submit/route";
import { POST as uploadRoute } from "@/app/api/cursor/drafts/artifact/route";
import { addDraftArtifact, draftEditBase, getVisibleDraft, type DraftActor } from "@/lib/drafts/service";
import { __resetDraftsMemoryForTests } from "@/lib/drafts/store";
import type { DraftArtifact } from "@/lib/drafts/types";
import { recordMcpToolCall } from "@/lib/mcp/audit";
import { uploadDraftArtifact } from "@/lib/mcp/draft-actions";
import { __clearEvidenceDriveCacheForTests } from "@/lib/mcp/evidence-actions";
import { GraphError } from "@/lib/sync/graph";
import { getProjects } from "@/lib/sync/repo";

// Parsed JSON is asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": key,
    "x-mc-operator-email": "vince@petrasoap.com",
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "claude-code",
    "x-mc-worker-id": "draft-artifact-test",
  };
}

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const post = (path: string, body: unknown, key = "claude-key") =>
  new Request(`http://localhost${path}`, { method: "POST", headers: headers(key), body: JSON.stringify(body) });

async function call(res: Promise<Response>): Promise<{ status: number; body: Body }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Body };
}

const save = (body: unknown, key?: string) => call(saveRoute(post("/api/cursor/drafts", body, key), ctx()));
const upload = (body: unknown, key?: string) => call(uploadRoute(post("/api/cursor/drafts/artifact", body, key), ctx()));
const read = (id: string) =>
  call(getRoute(new Request(`http://localhost/api/cursor/drafts/${id}`, { headers: headers("claude-key") }), ctx({ id })));

const plan = {
  project: { name: "Draft Projects", owner: "vince", repos: ["plx-mc"] },
  buckets: [{ key: "B1", name: "Uploads", owner: "vince" }],
  tasks: [{ key: "T1", bucket: "B1", title: "Draft artifact uploads" }],
};
const research = {
  summary: "Files for drafts, in the Mission Control library.",
  recommendation: "Reuse the evidence store.",
  approaches: [{ name: "Reuse the evidence store", chosen: true }, { name: "A store of its own" }],
};

/** The agent that writes the drafts below, as the actions see it. */
const writer: DraftActor = {
  kind: "agent",
  email: "vince@petrasoap.com",
  principalId: "sp_mcp_claude_code",
  acl: { tokens: ["vince@petrasoap.com"] },
  runtime: "claude-code",
  repo: "petralabx/PLX_MC",
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString("base64");
const diagram = { draftId: "DRF-1", kind: "diagram" as const, fileName: "plan.png", contentType: "image/png", name: "Plan diagram", contentBase64: PNG };

async function newDraft(extra: Body = {}) {
  const made = await save({ title: "Draft Projects", plan, research, ...extra });
  expect(made.status).toBe(200);
  return made.body.data.draftId as string;
}

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv("PLX_MC_DRAFTS_ENABLED", "");
  vi.stubEnv("PLX_MC_EVIDENCE_STORE_ENABLED", "1");
  vi.stubEnv("VMC_API_KEY", "");
  __resetDraftsMemoryForTests();
  __clearEvidenceDriveCacheForTests();
  h.uploads = [];
  h.uploadError = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mc_upload_draft_artifact", () => {
  it("stores the file under Drafts/DRF-n/ and adds it to the draft's artifacts as a link", async () => {
    await newDraft();
    const res = await upload(diagram);
    expect(res.status).toBe(200);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({ driveId: "drive-mc", contentType: "image/png", size: 12 });
    expect(h.uploads[0].path).toMatch(/^Drafts\/DRF-1\/\d{8}T\d{6}Z-[0-9a-f]{8}-plan\.png$/);
    const url = `https://petrasoap.sharepoint.com/sites/PLXSite/Mission%20Control/${h.uploads[0].path}`;
    expect(res.body.data).toMatchObject({ draftId: "DRF-1", duplicate: false, size: 12, artifact: { kind: "diagram", name: "Plan diagram", url, inline: null } });

    const draft = (await read("DRF-1")).body.data.draft;
    expect(draft.working.research.artifacts).toEqual([{ kind: "diagram", name: "Plan diagram", url, inline: null }]);
  });

  it("adds the same file once: a retry stores nothing and returns the link it has", async () => {
    await newDraft();
    const first = await upload(diagram);
    const again = await upload({ ...diagram, name: "Plan diagram, again" });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ duplicate: true, artifact: first.body.data.artifact });
    expect(h.uploads).toHaveLength(1);
    expect((await read("DRF-1")).body.data.draft.working.research.artifacts).toHaveLength(1);
  });

  it("is off until a person sets PLX_MC_EVIDENCE_STORE_ENABLED=1, and stores nothing meanwhile", async () => {
    await newDraft();
    vi.stubEnv("PLX_MC_EVIDENCE_STORE_ENABLED", "");
    const res = await upload(diagram);
    expect(res).toMatchObject({ status: 503, body: { error: { code: "evidence_store_unavailable" } } });
    expect(res.body.error.message).toContain("PLX_MC_EVIDENCE_STORE_ENABLED=1");
    expect(h.uploads).toHaveLength(0);
  });

  it("links one copy when the same file is stored twice at once", async () => {
    await newDraft();
    // Two copies of plan.png, stored a second apart by two calls that both found no link.
    const copy = (second: number): DraftArtifact => ({
      kind: "diagram",
      name: "Plan diagram",
      url: `https://petrasoap.sharepoint.com/sites/PLXSite/Mission%20Control/Drafts/DRF-1/20261028T22000${second}Z-abcdef12-plan.png`,
      inline: null,
    });
    const sameFile = (linked: DraftArtifact) => linked.url?.endsWith("-abcdef12-plan.png") ?? false;
    const [first, second] = await Promise.all([
      addDraftArtifact(writer, "DRF-1", copy(1), sameFile),
      addDraftArtifact(writer, "DRF-1", copy(2), sameFile),
    ]);
    expect([first.added, second.added].sort()).toEqual([false, true]);
    expect(second.artifact).toEqual(first.artifact);
    expect((await read("DRF-1")).body.data.draft.working.research.artifacts).toHaveLength(1);
  });

  it("with the base the form read, refuses a draft that moved before storing anything, and returns the new base", async () => {
    await newDraft();
    const moved = `sha256:${"0".repeat(64)}`;
    await expect(uploadDraftArtifact(writer, diagram, { base: moved })).rejects.toMatchObject({ code: "draft_changed", status: 409 });
    expect(h.uploads).toHaveLength(0);

    const base = draftEditBase(await getVisibleDraft(writer, "DRF-1"));
    const result = await uploadDraftArtifact(writer, diagram, { base });
    expect(result.duplicate).toBe(false);
    expect(result.editBase).toBe(draftEditBase(await getVisibleDraft(writer, "DRF-1")));
    expect(result.editBase).not.toBe(base);
  });

  it("refuses a file that is not what its kind and type say", async () => {
    await newDraft();
    expect(await upload({ ...diagram, contentType: "application/pdf" })).toMatchObject({ status: 400, body: { error: { code: "invalid_artifact" } } });
    const notPng = Buffer.from("just text").toString("base64");
    expect(await upload({ ...diagram, contentBase64: notPng })).toMatchObject({ status: 400, body: { error: { code: "invalid_artifact" } } });
    expect(h.uploads).toHaveLength(0);
  });

  it("refuses a restricted draft, because everyone on the PLX site can open the shared library", async () => {
    await newDraft({ visibility: "restricted", members: ["vince@petrasoap.com"] });
    expect(await upload(diagram)).toMatchObject({ status: 409, body: { error: { code: "draft_restricted" } } });
    expect(h.uploads).toHaveLength(0);
  });

  it("is the draft writer's alone: another agent for the same person stores nothing", async () => {
    await newDraft();
    expect(await upload(diagram, "codex-key")).toMatchObject({ status: 403, body: { error: { code: "not_draft_writer" } } });
    expect(h.uploads).toHaveLength(0);
  });

  it("returns a draft in review to drafting, as any edit does", async () => {
    await newDraft();
    expect((await call(submitRoute(post("/api/cursor/drafts/submit", { draftId: "DRF-1" }), ctx()))).body.data.draft.status).toBe("in_review");
    const res = await upload(diagram);
    expect(res.body.data.draft.status).toBe("drafting");
  });

  it("says what a person must do when SharePoint refuses, and leaves the draft as it was", async () => {
    await newDraft();
    h.uploadError = new GraphError(403, "denied", "https://graph.microsoft.com/v1.0/drives/drive-mc");
    const res = await upload(diagram);
    expect(res).toMatchObject({ status: 503, body: { error: { code: "evidence_store_unavailable" } } });
    expect(res.body.error.message).toContain("Mission Control");
    expect((await read("DRF-1")).body.data.draft.working.research.artifacts).toEqual([]);
  });

  it("runs over HTTP MCP too", async () => {
    await newDraft();
    const res = await mcpPost(
      new Request("http://localhost/api/cursor/mcp", {
        method: "POST",
        headers: headers("claude-key"),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mc_upload_draft_artifact", arguments: diagram } }),
      })
    );
    const result = ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text).data).toMatchObject({ draftId: "DRF-1", duplicate: false, artifact: { kind: "diagram" } });
    expect(h.uploads).toHaveLength(1);
  });

  // sol-6.1 P1 on 06fd992: Trading Lab work goes on its own SharePoint site, never the PLX site.
  it("keeps a Trading Lab draft's files off the PLX site, and stores nothing", async () => {
    await newDraft({ plan: { ...plan, tasks: [{ ...plan.tasks[0], repos: ["agentic-swarm"] }] } });
    const res = await upload(diagram);
    expect(res).toMatchObject({ status: 503, body: { error: { code: "evidence_store_unavailable" } } });
    expect(res.body.error.message).toContain("Trading Lab");

    __resetDraftsMemoryForTests();
    await newDraft({ plan: { ...plan, buckets: [{ ...plan.buckets[0], repos: ["petralabx/agentic-swarm"] }] } });
    expect(await upload(diagram)).toMatchObject({ status: 503, body: { error: { code: "evidence_store_unavailable" } } });

    // A draft that adds to an existing Trading Lab project, naming no repo itself.
    __resetDraftsMemoryForTests();
    vi.mocked(getProjects).mockImplementation(async () => [{ id: "PRJ-TRADING", repos: ["agentic-swarm"] }] as never);
    try {
      await newDraft({ plan: { ...plan, project: { existing: "PRJ-TRADING" } } });
      expect(await upload(diagram)).toMatchObject({ status: 503, body: { error: { code: "evidence_store_unavailable" } } });
    } finally {
      vi.mocked(getProjects).mockImplementation(async () => []);
    }
    expect(h.uploads).toHaveLength(0);
  });

  // Bugbot on d2640e3: a save that names the Trading Lab repo while a file is stored keeps it unlinked.
  it("checks the Trading Lab rule again under the lock, and links nothing", async () => {
    await newDraft({ plan: { ...plan, tasks: [{ ...plan.tasks[0], repos: ["agentic-swarm"] }] } });
    const stored: DraftArtifact = {
      kind: "diagram",
      name: "Plan diagram",
      url: "https://petrasoap.sharepoint.com/sites/PLXSite/Mission%20Control/Drafts/DRF-1/20261029T020000Z-abcdef12-plan.png",
      inline: null,
    };
    await expect(addDraftArtifact(writer, "DRF-1", stored)).rejects.toMatchObject({ code: "evidence_store_unavailable", status: 503 });
    expect((await read("DRF-1")).body.data.draft.working.research.artifacts).toEqual([]);
  });

  // sol-6.1 P1 on 06fd992: a link that is there already is no way past the base check.
  it("refuses a moved base under the lock even when the file is linked already", async () => {
    await newDraft();
    const base = draftEditBase(await getVisibleDraft(writer, "DRF-1"));
    const first = await uploadDraftArtifact(writer, diagram);
    const sameFile = (linked: DraftArtifact) => linked.url === first.artifact.url;
    await expect(addDraftArtifact(writer, "DRF-1", first.artifact, sameFile, { base })).rejects.toMatchObject({ code: "draft_changed", status: 409 });
  });

  // sol-6.1 P2 on 06fd992: the cap on links counts new links only.
  it("returns the link it has for a retry, even when the draft holds the most artifacts", async () => {
    const links = Array.from({ length: 49 }, (_, i) => ({ kind: "document", name: `Doc ${i + 1}`, url: `https://example.com/doc-${i + 1}` }));
    await newDraft({ research: { ...research, artifacts: links } });
    const first = await upload(diagram);
    expect(first.status).toBe(200);
    const again = await upload(diagram);
    expect(again).toMatchObject({ status: 200, body: { data: { duplicate: true, artifact: first.body.data.artifact } } });
    expect(await upload({ ...diagram, fileName: "other.png" })).toMatchObject({ status: 409, body: { error: { code: "too_many_artifacts" } } });
    expect(h.uploads).toHaveLength(1);
  });

  // sol-6.1 P2 on 06fd992: /api/events shows mcp.tool.invoked rows to every reader.
  it("keeps only the error code in the audit row of a failed upload, on HTTP MCP and REST", async () => {
    await newDraft({ visibility: "restricted", members: ["vince@petrasoap.com"] });
    const audit = vi.mocked(recordMcpToolCall);
    audit.mockClear();
    expect((await upload(diagram)).status).toBe(409);
    await mcpPost(
      new Request("http://localhost/api/cursor/mcp", {
        method: "POST",
        headers: headers("claude-key"),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mc_upload_draft_artifact", arguments: diagram } }),
      })
    );
    expect(audit.mock.calls.map(([row]) => [row.tool, row.ok, row.error])).toEqual([
      ["mc_upload_draft_artifact", false, "draft_restricted"],
      ["mc_upload_draft_artifact", false, "draft_restricted"],
    ]);
  });
});
