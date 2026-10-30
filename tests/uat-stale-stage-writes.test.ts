// TASK-4200: a STALE close (merged + uat:stale) ends when its task moves on to
// an open stage, or from verified back to merged. Every door that writes a
// stage must drop the label in the same write: patchTask (web PATCH, MCP), the
// reopen service, the SharePoint ToDos inbound pull and conflict keep-SP.
// Invariant: a reworked fix that merges again awaits re-test, never reads as
// stale-closed. The real repo.updateEntity / getEntity run here, against an
// in-memory entities table behind a fake @/lib/db; only Graph, the auth seams
// and the non-entity tables are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  entity_type: string; id: string; data: Record<string, unknown>; sync_state: string;
  sp_item_id: string | null; dirty_fields: string[]; field_attribution: Record<string, unknown>;
  completed_at: string | null; cancellation: unknown;
};

const s = vi.hoisted(() => ({
  table: new Map<string, Row>(),
  items: [] as Record<string, unknown>[],
  conflict: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => {
  const key = (t: unknown, id: unknown) => `${String(t)}:${String(id)}`;
  const q = async (sql: string, p: unknown[] = []) => {
    const n = sql.replace(/\s+/g, " ").trim();
    if (n.startsWith("SELECT count(*) AS n FROM entities")) return [{ n: String(s.table.size) }];
    if (n.startsWith("SELECT entity_type, id, data") && n.includes("WHERE entity_type = $1 AND id = $2")) {
      const r = s.table.get(key(p[0], p[1]));
      return r ? [structuredClone(r)] : [];
    }
    if (n.startsWith("SELECT entity_type, id, data") && n.includes("$1::text IS NULL OR entity_type = $1")) {
      return [...s.table.values()].filter((r) => p[0] == null || r.entity_type === p[0])
        .sort((a, b) => a.id.localeCompare(b.id)).map((r) => structuredClone(r));
    }
    if (n.startsWith("UPDATE entities SET data = $3")) {
      const r = s.table.get(key(p[0], p[1]));
      if (!r) return [];
      r.data = JSON.parse(String(p[2]));
      r.sync_state = String(p[3]);
      if (r.entity_type === "task") r.completed_at = r.completed_at ?? ((p[8] as string | null) ?? null);
      if (r.entity_type === "task" && p[9]) r.cancellation = p[10] == null ? null : JSON.parse(String(p[10]));
      return [];
    }
    return [];
  };
  // A distinct transaction function, as pg gives a client: updateEntity re-enters itself when q === query.
  return { query: q, withTransaction: async (fn: (tx: typeof q) => Promise<unknown>) => fn((sql: string, p?: unknown[]) => q(sql, p)) };
});
vi.mock("@/lib/compliance/repo", () => ({ appendEventTx: async () => "1", appendEvent: async () => "1" }));
vi.mock("@/lib/sync/graph", () => ({
  siteContext: async () => ({ siteId: "s", listIds: { todos: "L", risks: "L2", roadmap: "L3", projects: "L4", reporegistry: "L5" } }),
  listDelta: async () => ({ items: s.items, deltaLink: "d" }),
  resolveEmailByLookupId: async () => null,
  patchListItemFields: async () => undefined,
  createListItem: async () => "new",
  findItemByField: async () => null,
  resolveSiteUserLookupId: async () => null,
  normalizeLastModified: () => ({ source: "human", at: "2026-10-30T12:00:00.000Z" }),
  REPO_REGISTRY_KEY: "reporegistry", ROADMAP_KEY: "roadmap", PROJECTS_KEY: "projects",
  GraphError: class GraphError extends Error {},
}));
// The real updateEntity / getEntity / getEntities; the other tables are stubbed.
vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  seedRepos: async () => undefined,
  getRepos: async () => [],
  getBuckets: async () => [],
  getProjects: async () => [],
  getDeltaLink: async () => "stored-todos",
  saveDeltaLink: async () => undefined,
  markRegisterInboundComplete: async () => undefined,
  insertConflict: async () => undefined,
  appendAudit: async () => undefined,
  getBucketBySpItemId: async () => null,
  getConflict: async (id: string) => (s.conflict && s.conflict.id === id ? s.conflict : null),
  resolveConflictRow: async () => undefined,
}));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: async () => ({ actor: {}, actorId: "oid-1", auditLabel: "vince@example.com" }),
  aclPrincipalFromAuthorized: () => ({ tokens: ["oid-1"] }),
}));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: async () => undefined,
  assertTaskProjectAccess: async () => undefined,
}));
vi.mock("@/lib/permissions/agent-assignee-guard", () => ({ assertAgentAssigneeAllowed: () => undefined }));
vi.mock("@/lib/api/route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/route")>()),
  route: (handler: unknown) => handler,
}));

