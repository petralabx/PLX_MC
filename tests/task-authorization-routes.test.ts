// P8 — Task mutation routes derive actors server-side and call authorize(...).

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionActor: vi.fn(),
  createTask: vi.fn(),
  patchTask: vi.fn(),
  checkout: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: mocks.requireSessionActor,
}));

vi.mock("@/lib/sync", () => ({
  createTask: mocks.createTask,
  patchTask: mocks.patchTask,
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
