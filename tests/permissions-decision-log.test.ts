// TASK-620 — decision audit sink: row shape, fail-open behavior, off-mode no-op.

import { afterEach, describe, expect, it, vi } from "vitest";

import { recordPermissionDecision } from "@/lib/permissions/decision-log";
import type { IdentityQuery } from "@/lib/permissions";

afterEach(() => {
  vi.unstubAllEnvs();
});

const entry = {
  site: "routing.session",
  actorKind: "human" as const,
  actorId: "oid-1",
  capability: "task.create",
  resourceType: "task",
  resourceId: "TASK-1",
  allowed: true,
  reasonCode: "allowed",
  policyVersion: "permissions.v2",
  auditLabel: "vince@petrasoap.com",
};

describe("recordPermissionDecision", () => {
  it("is a DB-free no-op in mode off", async () => {
    const runQuery = vi.fn();
    await expect(recordPermissionDecision(entry, runQuery as IdentityQuery)).resolves.toBe(false);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("writes one parameterized row with allowed/reason/mode in staged modes", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const runQuery = vi.fn(async () => []);
    await expect(recordPermissionDecision(entry, runQuery)).resolves.toBe(true);
    expect(runQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = runQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO permissions_decision_log");
    expect(params).toEqual([
      "routing.session",
      "human",
      "oid-1",
      "task.create",
      "task",
      "TASK-1",
      true,
      "allowed",
      "permissions.v2",
      "log-only",
      null,
      null,
      "vince@petrasoap.com",
    ]);
  });

  it("persists shadow verdict columns when provided", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "review");
    const runQuery = vi.fn(async () => []);
    await recordPermissionDecision(
      { ...entry, shadowAllowed: false, shadowReasonCode: "capability_not_granted" },
      runQuery
    );
    const [, params] = runQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[9]).toBe("review");
    expect(params[10]).toBe(false);
    expect(params[11]).toBe("capability_not_granted");
  });

  it("fail-open: a sink failure resolves false and never throws", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const runQuery: IdentityQuery = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(recordPermissionDecision(entry, runQuery)).resolves.toBe(false);
  });
});
