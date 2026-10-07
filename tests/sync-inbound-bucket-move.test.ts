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
  getEntity: async () => ({ id: "seed" }),
  getEntities: async () => [{
    entity_type: "task", id: "TASK-1", sp_item_id: "sp1", sync_state: "synced", dirty_fields: [], field_attribution: {},
    data: { id: "TASK-1", title: "T", bucket: "BKT-OLD" },
  }],
  getBucketBySpItemId: async (id: string) => (h.buckets.has(id) ? { bucket: h.buckets.get(id) } : null),
  getProjects: async () => h.projects,
  appendAudit: async (_a: string, body: string) => { h.audits.push(body); },
  updateEntity: async (_t: string, _id: string, opts: { patch?: Record<string, unknown> }) => { if (opts.patch) h.patches.push(opts.patch); },
  getDeltaLink: async () => null,
  saveDeltaLink: async () => {},
  markRegisterInboundComplete: async () => {},
  insertConflict: async () => {},
  seedRepos: async () => {}, seedBuckets: async () => {}, seedProjects: async () => {},
  getRepos: async () => [], getProjectRows: async () => [], getBucketRows: async () => [],
}));

import { runScopedListDelta } from "@/lib/sync/engine";

const move = async () => { h.patches.length = 0; h.audits.length = 0; await runScopedListDelta("todos"); };

beforeEach(() => {
  h.buckets = new Map([["9", { id: "BKT-NEW", project: null }]]);
  h.projects = [];
  h.lookup = "9";
});

describe("inbound ToDos Initiative change", () => {
  it("applies a move to an open bucket", async () => {
    await move();
    expect(h.patches[0]).toMatchObject({ bucket: "BKT-NEW" });
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
});
