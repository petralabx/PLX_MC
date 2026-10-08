// TASK-2528 acceptance 3: a task created directly in merged/verified gets
// completed_at at creation. REST POST /api/tasks and the MCP create tool both
// go through createTask, so this covers both. Same hermetic mocks as
// sync-state-repos.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ inserts: [] as { sql: string; params: unknown[] }[] }));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  withTransaction: async <T>(fn: (q: unknown) => Promise<T>) =>
    fn(async (text: string, params: unknown[] = []) => {
      if (text.includes("INSERT INTO entities")) {
        store.inserts.push({ sql: text, params });
        return [{ id: "TASK-9001" }];
      }
      return [];
    }),
}));

vi.mock("@/lib/routing/repo", () => ({ allocateNextTaskId: vi.fn(async () => "TASK-9001") }));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.06.18 · 00:00",
  async getRepos() {
    return [];
  },
  async getBuckets() {
    return [{ id: "BKT-WMS", name: "WMS", owner: "vince" }];
  },
  async appendAudit() {},
}));

import { createTask } from "@/lib/sync/state";

beforeEach(() => {
  store.inserts.length = 0;
});

const completedAtParam = () => store.inserts.at(-1)!.params[3];

describe("createTask completed_at", () => {
  it.each(["merged", "verified"] as const)("stamps a task created straight into %s", async (stage) => {
    await createTask({ title: "t", bucket: "BKT-WMS", reporter: "vince", stage });
    expect(completedAtParam()).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
    expect(store.inserts.at(-1)!.sql).toMatch(/completed_at\s*\)\s*VALUES \('task'/);
  });

  it.each([undefined, "backlog", "progress", "review"] as const)(
    "leaves completed_at NULL for stage %s",
    async (stage) => {
      await createTask({ title: "t", bucket: "BKT-WMS", reporter: "vince", stage });
      expect(completedAtParam()).toBeNull();
    }
  );

  it("never persists completedAt into the jsonb payload", async () => {
    await createTask({ title: "t", bucket: "BKT-WMS", reporter: "vince", stage: "merged" });
    expect(JSON.parse(String(store.inserts.at(-1)!.params[1]))).not.toHaveProperty("completedAt");
  });

  it("only ever writes task rows", async () => {
    await createTask({ title: "t", bucket: "BKT-WMS", reporter: "vince", stage: "merged" });
    expect(store.inserts.at(-1)!.sql).toMatch(/VALUES \('task'/);
  });
});
