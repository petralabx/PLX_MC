// TASK-1206 — Hub MCP checkout may bind actor.repo for allowlisted consumers.
// Omitted repo stays the connector identity; unknown slugs fail closed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(async () => ({ checkoutId: "dsp_test" })),
  requireMcpActor: vi.fn(),
}));

vi.mock("@/lib/compliance/service", () => ({
  checkout: mocks.checkout,
  complete: vi.fn(),
}));

vi.mock("@/lib/mcp/sync-meta", () => ({
  syncMetaForTask: vi.fn(async () => ({ status: "queued" })),
}));

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: mocks.requireMcpActor,
}));

import { ApiError } from "@/lib/api/route";
import { actionCheckout } from "@/lib/mcp/actions";
import type { McpIdentity } from "@/lib/mcp/auth";
import { MCP_CHECKOUT_REPO_ALLOWLIST, resolveCheckoutRepo } from "@/lib/mcp/checkout-repo";

const HARD_GATED_CONSUMERS = [
  "petralabx/local-inference",
  "petralabx/skills",
  "petralabx/1hr-after",
  "petralabx/furgenics",
  "petralabx/for-and-against",
  "petralabx/agentic-swarm",
  "petralabx/plx-customer-portal",
] as const;

const hubIdentity: McpIdentity = {
  operatorEmail: "cos@petrasoap.com",
  runtime: "cursor-cloud",
  workerId: "w1",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_grok",
  actor: { kind: "service", id: "sp_mcp_grok", status: "active" },
};

const portalIdentity: McpIdentity = {
  ...hubIdentity,
  repo: "petralabx/plx-customer-portal",
};

describe("resolveCheckoutRepo", () => {
  it("omitted repo stays the connector identity (Hub default)", () => {
    expect(resolveCheckoutRepo("petralabx/PLX_MC")).toBe("petralabx/PLX_MC");
    expect(resolveCheckoutRepo("petralabx/PLX_MC", undefined)).toBe("petralabx/PLX_MC");
    expect(resolveCheckoutRepo("petralabx/PLX_MC", "   ")).toBe("petralabx/PLX_MC");
  });

  it("omitted repo stays the Portal connector identity", () => {
    expect(resolveCheckoutRepo("petralabx/plx-customer-portal")).toBe(
      "petralabx/plx-customer-portal"
    );
  });

  it("exports the hard-gated consumer allowlist including Portal", () => {
    expect([...MCP_CHECKOUT_REPO_ALLOWLIST]).toEqual([...HARD_GATED_CONSUMERS]);
    expect(MCP_CHECKOUT_REPO_ALLOWLIST).toContain("petralabx/plx-customer-portal");
  });

  it("allowlisted hard-gated consumers bind that slug", () => {
    for (const slug of HARD_GATED_CONSUMERS) {
      expect(resolveCheckoutRepo("petralabx/PLX_MC", slug)).toBe(slug);
    }
  });

  it("connector's own slug is accepted even when not on the consumer allowlist", () => {
    expect(resolveCheckoutRepo("petralabx/PLX_MC", "petralabx/PLX_MC")).toBe("petralabx/PLX_MC");
    expect(resolveCheckoutRepo("petralabx/plx-customer-portal", "petralabx/plx-customer-portal")).toBe(
      "petralabx/plx-customer-portal"
    );
  });

  it("rejects a non-allowlisted slug (fail closed)", () => {
    expect(() => resolveCheckoutRepo("petralabx/PLX_MC", "petralabx/unknown-repo")).toThrow(
      ApiError
    );
    try {
      resolveCheckoutRepo("petralabx/PLX_MC", "petralabx/unknown-repo");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("repo_not_allowlisted");
    }
  });

  it("rejects a registry id or malformed slug (not a GitHub slug)", () => {
    expect(() => resolveCheckoutRepo("petralabx/PLX_MC", "local-inference")).toThrow(ApiError);
    expect(() => resolveCheckoutRepo("petralabx/PLX_MC", "plx-mc")).toThrow(ApiError);
    try {
      resolveCheckoutRepo("petralabx/PLX_MC", "local-inference");
    } catch (err) {
      expect((err as ApiError).code).toBe("invalid_repo");
    }
  });
});

describe("actionCheckout actor.repo receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkout.mockResolvedValue({ checkoutId: "dsp_test" });
    mocks.requireMcpActor.mockReturnValue({
      actor: hubIdentity.actor,
      actorId: "sp_mcp_grok",
      actorKind: "service",
      auditLabel: "cos@petrasoap.com",
    });
  });

  it("omitted repo stays Hub default and receipt exposes actor.repo + taskId", async () => {
    const receipt = await actionCheckout(hubIdentity, "TASK-1206");
    expect(receipt.taskId).toBe("TASK-1206");
    expect(receipt.actor.repo).toBe("petralabx/PLX_MC");
    expect(receipt.checkoutId).toBe("dsp_test");
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "petralabx/PLX_MC", taskId: "TASK-1206" })
    );
    expect(mocks.requireMcpActor).toHaveBeenCalledWith(
      hubIdentity,
      "task.checkout",
      expect.objectContaining({ type: "task", id: "TASK-1206" }),
      expect.objectContaining({ repositoryId: "petralabx/PLX_MC" })
    );
  });

  it("allowlisted local-inference binds actor.repo on the minted checkout", async () => {
    const receipt = await actionCheckout(hubIdentity, "TASK-1206", {
      repo: "petralabx/local-inference",
    });
    expect(receipt.taskId).toBe("TASK-1206");
    expect(receipt.actor.repo).toBe("petralabx/local-inference");
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "petralabx/local-inference", taskId: "TASK-1206" })
    );
    expect(mocks.requireMcpActor).toHaveBeenCalledWith(
      hubIdentity,
      "task.checkout",
      expect.objectContaining({ type: "task", id: "TASK-1206" }),
      expect.objectContaining({ repositoryId: "petralabx/local-inference" })
    );
  });

  it("allowlisted skills binds actor.repo on the minted checkout", async () => {
    const receipt = await actionCheckout(hubIdentity, "TASK-1206", {
      repo: "petralabx/skills",
    });
    expect(receipt.actor.repo).toBe("petralabx/skills");
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "petralabx/skills", taskId: "TASK-1206" })
    );
  });

  it("allowlisted portal binds actor.repo on the minted checkout", async () => {
    const receipt = await actionCheckout(hubIdentity, "TASK-1285", {
      repo: "petralabx/plx-customer-portal",
    });
    expect(receipt.taskId).toBe("TASK-1285");
    expect(receipt.actor.repo).toBe("petralabx/plx-customer-portal");
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "petralabx/plx-customer-portal", taskId: "TASK-1285" })
    );
    expect(mocks.requireMcpActor).toHaveBeenCalledWith(
      hubIdentity,
      "task.checkout",
      expect.objectContaining({ type: "task", id: "TASK-1285" }),
      expect.objectContaining({ repositoryId: "petralabx/plx-customer-portal" })
    );
  });

  it("rejects an unknown slug and does not mint a checkout", async () => {
    await expect(
      actionCheckout(hubIdentity, "TASK-1206", { repo: "petralabx/unknown-repo" })
    ).rejects.toMatchObject({
      code: "repo_not_allowlisted",
    });
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("Portal omitted repo stays Portal (connector behavior unchanged)", async () => {
    const receipt = await actionCheckout(portalIdentity, "TASK-1206");
    expect(receipt.actor.repo).toBe("petralabx/plx-customer-portal");
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "petralabx/plx-customer-portal" })
    );
  });
});