import { PATCH } from "@/app/api/tasks/[id]/route";
import { FILES, TASKS } from "@/lib/mc-data/data";
import { awaitsRetest, countTaskProgress } from "@/lib/mc-data/policy";
import type { Task } from "@/lib/mc-data/types";
import { resolveConflict, runScopedListDelta } from "@/lib/sync/engine";
import { getEntity } from "@/lib/sync/repo";
import { patchTask } from "@/lib/sync/state";
import { isStaleClosed } from "@/lib/tasks/uat-labels";

const ID = "TASK-9100";
const UAT = ["kind:code", "uat:R5JD2K", "uat-attempt:1"];
const row = (type: string, id: string, data: Record<string, unknown>, extra: Partial<Row> = {}): Row => ({
  entity_type: type, id, data, sync_state: "synced", sp_item_id: null, dirty_fields: [], field_attribution: {},
  completed_at: null, cancellation: null, ...extra,
});
const read = async () => (await getEntity("task", ID))!.data as unknown as Task;
const putTask = (stage: string, labels: string[]) =>
  s.table.set(`task:${ID}`, row("task", ID, {
    id: ID, title: "t", bucket: "BKT-UAT", stage, priority: "medium", labels, accountableOwner: "vince",
    prs: [{ repo: "plx-customer-portal", num: 1, status: "merged", title: "fix", base: "staging" }],
  }, { sp_item_id: "7", completed_at: "2026-10-20T00:00:00.000Z" }));
