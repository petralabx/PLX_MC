// TASK-2529 acceptance 7: an inbound SharePoint edit to Status=Cancelled applies
// with a valid reason; one without raises a Sync conflict instead of being
// applied. The real engine + mapping run; Graph and the entities repo are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TASKS } from "@/lib/mc-data/data";

const s = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  row: null as Record<string, unknown> | null,
  known: new Set<string>(),
  updates: [] as { id: string; opts: Record<string, unknown> }[],
  conflicts: [] as Record<string, unknown>[],
  audits: [] as string[],
  events: [] as Record<string, unknown>[],
  txOrder: [] as string[],
  // Stands in for a cancel that commits after the pull's snapshot: updateEntity re-reads
  // the locked row, sees cancelled, and refuses any stage write that is not a reopen.
  cancelledUnderLock: false,
  resolved: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  withTransaction: async (fn: (q: unknown) => Promise<unknown>) => {
    s.txOrder.push("begin");
    const out = await fn("tx");
    s.txOrder.push("commit");
    return out;
  },
}));
vi.mock("@/lib/compliance/repo", () => ({
  appendEventTx: async (q: unknown, e: Record<string, unknown>) => {
    s.txOrder.push(`event:${String(q)}`);
    s.events.push(e);
    return "1";
  },
}));

vi.mock("@/lib/sync/graph", () => ({
  siteContext: async () => ({ siteId: "s", listIds: { todos: "L", risks: "L2", roadmap: "L3", projects: "L4", reporegistry: "L5" } }),
  listDelta: async () => ({ items: s.items, deltaLink: "d" }),
  resolveEmailByLookupId: async () => null,
  patchListItemFields: async () => undefined,
  createListItem: async () => "new",
  findItemByField: async () => null,
  resolveSiteUserLookupId: async () => null,
  normalizeLastModified: () => ({ source: "unknown", at: "2026-10-07T12:00:00.000Z" }),
  REPO_REGISTRY_KEY: "reporegistry",
  ROADMAP_KEY: "roadmap",
  PROJECTS_KEY: "projects",
  GraphError: class GraphError extends Error {},
}));

vi.mock("@/lib/sync/repo", () => ({
  entityCount: async () => 1,
  getEntity: async (type: string, id: string) => {
    if (type === "file") return { id };
    if (id === TASKS[TASKS.length - 1].id || s.known.has(id)) return s.row && s.row.id === id ? s.row : { id, data: {} };
    return null;
  },
  getEntities: async () => (s.row ? [s.row] : []),
  seedRepos: async () => undefined,
  getDeltaLink: async () => null,
  saveDeltaLink: async () => undefined,
  markRegisterInboundComplete: async () => undefined,
  insertConflict: async (c: Record<string, unknown>) => { s.conflicts.push(c); },
  getConflict: async (id: string) => (id === "cf-1" ? { id, entityType: "task", entityId: "TASK-2360", field: "Status", mcVal: "Cancelled", spVal: "In Progress" } : null),
  resolveConflictRow: async (id: string) => { s.resolved.push(id); },
  updateEntity: async (_t: string, id: string, opts: Record<string, unknown>, q?: unknown) => {
    const patch = opts.patch as Record<string, unknown> | undefined;
    if (s.cancelledUnderLock && patch?.stage !== undefined && patch.stage !== "cancelled") {
      const { ApiError } = await import("@/lib/api/route");
      throw new ApiError("reopen_required", "cancelled", 409);
    }
    s.updates.push({ id, opts });
    s.txOrder.push(`update:${String(q)}`);
  },
  appendAudit: async (_a: string, body: string) => { s.audits.push(body); },
  getBucketBySpItemId: async () => null,
}));

import { resolveConflict, runScopedListDelta } from "@/lib/sync/engine";

function seed(stage: string) {
  s.row = {
    entity_type: "task", id: "TASK-2360", sp_item_id: "7", sync_state: "synced", dirty_fields: [], field_attribution: {},
    data: { id: "TASK-2360", title: "t", stage, priority: "medium" },
  };
  s.known = new Set(["TASK-2360", "TASK-2341"]);
}
const item = (fields: Record<string, unknown>) => {
  s.items = [{ id: "7", fields: { TaskID: "TASK-2360", Title: "t", Priority: "Medium", ...fields } }];
};

beforeEach(() => {
  s.updates.length = 0; s.events.length = 0; s.txOrder.length = 0; s.conflicts.length = 0; s.audits.length = 0; s.items = []; s.cancelledUnderLock = false; s.resolved.length = 0;
  seed("progress");
});

