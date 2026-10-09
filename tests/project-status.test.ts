// Project lifecycle status (TASK-2530): patchProject stamps closedAt/closedBy,
// and creating a bucket or task under a closed project is rejected until the
// project is reopened. engine + db repo are mocked (hermetic, no live DB).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project } from "@/lib/mc-data";
import { isProjectClosed } from "@/lib/mc-data/helpers";
import { navBuckets, navProjects, pickerProjects, projectById, resetStore, updateProject } from "@/lib/mc-data/store";

const store = vi.hoisted(() => ({
  projects: [] as Project[],
  buckets: [] as Bucket[],
  upserts: [] as Project[],
  bucketUpserts: [] as Bucket[],
}));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureProjectsSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  withTransaction: async <T>(fn: (q: unknown) => Promise<T>) =>
    fn(async (text: string) => (text.includes("INSERT INTO entities") ? [{ id: "TASK-9001" }] : [])),
}));

vi.mock("@/lib/routing/repo", () => ({
  allocateNextTaskId: vi.fn(async () => "TASK-9001"),
}));

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.07 · 12:00",
  async getRepos() {
    return [];
  },
  async getProjects() {
    return store.projects;
  },
  async getBuckets() {
    return store.buckets;
  },
  async upsertProject(p: Project) {
    store.upserts.push(p);
    store.projects = store.projects.map((row) => (row.id === p.id ? p : row));
  },
  async upsertBucket(b: Bucket) {
    store.bucketUpserts.push(b);
  },
  async setProjectSync() {},
  async setBucketSync() {},
  async appendAudit() {},
}));

import { createBucket, createTask, patchProject } from "@/lib/sync/state";

const project = (over: Partial<Project> = {}): Project => ({
  id: "PRJ-DONE",
  name: "Done project",
  owner: "vince",
  health: "track",
  target: "—",
  started: "2026.06.11",
  desc: "",
  repos: [],
  sync: { state: "pending", ts: "—", sp: "Projects · unprovisioned" },
  prd: null,
  ...over,
});

const bucket = (): Bucket => ({
  id: "BKT-DONE",
  name: "Done bucket",
  owner: "vince",
  health: "track",
  target: "—",
  started: "2026.06.11",
  desc: "",
  repos: [],
  sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" },
  prd: null,
  project: "PRJ-DONE",
});

beforeEach(() => {
  store.projects = [project()];
  store.buckets = [bucket()];
  store.upserts.length = 0;
  store.bucketUpserts.length = 0;
  resetStore();
});

describe("patchProject status (TASK-2530)", () => {
  it("stamps closedAt/closedBy on close and clears them on reopen, leaving health alone", async () => {
    const closed = await patchProject("PRJ-DONE", { status: "closed" }, "vince@petrasoap.com");
    expect(closed?.status).toBe("closed");
    expect(closed?.closedBy).toBe("vince@petrasoap.com");
    expect(Number.isNaN(Date.parse(closed?.closedAt ?? ""))).toBe(false);
    expect(closed?.health).toBe("track");

    const reopened = await patchProject("PRJ-DONE", { status: "active" }, "vince@petrasoap.com");
    expect(reopened?.status).toBe("active");
    expect(reopened?.closedAt).toBeNull();
    expect(reopened?.closedBy).toBeNull();
  });

  it("does not restamp a project that is already closed", async () => {
    store.projects = [project({ status: "closed", closedAt: "2026-10-01T00:00:00.000Z", closedBy: "ledger" })];
    const next = await patchProject("PRJ-DONE", { status: "closed" }, "someone-else");
    expect(next?.closedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(next?.closedBy).toBe("ledger");
  });
});

describe("closed project blocks new work", () => {
  it("rejects createBucket and createTask under a closed project, then allows both after reopen", async () => {
    await patchProject("PRJ-DONE", { status: "closed" }, "vince");

    await expect(createBucket({ name: "New bucket", project: "PRJ-DONE" })).rejects.toMatchObject({
      code: "project_closed",
      status: 409,
    });
    await expect(
      createTask({ title: "New task", bucket: "BKT-DONE", reporter: "vince" })
    ).rejects.toMatchObject({ code: "project_closed", status: 409 });
    expect(store.bucketUpserts).toHaveLength(0);

    await patchProject("PRJ-DONE", { status: "active" }, "vince");

    const created = await createBucket({ name: "New bucket", project: "PRJ-DONE" });
    expect(created.project).toBe("PRJ-DONE");
    const task = await createTask({ title: "New task", bucket: "BKT-DONE", reporter: "vince" });
    expect(task.id).toBe("TASK-9001");
  });
});

describe("closed projects in client nav and pickers", () => {
  it("drops a closed project and its buckets from nav but keeps it as the selected picker value", () => {
    const id = "PRJ-PORTAL-GOLIVE";
    expect(navProjects().some((p) => p.id === id)).toBe(true);
    expect(navBuckets().some((b) => b.project === id)).toBe(true);

    updateProject(id, { status: "closed" });

    expect(isProjectClosed(projectById(id))).toBe(true);
    expect(navProjects().some((p) => p.id === id)).toBe(false);
    expect(navBuckets().some((b) => b.project === id)).toBe(false);
    expect(projectById(id)).toBeDefined(); // deep link still resolves
    expect(pickerProjects().some((p) => p.id === id)).toBe(false);
    expect(pickerProjects(id).some((p) => p.id === id)).toBe(true);

    updateProject(id, { status: "active" });
    expect(navProjects().some((p) => p.id === id)).toBe(true);
  });
});
