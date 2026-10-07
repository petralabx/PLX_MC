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
  updateEntity: async (_t: string, id: string, opts: Record<string, unknown>) => { s.updates.push({ id, opts }); },
  appendAudit: async (_a: string, body: string) => { s.audits.push(body); },
  getBucketBySpItemId: async () => null,
}));

import { runScopedListDelta } from "@/lib/sync/engine";

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
  s.updates.length = 0; s.conflicts.length = 0; s.audits.length = 0; s.items = [];
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

  it("an unchanged Cancelled row re-synced from SharePoint writes no cancellation", async () => {
    seed("cancelled");
    item({ Status: "Cancelled", CancelReason: "Obsolete" });
    await runScopedListDelta("todos");
    expect(s.conflicts).toEqual([]);
    for (const u of s.updates) expect(u.opts.cancellation).toBeUndefined();
  });
});
