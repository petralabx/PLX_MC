// Regression (hardener / Item 2 auditor finding): server createTask must enforce
// the repo allow-list against the PERSISTED registry (canonical seed + approved
// repos), not the fixture REPOS — otherwise a repo that was approved and
// persisted via upsertRepo is still rejected by POST /api/tasks. The engine +
// db repo are mocked so the test is hermetic.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  repos: [] as { id: string; name: string; lang: string; def: string; owner: string; visibility: string; scope: string }[],
  entities: [] as { id: string }[],
  audits: [] as { actor: string; body: string; state: string }[],
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  withTransaction: async <T>(fn: (q: unknown) => Promise<T>) => {
    const q = async (text: string, _params: unknown[] = []) => {
      if (text.includes("INSERT INTO entities")) {
        return [{ id: "TASK-9001" }];
      }
      return [];
    };
    return fn(q);
  },
}));

vi.mock("@/lib/routing/repo", () => ({
  allocateNextTaskId: vi.fn(async () => "TASK-9001"),
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.06.18 · 00:00",
  async getRepos() {
    return store.repos;
  },
  async getBuckets() {
    return [{ id: "BKT-WMS", name: "WMS", owner: "vince" }];
  },
  async getEntities() {
    return store.entities;
  },
  async insertEntity() {
    /* no-op */
  },
  async appendAudit(actor: string, body: string, state: string) {
    store.audits.push({ actor, body, state });
  },
}));

import { createTask } from "@/lib/sync/state";

beforeEach(() => {
  // The persisted registry holds an APPROVED repo that is NOT in the data.ts
  // fixture REPOS (portal-web / agentic-swarm / plx-mc).
  store.repos = [
    { id: "approved-svc", name: "approved-svc", lang: "TypeScript", def: "main", owner: "taylorvalton", visibility: "private", scope: "approved via the self-service queue" },
  ];
  store.entities = [];
  store.audits.length = 0;
});

describe("createTask — repo allow-list uses the persisted registry (Item 2)", () => {
  it("accepts a repo that is in the persisted registry but NOT in the fixture", async () => {
    const task = await createTask({
      title: "wire the approved service",
      bucket: "BKT-WMS",
      reporter: "vince",
      repos: ["approved-svc"],
    });
    expect(task.repos).toEqual(["approved-svc"]);
  });

  it("still rejects a repo that is in neither the registry nor the fixture", async () => {
    await expect(
      createTask({ title: "ghost", bucket: "BKT-WMS", reporter: "vince", repos: ["ghost-repo"] })
    ).rejects.toMatchObject({ code: "repo_not_allowed" });
  });
});
