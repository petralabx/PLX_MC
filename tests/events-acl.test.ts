// /api/events must not leak task.updated diffs (or any task-bound event) from
// restricted projects to principals outside the project.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { principalFromTokens } from "@/lib/permissions/project-acl";
import type { EventRow } from "@/lib/compliance/repo";

const h = vi.hoisted(() => ({ session: { email: "outsider@petrasoap.com" }, rows: null as unknown[] | null }));

vi.mock("@/lib/sync/repo", () => ({
  getProjects: async () => [
    { id: "PRJ-OPEN", visibility: "shared", members: [] },
    { id: "PRJ-SECRET", visibility: "restricted", members: ["vince@petrasoap.com"] },
  ],
  getBuckets: async () => [
    { id: "BKT-OPEN", project: "PRJ-OPEN" },
    { id: "BKT-SECRET", project: "PRJ-SECRET" },
  ],
  getEntities: async () => [
    { id: "TASK-OPEN", data: { id: "TASK-OPEN", bucket: "BKT-OPEN" } },
    { id: "TASK-SECRET", data: { id: "TASK-SECRET", bucket: "BKT-SECRET" } },
  ],
}));
vi.mock("@/lib/compliance/service", () => ({
  listEvents: async () => h.rows ?? [
    ev("1", "task.updated", "TASK-OPEN"),
    ev("2", "task.updated", "TASK-SECRET"),
    ev("3", "pr.merged", null),
    ev("4", "task.updated", "TASK-UNKNOWN"),
  ],
}));
vi.mock("@/lib/routing/mutations/actors", () => ({
  aclPrincipalFromSession: async () => principalFromTokens(h.session.email),
}));

function ev(seq: string, kind: string, taskId: string | null): EventRow {
  return { seq, ts: "2026-10-06T00:00:00.000Z", kind, actor: "a", repo: null, taskId, pr: null, payload: { diff: { title: { before: "s", after: "t" } } } };
}

import { filterEventsByProjectAcl } from "@/lib/compliance/events-acl";
import { GET } from "@/app/api/events/route";
import { __resetDraftsMemoryForTests, insertDraft } from "@/lib/drafts/store";
import { emptyDraftContent } from "@/lib/drafts/types";

beforeEach(() => { h.session.email = "outsider@petrasoap.com"; h.rows = null; __resetDraftsMemoryForTests(); });

describe("filterEventsByProjectAcl", () => {
  it("withholds task-bound events of restricted projects from non-members", async () => {
    const out = await filterEventsByProjectAcl(
      [ev("1", "task.updated", "TASK-OPEN"), ev("2", "task.updated", "TASK-SECRET")],
      principalFromTokens("outsider@petrasoap.com")
    );
    expect(out.map((e) => e.seq)).toEqual(["1"]);
  });

  it("withholds project and bucket archive reasons from non-members", async () => {
    const project = { ...ev("1", "project.archived", null), payload: { projectId: "PRJ-SECRET", reason: "private" } };
    const bucket = { ...ev("2", "bucket.unarchived", null), payload: { bucketId: "BKT-SECRET", reason: "private" } };
    expect(await filterEventsByProjectAcl([project, bucket], principalFromTokens("outsider@petrasoap.com"))).toEqual([]);
    expect(await filterEventsByProjectAcl([project, bucket], principalFromTokens("vince@petrasoap.com"))).toHaveLength(2);
  });
  it("keeps them for members", async () => {
    const out = await filterEventsByProjectAcl([ev("2", "task.updated", "TASK-SECRET")], principalFromTokens("vince@petrasoap.com"));
    expect(out).toHaveLength(1);
  });

  // TASK-4004: a rejected pr.task_link has no taskId but names its tasks in
  // payload.taskIds; every named task the Hub holds must be open to the caller.
  it("withholds a pr.task_link event that names a restricted task from non-members", async () => {
    const link = (seq: string, taskIds: string[]) => ({
      ...ev(seq, "pr.task_link", null),
      payload: { outcome: "repo_mismatch", taskIds, title: "Fix it", branch: "feat/x" },
    });
    const events = [
      link("1", ["TASK-SECRET"]),
      link("2", ["TASK-OPEN", "TASK-SECRET"]),
      link("3", ["TASK-OPEN"]),
      link("4", ["TASK-UNKNOWN"]),
    ];
    expect((await filterEventsByProjectAcl(events, principalFromTokens("outsider@petrasoap.com"))).map((e) => e.seq)).toEqual(["3", "4"]);
    expect(await filterEventsByProjectAcl(events, principalFromTokens("vince@petrasoap.com"))).toHaveLength(4);
  });

  // TASK-4059: a restricted draft's events carry free text (a withdraw or dismiss reason).
  it("withholds a restricted draft's events from non-members, and events of a draft the Hub does not hold", async () => {
    const draft = (visibility: "shared" | "restricted", members: string[]) =>
      insertDraft({ author: "vince@petrasoap.com", createdBy: "sp_mcp_claude_code", visibility, members, reviewers: [], working: emptyDraftContent("Plan") });
    const secret = await draft("restricted", ["stephen@petrasoap.com"]);
    const open = await draft("shared", []);
    const events = [
      { ...ev("1", "draft.withdrawn", null), payload: { draftId: secret.id, reason: "private" } },
      { ...ev("2", "draft.created", null), payload: { draftId: open.id } },
      { ...ev("3", "draft.reviewed", null), payload: { draftId: "DRF-999" } },
      ev("4", "task.updated", "TASK-OPEN"),
    ];
    const seqs = async (who: string) => (await filterEventsByProjectAcl(events, principalFromTokens(who))).map((e) => e.seq);
    expect(await seqs("outsider@petrasoap.com")).toEqual(["2", "4"]);
    expect(await seqs("stephen@petrasoap.com")).toEqual(["1", "2", "4"]);
    expect(await seqs("vince@petrasoap.com")).toEqual(["1", "2", "4"]);
    // Only draft events: the project maps are not needed, and the rule still holds.
    expect((await filterEventsByProjectAcl(events.slice(0, 3), principalFromTokens("outsider@petrasoap.com"))).map((e) => e.seq)).toEqual(["2"]);
  });
});

