// Closed-project rule on REST task update (TASK-2558): PATCH /api/tasks/{id}
// must refuse a bucket move into a closed project with 409 project_closed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  patchTask: vi.fn(),
  task: { data: { id: "TASK-1", bucket: "BKT-OPEN" } } as { data: { id: string; bucket: string } } | null,
  buckets: [
    { id: "BKT-OPEN", project: "PRJ-OPEN" },
    { id: "BKT-OPEN-2", project: "PRJ-OPEN" },
    { id: "BKT-DONE", project: "PRJ-DONE" },
  ],
  projects: [
    { id: "PRJ-OPEN", status: "active" },
    { id: "PRJ-DONE", status: "closed" },
  ],
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: async () => ({ actor: {}, actorId: "oid-1", auditLabel: "vince@example.com" }),
  aclPrincipalFromAuthorized: () => ({ tokens: ["oid-1"] }),
}));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: async () => undefined,
  assertTaskProjectAccess: async () => undefined,
}));
vi.mock("@/lib/sync", () => ({ patchTask: mocks.patchTask }));
vi.mock("@/lib/sync/repo", () => ({
  getEntity: async () => mocks.task,
  getBuckets: async () => mocks.buckets,
  getProjects: async () => mocks.projects,
}));
vi.mock("@/lib/api/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/route")>("@/lib/api/route");
  return { ...actual, route: (handler: unknown) => handler };
});

const call = async (body: Record<string, unknown>) => {
  const { PATCH } = await import("@/app/api/tasks/[id]/route");
  return (PATCH as unknown as (req: Request, ctx: unknown) => Promise<unknown>)(
    new Request("http://localhost/api/tasks/TASK-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "TASK-1" }) }
  );
};

describe("REST task update vs closed projects", () => {
  beforeEach(() => {
    mocks.patchTask.mockReset();
    mocks.patchTask.mockResolvedValue({ id: "TASK-1" });
  });

  it("rejects a move into a closed-project bucket with 409 project_closed and writes nothing", async () => {
    await expect(call({ bucket: "BKT-DONE" })).rejects.toMatchObject({
      code: "project_closed",
      status: 409,
      message: expect.stringContaining("PRJ-DONE"),
    });
    expect(mocks.patchTask).not.toHaveBeenCalled();
  });

  it("allows a move into an open-project bucket", async () => {
    await expect(call({ bucket: "BKT-OPEN-2" })).resolves.toEqual({ id: "TASK-1" });
    expect(mocks.patchTask).toHaveBeenCalledTimes(1);
  });

  it("does not block a no-op bucket re-send or a non-bucket edit", async () => {
    await call({ bucket: "BKT-OPEN" });
    await call({ title: "renamed" });
    expect(mocks.patchTask).toHaveBeenCalledTimes(2);
  });
});
