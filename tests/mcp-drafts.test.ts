// Draft Projects tools (TASK-4059) on the paths an agent uses: JSON-RPC
// tools/call on POST /api/cursor/mcp (HTTP MCP) and the /api/cursor/drafts REST
// routes the stdio client proxies to. The live-state reads (repos, projects,
// buckets, tasks) are mocked; the drafts store runs on its process-local
// fallback, so the real actions, capabilities and allowlists run without a
// database. Every tool is on unless PLX_MC_DRAFTS_ENABLED=0, the kill switch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS: Record<string, string> = {
  sp_mcp_claude_code: "claude-key",
  sp_mcp_codex: "codex-key",
  sp_mcp_portal: "portal-key",
  sp_mcp_workbench: "workbench-key",
};

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: vi.fn(async () => "1") }));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  appendEvent: vi.fn(async () => "1"),
}));
vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getRepos: vi.fn(async () => [{ id: "plx-mc", name: "PLX_MC" }]),
  getProjects: vi.fn(async () => [{ id: "PRJ-INFRA", name: "Infra", visibility: "shared", members: [] }]),
  // A duplicate is raised only for a task whose bucket and project the Hub holds.
  getBuckets: vi.fn(async () => [{ id: "BKT-INFRA", name: "Infra", project: "PRJ-INFRA" }]),
  getEntities: vi.fn(async () => [
    { data: { id: "TASK-9", title: "Drafts storage migration", stage: "backlog", bucket: "BKT-INFRA" } },
  ]),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { GET as listRoute, POST as saveRoute } from "@/app/api/cursor/drafts/route";
import { GET as getRoute } from "@/app/api/cursor/drafts/[id]/route";
import { POST as submitRoute } from "@/app/api/cursor/drafts/submit/route";
import { POST as reviewRoute } from "@/app/api/cursor/drafts/review/route";
import { __resetDraftsMemoryForTests } from "@/lib/drafts/store";
import { recordMcpToolCall } from "@/lib/mcp/audit";

const DRAFT_TOOLS = ["mc_save_draft", "mc_submit_draft", "mc_get_draft", "mc_list_drafts", "mc_review_draft"];

function headers(key: string, email = "vince@petrasoap.com"): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": key,
    "x-mc-operator-email": email,
    "x-mc-repo": "petralabx/PLX_MC",
    "x-mc-runtime": "claude-code",
    "x-mc-worker-id": "drafts-test",
  };
}

let rpcId = 0;
// Parsed tool JSON is asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

async function rpc(key: string, method: string, params: unknown, email?: string): Promise<Body> {
  rpcId += 1;
  const res = await mcpPost(
    new Request("http://localhost/api/cursor/mcp", {
      method: "POST",
      headers: headers(key, email),
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
    })
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: Body }).result;
}

