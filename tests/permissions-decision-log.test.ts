// TASK-620 — decision audit sink: row shape, fail-open behavior, off-mode no-op,
// and one permissions_decision_log row (allowed + reasonCode) per mutating decision.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  userRole: "admin" as "admin" | "member",
  principalStatus: "active" as "active" | "revoked" | "missing",
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    dbState.calls.push({ sql, params });
    if (sql.includes("FROM service_principals")) {
      if (dbState.principalStatus === "missing") return [];
      return [{ id: params[0], name: String(params[0]), status: dbState.principalStatus }];
    }
    if (sql.includes("FROM mc_users")) {
      return [
        {
          id: "u1",
          entra_oid: params[0],
          email: "vince@petrasoap.com",
          display_name: "Vince",
          access_role: dbState.userRole,
          status: "active",
        },
      ];
    }
    if (sql.includes("FROM routing_sessions")) {
      const later = new Date(Date.now() + 86_400_000).toISOString();
      return [
        {
          id: params[0],
          repo_id: "plx-mc",
          actor_id: "other-oid",
          actor_kind: "human",
          base_branch: "main",
          source_branch: "task/x",
          head_sha: null,
          status: "active",
          absolute_expires_at: later,
          idle_expires_at: later,
        },
      ];
    }
    if (sql.includes("FROM projects")) {
      return [
        { id: "PRJ-OPEN", data: { id: "PRJ-OPEN", name: "Open", visibility: "shared", members: [] } },
        {
          id: "PRJ-SECRET",
          data: {
            id: "PRJ-SECRET",
            name: "Secret",
            visibility: "restricted",
            members: ["vince@petrasoap.com"],
          },
        },
      ];
    }
    if (sql.includes("FROM mc_dispatch WHERE id")) {
      return [
        {
          id: params[0],
          actor_kind: "agent",
          runtime: "cursor",
          task_id: "TASK-1",
          accountable_human: "vince@petrasoap.com",
          repo: "petralabx/PLX_MC",
          revoked: false,
          expires_at: new Date(Date.now() + 3_600_000),
          released_at: null,
          released_reason: null,
        },
      ];
    }
    return [];
  }),
  withTransaction: vi.fn(async (fn: (q: (sql: string, params?: unknown[]) => Promise<unknown[]>) => Promise<unknown>) =>
    fn(async (sql: string, params: unknown[] = []) => {
      dbState.calls.push({ sql, params });
      return [];
    })
  ),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    auth: vi.fn(async () => ({ user: { oid: "oid-1", email: "vince@petrasoap.com" } })),
  };
});

import { recordPermissionDecision } from "@/lib/permissions/decision-log";
import type { IdentityQuery } from "@/lib/permissions";
import { permissionsEnforcementMode } from "@/lib/auth/identity";
import { assertAgentAssigneeAllowed } from "@/lib/permissions/agent-assignee-guard";
import { assertProjectIdAccess } from "@/lib/permissions/project-acl-guard";
import { principalFromTokens } from "@/lib/permissions/project-acl";
import { resolveMcpServicePrincipal, type McpIdentity } from "@/lib/mcp/auth";
import { assertMcpToolAllowed } from "@/lib/mcp/tool-allowlist";
import { requireMcpActor, requireSessionActor } from "@/lib/routing/mutations/actors";
import { checkout, complete, requireGithubActionsProposeAuthorized } from "@/lib/compliance/service";
import { requireProjectionAuthorized } from "@/lib/compliance/projection";
import { requireSyncServiceWrite } from "@/lib/sync/engine";
import { requireRoutingMaintenance } from "@/app/api/cron/routing-maintenance/route";
import { POST as transferPost } from "@/app/api/routing/transfer/route";
import { setRoutingInboxEnabled } from "@/components/mc/routing-inbox/flag";

afterEach(() => {
  vi.unstubAllEnvs();
  setRoutingInboxEnabled(false);
});

beforeEach(() => {
  dbState.calls.length = 0;
  dbState.userRole = "admin";
  dbState.principalStatus = "active";
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

  it("writes a denial row with allowed false and the reasonCode in log-only", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const runQuery = vi.fn(async () => []);
    await recordPermissionDecision(
      { ...entry, allowed: false, reasonCode: "capability_not_granted" },
      runQuery
    );
    const [, params] = runQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[6]).toBe(false);
    expect(params[7]).toBe("capability_not_granted");
    expect(params[9]).toBe("log-only");
  });
});

function decisionInserts() {
  return dbState.calls.filter((call) => call.sql.includes("INSERT INTO permissions_decision_log"));
}

