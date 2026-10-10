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

beforeEach(() => { h.session.email = "outsider@petrasoap.com"; h.rows = null; });

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