async function callTool(key: string, name: string, args: Body, email?: string): Promise<{ isError: boolean; body: Body }> {
  const result = (await rpc(key, "tools/call", { name, arguments: args }, email)) as { content: { text: string }[]; isError?: boolean };
  const text = result.content[0].text;
  // The SDK refuses input that fails the tool's schema with plain text, before the action runs.
  return { isError: result.isError === true, body: text.startsWith("{") ? JSON.parse(text) : { raw: text } };
}

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const post = (path: string, body: unknown, key = "claude-key") =>
  new Request(`http://localhost${path}`, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
const get = (path: string, key = "claude-key") => new Request(`http://localhost${path}`, { headers: headers(key) });

const plan = {
  project: { name: "Draft Projects", owner: "vince", repos: ["plx-mc"] },
  buckets: [{ key: "B1", name: "Storage and tools", owner: "vince" }],
  tasks: [{ key: "T1", bucket: "B1", title: "Drafts storage migration" }],
};
const research = {
  summary: "Reviewable plans in Mission Control.",
  recommendation: "Separate tables.",
  approaches: [
    { name: "Separate tables", chosen: true },
    { name: "Status on projects" },
  ],
};

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com,ricardo@petrasoap.com");
  vi.stubEnv("PLX_MC_DRAFTS_ENABLED", "");
  vi.stubEnv("VMC_API_KEY", "");
  __resetDraftsMemoryForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("draft tools", () => {
  it("registers all five tools on the HTTP MCP server", async () => {
    const { tools } = (await rpc("claude-key", "tools/list", {})) as { tools: { name: string }[] };
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(DRAFT_TOOLS));
  });

  it("refuses every tool and route while the kill switch is on", async () => {
    vi.stubEnv("PLX_MC_DRAFTS_ENABLED", "0");
    const { isError, body } = await callTool("claude-key", "mc_list_drafts", {});
    expect(isError).toBe(true);
    expect(body.error.code).toBe("drafts_disabled");
    const res = await saveRoute(post("/api/cursor/drafts", { title: "x" }), ctx());
    expect(res.status).toBe(404);
    expect(((await res.json()) as Body).error.code).toBe("drafts_disabled");
  });

  it("runs create, submit, review and read over HTTP MCP", async () => {
    const created = await callTool("claude-key", "mc_save_draft", { title: "Draft Projects", plan, research, reviewers: ["ricardo"] });
    expect(created.isError).toBe(false);
    expect(created.body.data).toMatchObject({ draftId: "DRF-1", created: true, preflight: [] });
    expect(created.body.data.draft).toMatchObject({ status: "drafting", author: "vince@petrasoap.com", createdBy: "sp_mcp_claude_code", tasks: 1 });

    const submitted = await callTool("claude-key", "mc_submit_draft", { draftId: "DRF-1" });
    expect(submitted.body.data).toMatchObject({ frozen: true, duplicatesRaised: 1, draft: { status: "in_review", version: 1, openFindings: 1, openBlockingFindings: 0 } });

    const finding = await callTool(
      "codex-key",
      "mc_review_draft",
      { draftId: "DRF-1", kind: "finding", version: 1, body: "T1 has no repo.", blocking: true, target: "T1" },
      "ricardo@petrasoap.com"
    );
    expect(finding.body.data.review).toMatchObject({ kind: "finding", blocking: true, status: "open", by: "ricardo@petrasoap.com", byPrincipal: "sp_mcp_codex" });

    // A review names the version it read: a version it did not read refuses.
    const unread = await callTool("codex-key", "mc_review_draft", { draftId: "DRF-1", kind: "approve", version: 2, body: "Yes." }, "ricardo@petrasoap.com");
    expect(unread.body).toMatchObject({ error: { code: "draft_version_moved" } });
    const noVersion = await callTool("codex-key", "mc_review_draft", { draftId: "DRF-1", kind: "approve", body: "Yes." }, "ricardo@petrasoap.com");
    expect(noVersion.isError).toBe(true);

    const read = await callTool("claude-key", "mc_get_draft", { draftId: "DRF-1" });
    expect(read.body.data.draft.openBlockingFindings).toEqual([finding.body.data.review.id]);
    expect(read.body.data.draft.reviews.every((r: Body) => r.stale === false)).toBe(true);

    const resolved = await callTool(
      "codex-key",
      "mc_review_draft",
      { draftId: "DRF-1", kind: "resolve", findingId: finding.body.data.review.id, body: "Fixed in v2." },
      "ricardo@petrasoap.com"
    );
    expect(resolved.body.data.review).toMatchObject({ status: "resolved" });

    const v1 = await callTool("claude-key", "mc_get_draft", { draftId: "DRF-1", version: 1 });
    expect(v1.body.data.version).toMatchObject({ version: 1, digest: submitted.body.data.draft.digest });
  });

  it("refuses an incomplete submit with every problem, and an agent edit of another principal's draft", async () => {
    await callTool("claude-key", "mc_save_draft", { title: "Thin", plan });
    const submit = await callTool("claude-key", "mc_submit_draft", { draftId: "DRF-1" });
    expect(submit.isError).toBe(true);
    expect(submit.body.error.code).toBe("draft_not_ready");
    expect(submit.body.error.message).toContain("research.approaches");
    const other = await callTool("codex-key", "mc_save_draft", { draftId: "DRF-1", title: "Mine now" });
    expect(other.body.error.code).toBe("not_draft_writer");
  });

  // sol-6.1 P1 on ae15231: /api/events shows mcp.tool.invoked rows to every reader.
  it("keeps only the error code in the audit row of a failed draft call, on HTTP MCP and REST", async () => {
    const audit = vi.mocked(recordMcpToolCall);
    const secretPlan = { ...plan, tasks: [{ key: "T1", bucket: "B1", title: "Reorg", repos: ["secret-repo"] }] };
    await callTool("claude-key", "mc_save_draft", { title: "Secret plan", visibility: "restricted", members: ["vince@petrasoap.com"], plan: secretPlan, research });
    audit.mockClear();
    const failed = await callTool("claude-key", "mc_submit_draft", { draftId: "DRF-1" });
    expect(failed.body.error.message).toContain("secret-repo");
    const res = await submitRoute(post("/api/cursor/drafts/submit", { draftId: "DRF-1" }), ctx());
    expect(res.status).toBe(422);
    expect(audit.mock.calls.map(([row]) => [row.tool, row.ok, row.error])).toEqual([
      ["mc_submit_draft", false, "draft_not_ready"],
      ["mc_submit_draft", false, "draft_not_ready"],
    ]);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("secret-repo");
  });

  it("validates inputs before anything is stored", async () => {
    const noTitle = await callTool("claude-key", "mc_save_draft", { plan });
    expect(noTitle).toMatchObject({ isError: true, body: { raw: expect.stringContaining("A new draft needs a title.") } });
    const mixed = await callTool("claude-key", "mc_save_draft", { draftId: "DRF-1", title: "x", withdraw: { reason: "Not needed any more." } });
    expect(mixed).toMatchObject({ isError: true, body: { raw: expect.stringContaining("cannot be mixed") } });
    const badKind = await callTool("claude-key", "mc_review_draft", { draftId: "DRF-1", kind: "comment", blocking: true, body: "x" });
    expect(badKind).toMatchObject({ isError: true, body: { raw: expect.stringContaining("findings only") } });
    const list = await callTool("claude-key", "mc_list_drafts", { status: "all" });
    expect(list.body.data.drafts).toEqual([]);
  });

  it("keeps the draft tools from the restricted principals", async () => {
    for (const key of ["portal-key", "workbench-key"]) {
      const { isError, body } = await callTool(key, "mc_list_drafts", {});
      expect(isError).toBe(true);
      expect(body.error.code).toBe("forbidden");
      const res = await listRoute(get("/api/cursor/drafts", key), ctx());
      expect(res.status).toBe(403);
    }
  });
});