async function flushDecisions() {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function expectDecision(match: {
  site?: string;
  capability?: string;
  allowed: boolean;
  reasonCode: string;
}) {
  const hit = decisionInserts().find((call) => {
    const params = call.params;
    if (match.site !== undefined && params[0] !== match.site) return false;
    if (match.capability !== undefined && params[3] !== match.capability) return false;
    return params[6] === match.allowed && params[7] === match.reasonCode;
  });
  expect(hit, JSON.stringify(decisionInserts().map((call) => call.params))).toBeTruthy();
}

function mcpIdentity(id: McpIdentity["servicePrincipalId"]): McpIdentity {
  return {
    operatorEmail: "vince@petrasoap.com",
    runtime: "cursor",
    workerId: "w1",
    repo: "petralabx/PLX_MC",
    servicePrincipalId: id,
    actor: { kind: "service", id, status: "active" },
  };
}

describe("permissionsEnforcementMode legacy flag", () => {
  it("stays off when unset and maps ENABLED=1 to enforce unless mode wins", () => {
    expect(permissionsEnforcementMode()).toBe("off");
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
    expect(permissionsEnforcementMode()).toBe("enforce");
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    expect(permissionsEnforcementMode()).toBe("log-only");
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "yolo");
    expect(permissionsEnforcementMode()).toBe("enforce");
  });
});

describe("mutating decisions in log-only", () => {
  it("records nothing while mode is off", async () => {
    requireMcpActor(mcpIdentity("sp_mcp_cursor"), "task.progress", { type: "task", id: "TASK-1" });
    await expect(requireSyncServiceWrite()).resolves.toMatchObject({ id: "sp_sync_inbound" });
    await flushDecisions();
    expect(decisionInserts()).toHaveLength(0);
  });

  it("records allow and deny with allowed and reasonCode", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    requireMcpActor(mcpIdentity("sp_mcp_cursor"), "task.progress", { type: "task", id: "TASK-1" });
    expect(() =>
      requireMcpActor(mcpIdentity("sp_mcp_portal"), "task.checkout", { type: "task", id: "TASK-1" })
    ).toThrow(/task\.checkout denied/);
    await flushDecisions();
    expectDecision({
      site: "routing.mcp",
      capability: "task.progress",
      allowed: true,
      reasonCode: "allowed",
    });
    expectDecision({
      site: "routing.mcp",
      capability: "task.checkout",
      allowed: false,
      reasonCode: "capability_not_granted",
    });
  });

  it("records one row for each representative mutating call", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    const cursor = mcpIdentity("sp_mcp_cursor");
    requireMcpActor(cursor, "task.create", { type: "bucket", id: "BKT-1" });
    requireMcpActor(cursor, "task.checkout", { type: "task", id: "TASK-1" });
    requireMcpActor(cursor, "task.progress", { type: "task", id: "TASK-1" });
    requireMcpActor(cursor, "task.complete", { type: "task", id: "TASK-1" });
    requireMcpActor(cursor, "sync.mutate", { type: "sync" });
    await expect(requireSyncServiceWrite()).resolves.toMatchObject({ kind: "service" });
    await expect(requireRoutingMaintenance()).resolves.toMatchObject({ id: "sp_routing_maintenance" });
    await expect(
      requireProjectionAuthorized("task.progress", { type: "task", id: "TASK-1" })
    ).resolves.toMatchObject({ id: "sp_compliance_projection" });
    await expect(requireGithubActionsProposeAuthorized("petralabx/PLX_MC")).resolves.toMatchObject({
      id: "sp_github_actions_routing",
    });
    await expect(requireSessionActor("task.create", { type: "task", id: "TASK-1" })).resolves.toMatchObject({
      actorKind: "human",
    });
    const checkedOut = await checkout({
      taskId: "TASK-1",
      runtime: "cursor",
      accountableHuman: "vince@petrasoap.com",
      repo: "petralabx/PLX_MC",
      actor: cursor.actor,
      door: "mcp",
    });
    expect(checkedOut.checkoutId).toMatch(/^dsp_/);
    await complete({
      checkoutId: "dsp_sample",
      summary: "shipped",
      actor: cursor.actor,
    });
    await flushDecisions();

    for (const capability of ["task.create", "task.checkout", "task.progress", "task.complete", "sync.mutate"]) {
      expectDecision({ site: "routing.mcp", capability, allowed: true, reasonCode: "allowed" });
    }
    expectDecision({ site: "sync.service", capability: "sync.service.write", allowed: true, reasonCode: "allowed" });
    expectDecision({ site: "routing.maintenance", capability: "routing.maintain", allowed: true, reasonCode: "allowed" });
    expectDecision({
      site: "compliance.projection",
      capability: "task.progress",
      allowed: true,
      reasonCode: "allowed",
    });
    expectDecision({
      site: "compliance.routing-propose",
      capability: "routing.propose",
      allowed: true,
      reasonCode: "allowed",
    });
    expectDecision({ site: "routing.session", capability: "task.create", allowed: true, reasonCode: "allowed" });
    expectDecision({ site: "compliance.checkout", capability: "task.checkout", allowed: true, reasonCode: "allowed" });
    expectDecision({ site: "compliance.complete", capability: "task.complete", allowed: true, reasonCode: "allowed" });
  });

  it("records a log-only shadow denial without changing the applied allow", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    dbState.principalStatus = "revoked";
    const resolved = await resolveMcpServicePrincipal("sp_mcp_cursor");
    expect(resolved.actor.status).toBe("active");
    expect(resolved.shadowActor?.status).toBe("revoked");
    requireMcpActor(
      {
        ...mcpIdentity("sp_mcp_cursor"),
        actor: resolved.actor,
        shadowActor: resolved.shadowActor,
        shadowMissing: resolved.shadowMissing,
      },
      "task.progress",
      { type: "task", id: "TASK-1" }
    );
    await flushDecisions();
    const hit = decisionInserts().find((call) => call.params[3] === "task.progress");
    expect(hit?.params[6]).toBe(true);
    expect(hit?.params[7]).toBe("allowed");
    expect(hit?.params[10]).toBe(false);
    expect(hit?.params[11]).toBe("actor_revoked");
  });

  it("records tool-allowlist and agent-assignee denials, and restricted-project decisions", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "log-only");
    expect(() =>
      assertMcpToolAllowed(
        { servicePrincipalId: "sp_mcp_portal", operatorEmail: "vince@petrasoap.com" },
        "mc_report_progress"
      )
    ).toThrow(/denied/);
    expect(() =>
      assertAgentAssigneeAllowed(
        { kind: "service", id: "sp_mcp_cursor", status: "active" },
        "agent:hasitha",
        { capability: "task.create" }
      )
    ).toThrow(/agent:/);
    assertAgentAssigneeAllowed(
      { kind: "human", id: "oid-1", role: "admin", status: "active" },
      "agent:hasitha",
      { capability: "task.progress" }
    );
    await expect(assertProjectIdAccess("PRJ-OPEN", principalFromTokens("greg@petrasoap.com"))).resolves.toBeUndefined();
    await expect(
      assertProjectIdAccess("PRJ-SECRET", principalFromTokens("vince@petrasoap.com"))
    ).resolves.toBeUndefined();
    await expect(assertProjectIdAccess("PRJ-SECRET", principalFromTokens("greg@petrasoap.com"))).rejects.toMatchObject({
      code: "project_acl_denied",
    });
    await flushDecisions();
    expectDecision({
      site: "mcp.tool-allowlist",
      capability: "mc_report_progress",
      allowed: false,
      reasonCode: "tool_not_allowlisted",
    });
    expectDecision({
      site: "permissions.agent-assignee",
      capability: "task.create",
      allowed: false,
      reasonCode: "context_denied",
    });
    expectDecision({
      site: "permissions.agent-assignee",
      capability: "task.progress",
      allowed: true,
      reasonCode: "allowed",
    });
    expectDecision({
      site: "permissions.project-acl",
      capability: "project.access",
      allowed: true,
      reasonCode: "allowed",
    });
    expectDecision({
      site: "permissions.project-acl",
      capability: "project.access",
      allowed: false,
      reasonCode: "context_denied",
    });
    const aclRows = decisionInserts().filter((call) => call.params[0] === "permissions.project-acl");
    expect(aclRows).toHaveLength(2);
  });
});

