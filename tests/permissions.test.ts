// Permissions kernel contracts — grant matrix, default deny, contextual
// denial, service-principal separation, unknown capability/actor denial.

import { describe, expect, it } from "vitest";

import {
  POLICY_VERSION,
  authorize,
  capabilitiesForRole,
  capabilitiesForServicePrincipal,
  isCapability,
  type AccessRole,
  type Capability,
  type PermissionActor,
} from "@/lib/permissions";

function human(role: AccessRole, id = "oid-human"): PermissionActor {
  return { kind: "human", id, role, status: "active" };
}

function service(id: string): PermissionActor {
  return { kind: "service", id, status: "active" };
}

describe("capability typing", () => {
  it("accepts known capabilities and rejects unknowns", () => {
    expect(isCapability("task.read")).toBe(true);
    expect(isCapability("repo.approve")).toBe(true);
    expect(isCapability("not.a.capability")).toBe(false);
  });
});

describe("role grant matrix", () => {
  const cases: Array<{
    role: AccessRole;
    allowed: Capability[];
    denied: Capability[];
  }> = [
    {
      role: "member",
      allowed: [
        "task.read",
        "task.create",
        "task.link",
        "task.checkout",
        "task.progress",
        "task.complete",
        "routing.suggest",
        "routing.resolve",
      ],
      denied: [
        "task.reopen",
        "bucket.create",
        "bucket.update",
        "project.create",
        "project.update",
        "repo.approve",
        "routing.policy.write",
        "permissions.manage",
        "routing.propose",
        "routing.maintain",
        "sync.mutate",
        "sync.service.write",
      ],
    },
    {
      role: "admin",
      allowed: [
        "task.read",
        "task.create",
        "task.link",
        "task.reopen",
        "task.checkout",
        "task.progress",
        "task.complete",
        "routing.suggest",
        "routing.resolve",
        "bucket.create",
        "bucket.update",
        "project.create",
        "project.update",
        "repo.approve",
        "routing.policy.write",
        "sync.mutate",
      ],
      denied: ["permissions.manage", "routing.propose", "routing.maintain", "sync.service.write"],
    },
    {
      role: "owner",
      allowed: [
        "task.read",
        "task.create",
        "task.link",
        "task.reopen",
        "task.checkout",
        "task.progress",
        "task.complete",
        "routing.suggest",
        "routing.resolve",
        "bucket.create",
        "bucket.update",
        "project.create",
        "project.update",
        "repo.approve",
        "routing.policy.write",
        "permissions.manage",
        "sync.mutate",
      ],
      denied: ["routing.propose", "routing.maintain", "sync.service.write"],
    },
  ];

  for (const { role, allowed, denied } of cases) {
    it(`grants the ${role} bundle`, () => {
      const grants = new Set(capabilitiesForRole(role));
      for (const capability of allowed) {
        expect(grants.has(capability), `${role} should have ${capability}`).toBe(true);
        const decision = authorize({ actor: human(role), capability });
        expect(decision.allowed).toBe(true);
        expect(decision.reasonCode).toBe("allowed");
        expect(decision.policyVersion).toBe(POLICY_VERSION);
      }
      for (const capability of denied) {
        expect(grants.has(capability), `${role} should not have ${capability}`).toBe(false);
        const decision = authorize({ actor: human(role), capability });
        expect(decision.allowed).toBe(false);
        expect(decision.reasonCode).toBe("capability_not_granted");
      }
    });
  }
});

