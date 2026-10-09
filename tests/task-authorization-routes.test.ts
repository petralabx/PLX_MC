// P8 — Task mutation routes derive actors server-side and call authorize(...).

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionActor: vi.fn(),
  createTask: vi.fn(),
  patchTask: vi.fn(),
  checkout: vi.fn(),
  complete: vi.fn(),
  assertBucketProjectAccess: vi.fn(async () => undefined),
  assertTaskProjectAccess: vi.fn(async () => undefined),
  assertProjectIdAccess: vi.fn(async () => undefined),
  getEntity: vi.fn(),
  reopenTask: vi.fn(),
  appendEvent: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({ getEntity: mocks.getEntity }));
vi.mock("@/lib/sync/cancel", () => ({ reopenTask: mocks.reopenTask }));
vi.mock("@/lib/compliance/repo", () => ({ appendEvent: mocks.appendEvent }));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: mocks.requireSessionActor,
  aclPrincipalFromAuthorized: () => ({ tokens: ["oid-1", "vince@example.com"] }),
}));

vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: mocks.assertBucketProjectAccess,
  assertTaskProjectAccess: mocks.assertTaskProjectAccess,
  assertProjectIdAccess: mocks.assertProjectIdAccess,
}));

vi.mock("@/lib/sync", () => ({
  createTask: mocks.createTask,
  patchTask: mocks.patchTask,
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: async () => null,
  getBuckets: async () => [],
  getProjects: async () => [],
}));

vi.mock("@/lib/compliance/service", () => ({
  checkout: mocks.checkout,
  complete: mocks.complete,
}));

vi.mock("@/lib/api/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/route")>("@/lib/api/route");
  return {
    ...actual,
    // Expose handler for direct invocation without NextResponse wrapping.
    route: (handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>) =>
      handler,
  };
});

