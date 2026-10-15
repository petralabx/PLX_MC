// Entra OID propagation through JWT/session identity helpers.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractEntraOid,
  extractEntraRoles,
  hydrateMcUserByOid,
  permissionsEnforcementEnabled,
  syncMcUserAtSignIn,
  toSessionIdentity,
} from "@/lib/auth/identity";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractEntraOid", () => {
  it("prefers the Entra oid claim over sub", () => {
    expect(
      extractEntraOid({
        oid: "11111111-2222-3333-4444-555555555555",
        sub: "should-not-win",
        email: "vince@petrasoap.com",
      })
    ).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("returns null when oid is missing", () => {
    expect(extractEntraOid({ sub: "only-sub", email: "vince@petrasoap.com" })).toBeNull();
    expect(extractEntraOid(null)).toBeNull();
  });
});

describe("extractEntraRoles", () => {
  it("keeps the app-role strings from the ID token", () => {
    expect(extractEntraRoles({ roles: ["Goals.Viewer", "Goals.Editor"] })).toEqual(["Goals.Viewer", "Goals.Editor"]);
  });

  it("drops anything that is not a non-empty string, and missing claims give no roles", () => {
    expect(extractEntraRoles({ roles: ["Goals.Viewer", 7, "", null] })).toEqual(["Goals.Viewer"]);
    expect(extractEntraRoles({ roles: "Goals.Editor" })).toEqual([]);
    expect(extractEntraRoles({ email: "vince@petrasoap.com" })).toEqual([]);
    expect(extractEntraRoles(null)).toEqual([]);
  });
});

describe("toSessionIdentity", () => {
  it("carries oid + email into the session user shape", () => {
    expect(
      toSessionIdentity({
        oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        email: "Vince@PetraSoap.com",
      })
    ).toEqual({
      oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      email: "vince@petrasoap.com",
    });
  });

  it("omits oid when absent so dormant mode stays usable", () => {
    expect(toSessionIdentity({ email: "vince@petrasoap.com" })).toEqual({
      oid: undefined,
      email: "vince@petrasoap.com",
    });
  });
});

describe("permissionsEnforcementEnabled", () => {
  it("defaults off so local dev/build need no DB identity hydration", () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "");
    expect(permissionsEnforcementEnabled()).toBe(false);
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "0");
    expect(permissionsEnforcementEnabled()).toBe(false);
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    expect(permissionsEnforcementEnabled()).toBe(true);
  });

  it("does not query identities when enforcement is off", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "0");
    const identityQuery = vi.fn();

    await expect(hydrateMcUserByOid("oid-off", identityQuery)).resolves.toBeNull();
    expect(identityQuery).not.toHaveBeenCalled();
  });

  it("hydrates persisted role and status by Entra oid when enforcement is on", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    const identityQuery = vi.fn(async () => [
      {
        id: "usr_42",
        entra_oid: "oid-persisted",
        email: "member@petrasoap.com",
        display_name: "Persisted Member",
        access_role: "admin",
        status: "revoked",
      },
    ]);

    await expect(hydrateMcUserByOid("oid-persisted", identityQuery)).resolves.toEqual({
      id: "usr_42",
      entraOid: "oid-persisted",
      email: "member@petrasoap.com",
      displayName: "Persisted Member",
      accessRole: "admin",
      status: "revoked",
    });
    expect(identityQuery).toHaveBeenCalledWith(expect.stringContaining("FROM mc_users"), [
      "oid-persisted",
    ]);
  });
});

// TASK-3010: the sign-in writes the mc_users row from the MC.* app role.
describe("syncMcUserAtSignIn", () => {
  const claims = {
    oid: "oid-new-admin",
    email: "New.Admin@PetraSoap.com",
    name: "New Admin",
    roles: ["MC.Admin"],
  };

  it("creates or updates an active row with the role's access_role", async () => {
    const identityQuery = vi.fn(async () => []);

    await expect(
      syncMcUserAtSignIn(
        { claims, decision: { admitted: true, via: "role", accessRole: "admin" } },
        identityQuery
      )
    ).resolves.toBe("upserted");
    expect(identityQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = identityQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO mc_users");
    expect(sql).toContain("ON CONFLICT (entra_oid) DO UPDATE");
    expect(sql).toContain("status = 'active'");
    expect(params).toEqual([
      "usr_oid-new-admin",
      "oid-new-admin",
      "new.admin@petrasoap.com",
      "New Admin",
      "admin",
    ]);
  });

  it("leaves an allowlist-only sign-in's row alone (no role claim to write)", async () => {
    const identityQuery = vi.fn(async () => []);

    await expect(
      syncMcUserAtSignIn(
        { claims: { ...claims, roles: [] }, decision: { admitted: true, via: "allowlist", accessRole: null } },
        identityQuery
      )
    ).resolves.toBe("unchanged");
    expect(identityQuery).not.toHaveBeenCalled();
  });

  it("revokes the row of a refused sign-in (role removed, not allowlisted)", async () => {
    const identityQuery = vi.fn(async () => []);

    await expect(
      syncMcUserAtSignIn(
        { claims: { ...claims, roles: [] }, decision: { admitted: false, via: null, accessRole: null } },
        identityQuery
      )
    ).resolves.toBe("revoked");
    const [sql, params] = identityQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("UPDATE mc_users");
    expect(sql).toContain("status = 'revoked'");
    expect(params).toEqual(["oid-new-admin"]);
  });

  it("reports a failed write without throwing, so admission alone decides", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const identityQuery = vi.fn(async () => {
      throw new Error("db down");
    });

    await expect(
      syncMcUserAtSignIn(
        { claims, decision: { admitted: true, via: "role", accessRole: "admin" } },
        identityQuery
      )
    ).resolves.toBe("failed");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("writes nothing without an Entra oid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const identityQuery = vi.fn(async () => []);

    await expect(
      syncMcUserAtSignIn(
        { claims: { ...claims, oid: undefined }, decision: { admitted: true, via: "role", accessRole: "admin" } },
        identityQuery
      )
    ).resolves.toBe("failed");
    expect(identityQuery).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