describe("mutating denials in enforce", () => {
  it("records a missing and a revoked MCP principal", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    await expect(
      resolveMcpServicePrincipal("sp_mcp_cursor", { query: async () => [] })
    ).rejects.toMatchObject({ code: "mcp_service_principal_missing" });
    await expect(
      resolveMcpServicePrincipal("sp_mcp_cursor", {
        query: async () => [{ id: "sp_mcp_cursor", name: "Cursor", status: "revoked" }],
      })
    ).rejects.toMatchObject({ code: "mcp_service_principal_revoked" });
    await flushDecisions();
    expectDecision({ site: "mcp.auth", capability: "mcp.authenticate", allowed: false, reasonCode: "unknown_actor" });
    expectDecision({ site: "mcp.auth", capability: "mcp.authenticate", allowed: false, reasonCode: "actor_revoked" });
  });

  it("records a checkout with no actor as unknown_actor", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    await expect(
      checkout({
        taskId: "TASK-1",
        runtime: "cursor",
        accountableHuman: "vince@petrasoap.com",
        repo: "petralabx/PLX_MC",
      })
    ).rejects.toMatchObject({ status: 403 });
    await flushDecisions();
    expectDecision({
      site: "compliance.checkout",
      capability: "task.checkout",
      allowed: false,
      reasonCode: "unknown_actor",
    });
  });

  it("records a routing transfer denial for a member who does not own the session", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    dbState.userRole = "member";
    setRoutingInboxEnabled(true);
    const res = await transferPost(
      new Request("http://mc.plxcustomer.io/api/routing/transfer", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ sessionId: "rtx_1", sourceBranch: "task/x" }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(403);
    await flushDecisions();
    expectDecision({
      site: "routing.transfer",
      capability: "routing.resolve",
      allowed: false,
      reasonCode: "not_session_actor",
    });
  });
});
