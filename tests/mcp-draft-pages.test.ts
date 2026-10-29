// Review pages (TASK-4135): the writer's agent renders a submitted version as a
// page (mc_render_draft_page), publishes it as a Claude Artifact, records its
// link (mc_publish_draft_page), and relays the page's comments back as comment
// reviews (mc_review_draft with relay). Decisions (Vince, 2026-10-29): only
// Petra people's comments come back, a page comment never blocks, shared drafts
// only, off until PLX_MC_DRAFT_PAGES_ENABLED=1. The real routes, actions,
// capabilities and drafts store (its process-local fallback) run; the live-state
// reads and the audit writes are mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS: Record<string, string> = {
  sp_mcp_claude_code: "claude-key",
  sp_mcp_codex: "codex-key",
};

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/mcp/audit", () => ({ recordMcpToolCall: vi.fn(async () => "1") }));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  appendEvent: vi.fn(async () => "1"),
}));
vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getRepos: vi.fn(async () => [{ id: "plx-mc", name: "PLX_MC", owner: "petralabx" }]),
  getProjects: vi.fn(async () => []),
  getBuckets: vi.fn(async () => []),
  getEntities: vi.fn(async () => []),
}));

import { POST as mcpPost } from "@/app/api/cursor/mcp/route";
import { POST as saveRoute } from "@/app/api/cursor/drafts/route";
import { GET as getRoute } from "@/app/api/cursor/drafts/[id]/route";
import { GET as renderRoute } from "@/app/api/cursor/drafts/[id]/page/route";
import { POST as publishRoute } from "@/app/api/cursor/drafts/page/route";
import { POST as reviewRoute } from "@/app/api/cursor/drafts/review/route";
import { POST as submitRoute } from "@/app/api/cursor/drafts/submit/route";
import { __resetDraftsMemoryForTests } from "@/lib/drafts/store";
import { recordMcpToolCall } from "@/lib/mcp/audit";

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
    "x-mc-worker-id": "draft-pages-test",
  };
}

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const post = (path: string, body: unknown, key = "claude-key") =>
  new Request(`http://localhost${path}`, { method: "POST", headers: headers(key), body: JSON.stringify(body) });

async function call(res: Promise<Response>): Promise<{ status: number; body: Body }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Body };
}

const save = (body: unknown) => call(saveRoute(post("/api/cursor/drafts", body), ctx()));
const submit = (draftId: string) => call(submitRoute(post("/api/cursor/drafts/submit", { draftId }), ctx()));
const read = (id: string) =>
  call(getRoute(new Request(`http://localhost/api/cursor/drafts/${id}`, { headers: headers("claude-key") }), ctx({ id })));
const render = (id: string, query = "", key = "claude-key") =>
  call(renderRoute(new Request(`http://localhost/api/cursor/drafts/${id}/page${query}`, { headers: headers(key) }), ctx({ id })));
const publish = (body: unknown, key?: string) => call(publishRoute(post("/api/cursor/drafts/page", body, key), ctx()));
const review = (body: unknown, key?: string) => call(reviewRoute(post("/api/cursor/drafts/review", body, key), ctx()));

const PAGE = "https://claude.ai/artifact/0f9d3c2a-7b1e-4c55-9d2e-1a2b3c4d5e6f";
const plan = {
  project: { name: "Review pages", owner: "vince", repos: ["plx-mc"] },
  buckets: [{ key: "B1", name: "Pages", owner: "vince" }],
  tasks: [{ key: "T1", bucket: "B1", title: "Publish a version as a page" }],
};
const research = {
  summary: "People outside Mission Control review a draft on a page.",
  recommendation: "Claude Artifacts first.",
  approaches: [{ name: "Claude Artifacts", chosen: true }, { name: "Cursor Canvas" }],
};

/** A shared draft, submitted: version 1 is under review. */
async function submitted(extra: Body = {}) {
  const made = await save({ title: "Review pages", plan, research, ...extra });
  expect(made.status).toBe(200);
  const sent = await submit(made.body.data.draftId);
  expect(sent.status).toBe(200);
  return made.body.data.draftId as string;
}