// What the compliance projection sends when the reworked fix's PR merges.
const projectionMerge = async () => (await patchTask(ID, { stage: "merged" }, "compliance-projection", { complianceProjection: true }))!;
const webPatch = (body: Record<string, unknown>) =>
  (PATCH as unknown as (req: Request, ctx: unknown) => Promise<Task>)(
    new Request(`http://localhost/api/tasks/${ID}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: ID }) }
  );
/** The fix merges again and waits for its re-test: open in rollups, never stale-closed. */
async function expectReworkAwaitsRetest() {
  const merged = await projectionMerge();
  expect(merged).toMatchObject({ stage: "merged", labels: UAT });
  expect(isStaleClosed(merged)).toBe(false);
  expect(awaitsRetest(merged)).toBe(true);
  expect(countTaskProgress([merged])).toMatchObject({ inProgress: 1, unconfirmed: 0 });
}

beforeEach(() => {
  s.table.clear(); s.items = []; s.conflict = null;
  // ensureSeeded's "already seeded" probe rows.
  const last = TASKS[TASKS.length - 1].id;
  s.table.set(`task:${last}`, row("task", last, { id: last, stage: "backlog", labels: [] }));
  if (FILES.length) s.table.set(`file:${FILES[FILES.length - 1].id}`, row("file", FILES[FILES.length - 1].id, {}));
  putTask("merged", [...UAT, "uat:stale"]);
});

describe("a move to an open stage ends a STALE close on every door (S1-01)", () => {
  it("the SharePoint ToDos pull: Status In Progress drops uat:stale", async () => {
    expect(isStaleClosed(await read())).toBe(true);
    s.items = [{ id: "7", fields: { TaskID: ID, Title: "t", Priority: "Medium", Status: "In Progress" } }];
    expect(await runScopedListDelta("todos")).toMatchObject({ pulled: 1, conflicts: 0 });
    expect(await read()).toMatchObject({ stage: "progress", labels: UAT });
    await expectReworkAwaitsRetest();
  });

  it("conflict keep-SP on Status drops uat:stale", async () => {
    s.conflict = { id: "cf-1", entityType: "task", entityId: ID, field: "Status", mcVal: "Merged", spVal: "In Progress" };
    expect(await resolveConflict("cf-1", "sp", "vince")).toBe(true);
    expect(await read()).toMatchObject({ stage: "progress", labels: UAT });
    await expectReworkAwaitsRetest();
  });

  it("a person's move back (web PATCH) drops uat:stale", async () => {
    await expect(webPatch({ stage: "review" })).resolves.toMatchObject({ stage: "review", labels: UAT });
    await expectReworkAwaitsRetest();
  });

  it("a move back that also sends its labels without uat:stale is no removal: the label goes with the move", async () => {
    await expect(webPatch({ stage: "review", labels: UAT })).resolves.toMatchObject({ stage: "review", labels: UAT });
    await expectReworkAwaitsRetest();
  });

  it("reopening a cancelled task that kept uat:stale drops it", async () => {
    putTask("cancelled", [...UAT, "uat:stale"]);
    await expect(webPatch({ stage: "backlog" })).resolves.toMatchObject({ stage: "backlog", labels: UAT });
    await expectReworkAwaitsRetest();
  });
});

describe("uat:stale as history (S1-07)", () => {
  it("stays when the task moves on to verified or cancelled", async () => {
    await expect(patchTask(ID, { stage: "verified" }, "portal", { uatVerify: true })).resolves.toMatchObject({
      stage: "verified", labels: [...UAT, "uat:stale"],
    });
    putTask("merged", [...UAT, "uat:stale"]);
    const cancellation = { reason: "superseded" as const, replacedBy: "TASK-9101", cancelledAt: "2026-10-30T00:00:00.000Z", cancelledBy: "sp_mcp_portal" };
    await expect(patchTask(ID, { stage: "cancelled" }, "portal", { cancellation })).resolves.toMatchObject({
      stage: "cancelled", labels: [...UAT, "uat:stale"],
    });
  });

  it("goes when a verified task moves back to merged, so it awaits re-test again and is never a live STALE close", async () => {
    putTask("verified", [...UAT, "uat:stale"]);
    const merged = await webPatch({ stage: "merged" });
    expect(merged).toMatchObject({ stage: "merged", labels: UAT });
    expect(isStaleClosed(merged)).toBe(false);
    expect(countTaskProgress([merged])).toMatchObject({ inProgress: 1, unconfirmed: 0, done: 0 });
  });
});

describe("a web PATCH that moves no stage", () => {
  it("keeps uat:stale through a label-only edit and a title-only edit of a STALE-closed task", async () => {
    putTask("merged", [...UAT, "uat:stale"]);
    expect(await webPatch({ labels: [...UAT, "uat:stale", "api"] })).toMatchObject({ stage: "merged", labels: [...UAT, "uat:stale", "api"] });
    expect(await webPatch({ title: "Renamed" })).toMatchObject({ title: "Renamed", stage: "merged" });
    const stored = await read();
    expect(stored.labels).toEqual([...UAT, "uat:stale", "api"]);
    expect(isStaleClosed(stored)).toBe(true);
  });
});

describe("a web PATCH that reopens with the labels it read (S1-08)", () => {
  it("succeeds in one call: the reopen ended the close, so the echoed uat:stale is not an add", async () => {
    putTask("cancelled", [...UAT, "uat:stale"]);
    const task = await webPatch({ stage: "backlog", labels: [...UAT, "uat:stale", "needs-vince"] });
    expect(task).toMatchObject({ stage: "backlog", labels: [...UAT, "needs-vince"] });
    expect((await read()).labels).toEqual([...UAT, "needs-vince"]);
  });

  it("still refuses a reopen that adds uat:stale or a near-copy to a task that never had it, before the reopen commits", async () => {
    for (const label of ["uat:stale", " UAT:Stale", "uat:stale "]) {
      putTask("cancelled", UAT);
      await expect(webPatch({ stage: "backlog", labels: [...UAT, label] })).rejects.toMatchObject({ code: "forbidden", status: 403 });
      expect(await read()).toMatchObject({ stage: "cancelled", labels: UAT });
    }
  });
});
