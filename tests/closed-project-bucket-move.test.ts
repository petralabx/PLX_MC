// Closed-project rule on bucket re-parenting (TASK-2558): patchBucket must
// refuse moving a bucket into a closed project with 409 project_closed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project } from "@/lib/mc-data";

const store = vi.hoisted(() => ({ projects: [] as Project[], upserts: [] as Bucket[] }));

vi.mock("@/lib/sync/engine", () => ({
  ensureSeeded: vi.fn(async () => true),
  ensureReposSeeded: vi.fn(async () => {}),
  ensureProjectsSeeded: vi.fn(async () => {}),
  ensureBucketsSeeded: vi.fn(async () => {}),
}));

const bucket = {
  id: "BKT-1",
  name: "Bucket",
  owner: "vince",
  health: "track",
  target: "—",
  started: "2026.06.11",
  desc: "",
  repos: [],
  sync: { state: "pending", ts: "—", sp: "Roadmap" },
  prd: null,
  project: "PRJ-OPEN",
} as Bucket;

vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "2026.10.09 · 12:00",
  getRepos: async () => [],
  getProjects: async () => store.projects,
  getBucketRows: async () => [{ bucket, dirtyFields: [] }],
  upsertBucket: async (b: Bucket) => {
    store.upserts.push(b);
  },
  appendAudit: async () => {},
}));

import { patchBucket } from "@/lib/sync/state";

const project = (id: string, status: "active" | "closed"): Project =>
  ({ id, name: id, owner: "vince", status }) as Project;

describe("bucket re-parenting vs closed projects", () => {
  beforeEach(() => {
    store.projects = [project("PRJ-OPEN", "active"), project("PRJ-OPEN-2", "active"), project("PRJ-DONE", "closed")];
    store.upserts.length = 0;
  });

  it("rejects moving a bucket to a closed project with 409 project_closed and writes nothing", async () => {
    await expect(patchBucket("BKT-1", { project: "PRJ-DONE" }, "vince")).rejects.toMatchObject({
      code: "project_closed",
      status: 409,
      message: expect.stringContaining("PRJ-DONE"),
    });
    expect(store.upserts).toHaveLength(0);
  });

  it("allows moving a bucket to an open project", async () => {
    const next = await patchBucket("BKT-1", { project: "PRJ-OPEN-2" }, "vince");
    expect(next?.project).toBe("PRJ-OPEN-2");
    expect(store.upserts).toHaveLength(1);
  });

  it("does not block edits to a bucket already inside a project that later closed", async () => {
    store.projects = [project("PRJ-OPEN", "closed")];
    const next = await patchBucket("BKT-1", { project: "PRJ-OPEN", name: "Renamed" }, "vince");
    expect(next?.name).toBe("Renamed");
  });
});