const relay = (extra: Body = {}, key?: string) =>
  review(
    {
      draftId: "DRF-1",
      kind: "comment",
      version: 1,
      body: "B1 needs an owner who reviews the pages.",
      target: "B1",
      relay: { pageUrl: PAGE, commentId: "cmt_1", commenter: "Ricardo@PetraSoap.com" },
      ...extra,
    },
    key
  );

beforeEach(() => {
  vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
  vi.stubEnv("PLX_MC_MCP_API_KEY", "");
  vi.stubEnv("PLX_MC_MCP_AGENT_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
  vi.stubEnv("PLX_MC_DRAFTS_ENABLED", "");
  vi.stubEnv("PLX_MC_DRAFT_PAGES_ENABLED", "1");
  vi.stubEnv("VMC_API_KEY", "");
  __resetDraftsMemoryForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("review pages", () => {
  it("are off until a person sets PLX_MC_DRAFT_PAGES_ENABLED=1", async () => {
    await submitted();
    vi.stubEnv("PLX_MC_DRAFT_PAGES_ENABLED", "");
    expect(await render("DRF-1")).toMatchObject({ status: 503, body: { error: { code: "draft_pages_off" } } });
    expect(await publish({ draftId: "DRF-1", version: 1, url: PAGE })).toMatchObject({ status: 503, body: { error: { code: "draft_pages_off" } } });
    expect(await relay()).toMatchObject({ status: 503, body: { error: { code: "draft_pages_off" } } });
  });

  it("render the version under review as a self-contained page, every value escaped", async () => {
    await submitted({
      title: "Pages <script>alert(1)</script>",
      plan: { ...plan, tasks: [{ ...plan.tasks[0], description: '<img src=x onerror="alert(2)">' }] },
    });
    const res = await render("DRF-1");
    expect(res.status).toBe(200);
    const { html, title, version, digest } = res.body.data;
    expect({ title, version }).toEqual({ title: "DRF-1 v1 review", version: 1 });
    expect(digest).toMatch(/^sha256:/);
    expect(html).toContain("<title>DRF-1 v1 review</title>");
    expect(html).toContain("Pages &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(html).not.toMatch(/<script|<img|onerror="/i);
    for (const target of ["P", "B1", "T1", "research.summary", "research.approaches"]) {
      expect(html).toContain(`data-target="${target}"`);
    }
  });

  it("keep a restricted draft off any page", async () => {
    await submitted({ visibility: "restricted", members: ["vince@petrasoap.com"] });
    expect(await render("DRF-1")).toMatchObject({ status: 409, body: { error: { code: "draft_restricted" } } });
    expect(await publish({ draftId: "DRF-1", version: 1, url: PAGE })).toMatchObject({ status: 409, body: { error: { code: "draft_restricted" } } });
  });

  it("record the page the writer published for the version under review, once", async () => {
    await submitted();
    const first = await publish({ draftId: "DRF-1", version: 1, url: PAGE });
    expect(first).toMatchObject({ status: 200, body: { data: { published: true, page: { source: "page", pageUrl: PAGE, version: 1, kind: "comment", blocking: false } } } });
    const again = await publish({ draftId: "DRF-1", version: 1, url: PAGE });
    expect(again.body.data).toMatchObject({ published: false, page: { id: first.body.data.page.id } });
    expect((await read("DRF-1")).body.data.draft.reviews.filter((r: Body) => r.source === "page")).toHaveLength(1);
  });

  it("are published only by the writer, for the version under review, with a Claude Artifact link", async () => {
    await submitted();
    expect(await publish({ draftId: "DRF-1", version: 1, url: PAGE }, "codex-key")).toMatchObject({ status: 403, body: { error: { code: "not_draft_writer" } } });
    expect(await publish({ draftId: "DRF-1", version: 2, url: PAGE })).toMatchObject({ status: 409, body: { error: { code: "draft_version_moved" } } });
    expect(await publish({ draftId: "DRF-1", version: 1, url: "https://example.com/page" })).toMatchObject({ status: 400 });
    await save({ draftId: "DRF-1", title: "Edited after submit" });
    expect(await publish({ draftId: "DRF-1", version: 1, url: PAGE })).toMatchObject({ status: 409, body: { error: { code: "draft_not_in_review" } } });
  });

  it("relay a Petra person's comment as a comment by them on the page's version, once", async () => {
    await submitted();
    await publish({ draftId: "DRF-1", version: 1, url: PAGE });
    const first = await relay();
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      duplicate: false,
      review: {
        kind: "comment",
        blocking: false,
        target: "B1",
        version: 1,
        by: "ricardo@petrasoap.com",
        byKind: "human",
        byPrincipal: null,
        source: "artifact",
        pageUrl: PAGE,
        pageCommentId: "cmt_1",
        relayedBy: "sp_mcp_claude_code",
        relayedFor: "vince@petrasoap.com",
      },
    });
    const again = await relay({ body: "Edited on the page later." });
    expect(again.body.data).toMatchObject({ duplicate: true, review: { id: first.body.data.review.id, body: "B1 needs an owner who reviews the pages." } });
    expect((await read("DRF-1")).body.data.draft.reviews.filter((r: Body) => r.source === "artifact")).toHaveLength(1);
  });

  it("leave other people's comments on the page", async () => {
    await submitted();
    await publish({ draftId: "DRF-1", version: 1, url: PAGE });
    const res = await relay({ relay: { pageUrl: PAGE, commentId: "cmt_2", commenter: "someone@example.com" } });
    expect(res).toMatchObject({ status: 422, body: { error: { code: "commenter_not_petra" } } });
    expect((await read("DRF-1")).body.data.draft.reviews.filter((r: Body) => r.source === "artifact")).toHaveLength(0);
  });

  it("relay comments only, and only from a page the draft recorded", async () => {
    await submitted();
    expect(await relay()).toMatchObject({ status: 409, body: { error: { code: "page_not_published" } } });
    await publish({ draftId: "DRF-1", version: 1, url: PAGE });
    expect(await relay({ kind: "finding", blocking: true })).toMatchObject({ status: 400 });
    expect(await relay({}, "codex-key")).toMatchObject({ status: 403, body: { error: { code: "not_draft_writer" } } });
  });

  it("land a comment on the version its page showed: an older one shows as stale, and a republished link carries both", async () => {
    await submitted();
    await publish({ draftId: "DRF-1", version: 1, url: PAGE });
    await save({ draftId: "DRF-1", title: "Review pages, second pass" });
    expect((await submit("DRF-1")).body.data.draft.version).toBe(2);
    expect((await relay()).body.data.review).toMatchObject({ version: 1 });
    // The page shows version 2 only once the writer republishes it and records it again.
    expect(await relay({ version: 2, relay: { pageUrl: PAGE, commentId: "cmt_2", commenter: "ricardo@petrasoap.com" } })).toMatchObject({
      status: 409,
      body: { error: { code: "page_not_published" } },
    });
    expect((await publish({ draftId: "DRF-1", version: 2, url: PAGE })).body.data.published).toBe(true);
    expect((await relay({ version: 2, relay: { pageUrl: PAGE, commentId: "cmt_2", commenter: "ricardo@petrasoap.com" } })).body.data.review).toMatchObject({ version: 2 });
    const relayed = (await read("DRF-1")).body.data.draft.reviews.filter((r: Body) => r.source === "artifact");
    expect(relayed.map((r: Body) => [r.pageCommentId, r.version, r.stale])).toEqual([
      ["cmt_1", 1, true],
      ["cmt_2", 2, false],
    ]);
  });

  it("keep only the error code in the audit row of a failed relay: its message names the commenter", async () => {
    await submitted();
    await publish({ draftId: "DRF-1", version: 1, url: PAGE });
    const audit = vi.mocked(recordMcpToolCall);
    audit.mockClear();
    await relay({ relay: { pageUrl: PAGE, commentId: "cmt_3", commenter: "outsider@example.com" } });
    expect(audit.mock.calls.map(([row]) => [row.tool, row.ok, row.error])).toEqual([["mc_review_draft", false, "commenter_not_petra"]]);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("outsider@example.com");
  });

  it("run over HTTP MCP too", async () => {
    await submitted();
    const res = await mcpPost(
      new Request("http://localhost/api/cursor/mcp", {
        method: "POST",
        headers: headers("claude-key"),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mc_render_draft_page", arguments: { draftId: "DRF-1" } } }),
      })
    );
    const result = ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text).data).toMatchObject({ draftId: "DRF-1", version: 1, title: "DRF-1 v1 review" });
  });
});
