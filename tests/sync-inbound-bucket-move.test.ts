// TASK-2533 — an inbound SharePoint Initiative change is validated like an
// mc_update_task bucket move: unknown/archived/closed/restricted targets are
// refused with an audit line, valid ones apply.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  buckets: new Map<string, Record<string, unknown>>(),
  projects: [] as Record<string, unknown>[],
  patches: [] as Record<string, unknown>[],
  audits: [] as string[],
  lookup: "9",
  conflicts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  resolved: [] as unknown[][],
}));

vi.mock("@/lib/db", () => ({ query: async () => [], withTransaction: async (fn: (q: unknown) => Promise<unknown>) => fn(async () => []) }));
vi.mock("@/lib/sync/graph", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GraphError: class GraphError extends Error {},
  siteContext: async () => ({ siteId: "s", listIds: { todos: "t", risks: "r", projects: "p", roadmap: "m", documents: "d" } }),
  listDelta: async () => ({
    items: [{ id: "sp1", fields: { TaskID: "TASK-1", Title: "T", InitiativeLookupId: h.lookup } }],
    deltaLink: "dl",
  }),
  resolveEmailByLookupId: async () => null,
  resolveSiteUserLookupId: async () => null,
  REPO_REGISTRY_KEY: "reporegistry", PROJECTS_KEY: "projects", ROADMAP_KEY: "roadmap",
}));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "now",
  entityCount: async () => 1,
  getEntity: async (_t: string, id: string) => (id === "TASK-1"
    ? { entity_type: "task", id, sp_item_id: "sp1", sync_state: "conflict", dirty_fields: ["bucket"], field_attribution: {}, data: { id, bucket: "BKT-OLD" } }
    : { id: "seed" }),
  getConflict: async (id: string) => {
    const c = h.conflicts.find((x) => x.id === id);
    return c ? { ...c, entityType: c.entityType } : null;
  },
  resolveConflictRow: async (...args: unknown[]) => { h.resolved.push(args); },
  getEntities: async () => [{
    entity_type: "task", id: "TASK-1", sp_item_id: "sp1", sync_state: "synced", dirty_fields: [], field_attribution: {},
    data: { id: "TASK-1", title: "T", bucket: "BKT-OLD" },
  }],
  getBucketBySpItemId: async (id: string) => (h.buckets.has(id) ? { bucket: h.buckets.get(id) } : null),
  getProjects: async () => h.projects,
  getBuckets: async () => [...h.buckets.values()],
  appendAudit: async (_a: string, body: string) => { h.audits.push(body); },
  updateEntity: async (_t: string, _id: string, opts: { patch?: Record<string, unknown> }) => {
    h.updates.push(opts);
    if (opts.patch) h.patches.push(opts.patch);
  },
  getDeltaLink: async () => null,
  saveDeltaLink: async () => {},
  markRegisterInboundComplete: async () => {},
  insertConflict: async (c: Record<string, unknown>) => { h.conflicts.push(c); },
  seedRepos: async () => {}, seedBuckets: async () => {}, seedProjects: async () => {},
  getRepos: async () => [], getProjectRows: async () => [], getBucketRows: async () => [],
}));

import { resolveConflict, runScopedListDelta } from "@/lib/sync/engine";

const move = async () => { h.patches.length = 0; h.audits.length = 0; h.conflicts.length = 0; h.updates.length = 0; h.resolved.length = 0; await runScopedListDelta("todos"); };

beforeEach(() => {
  h.buckets = new Map([["9", { id: "BKT-NEW", project: null }]]);
  h.projects = [];
  h.lookup = "9";
});

describe("inbound ToDos Initiative change", () => {
  it("applies a move to an open bucket", async () => {
    await move();
    expect(h.patches[0]).toMatchObject({ bucket: "BKT-NEW" });
    expect(h.conflicts).toHaveLength(0);
    expect(h.updates.some((u) => u.syncState === "conflict")).toBe(false);
  });
  it("refuses an archived bucket, a closed project and a restricted project", async () => {
    for (const [bucket, projects] of [
      [{ id: "BKT-NEW", project: null, archived: true }, []],
      [{ id: "BKT-NEW", project: "PRJ-C" }, [{ id: "PRJ-C", status: "closed" }]],
      [{ id: "BKT-NEW", project: "PRJ-R" }, [{ id: "PRJ-R", visibility: "restricted", members: ["a@b.c"] }]],
    ] as const) {
      h.buckets = new Map([["9", { ...bucket }]]);
      h.projects = [...projects];
      await move();
      expect(h.patches.some((p) => "bucket" in p)).toBe(false);
      expect(h.audits.join("\n")).toMatch(/bucket change refused on TASK-1 → BKT-NEW/);
    }
  });
  it("records a rejected move as an open Initiative conflict and holds the task out of the outbound sweep", async () => {
    h.buckets = new Map([["9", { id: "BKT-NEW", project: null, archived: true }]]);
    await move();
    expect(h.patches.some((p) => "bucket" in p)).toBe(false);
    expect(h.conflicts).toHaveLength(1);
    expect(h.conflicts[0]).toMatchObject({
      entityType: "task", entityId: "TASK-1", field: "Initiative", mcVal: "BKT-OLD", spVal: "BKT-NEW", by: "scribe",
    });
    // Outbound sweep only pushes sync_state === "pending"; "conflict" is held.
    expect(h.updates.find((u) => u.syncState === "conflict")).toMatchObject({ syncExtras: { wsVal: "BKT-OLD", spVal: "BKT-NEW" } });
    expect(h.audits.join("\n")).toMatch(/bucket change refused on TASK-1 → BKT-NEW/);
    expect(h.audits.join("\n")).toMatch(/Conflict detected on TASK-1 · Initiative/);
  });
  it("resolves a rejected-move conflict through the existing flow (keep SharePoint applies the bucket)", async () => {
    h.buckets = new Map([["9", { id: "BKT-NEW", project: null, archived: true }]]);
    await move();
    const id = String(h.conflicts[0].id);
    h.updates.length = 0;
    await expect(resolveConflict(id, "sp", "vince")).resolves.toBe(true);
    expect(h.updates[0]).toMatchObject({ patch: { bucket: "BKT-NEW" }, syncState: "synced" });
    expect(h.resolved).toEqual([[id, "sp"]]);
  });
});
