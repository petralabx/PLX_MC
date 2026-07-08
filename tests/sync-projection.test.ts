// EN-007 P3 — compliance projection leaves tasks pending for SharePoint push, and
// the sync sweep pushes stage changes to ToDos. Repo/graph seams mocked in-memory
// (no live DB/Graph), same technique as tests/sync-sweep-audit.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";

const h = vi.hoisted(() => ({
  rows: new Map<
    string,
    { entity_type: string; id: string; data: Record<string, unknown>; sync_state: string; sp_item_id: string | null; dirty_fields: string[] }
  >(),
  events: [] as { kind: string; taskId?: string | null; dedupKey?: string | null }[],
  dedupTaskIds: new Map<string, string>(),
  patchCalls: [] as { listKey: string; itemId: string; fields: Record<string, unknown> }[],
  audits: [] as { body: string; state: string }[],
  buckets: [
    { id: "BKT-INFRA", name: "Backend Infra", owner: "vince", health: "track" as const, target: "Oct 01", started: "2026.06.11", desc: "", repos: [], sync: { state: "synced" as const, ts: "—", sp: "—" }, prd: null as string | null, project: null },
  ],
}));

vi.mock("@/lib/sync/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sync/engine")>();
  return {
    ...actual,
    ensureReposSeeded: vi.fn(async () => false),
  };
});

vi.mock("@/lib/compliance/repo", () => ({
  async appendEvent(e: { kind: string; taskId?: string | null; dedupKey?: string | null }) {
    h.events.push(e);
    if (e.dedupKey && e.taskId) h.dedupTaskIds.set(e.dedupKey, e.taskId);
  },
  async eventTaskIdByDedupKey(dedupKey: string) {
    return h.dedupTaskIds.get(dedupKey) ?? null;
  },
}));

vi.mock("@/lib/sync/graph", () => ({
  GraphError: class GraphError extends Error {},
  siteContext: async () => ({ siteId: "s", listIds: { todos: "L-todos", risks: "L-risks", reporegistry: "L-rr", projects: "L-p", roadmap: "L-rm" } }),
  listDelta: async () => ({ items: [], deltaLink: "dl" }),
  patchListItemFields: async (_ctx: unknown, listKey: string, itemId: string, fields: Record<string, unknown>) => {
    h.patchCalls.push({ listKey, itemId, fields });
  },
  createListItem: async () => "new-item",
  findItemByField: async () => null,
  REPO_REGISTRY_KEY: "reporegistry",
  PROJECTS_KEY: "projects",
  ROADMAP_KEY: "roadmap",
  resolveSiteUserLookupId: async () => null,
  resolveEmailByLookupId: async () => null,
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.07.08 · 00:00",
  entityCount: async () => h.rows.size,
  async getRepos() {
    return [{ id: "plx-mc", name: "PLX_MC", lang: "TypeScript", def: "main", owner: "taylorvalton", visibility: "private", scope: "" }];
  },
  async getBuckets() {
    return h.buckets;
  },
  async getEntity(type: string, id: string) {
    const row = h.rows.get(`${type}:${id}`);
    if (row) return row;
    // Satisfy ensureSeeded()'s "fixtures already present" guard without loading TASKS.
    if (type === "task" || type === "file") {
      return { entity_type: type, id, data: { id }, sync_state: "synced", sp_item_id: "seed", dirty_fields: [] };
    }
    return null;
  },
  async getEntities(type: string) {
    return [...h.rows.entries()]
      .filter(([k]) => k.startsWith(`${type}:`))
      .map(([, row]) => row);
  },
  async insertEntity(type: string, id: string, data: Record<string, unknown>, syncState: string, dirtyFields: string[]) {
    h.rows.set(`${type}:${id}`, {
      entity_type: type,
      id,
      data,
      sync_state: syncState,
      sp_item_id: null,
      dirty_fields: dirtyFields,
    });
  },
  async updateEntity(
    type: string,
    id: string,
    opts: { patch?: Record<string, unknown>; syncState?: string; dirtyFields?: string[] }
  ) {
    const row = h.rows.get(`${type}:${id}`);
    if (!row) return;
    row.data = { ...row.data, ...(opts.patch ?? {}) };
    if (opts.syncState !== undefined) row.sync_state = opts.syncState;
    if (opts.dirtyFields !== undefined) row.dirty_fields = opts.dirtyFields;
  },
  async appendAudit(_actor: string, body: string, state: string) {
    h.audits.push({ body, state });
  },
  getDeltaLink: async () => null,
  saveDeltaLink: async () => {},
  insertConflict: async () => {},
  insertPushError: async () => {},
  countsByList: async () => ({}),
  seedRepos: async () => {},
  getProjectRows: async () => [],
  getBucketRows: async () => [],
}));