describe("GET /api/events", () => {
  it("filters by session principal but pages on the unfiltered cursor", async () => {
    const res = await GET(new Request("http://localhost/api/events?limit=4"), { params: Promise.resolve({}) } as never);
    const body = await res.json();
    const data = body.data ?? body;
    expect(data.events.map((e: EventRow) => e.seq)).toEqual(["1", "3", "4"]);
    expect(data.nextCursor).toBe("4");
    expect(data.hasMore).toBe(true);
    expect(JSON.stringify(data)).not.toContain("TASK-SECRET");
  });

  // TASK-4059 P1: a restricted draft's withdraw reason must not reach a non-member.
  it("shows a restricted draft's withdrawal only to its members and author", async () => {
    const secret = await insertDraft({
      author: "vince@petrasoap.com",
      createdBy: "sp_mcp_claude_code",
      visibility: "restricted",
      members: ["stephen@petrasoap.com"],
      reviewers: [],
      working: emptyDraftContent("Secret reorg"),
    });
    h.rows = [
      { ...ev("1", "draft.withdrawn", null), payload: { draftId: secret.id, reason: "The reorg is confidential." } },
      ev("2", "pr.merged", null),
    ];
    const read = async (email: string) => {
      h.session.email = email;
      const body = await (await GET(new Request("http://localhost/api/events?limit=50"), { params: Promise.resolve({}) } as never)).json();
      return (body.data ?? body) as { events: EventRow[]; nextCursor: string | null };
    };
    const outsider = await read("outsider@petrasoap.com");
    expect(outsider.events.map((e) => e.seq)).toEqual(["2"]);
    expect(JSON.stringify(outsider)).not.toContain("confidential");
    expect(outsider.nextCursor).toBe("2");
    expect((await read("stephen@petrasoap.com")).events.map((e) => e.seq)).toEqual(["1", "2"]);
    expect((await read("vince@petrasoap.com")).events.map((e) => e.seq)).toEqual(["1", "2"]);
  });

  it("cuts a page at the byte budget and resumes the cursor at the first unsent event", async () => {
    const big = (seq: string) => ({ ...ev(seq, "task.updated", "TASK-OPEN"), payload: { d: "x".repeat(64_000) } });
    h.rows = Array.from({ length: 100 }, (_, i) => big(String(i + 1)));
    const res = await GET(new Request("http://localhost/api/events?limit=100"), { params: Promise.resolve({}) } as never);
    const body = await res.json();
    const data = body.data ?? body;
    expect(JSON.stringify(data).length).toBeLessThan(3_100_000);
    expect(data.events.length).toBeLessThan(100);
    expect(data.nextCursor).toBe(data.events[data.events.length - 1].seq);
    expect(data.hasMore).toBe(true);
  });
});