describe("task authorization routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSessionActor.mockResolvedValue({
      actor: { kind: "human", id: "oid-1", role: "member", status: "active" },
      actorId: "oid-1",
      actorKind: "human",
      auditLabel: "vince@example.com",
    });
    mocks.getEntity.mockResolvedValue({ data: { stage: "progress" } });
    mocks.reopenTask.mockResolvedValue({ stage: "backlog" });
    mocks.createTask.mockResolvedValue({ id: "TASK-1", title: "t" });
    mocks.patchTask.mockResolvedValue({ id: "TASK-1", stage: "progress" });
    mocks.checkout.mockResolvedValue({ checkoutId: "dsp_x" });
    mocks.complete.mockResolvedValue({ ok: true });
  });

  it("POST /api/tasks authorizes task.create and ignores body.reporter identity", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const req = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "New",
        bucket: "BKT-OPS",
        reporter: "spoofed-reporter",
      }),
    });
    await POST(req, { params: Promise.resolve({}) });
    expect(mocks.requireSessionActor).toHaveBeenCalledWith(
      "task.create",
      expect.objectContaining({ type: "bucket", id: "BKT-OPS" })
    );
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ reporter: "vince@example.com" }),
      expect.objectContaining({ source: "human", actorId: "oid-1" })
    );
  });

  it("PATCH /api/tasks/{id} ignores body.actor and authorizes from session", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = new Request("http://localhost/api/tasks/TASK-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "spoofed", stage: "progress" }),
    });
    await PATCH(req, { params: Promise.resolve({ id: "TASK-1" }) });
    expect(mocks.requireSessionActor).toHaveBeenCalledWith(
      "task.progress",
      expect.objectContaining({ type: "task", id: "TASK-1" })
    );
    expect(mocks.patchTask).toHaveBeenCalledWith(
      "TASK-1",
      expect.not.objectContaining({ actor: expect.anything() }),
      "vince@example.com",
      expect.objectContaining({ attribution: { source: "human", actorId: "oid-1" } })
    );
  });

  describe("stage changes into or out of cancelled (TASK-2529)", () => {
    const patchStage = async (stage: string) => {
      const { PATCH } = await import("@/app/api/tasks/[id]/route");
      return PATCH(
        new Request("http://localhost/api/tasks/TASK-1", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stage }),
        }),
        { params: Promise.resolve({ id: "TASK-1" }) }
      );
    };
    const member = { actor: { kind: "human", id: "oid-1" }, actorId: "oid-1", actorKind: "human", auditLabel: "vince@example.com" };

    it("refuses a member holding only task.progress: 403, task.reopen_denied audit, no reopen, no patch", async () => {
      const { ApiError } = await import("@/lib/api/route");
      mocks.getEntity.mockResolvedValue({ data: { stage: "cancelled" } });
      mocks.requireSessionActor.mockImplementation(async (capability: string) => {
        if (capability === "task.reopen") throw new ApiError("forbidden", "task.reopen denied (no_grant).", 403);
        return member;
      });
      await expect(patchStage("backlog")).rejects.toMatchObject({ code: "forbidden", status: 403 });
      expect(mocks.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "task.reopen_denied", taskId: "TASK-1" })
      );
      expect(mocks.reopenTask).not.toHaveBeenCalled();
      expect(mocks.patchTask).not.toHaveBeenCalled();
    });

    it("lets a principal with task.reopen reopen through the reopen service (not a bare patch)", async () => {
      mocks.getEntity.mockResolvedValue({ data: { stage: "cancelled" } });
      await patchStage("backlog");
      expect(mocks.requireSessionActor).toHaveBeenCalledWith("task.reopen", { type: "task", id: "TASK-1" });
      expect(mocks.reopenTask).toHaveBeenCalledWith(
        "TASK-1",
        { stage: "backlog" },
        expect.objectContaining({ actorId: "oid-1", eventActor: "human:vince@example.com" })
      );
      expect(mocks.patchTask).toHaveBeenCalledWith("TASK-1", {}, "vince@example.com", expect.anything());
    });

    it("does not require task.reopen for a stage change on a task that is not cancelled", async () => {
      await patchStage("qa");
      expect(mocks.requireSessionActor).not.toHaveBeenCalledWith("task.reopen", expect.anything());
      expect(mocks.reopenTask).not.toHaveBeenCalled();
    });

    it("refuses entering cancelled through PATCH (schema rejects it; only the cancel service enters)", async () => {
      await expect(patchStage("cancelled")).rejects.toMatchObject({ status: 400 });
      expect(mocks.patchTask).not.toHaveBeenCalled();
    });
  });

  it("PATCH /api/tasks/{id} lets a signed-in person set an agent: assignee", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = new Request("http://localhost/api/tasks/TASK-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignee: "agent:hasitha-fernando" }),
    });
    await PATCH(req, { params: Promise.resolve({ id: "TASK-1" }) });
    expect(mocks.patchTask).toHaveBeenCalledWith(
      "TASK-1",
      expect.objectContaining({ assignee: "agent:hasitha-fernando" }),
      "vince@example.com",
      expect.anything()
    );
  });

  it("PATCH /api/tasks/{id} refuses an agent: assignee from a non-person actor", async () => {
    mocks.requireSessionActor.mockResolvedValueOnce({
      actor: { kind: "service", id: "sp_mcp_grok", status: "active" },
      actorId: "sp_mcp_grok",
      actorKind: "service",
      auditLabel: "vince@example.com",
    });
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = new Request("http://localhost/api/tasks/TASK-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignee: "agent:hasitha-fernando" }),
    });
    await expect(PATCH(req, { params: Promise.resolve({ id: "TASK-1" }) })).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    expect(mocks.patchTask).not.toHaveBeenCalled();
  });

  it("PATCH /api/tasks/{id} asserts ACL on the destination bucket before move", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = new Request("http://localhost/api/tasks/TASK-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bucket: "BKT-SECRET" }),
    });
    await PATCH(req, { params: Promise.resolve({ id: "TASK-1" }) });
    expect(mocks.assertTaskProjectAccess).toHaveBeenCalledWith("TASK-1", {
      tokens: ["oid-1", "vince@example.com"],
    });
    expect(mocks.assertBucketProjectAccess).toHaveBeenCalledWith("BKT-SECRET", {
      tokens: ["oid-1", "vince@example.com"],
    });
    expect(mocks.patchTask).toHaveBeenCalled();
  });

  it("does not move a task when the destination bucket ACL denies", async () => {
    mocks.assertBucketProjectAccess.mockRejectedValueOnce(
      new (await import("@/lib/api/route")).ApiError(
        "project_acl_denied",
        "Not a member of this restricted project.",
        403
      )
    );
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const req = new Request("http://localhost/api/tasks/TASK-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bucket: "BKT-SECRET" }),
    });
    await expect(PATCH(req, { params: Promise.resolve({ id: "TASK-1" }) })).rejects.toMatchObject({
      code: "project_acl_denied",
      status: 403,
    });
    expect(mocks.patchTask).not.toHaveBeenCalled();
  });

  it("compliance checkout authorizes task.checkout with session actor", async () => {
    const { POST } = await import("@/app/api/compliance/checkout/route");
    const req = new Request("http://localhost/api/compliance/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "TASK-1",
        runtime: "cursor",
        accountableHuman: "vince@example.com",
        repo: "petralabx/PLX_MC",
      }),
    });
    await POST(req, { params: Promise.resolve({}) });
    expect(mocks.requireSessionActor).toHaveBeenCalledWith(
      "task.checkout",
      expect.objectContaining({ type: "task", id: "TASK-1" }),
      expect.objectContaining({ repositoryId: "petralabx/PLX_MC" })
    );
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ id: "oid-1" }),
        door: "compliance",
      })
    );
  });

  it("compliance complete authorizes task.complete with session actor", async () => {
    const { POST } = await import("@/app/api/compliance/complete/route");
    const req = new Request("http://localhost/api/compliance/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkoutId: "dsp_x",
        summary: "done",
      }),
    });
    await POST(req, { params: Promise.resolve({}) });
    expect(mocks.requireSessionActor).toHaveBeenCalledWith("task.complete");
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ id: "oid-1" }),
      })
    );
  });
});