import { projectPullRequest } from "@/lib/compliance/projection";
import { runSweep } from "@/lib/sync/engine";

function seedTask(over: Partial<Task> = {}): Task {
  const base: Task = {
    id: "TASK-500",
    title: "Projection push test",
    description: "",
    bucket: "BKT-INFRA",
    stage: "progress",
    priority: "medium",
    assignee: null,
    coassignees: [],
    reporter: "vince",
    accountableOwner: "vince",
    reqs: [],
    repos: ["plx-mc"],
    estimate: "M",
    labels: [],
    prs: [],
    due: "Jul 8",
    sync: { state: "synced", ts: "—", sp: "ToDos · item 500" },
    subtasks: [],
    activity: [],
    ...over,
  };
  h.rows.set("task:" + base.id, {
    entity_type: "task",
    id: base.id,
    data: base as unknown as Record<string, unknown>,
    sync_state: "synced",
    sp_item_id: "sp-500",
    dirty_fields: [],
  });
  return base;
}

beforeEach(() => {
  h.rows.clear();
  h.events.length = 0;
  h.dedupTaskIds.clear();
  h.patchCalls.length = 0;
  h.audits.length = 0;
  delete process.env.COMPLIANCE_PROJECTION_ENABLED;
});

describe("compliance projection → sync pending queue", () => {
  it("marks the task pending with stage dirty after a merged PR projection", async () => {
    seedTask({ id: "TASK-500", stage: "progress" });

    await projectPullRequest(
      {
        action: "closed",
        merged: true,
        repo: "PLX_MC",
        prNumber: 99,
        headSha: "merge-sha",
        branch: "feat/x",
        title: "Ship projection",
        author: "greg",
        labels: [],
        checkoutId: "dsp_test",
        checkoutIds: ["dsp_test"],
      },
      { actorKind: "agent", actorIdentity: "cursor", taskIds: ["TASK-500"], sparse: false }
    );

    const row = h.rows.get("task:TASK-500")!;
    expect((row.data as unknown as Task).stage).toBe("merged");
    expect(row.sync_state).toBe("pending");
    expect(row.dirty_fields).toContain("stage");
    expect(h.events.some((e) => e.kind === "task.promoted")).toBe(true);
  });

  it("pushes the merged stage to SharePoint ToDos on the next sweep", async () => {
    seedTask({ id: "TASK-501", stage: "merged", prs: [{ repo: "PLX_MC", num: 100, status: "merged", title: "Ship" }] });
    const row = h.rows.get("task:TASK-501")!;
    row.sync_state = "pending";
    row.dirty_fields = ["stage"];

    const result = await runSweep("compliance-projection-test");
    expect(result.pushed).toBe(1);
    expect(h.patchCalls).toHaveLength(1);
    expect(h.patchCalls[0]).toMatchObject({ listKey: "todos", itemId: "sp-500" });
    expect(h.patchCalls[0].fields.Status).toBe("Merged");
    expect(h.audits.some((a) => a.body.startsWith("Sweep completed"))).toBe(true);
  });
});
