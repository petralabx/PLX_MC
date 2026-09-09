// Routing confirm / attach / create-routed must fail-close on the target
// restricted project, not just routing.resolve.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";
import type { McpIdentity } from "@/lib/mcp/auth";

const mocks = vi.hoisted(() => ({
  requireMcpActor: vi.fn(),
  aclPrincipalFromMcp: vi.fn(() => ({ tokens: ["sp_mcp_cursor"] })),
  assertTaskProjectAccess: vi.fn(async () => undefined),
  assertBucketProjectAccess: vi.fn(async () => undefined),
  confirmExistingTask: vi.fn(),
  attachCheckoutLink: vi.fn(),
  createConfirmedTask: vi.fn(),
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: mocks.requireMcpActor,
  aclPrincipalFromMcp: mocks.aclPrincipalFromMcp,
}));

vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertTaskProjectAccess: mocks.assertTaskProjectAccess,
  assertBucketProjectAccess: mocks.assertBucketProjectAccess,
}));

vi.mock("@/lib/routing/service", () => ({
  confirmExistingTask: mocks.confirmExistingTask,
  attachCheckoutLink: mocks.attachCheckoutLink,
  createConfirmedTask: mocks.createConfirmedTask,
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: mocks.syncMetaForTask,
}));

import {
  actionAttachCheckout,
  actionConfirmExisting,
  actionCreateRoutedTask,
} from "@/lib/mcp/routing-mutation-actions";

const identity: McpIdentity = {
  operatorEmail: "greg@petrasoap.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

const authorized = {
  actor: { kind: "service" as const, id: "sp_mcp_cursor", status: "active" as const },
  actorId: "sp_mcp_cursor",
  actorKind: "service" as const,
  auditLabel: "greg@petrasoap.com",
};

describe("routing mutation project ACL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMcpActor.mockReturnValue(authorized);
    mocks.aclPrincipalFromMcp.mockReturnValue({ tokens: ["sp_mcp_cursor"] });
    mocks.confirmExistingTask.mockResolvedValue({ taskId: "TASK-SECRET" });
    mocks.attachCheckoutLink.mockResolvedValue({ taskId: "TASK-SECRET" });
    mocks.createConfirmedTask.mockResolvedValue({ taskId: "TASK-NEW" });
  });

  it("confirms an existing task only after destination task ACL", async () => {
    await actionConfirmExisting(identity, { proposalId: "prp_1", taskId: "TASK-SECRET" });
    expect(mocks.assertTaskProjectAccess).toHaveBeenCalledWith("TASK-SECRET", {
      tokens: ["sp_mcp_cursor"],
    });
    expect(mocks.confirmExistingTask).toHaveBeenCalled();
  });

  it("does not confirm when the target task is in a restricted project", async () => {
    mocks.assertTaskProjectAccess.mockRejectedValueOnce(
      new ApiError("project_acl_denied", "Not a member of this restricted project.", 403)
    );
    await expect(
      actionConfirmExisting(identity, { proposalId: "prp_1", taskId: "TASK-SECRET" })
    ).rejects.toMatchObject({ code: "project_acl_denied", status: 403 });
    expect(mocks.confirmExistingTask).not.toHaveBeenCalled();
  });

  it("attaches checkout only after destination task ACL", async () => {
    await actionAttachCheckout(identity, {
      proposalId: "prp_1",
      taskId: "TASK-SECRET",
      checkoutId: "dsp_x",
    });
    expect(mocks.assertTaskProjectAccess).toHaveBeenCalledWith("TASK-SECRET", {
      tokens: ["sp_mcp_cursor"],
    });
    expect(mocks.attachCheckoutLink).toHaveBeenCalled();
  });

  it("does not attach checkout when the target task ACL denies", async () => {
    mocks.assertTaskProjectAccess.mockRejectedValueOnce(
      new ApiError("project_acl_denied", "Not a member of this restricted project.", 403)
    );
    await expect(
      actionAttachCheckout(identity, {
        proposalId: "prp_1",
        taskId: "TASK-SECRET",
        checkoutId: "dsp_x",
      })
    ).rejects.toMatchObject({ code: "project_acl_denied", status: 403 });
    expect(mocks.attachCheckoutLink).not.toHaveBeenCalled();
  });

  it("creates a routed task only after destination bucket ACL", async () => {
    await actionCreateRoutedTask(identity, {
      proposalId: "prp_1",
      bucketId: "BKT-SECRET",
      title: "Injected",
      accountableOwnerId: "vince",
    });
    expect(mocks.assertBucketProjectAccess).toHaveBeenCalledWith("BKT-SECRET", {
      tokens: ["sp_mcp_cursor"],
    });
    expect(mocks.createConfirmedTask).toHaveBeenCalled();
  });

  it("does not create a routed task when the destination bucket ACL denies", async () => {
    mocks.assertBucketProjectAccess.mockRejectedValueOnce(
      new ApiError("project_acl_denied", "Not a member of this restricted project.", 403)
    );
    await expect(
      actionCreateRoutedTask(identity, {
        proposalId: "prp_1",
        bucketId: "BKT-SECRET",
        title: "Injected",
        accountableOwnerId: "vince",
      })
    ).rejects.toMatchObject({ code: "project_acl_denied", status: 403 });
    expect(mocks.createConfirmedTask).not.toHaveBeenCalled();
  });
});
