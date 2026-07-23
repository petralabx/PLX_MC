// TASK-618 — staged enforcement rollout: mode ladder semantics, actor
// resolution per mode, and shadow-verdict evaluation.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  permissionsEnforcementEnabled,
  permissionsEnforcementMode,
  permissionsIdentityHydrationEnabled,
} from "@/lib/auth/identity";
import type { IdentityQuery } from "@/lib/permissions";

const decisionLog = vi.hoisted(() => ({
  entries: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async (entry: Record<string, unknown>) => {
    decisionLog.entries.push(entry);
    return true;
  }),
}));

import {
  authorizeStaged,
  resolveStagedHumanActor,
  resolveStagedServicePrincipal,
} from "@/lib/permissions/enforcement";

afterEach(() => {
  vi.unstubAllEnvs();
  decisionLog.entries.length = 0;
});

const memberRow = {
  id: "u1",
  entra_oid: "oid-1",
  email: "member@petrasoap.com",
  display_name: "Member",
  access_role: "member",
  status: "active",
};

function queryReturning(rows: Record<string, unknown>[]): IdentityQuery {
  return vi.fn(async () => rows);
}

describe("permissionsEnforcementMode", () => {
  it("defaults off and honors the legacy enabled flag as enforce", () => {
    expect(permissionsEnforcementMode()).toBe("off");
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    expect(permissionsEnforcementMode()).toBe("enforce");
    expect(permissionsEnforcementEnabled()).toBe(true);
  });

  it("mode variable wins over the legacy flag", () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    expect(permissionsEnforcementMode()).toBe("log-only");
    expect(permissionsEnforcementEnabled()).toBe(false);
    expect(permissionsIdentityHydrationEnabled()).toBe(true);
  });

  it("unknown mode strings fall back to the legacy flag", () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "yolo");
    expect(permissionsEnforcementMode()).toBe("off");
  });
});

describe("resolveStagedHumanActor", () => {
  it("off: synthesizes admin without touching the database", async () => {
    const runQuery = vi.fn();
    const staged = await resolveStagedHumanActor("oid-1", runQuery as IdentityQuery);
    expect(staged.appliedActor).toEqual({
      kind: "human",
      id: "oid-1",
      role: "admin",
      status: "active",
    });
    expect(staged.shadowActor).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("log-only: keeps the legacy admin actor and hydrates the shadow", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const staged = await resolveStagedHumanActor("oid-1", queryReturning([memberRow]));
    expect(staged.appliedActor).toMatchObject({ kind: "human", role: "admin" });
    expect(staged.shadowActor).toEqual({
      kind: "human",
      id: "oid-1",
      role: "member",
      status: "active",
    });
    expect(staged.shadowMissing).toBe(false);
  });

  it("log-only: missing identity row is a shadow signal, not a denial", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const staged = await resolveStagedHumanActor("oid-unknown", queryReturning([]));
    expect(staged.appliedActor).toMatchObject({ kind: "human", role: "admin" });
    expect(staged.shadowMissing).toBe(true);
  });

  it("log-only: repository failure is fail-open", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const failing: IdentityQuery = vi.fn(async () => {
      throw new Error("db down");
    });
    const staged = await resolveStagedHumanActor("oid-1", failing);
    expect(staged.appliedActor).toMatchObject({ kind: "human", role: "admin" });
    expect(staged.shadowActor).toBeNull();
    expect(staged.shadowMissing).toBe(false);
  });

  it("review: humans still keep the legacy outcome with a shadow verdict", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "review");
    const staged = await resolveStagedHumanActor("oid-1", queryReturning([memberRow]));
    expect(staged.appliedActor).toMatchObject({ kind: "human", role: "admin" });
    expect(staged.shadowActor).toMatchObject({ kind: "human", role: "member" });
  });

  it("enforce: applied actor is the hydrated identity; missing row means null", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const hydrated = await resolveStagedHumanActor("oid-1", queryReturning([memberRow]));
    expect(hydrated.appliedActor).toMatchObject({ kind: "human", role: "member" });
    expect(hydrated.shadowActor).toBeNull();

    const missing = await resolveStagedHumanActor("oid-x", queryReturning([]));
    expect(missing.appliedActor).toBeNull();
  });
});

describe("resolveStagedServicePrincipal", () => {
  const spRow = { id: "sp_sync_inbound", name: "Sync", status: "active" };

  it("off: assumes active without a lookup", async () => {
    const runQuery = vi.fn();
    const staged = await resolveStagedServicePrincipal(
      "sp_sync_inbound",
      runQuery as IdentityQuery
    );
    expect(staged.actor?.status).toBe("active");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("log-only: assumes active but surfaces revocation as a shadow verdict", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const staged = await resolveStagedServicePrincipal(
      "sp_sync_inbound",
      queryReturning([{ ...spRow, status: "revoked" }])
    );
    expect(staged.actor?.status).toBe("active");
    expect(staged.shadowActor?.status).toBe("revoked");
  });

  it("log-only: missing principal row is shadow-only and fail-open on errors", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const missing = await resolveStagedServicePrincipal("sp_sync_inbound", queryReturning([]));
    expect(missing.actor?.status).toBe("active");
    expect(missing.shadowMissing).toBe(true);

    const failing: IdentityQuery = vi.fn(async () => {
      throw new Error("db down");
    });
    const errored = await resolveStagedServicePrincipal("sp_sync_inbound", failing);
    expect(errored.actor?.status).toBe("active");
    expect(errored.shadowMissing).toBe(false);
  });

  it("review: fail-closed — missing principal yields no actor", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "review");
    const staged = await resolveStagedServicePrincipal("sp_sync_inbound", queryReturning([]));
    expect(staged.actor).toBeNull();
    expect(staged.missing).toBe(true);
  });

  it("review/enforce: real revocation status flows into the applied actor", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "review");
    const staged = await resolveStagedServicePrincipal(
      "sp_sync_inbound",
      queryReturning([{ ...spRow, status: "revoked" }])
    );
    expect(staged.actor?.status).toBe("revoked");
  });
});

describe("authorizeStaged", () => {
  it("records the applied decision with the shadow verdict", () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const decision = authorizeStaged({
      site: "test.site",
      capability: "sync.mutate",
      resource: { type: "sync" },
      appliedActor: { kind: "human", id: "oid-1", role: "admin", status: "active" },
      shadowActor: { kind: "human", id: "oid-1", role: "member", status: "active" },
    });
    expect(decision.allowed).toBe(true);
    expect(decisionLog.entries).toHaveLength(1);
    expect(decisionLog.entries[0]).toMatchObject({
      site: "test.site",
      capability: "sync.mutate",
      allowed: true,
      reasonCode: "allowed",
      shadowAllowed: false,
      shadowReasonCode: "capability_not_granted",
    });
  });

  it("marks a missing shadow identity as an unknown_actor shadow denial", () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    authorizeStaged({
      site: "test.site",
      capability: "task.read",
      appliedActor: { kind: "human", id: "oid-1", role: "admin", status: "active" },
      shadowMissing: true,
    });
    expect(decisionLog.entries[0]).toMatchObject({
      shadowAllowed: false,
      shadowReasonCode: "unknown_actor",
    });
  });

  it("applies real denials in enforce mode with no shadow columns", () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const decision = authorizeStaged({
      site: "test.site",
      capability: "sync.mutate",
      resource: { type: "sync" },
      appliedActor: { kind: "human", id: "oid-1", role: "member", status: "active" },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("capability_not_granted");
    expect(decisionLog.entries[0]).toMatchObject({
      allowed: false,
      shadowAllowed: undefined,
    });
  });
});