describe("draft REST routes", () => {
  it("serve the stdio client the same actions", async () => {
    const saved = await saveRoute(post("/api/cursor/drafts", { title: "Draft Projects", plan, research }), ctx());
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as Body).data.draftId).toBe("DRF-1");

    const submitted = await submitRoute(post("/api/cursor/drafts/submit", { draftId: "DRF-1" }), ctx());
    expect(((await submitted.json()) as Body).data.draft.version).toBe(1);

    const review = await reviewRoute(post("/api/cursor/drafts/review", { draftId: "DRF-1", kind: "approve", version: 1, body: "Good." }), ctx());
    expect(((await review.json()) as Body).data.review).toMatchObject({ kind: "approve", byKind: "agent" });

    const listed = (await (await listRoute(get("/api/cursor/drafts?status=in_review&mine=true"), ctx())).json()) as Body;
    expect(listed.data.drafts.map((d: Body) => d.id)).toEqual(["DRF-1"]);
    expect(listed.data.filter).toMatchObject({ status: "in_review", mine: true });

    const one = (await (await getRoute(get("/api/cursor/drafts/DRF-1?version=1"), ctx({ id: "DRF-1" }))).json()) as Body;
    expect(one.data.version.version).toBe(1);
    const bad = await getRoute(get("/api/cursor/drafts/DRF-1?version=x"), ctx({ id: "DRF-1" }));
    expect(bad.status).toBe(400);
    const missing = await getRoute(get("/api/cursor/drafts/DRF-99"), ctx({ id: "DRF-99" }));
    expect(missing.status).toBe(404);
  });
});
