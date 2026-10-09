// Closed-project rule on sync conflict resolution (TASK-2558): keeping the
// SharePoint value must not move a task/bucket into a closed project.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  conflict: { id: "cf-1", entityType: "task", entityId: "TASK-1", field: "Initiative", mcVal: "BKT-OPEN", spVal: "BKT-DONE" } as Record<string, string>,
  task: { id: "TASK-1", data: { id: "TASK-1", bucket: "BKT-OPEN" }, dirty_fields: ["bucket"], field_attribution: {}, sp_item_id: "1" } as Record<string, unknown>,
  bucketRow: { bucket: { id: "BKT-OPEN", project: "PRJ-OPEN" }, syncState: "pending", spItemId: "2", dirtyFields: ["project"], fieldAttribution: {} } as Record<string, unknown>,
  buckets: [
    { id: "BKT-OPEN", project: "PRJ-OPEN" },
    { id: "BKT-OPEN-2", project: "PRJ-OPEN" },
    { id: "BKT-DONE", project: "PRJ-DONE" },
  ],
  projects: [
    { id: "PRJ-OPEN", status: "active" },
    { id: "PRJ-OPEN-2", status: "active" },
    { id: "PRJ-DONE", status: "closed" },
  ],
  updateEntity: vi.fn(),
  updateBucket: vi.fn(),
  resolveConflictRow: vi.fn(),
  appendAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: async () => [] }));
vi.mock("@/lib/sync/repo", () => ({
  stamp: () => "now",
  getConflict: async () => h.conflict,
  getEntity: async () => h.task,
  getBucketRows: async () => [h.bucketRow],
  getProjectRows: async () => [],
  getBuckets: async () => h.buckets,
  getProjects: async () => h.projects,
  updateEntity: h.updateEntity,
  updateBucket: h.updateBucket,
  resolveConflictRow: h.resolveConflictRow,
  appendAudit: h.appendAudit,
}));

import { resolveConflict } from "@/lib/sync/engine";

const setTaskConflict = (spVal: string) => {
  h.conflict = { id: "cf-1", entityType: "task", entityId: "TASK-1", field: "bucket", mcVal: "BKT-OPEN", spVal };
};
const setBucketConflict = (spVal: string) => {
  h.conflict = { id: "cf-1", entityType: "bucket", entityId: "BKT-OPEN", field: "project", mcVal: "PRJ-OPEN", spVal };
};

describe("SharePoint-wins conflict resolution vs closed projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a task bucket conflict targeting a closed project, leaves it unresolved and the bucket unchanged", async () => {
    setTaskConflict("BKT-DONE");
    await expect(resolveConflict("cf-1", "sp", "vince")).rejects.toMatchObject({ code: "project_closed", status: 409 });
    expect(h.updateEntity).not.toHaveBeenCalled();
    expect(h.resolveConflictRow).not.toHaveBeenCalled();
    expect(h.appendAudit).toHaveBeenCalledWith("vince", expect.stringContaining("left unresolved"), "error");
  });

  it("applies a task bucket conflict targeting an open project", async () => {
    setTaskConflict("BKT-OPEN-2");
    await expect(resolveConflict("cf-1", "sp", "vince")).resolves.toBe(true);
    expect(h.updateEntity).toHaveBeenCalledWith("task", "TASK-1", expect.objectContaining({ patch: { bucket: "BKT-OPEN-2" } }));
    expect(h.resolveConflictRow).toHaveBeenCalledWith("cf-1", "sp");
  });

  it("refuses a bucket project conflict targeting a closed project", async () => {
    setBucketConflict("PRJ-DONE");
    await expect(resolveConflict("cf-1", "sp", "vince")).rejects.toMatchObject({ code: "project_closed" });
    expect(h.updateBucket).not.toHaveBeenCalled();
    expect(h.resolveConflictRow).not.toHaveBeenCalled();
  });

  it("applies a bucket project conflict targeting an open project", async () => {
    setBucketConflict("PRJ-OPEN-2");
    await expect(resolveConflict("cf-1", "sp", "vince")).resolves.toBe(true);
    expect(h.updateBucket).toHaveBeenCalled();
  });
});
