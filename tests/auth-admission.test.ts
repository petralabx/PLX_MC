// Sign-in admission (TASK-3010): an MC.* Entra app role admits and sets the
// mc_users access_role; PLX_MC_ALLOWED_USERS stays a transitional /
// break-glass path so deploying before the roles exist locks nobody out.

import { describe, expect, it } from "vitest";

import { accessRoleFromEntraRoles, admissionDecision } from "@/lib/auth/gate";

const allow = "vince@petrasoap.com,cos@petrasoap.com";

describe("accessRoleFromEntraRoles", () => {
  it("maps MC.Owner / MC.Admin / MC.Member onto owner / admin / member", () => {
    expect(accessRoleFromEntraRoles(["MC.Owner"])).toBe("owner");
    expect(accessRoleFromEntraRoles(["MC.Admin"])).toBe("admin");
    expect(accessRoleFromEntraRoles(["MC.Member"])).toBe("member");
  });

  it("gives the highest role when several are assigned", () => {
    expect(accessRoleFromEntraRoles(["MC.Member", "MC.Owner", "MC.Admin"])).toBe("owner");
    expect(accessRoleFromEntraRoles(["Goals.Viewer", "MC.Member", "MC.Admin"])).toBe("admin");
  });

  it("ignores other app roles, wrong case and non-arrays", () => {
    expect(accessRoleFromEntraRoles(["Goals.Viewer", "Goals.Editor"])).toBeNull();
    expect(accessRoleFromEntraRoles(["mc.admin", "MC.Administrator"])).toBeNull();
    expect(accessRoleFromEntraRoles("MC.Owner")).toBeNull();
    expect(accessRoleFromEntraRoles(undefined)).toBeNull();
    expect(accessRoleFromEntraRoles([])).toBeNull();
  });
});

describe("admissionDecision", () => {
  it("admits an MC.* role holder who is not on the allowlist", () => {
    expect(admissionDecision({ email: "new.admin@petrasoap.com", roles: ["MC.Admin"] }, allow)).toEqual({
      admitted: true,
      via: "role",
      accessRole: "admin",
    });
  });

  it("prefers the role when the person is also allowlisted", () => {
    expect(admissionDecision({ email: "Vince@PetraSoap.com", roles: ["MC.Owner"] }, allow)).toEqual({
      admitted: true,
      via: "role",
      accessRole: "owner",
    });
  });

  it("keeps admitting an allowlisted person with no MC.* role (transition / break-glass), with no role to write", () => {
    expect(admissionDecision({ email: "vince@petrasoap.com", roles: ["Goals.Viewer"] }, allow)).toEqual({
      admitted: true,
      via: "allowlist",
      accessRole: null,
    });
  });

  it("refuses someone with no MC.* role who is not allowlisted", () => {
    expect(admissionDecision({ email: "jesse@petrasoap.com", roles: ["Goals.Viewer"] }, allow)).toEqual({
      admitted: false,
      via: null,
      accessRole: null,
    });
    expect(admissionDecision({ email: "jesse@petrasoap.com", roles: [] }, undefined).admitted).toBe(false);
  });
});
