// Session routing decide routes (accept / change / create-intent) must assert
// destination project ACL, not just routing.resolve — twin of the MCP actions
// covered in routing-mutation-acl.test.ts.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";

const mocks = vi.hoisted(() => ({
  requireSessionActor: vi.fn(),
  assertTaskProjectAccess: vi.fn(async () => undefined),
  assertBucketProjectAccess: vi.fn(async () => undefined),
  confirmExistingTask: vi.fn(),
  createConfirmedTask: vi.fn(),
}));

const principal = { tokens: ["oid-1"] };

vi.mock("@/lib/routing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/routing")>("@/lib/routing");
  return {
    ...actual,
    requireSessionActor: mocks.requireSessionActor,
    confirmExistingTask: mocks.confirmExistingTask,
    createConfirmedTask: mocks.createConfirmedTask,
  };
});

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: mocks.requireSessionActor,
  aclPrincipalFromAuthorized: () => principal,
}));

vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertTaskProjectAccess: mocks.assertTaskProjectAccess,
  assertBucketProjectAccess: mocks.assertBucketProjectAccess,
}));

vi.mock("@/lib/api/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/route")>("@/lib/api/route");
  return {
    ...actual,
    route: (handler: unknown) => handler,
  };
});

import { resetRoutingInboxFlag, setRoutingInboxEnabled } from "@/components/mc/routing-inbox/flag";

const authorized = {
  actor: { kind: "human" as const, id: "h1", status: "active" as const },
  actorId: "oid-1",
  actorKind: "human" as const,
  auditLabel: "user@petrasoap.com",
};

const denied = () =>
  new ApiError("project_acl_denied", "Not a member of this restricted project.", 403);

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>;

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", host: "localhost" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({}) };

describe("routing decide routes project ACL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRoutingInboxEnabled(true);
    mocks.requireSessionActor.mockResolvedValue(authorized);
    mocks.confirmExistingTask.mockResolvedValue({ taskId: "TASK-SECRET" });
    mocks.createConfirmedTask.mockResolvedValue({ taskId: "TASK-NEW" });
  });

  afterAll(() => resetRoutingInboxFlag());

  const loaders = {
    accept: () => import("@/app/api/routing/decide/accept/route"),
    change: () => import("@/app/api/routing/decide/change/route"),
  };
  for (const [name, path, extra] of [
    ["accept", "/api/routing/decide/accept", {}],
    ["change", "/api/routing/decide/change", { overrideReason: "better match" }],
  ] as const) {
    it(`${name} confirms only after destination task ACL passes`, async () => {
      const { POST } = (await loaders[name]()) as { POST: Handler };
      await POST(post(path, { proposalId: "rp_1", taskId: "TASK-SECRET", ...extra }), ctx);
      expect(mocks.assertTaskProjectAccess).toHaveBeenCalledWith("TASK-SECRET", principal);
      expect(mocks.confirmExistingTask).toHaveBeenCalled();
    });

    it(`${name} does not confirm when the target task is in a restricted project`, async () => {
      mocks.assertTaskProjectAccess.mockRejectedValueOnce(denied());
      const { POST } = (await loaders[name]()) as { POST: Handler };
      await expect(
        POST(post(path, { proposalId: "rp_1", taskId: "TASK-SECRET", ...extra }), ctx)
      ).rejects.toMatchObject({ code: "project_acl_denied", status: 403 });
      expect(mocks.confirmExistingTask).not.toHaveBeenCalled();
    });
  }

  it("create-intent creates only after destination bucket ACL passes", async () => {
    const { POST } = (await import("@/app/api/routing/decide/create-intent/route")) as { POST: Handler };
    await POST(post("/api/routing/decide/create-intent", { proposalId: "rp_1", bucketId: "BKT-SECRET", title: "T" }), ctx);
    expect(mocks.assertBucketProjectAccess).toHaveBeenCalledWith("BKT-SECRET", principal);
    expect(mocks.createConfirmedTask).toHaveBeenCalled();
  });

  it("create-intent does not create when the destination bucket is restricted", async () => {
    mocks.assertBucketProjectAccess.mockRejectedValueOnce(denied());
    const { POST } = (await import("@/app/api/routing/decide/create-intent/route")) as { POST: Handler };
    await expect(
      POST(post("/api/routing/decide/create-intent", { proposalId: "rp_1", bucketId: "BKT-SECRET", title: "T" }), ctx)
    ).rejects.toMatchObject({ code: "project_acl_denied", status: 403 });
    expect(mocks.createConfirmedTask).not.toHaveBeenCalled();
  });
});
