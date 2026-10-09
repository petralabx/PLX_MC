import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project } from "@/lib/mc-data/types";

const h = vi.hoisted(() => ({
  projects: [] as { project: Project; syncState: string; spItemId: string; dirtyFields: string[] }[],
  buckets: [] as { bucket: Bucket; syncState: string; spItemId: string; dirtyFields: string[] }[],
  tasks: [] as Record<string, unknown>[],
  deltas: {} as Record<string, Record<string, unknown>[]>,
  saved: [] as string[], audits: [] as string[],
  failure: undefined as Error | undefined,
  taskInsert: vi.fn(), bucketInsert: vi.fn(), push: vi.fn(), update: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: async () => [], withTransaction: async (fn: (q: unknown) => unknown) => fn(async () => []) }));
vi.mock("@/lib/sync/graph", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  siteContext: async () => ({ siteId: "s", listIds: { todos: "t", risks: "r", projects: "p", roadmap: "m" } }),
  listDelta: async (_ctx: unknown, key: string) => ({ items: h.deltas[key] ?? [], deltaLink: `dl-${key}` }),
  patchListItemFields: h.push,
  resolveSiteUserLookupId: async () => null,
}));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "now", entityCount: async () => 1, getEntity: async () => ({ id: "seed" }),
  seedRepos: async () => {}, seedBuckets: async () => {}, seedProjects: async () => {},
  getRepos: async () => [], getProjects: async () => h.projects.map((r) => r.project),
  getProjectRows: async () => h.projects, getBucketRows: async () => h.buckets,
  getBuckets: async () => h.buckets.map((r) => r.bucket),
  getBucketBySpItemId: async (id: string) => h.buckets.find((r) => r.spItemId === id),
  getEntities: async (type: string) => type === "task" ? h.tasks : [],
  getDeltaLink: async () => null,
  saveDeltaLink: async (key: string, dl: string) => { h.saved.push(`${key}:${dl}`); },
  markRegisterInboundComplete: async () => {},
  appendAudit: async (_actor: string, body: string) => { h.audits.push(body); },
  insertAdoptedTask: h.taskInsert, insertAdoptedBucket: h.bucketInsert,
  updateEntity: h.update, countsByList: async () => ({}),
  setProjectSync: async () => {}, setBucketSync: async () => {},
}));
import { runSweep } from "@/lib/sync/engine";
import { archiveContainer } from "@/lib/sync/archive";
vi.mock("@/lib/compliance/repo", () => ({ appendEventTx: async () => {} }));

beforeEach(() => {
  vi.clearAllMocks();
  h.saved = []; h.audits = []; h.failure = undefined;
  h.projects = [{ project: { id: "PRJ-A", archivedAt: "2026-10-09" } as Project, syncState: "conflict", spItemId: "1", dirtyFields: ["name"] }];
  h.buckets = [{ bucket: { id: "BKT-A", project: "PRJ-A", archivedAt: "2026-10-09" } as Bucket, syncState: "conflict", spItemId: "2", dirtyFields: ["name"] }];
  h.tasks = [{ id: "TASK-1", entity_type: "task", sp_item_id: "3", sync_state: "pending", dirty_fields: ["title"], data: { id: "TASK-1", title: "existing", bucket: "BKT-A" } }];
  h.deltas = {
    roadmap: [{ id: "new-bucket", fields: { InitiativeID: "BKT-NEW", Title: "New", ProjectLookupId: "1" } }],
    todos: [{ id: "new-task", fields: { TaskID: "TASK-2", Title: "New", InitiativeLookupId: "2" } },
      { id: "3", fields: { TaskID: "TASK-1", Description: "existing task still syncs" } }],
  };
  const insert = async () => { throw h.failure ?? Object.assign(new Error("project is archived"), { code: "23514" }); };
  h.taskInsert.mockImplementation(insert); h.bucketInsert.mockImplementation(insert);
});
describe("archived inbound adoption", () => {
  it("audits new task and bucket skips, advances cursors, syncs existing archived tasks and runs outbound", async () => {
    const result = await runSweep();
    expect(result).toMatchObject({ skippedInbound: 2, adoptedInbound: 0, pushed: 1, pulled: 1 });
    expect(h.taskInsert).not.toHaveBeenCalled(); expect(h.bucketInsert).not.toHaveBeenCalled();
    expect(h.saved).toEqual(expect.arrayContaining(["todos:dl-todos", "roadmap:dl-roadmap"]));
    expect(h.audits.filter((a) => a.includes("archived container"))).toHaveLength(2);
    expect(h.audits.join("\n")).toContain("TASK-2 spItem=new-task");
    expect(h.audits.join("\n")).toContain("BKT-NEW spItem=new-bucket");
    expect(h.update).toHaveBeenCalledWith("task", "TASK-1", expect.objectContaining({ patch: { description: "existing task still syncs" } }));
    expect(h.push).toHaveBeenCalledWith(expect.anything(), "todos", "3", expect.anything());
  });
  it("audits archive race rejections and still advances both cursors and pushes", async () => {
    h.projects[0].project.archivedAt = null; h.buckets[0].bucket.archivedAt = null;
    const result = await runSweep();
    expect(result).toMatchObject({ skippedInbound: 2, adoptedInbound: 0, pushed: 1 });
    expect(h.taskInsert).toHaveBeenCalledOnce(); expect(h.bucketInsert).toHaveBeenCalledOnce();
    expect(h.saved).toEqual(expect.arrayContaining(["todos:dl-todos", "roadmap:dl-roadmap"]));
    expect(h.audits.filter((a) => a.includes("archived container"))).toHaveLength(2);
  });
  it("checks parent archive state even when the task bucket itself is not archived", async () => {
    h.buckets[0].bucket.archivedAt = null;
    await runSweep();
    expect(h.taskInsert).not.toHaveBeenCalled();
  });
  it("does not swallow unrelated check violations", async () => {
    h.projects[0].project.archivedAt = null; h.buckets[0].bucket.archivedAt = null;
    h.failure = Object.assign(new Error("other constraint"), { code: "23514" });
    await expect(runSweep()).rejects.toThrow("other constraint");
  });
  it.each(["archive", "unarchive"] as const)("keeps project and bucket conflicts out of outbound after %s", async (action) => {
    // Model the SQL update against the persisted conflict state; the separate
    // PostgreSQL harness validates the database archive guards/backfill.
    const db = await import("@/lib/db");
    vi.spyOn(db, "withTransaction").mockImplementation(async (fn) => fn((async (sql: string) => {
      if (sql.startsWith("UPDATE")) {
        expect(sql).toContain("CASE WHEN sync_state = 'conflict' THEN 'conflict' ELSE 'pending' END");
      }
      return [];
    }) as never));
    await archiveContainer({ entityType: "project", id: "PRJ-A", action, reason: "retirement", actor: "vince", force: true });
    h.projects[0].project.archivedAt = null;
    await archiveContainer({ entityType: "bucket", id: "BKT-A", action, reason: "retirement", actor: "vince", force: true });
    h.deltas = {};
    await runSweep();
    expect(h.push.mock.calls.map((args) => args[1])).toEqual(["todos"]);
  });
});
