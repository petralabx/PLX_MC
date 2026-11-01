// TASK-4005 (Vince, 2026-10-26): every task sits in a bucket of a project. createTask
// is the door for the UI, REST POST /api/tasks, MCP mc_create_task and draft accept;
// routing-task-creation.test.ts covers mc_create_routed_task.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  inserts: [] as unknown[],
  buckets: [] as { id: string; name: string; project?: string | null }[],
  projects: [] as { id: string; name: string; status?: string }[],
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
  ensureProjectsSeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  withTransaction: async <T>(fn: (q: unknown) => Promise<T>) =>
    fn(async (text: string, params: unknown[] = []) => {
      if (text.includes("INSERT INTO entities")) {
        store.inserts.push(params);
        return [{ id: "TASK-9001" }];
      }
      return [];
    }),
}));

vi.mock("@/lib/routing/repo", () => ({ allocateNextTaskId: vi.fn(async () => "TASK-9001") }));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.11.01 · 00:00",
  async getRepos() {
    return [];
  },
  async getBuckets() {
    return store.buckets;
  },
  async getProjects() {
    return store.projects;
  },
  async appendAudit() {},
}));

import { createTask } from "@/lib/sync/state";
import { assertBucketHasProject } from "@/lib/sync/bucket-project";

beforeEach(() => {
  store.inserts.length = 0;
  store.projects = [{ id: "PRJ-OPS", name: "Ops" }];
});

describe("createTask needs a bucket of a project (TASK-4005)", () => {
  it("creates a task in a bucket of a project", async () => {
    store.buckets = [{ id: "BKT-OPS", name: "Ops", project: "PRJ-OPS" }];
    await createTask({ title: "t", bucket: "BKT-OPS", reporter: "vince" });
    expect(store.inserts).toHaveLength(1);
  });

  it.each([
    ["no project", null, /BKT-LOOSE belongs to no project/],
    ["a missing project", "PRJ-GONE", /BKT-LOOSE names project PRJ-GONE, which does not exist/],
  ])("refuses a bucket with %s before any write", async (_label, project, message) => {
    store.buckets = [{ id: "BKT-LOOSE", name: "Loose", project }];
    await expect(createTask({ title: "t", bucket: "BKT-LOOSE", reporter: "vince" })).rejects.toMatchObject({
      code: "bucket_without_project",
      status: 422,
      message: expect.stringMatching(message),
    });
    expect(store.inserts).toHaveLength(0);
  });

  it("still refuses a closed project", async () => {
    store.buckets = [{ id: "BKT-OPS", name: "Ops", project: "PRJ-OPS" }];
    store.projects = [{ id: "PRJ-OPS", name: "Ops", status: "closed" }];
    await expect(createTask({ title: "t", bucket: "BKT-OPS", reporter: "vince" })).rejects.toMatchObject({
      code: "project_closed",
    });
  });
});

describe("assertBucketHasProject", () => {
  it("passes only a bucket whose project exists", () => {
    const projects = [{ id: "PRJ-A" }];
    expect(() => assertBucketHasProject({ id: "B", project: "PRJ-A" }, projects)).not.toThrow();
    for (const project of [undefined, null, "", "  ", "PRJ-B"]) {
      expect(() => assertBucketHasProject({ id: "B", project }, projects)).toThrow(/project/);
    }
  });
});
