// Identity persistence contracts — migration shape + revoke semantics.
// P1 does not apply migrations to staging/prod; SQL is inspected as a contract.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MCP_SERVICE_PRINCIPAL_ID,
  buildGithubIdentityRecord,
  buildMcUserRecord,
  buildServicePrincipalRecord,
  isGithubIdentityActive,
  isMcUserActive,
  isServicePrincipalActive,
} from "@/lib/permissions";
import {
  findGithubIdentityByUserId,
  findServicePrincipalById,
} from "@/lib/permissions/repository";

const MIGRATION = resolve(process.cwd(), "db/migrations/016_permissions_identities.sql");

describe("migration 016_permissions_identities.sql", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("is additive and idempotent (IF NOT EXISTS, no destructive SQL)", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+mc_users/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+github_identities/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+service_principals/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("keys mc_users by Entra oid and stores access roles", () => {
    expect(sql).toMatch(/entra_oid\s+text\s+NOT NULL/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*entra_oid\s*\)|entra_oid\s+text\s+NOT NULL\s+UNIQUE/i);
    expect(sql).toMatch(/access_role/i);
    expect(sql).toMatch(/owner/i);
    expect(sql).toMatch(/admin/i);
    expect(sql).toMatch(/member/i);
  });

  it("keys github_identities by numeric GitHub user id with verify/revoke columns", () => {
    expect(sql).toMatch(/github_user_id\s+bigint/i);
    expect(sql).toMatch(/PRIMARY KEY\s*\(\s*github_user_id\s*\)|github_user_id\s+bigint\s+PRIMARY KEY/i);
    expect(sql).toMatch(/verified_at/i);
    expect(sql).toMatch(/revoked_at/i);
    expect(sql).toMatch(/mc_user_id/i);
  });

  it("persists service principals with stable ids", () => {
    expect(sql).toMatch(/service_principals/i);
    expect(sql).toMatch(/sp_mcp_cursor|MCP_SERVICE|plx-mc-mcp/i);
  });
});

describe("identity records", () => {
  it("builds mc_users keyed by entra oid", () => {
    const user = buildMcUserRecord({
      entraOid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      email: "vince@petrasoap.com",
      accessRole: "owner",
    });
    expect(user.entraOid).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(user.accessRole).toBe("owner");
    expect(user.status).toBe("active");
    expect(isMcUserActive(user)).toBe(true);
  });

  it("builds verified github identities keyed by numeric id", () => {
    const link = buildGithubIdentityRecord({
      githubUserId: 123456,
      mcUserId: "usr_1",
      githubLogin: "vince",
    });
    expect(link.githubUserId).toBe(123456);
    expect(link.revokedAt).toBeNull();
    expect(isGithubIdentityActive(link)).toBe(true);
  });

  it("treats revoked users and github links as inactive", () => {
    const user = buildMcUserRecord({
      entraOid: "oid-revoked",
      email: "x@example.com",
      accessRole: "member",
      status: "revoked",
    });
    expect(isMcUserActive(user)).toBe(false);

    const link = buildGithubIdentityRecord({
      githubUserId: 99,
      mcUserId: "usr_1",
      githubLogin: "x",
      revokedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(isGithubIdentityActive(link)).toBe(false);
  });

  it("seeds the durable MCP service principal id", () => {
    const sp = buildServicePrincipalRecord({
      id: MCP_SERVICE_PRINCIPAL_ID,
      name: "PLX MC MCP",
    });
    expect(sp.id).toBe("sp_mcp_cursor");
    expect(isServicePrincipalActive(sp)).toBe(true);
    expect(
      isServicePrincipalActive({
        ...sp,
        status: "revoked",
      })
    ).toBe(false);
  });
});

describe("durable identity query seams", () => {
  it("loads service-principal status from persistence", async () => {
    const identityQuery = async () => [
      { id: "sp_mcp_cursor", name: "PLX MC MCP", status: "revoked" },
    ];
    await expect(findServicePrincipalById("sp_mcp_cursor", identityQuery)).resolves.toEqual({
      id: "sp_mcp_cursor",
      name: "PLX MC MCP",
      status: "revoked",
    });
  });

  it("loads active and revoked GitHub identity links by numeric user id", async () => {
    const activeQuery = async () => [
      {
        github_user_id: "123456",
        mc_user_id: "usr_1",
        github_login: "vince",
        verified_at: "2026-07-14T12:00:00.000Z",
        revoked_at: null,
      },
    ];
    const revokedQuery = async () => [
      {
        github_user_id: 654321,
        mc_user_id: "usr_2",
        github_login: "former-user",
        verified_at: new Date("2026-07-01T12:00:00.000Z"),
        revoked_at: new Date("2026-07-10T12:00:00.000Z"),
      },
    ];

    const active = await findGithubIdentityByUserId(123456, activeQuery);
    const revoked = await findGithubIdentityByUserId(654321, revokedQuery);

    expect(active).toEqual({
      githubUserId: 123456,
      mcUserId: "usr_1",
      githubLogin: "vince",
      verifiedAt: "2026-07-14T12:00:00.000Z",
      revokedAt: null,
    });
    expect(isGithubIdentityActive(active!)).toBe(true);
    expect(revoked?.revokedAt).toBe("2026-07-10T12:00:00.000Z");
    expect(isGithubIdentityActive(revoked!)).toBe(false);
  });
});