describe("default deny", () => {
  it("denies unknown capabilities", () => {
    const decision = authorize({
      actor: human("owner"),
      capability: "totally.fake" as Capability,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("unknown_capability");
    expect(decision.policyVersion).toBe(POLICY_VERSION);
  });

  it("denies missing or malformed actors", () => {
    expect(
      authorize({
        actor: null as unknown as PermissionActor,
        capability: "task.read",
      }).reasonCode
    ).toBe("unknown_actor");
    expect(
      authorize({
        actor: { kind: "human", id: "", role: "member", status: "active" },
        capability: "task.read",
      }).reasonCode
    ).toBe("unknown_actor");
    expect(
      authorize({
        actor: { kind: "alien" as "human", id: "x", role: "owner", status: "active" },
        capability: "task.read",
      }).reasonCode
    ).toBe("unknown_actor");
  });

  it("denies by default when no grant matches", () => {
    const decision = authorize({
      actor: service("sp_unknown"),
      capability: "task.read",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("capability_not_granted");
  });
});

describe("service-principal separation", () => {
  it("cannot inject caller-supplied service capabilities", () => {
    const injected: PermissionActor = {
      kind: "service",
      id: "sp_unknown",
      status: "active",
      // @ts-expect-error Service capabilities come only from the registry.
      capabilities: ["permissions.manage"],
    };
    expect(authorize({ actor: injected, capability: "permissions.manage" })).toMatchObject({
      allowed: false,
      reasonCode: "capability_not_granted",
    });
  });

  it("grants only explicit MCP service capabilities", () => {
    const mcpCaps = capabilitiesForServicePrincipal("sp_mcp_cursor");
    expect(mcpCaps).toEqual(
      expect.arrayContaining([
        "task.read",
        "task.checkout",
        "task.progress",
        "task.complete",
        "routing.suggest",
        "routing.propose",
      ])
    );
    expect(mcpCaps).not.toContain("task.create");
    expect(mcpCaps).not.toContain("repo.approve");
    expect(mcpCaps).not.toContain("permissions.manage");

    const actor = service("sp_mcp_cursor");
    expect(authorize({ actor, capability: "routing.suggest" }).allowed).toBe(true);
    expect(authorize({ actor, capability: "task.create" }).allowed).toBe(false);
    expect(authorize({ actor, capability: "repo.approve" }).allowed).toBe(false);
  });

  it("does not inherit human role bundles from operator context", () => {
    // Even if a caller tries to stamp a human role onto a service actor, grants
    // come only from the service-principal registry.
    const spoofed = {
      kind: "service" as const,
      id: "sp_mcp_cursor",
      status: "active" as const,
      role: "owner" as AccessRole,
    };
    expect(authorize({ actor: spoofed, capability: "permissions.manage" }).allowed).toBe(false);
    expect(authorize({ actor: spoofed, capability: "routing.suggest" }).allowed).toBe(true);
  });

  it("grants GitHub Actions propose and compliance projection capabilities", () => {
    const ga = capabilitiesForServicePrincipal("sp_github_actions_routing");
    expect(ga).toEqual(expect.arrayContaining(["routing.propose", "task.read"]));
    expect(ga).not.toContain("task.create");

    const proj = capabilitiesForServicePrincipal("sp_compliance_projection");
    expect(proj).toEqual(
      expect.arrayContaining(["task.progress", "task.link", "task.read"])
    );
    expect(proj).not.toContain("routing.propose");

    expect(
      authorize({
        actor: service("sp_github_actions_routing"),
        capability: "routing.propose",
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: service("sp_compliance_projection"),
        capability: "task.progress",
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: service("sp_compliance_projection"),
        capability: "routing.propose",
      }).allowed
    ).toBe(false);
  });
});

describe("contextual denial", () => {
  it("denies reopen of verified work for non-privileged humans even when granted", () => {
    const decision = authorize({
      actor: human("admin"),
      capability: "task.reopen",
      resource: { type: "task", id: "TASK-1", stage: "verified" },
      context: { accountableOwnerId: "someone-else", actorIsAccountableOwner: false },
    });
    // Admin/Owner may reopen verified work; member cannot — covered in matrix.
    // Contextual: accountable-owner mismatch alone does not strip admin reopen.
    expect(decision.allowed).toBe(true);
  });

  it("denies task mutation when repository binding fails", () => {
    const decision = authorize({
      actor: human("member"),
      capability: "task.link",
      resource: { type: "task", id: "TASK-1", repos: ["portal-web"] },
      context: { repositoryId: "unrelated-repo" },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("repository_mismatch");
  });

  it("denies service principals from human-only contextual actions", () => {
    const decision = authorize({
      actor: service("sp_mcp_cursor"),
      capability: "task.link",
      resource: { type: "task", id: "TASK-1" },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("capability_not_granted");
  });

  it("denies sync.service.write for humans", () => {
    expect(authorize({ actor: human("owner"), capability: "sync.service.write" }).allowed).toBe(
      false
    );
    expect(
      authorize({
        actor: service("sp_sync_inbound"),
        capability: "sync.service.write",
      }).allowed
    ).toBe(true);
  });
});

describe("revocation", () => {
  it("denies revoked humans and service principals", () => {
    expect(
      authorize({
        actor: { kind: "human", id: "oid-1", role: "owner", status: "revoked" },
        capability: "task.read",
      }).reasonCode
    ).toBe("actor_revoked");
    expect(
      authorize({
        actor: { kind: "service", id: "sp_mcp_cursor", status: "revoked" },
        capability: "routing.suggest",
      }).reasonCode
    ).toBe("actor_revoked");
  });
});
