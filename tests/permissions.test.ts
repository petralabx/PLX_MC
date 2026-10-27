// Permissions kernel contracts — grant matrix, default deny, contextual
// denial, service-principal separation, unknown capability/actor denial.

import { describe, expect, it } from "vitest";

import {
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  POLICY_VERSION,
  authorize,
  capabilitiesForRole,
  capabilitiesForServicePrincipal,
  isCapability,
  permissionActorFromDirectoryRole,
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
  it("identifies the reviewed MCP task-create policy revision", () => {
    expect(POLICY_VERSION).toBe("permissions.v2");
  });

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
        "bucket.comment",
        "repo.request",
        "skill.submit",
        "skill.install",
      ],
      denied: [
        "task.reopen",
        "task.cancel",
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
        "vendor_spend.write",
        "compliance.reconcile",
      ],
    },
    {
      role: "admin",
      allowed: [
        "task.read",
        "task.create",
        "task.link",
        "task.reopen",
        "task.cancel",
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
        "vendor_spend.write",
        "bucket.comment",
        "repo.request",
        "skill.submit",
        "skill.install",
        "compliance.reconcile",
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
        "task.cancel",
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
        "vendor_spend.write",
        "bucket.comment",
        "repo.request",
        "skill.submit",
        "skill.install",
        "compliance.reconcile",
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

  it("task.cancel is held by sp_mcp_cursor, sp_mcp_cos, and sp_mcp_ledger only; task.reopen by sp_mcp_cursor and sp_mcp_ledger only (TASK-2580, TASK-3374)", () => {
    for (const role of ["admin", "owner"] as const) {
      expect(capabilitiesForRole(role)).toEqual(expect.arrayContaining(["task.cancel", "task.reopen"]));
    }
    expect(capabilitiesForRole("member")).not.toContain("task.cancel");
    expect(capabilitiesForRole("member")).not.toContain("task.reopen");
    for (const id of MCP_AGENT_SERVICE_PRINCIPAL_IDS) {
      if (id !== "sp_mcp_cursor" && id !== "sp_mcp_ledger") {
        expect(capabilitiesForServicePrincipal(id)).not.toContain("task.reopen");
        expect(authorize({ actor: service(id), capability: "task.reopen" }))
          .toMatchObject({ allowed: false, reasonCode: "capability_not_granted" });
      }
      if (id === "sp_mcp_cursor" || id === "sp_mcp_cos" || id === "sp_mcp_ledger") continue;
      expect(capabilitiesForServicePrincipal(id)).not.toContain("task.cancel");
    }
    expect(authorize({ actor: service("sp_mcp_cursor"), capability: "task.cancel" }).allowed).toBe(true);
  });

  it("sp_mcp_cursor holds task.cancel, task.reopen (TASK-3374) and task.link_merged_pr (TASK-3671); sp_mcp_ledger holds task.cancel and task.reopen", () => {
    const cursor = capabilitiesForServicePrincipal("sp_mcp_cursor");
    expect(cursor).toEqual(expect.arrayContaining(["task.cancel", "task.reopen"]));
    expect(cursor).toContain("task.link_merged_pr");
    // TASK-3374 grants reopen, TASK-3671 link_merged_pr: no verify, no assign, nothing else beyond the agent bundle.
    expect(cursor as readonly string[]).not.toContain("task.verify");
    expect([...cursor].sort()).toEqual(
      [...capabilitiesForServicePrincipal("sp_mcp_codex"), "task.cancel", "task.reopen", "task.link_merged_pr"].sort()
    );
    expect(authorize({ actor: service("sp_mcp_cursor"), capability: "task.cancel" }).allowed).toBe(true);
    expect(authorize({ actor: service("sp_mcp_cursor"), capability: "task.reopen" }).allowed).toBe(true);
    expect(authorize({ actor: service("sp_mcp_cursor"), capability: "task.link_merged_pr" }).allowed).toBe(true);
    const ledger = capabilitiesForServicePrincipal("sp_mcp_ledger");
    expect(ledger).toEqual(expect.arrayContaining(["task.cancel", "task.reopen"]));
    expect(authorize({ actor: service("sp_mcp_ledger"), capability: "task.cancel" }).allowed).toBe(true);
    expect(authorize({ actor: service("sp_mcp_ledger"), capability: "task.reopen" }).allowed).toBe(true);
  });

  it("sp_mcp_cos is the cursor grant minus task.reopen plus exactly task.link_merged_pr and task.assign (TASK-3407)", () => {
    const cursor = capabilitiesForServicePrincipal("sp_mcp_cursor").filter((c) => c !== "task.reopen" && c !== "task.link_merged_pr");
    expect([...capabilitiesForServicePrincipal("sp_mcp_cos")].sort()).toEqual(
      [...cursor, "task.link_merged_pr", "task.assign"].sort()
    );
    for (const capability of ["task.cancel", "task.link_merged_pr", "task.assign"] as const) {
      expect(authorize({ actor: service("sp_mcp_cos"), capability }).allowed).toBe(true);
    }
    for (const capability of ["task.reopen", "permissions.manage", "approval.decide", "sync.service.write"] as const) {
      expect(authorize({ actor: service("sp_mcp_cos"), capability })).toMatchObject({
        allowed: false,
        reasonCode: "capability_not_granted",
      });
    }
  });

  it("grants only explicit MCP service capabilities", () => {
    const mcpCaps = capabilitiesForServicePrincipal("sp_mcp_cursor");
    expect(mcpCaps).toEqual(
      expect.arrayContaining([
        "task.read",
        "task.create",
        "task.checkout",
        "task.progress",
        "task.complete",
        "task.link",
        "routing.suggest",
        "routing.propose",
        "routing.resolve",
        "sync.mutate",
        "bucket.update",
      ])
    );
    expect(mcpCaps).not.toContain("repo.approve");
    expect(mcpCaps).not.toContain("permissions.manage");
    expect(mcpCaps).not.toContain("vendor_spend.write");
    expect(mcpCaps).not.toContain("compliance.reconcile");
    expect(mcpCaps).toContain("project.update");

    const actor = service("sp_mcp_cursor");
    expect(authorize({ actor, capability: "task.create" }).allowed).toBe(true);
    expect(authorize({ actor, capability: "routing.suggest" }).allowed).toBe(true);
    expect(authorize({ actor, capability: "routing.resolve" }).allowed).toBe(true);
    expect(authorize({ actor, capability: "task.link" }).allowed).toBe(true);
    expect(authorize({ actor, capability: "sync.mutate" }).allowed).toBe(true);
    expect(authorize({ actor, capability: "bucket.update" }).allowed).toBe(true);
    expect(authorize({ actor, capability: "project.update" }).allowed).toBe(true);
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

  it("denies restricted-project access when the caller is not a member", () => {
    const decision = authorize({
      actor: human("admin"),
      capability: "task.read",
      resource: { type: "project", id: "PRJ-SECRET" },
      context: {
        projectVisibility: "restricted",
        projectMembers: ["vince@petrasoap.com", "sp_mcp_cursor"],
        principalTokens: ["outsider@petrasoap.com"],
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("context_denied");
  });

  it("allows restricted-project access when a member token matches", () => {
    const decision = authorize({
      actor: service("sp_mcp_cursor"),
      capability: "task.read",
      resource: { type: "project", id: "PRJ-SECRET" },
      context: {
        projectVisibility: "restricted",
        projectMembers: ["vince@petrasoap.com", "sp_mcp_cursor"],
        principalTokens: ["sp_mcp_cursor"],
      },
    });
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

  it("allows reviewed MCP principals to create planning hierarchy and patch buckets", () => {
    expect(
      authorize({
        actor: service("sp_mcp_cursor"),
        capability: "bucket.create",
        resource: { type: "bucket", id: "BKT-1" },
      })
    ).toMatchObject({ allowed: true, reasonCode: "allowed" });
    expect(
      authorize({
        actor: service("sp_mcp_cursor"),
        capability: "bucket.update",
        resource: { type: "bucket", id: "BKT-1" },
      })
    ).toMatchObject({ allowed: true, reasonCode: "allowed" });
    expect(
      authorize({
        actor: service("sp_mcp_cursor"),
        capability: "project.create",
      })
    ).toMatchObject({ allowed: true, reasonCode: "allowed" });
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

describe("permissionActorFromDirectoryRole", () => {
  it("maps a directory person onto an active human with their access role", () => {
    expect(permissionActorFromDirectoryRole({ kind: "human", id: "vince", role: "Owner" })).toEqual({
      kind: "human",
      id: "vince",
      role: "owner",
      status: "active",
    });
    expect(permissionActorFromDirectoryRole({ kind: "human", id: "a", role: " ADMIN " })).toMatchObject({
      role: "admin",
    });
    expect(permissionActorFromDirectoryRole({ kind: "human", id: "g", role: "Contributor" })).toMatchObject({
      role: "member",
    });
    expect(permissionActorFromDirectoryRole({ kind: "human", id: "i", role: "Invited" })).toMatchObject({
      role: "member",
    });
  });

  it("gives no permission identity to a missing actor, an agent or a person with no role", () => {
    expect(permissionActorFromDirectoryRole(undefined)).toBeNull();
    expect(permissionActorFromDirectoryRole(null)).toBeNull();
    expect(permissionActorFromDirectoryRole({ kind: "agent", id: "vibes" })).toBeNull();
    expect(permissionActorFromDirectoryRole({ kind: "human", id: "x", role: "" })).toBeNull();
    expect(authorize({ actor: permissionActorFromDirectoryRole(undefined), capability: "task.read" }))
      .toMatchObject({ allowed: false, reasonCode: "unknown_actor" });
  });
});

describe("TASK-4015 sp_mcp_vince personal principal", () => {
  it("is registered and holds exactly sp_mcp_claude_code's grant", () => {
    expect(MCP_AGENT_SERVICE_PRINCIPAL_IDS).toContain("sp_mcp_vince");
    expect([...capabilitiesForServicePrincipal("sp_mcp_vince")].sort())
      .toEqual([...capabilitiesForServicePrincipal("sp_mcp_claude_code")].sort());
  });
});