describe("inbound Status=Cancelled", () => {
  it("applies with a valid reason, stores the cancellation, and attributes it to the sync actor", async () => {
    item({ Status: "Cancelled", CancelReason: "Duplicate", ReplacedBy: "TASK-2341" });
    const res = await runScopedListDelta("todos");
    expect(res).toMatchObject({ pulled: 1, conflicts: 0 });
    const write = s.updates.find((u) => (u.opts.patch as Record<string, unknown> | undefined)?.stage === "cancelled")!;
    expect(write.opts.cancellation).toMatchObject({ reason: "duplicate", replacedBy: "TASK-2341" });
    expect(s.conflicts).toEqual([]);
  });

  it.each([
    ["no CancelReason", { Status: "Cancelled" }],
    ["Duplicate without Replaced By", { Status: "Cancelled", CancelReason: "Duplicate" }],
    ["a Replaced By that does not exist", { Status: "Cancelled", CancelReason: "Superseded", ReplacedBy: "TASK-99999" }],
  ])("raises a Sync conflict and does not apply the stage (%s)", async (_n, fields) => {
    item(fields);
    const res = await runScopedListDelta("todos");
    expect(res).toMatchObject({ conflicts: 1 });
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0]).toMatchObject({ entityId: "TASK-2360", field: "Status", spVal: "cancelled" });
    expect(String(s.conflicts[0].note)).toMatch(/without a valid cancellation/);
    for (const u of s.updates) {
      expect((u.opts.patch as Record<string, unknown> | undefined)?.stage).not.toBe("cancelled");
      expect(u.opts.cancellation).toBeUndefined();
    }
  });

  it("an inbound move out of Cancelled records a Sync conflict and keeps the cancellation (no task.reopen path)", async () => {
    seed("cancelled");
    item({ Status: "In Progress" });
    const res = await runScopedListDelta("todos");
    expect(res).toMatchObject({ conflicts: 1 });
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0]).toMatchObject({ entityId: "TASK-2360", field: "Status" });
    expect(String(s.conflicts[0].note)).toMatch(/task\.reopen/);
    for (const u of s.updates) {
      expect((u.opts.patch as Record<string, unknown> | undefined)?.stage).toBeUndefined();
      expect(u.opts.dirtyFields ?? []).not.toContain("cancellation");
    }
  });

  it("an unchanged Cancelled row re-synced from SharePoint writes no cancellation", async () => {
    seed("cancelled");
    item({ Status: "Cancelled", CancelReason: "Obsolete" });
    await runScopedListDelta("todos");
    expect(s.conflicts).toEqual([]);
    for (const u of s.updates) expect(u.opts.cancellation).toBeUndefined();
  });
});

describe("inbound cancel event and reopen mirror clear (Astra P2s)", () => {
  it("a valid SharePoint cancel appends task.cancelled with the real previousStage, atomically with the write", async () => {
    seed("review");
    item({ Status: "Cancelled", CancelReason: "Duplicate", ReplacedBy: "TASK-2341" });
    await runScopedListDelta("todos");
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({
      kind: "task.cancelled",
      taskId: "TASK-2360",
      payload: { previousStage: "review", reason: "duplicate", replacedBy: "TASK-2341", source: "sharepoint" },
    });
    // update and event ran on the same transaction handle, inside begin/commit.
    expect(s.txOrder).toEqual(["begin", "update:tx", "event:tx", "commit"]);
  });

  it("no event for an invalid cancel or an already-cancelled row", async () => {
    item({ Status: "Cancelled" });
    await runScopedListDelta("todos");
    seed("cancelled");
    item({ Status: "Cancelled", CancelReason: "Obsolete" });
    await runScopedListDelta("todos");
    expect(s.events).toEqual([]);
  });

  it("an ordinary inbound edit does not mark cancellation dirty", async () => {
    seed("progress");
    item({ Status: "In Progress", Priority: "High" });
    await runScopedListDelta("todos");
    for (const u of s.updates) expect((u.opts.dirtyFields as string[] | undefined) ?? []).not.toContain("cancellation");
  });
});

describe("a cancel committing after the snapshot (Astra P1: re-check under the row lock)", () => {
  it("an inbound stage move is refused at the locked write: Sync conflict, other fields still applied, no reopen", async () => {
    seed("progress"); // the pull's snapshot predates the cancel
    s.cancelledUnderLock = true;
    item({ Status: "In Review", Priority: "High" });
    const res = await runScopedListDelta("todos");
    expect(res).toMatchObject({ conflicts: 1 });
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0]).toMatchObject({ entityId: "TASK-2360", field: "Status" });
    expect(String(s.conflicts[0].note)).toMatch(/task\.reopen/);
    const applied = s.updates.filter((u) => u.opts.patch).map((u) => u.opts.patch as Record<string, unknown>);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ priority: "high" });
    expect(applied[0]).not.toHaveProperty("stage");
  });

  it("conflict resolution keep-SP is refused when the locked write finds the task cancelled", async () => {
    seed("progress");
    s.cancelledUnderLock = true;
    expect(await resolveConflict("cf-1", "sp", "tester")).toBe(false);
    expect(s.resolved).toEqual([]);
  });
});
