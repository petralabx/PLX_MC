// P2 honesty-oracle thin v1 — hard gate: freshly seeded / no inbound-delta → dataSource "seed".
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  PLX_MC_MCP_ENABLED: "0",
  PLX_MC_SYNC_ENABLED: "",
  CRON_SECRET: "",
  PLX_MC_DATABASE_URL: "",
  PLX_MC_GRAPH_WEBHOOK_ENABLED: "",
  PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE: "",
  PLX_MC_GRAPH_NOTIFICATION_URL: "",
}));

vi.stubEnv("PLX_MC_MCP_ENABLED", env.PLX_MC_MCP_ENABLED);
vi.stubEnv("PLX_MC_SYNC_ENABLED", env.PLX_MC_SYNC_ENABLED);
vi.stubEnv("CRON_SECRET", env.CRON_SECRET);
vi.stubEnv("PLX_MC_DATABASE_URL", env.PLX_MC_DATABASE_URL);
vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_ENABLED", env.PLX_MC_GRAPH_WEBHOOK_ENABLED);
vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE", env.PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE);
vi.stubEnv("PLX_MC_GRAPH_NOTIFICATION_URL", env.PLX_MC_GRAPH_NOTIFICATION_URL);

const completions = vi.hoisted(() => ({
  stamps: {} as Record<string, Date | null>,
}));

vi.mock("@/lib/sync", () => ({
  snapshot: vi.fn(async () => ({
    tasks: [{ id: "TASK-1" }, { id: "TASK-2" }, { id: "TASK-3" }],
    buckets: [{ id: "BKT-1" }],
    lastSweep: "2026-07-16T12:00:00.000Z",
    risks: [],
    files: [],
    conflicts: [],
    errors: [],
    projects: [],
    repos: [],
    repoRequests: [],
  })),
  createTask: vi.fn(),
  patchTask: vi.fn(),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => null),
  getRegisterInboundCompletions: vi.fn(async () => ({ ...completions.stamps })),
}));

import { actionSelfCheck } from "@/lib/mcp/actions";
import {
  resolveDataSource,
  resolveSyncMode,
  resolveDatabaseBound,
  resolveLastSweepAgeMs,
  resolveWebhooksEnabled,
  buildHonestyFields,
} from "@/lib/mcp/honesty";
import type { McpIdentity } from "@/lib/mcp/auth";
import type { SyncFreshnessResult } from "@/lib/sync/freshness";

const identity: McpIdentity = {
  operatorEmail: "vince@petrasoap.com",
  runtime: "cursor",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_cursor",
  actor: { kind: "service", id: "sp_mcp_cursor", status: "active" },
};

function emptyFreshness(): SyncFreshnessResult {
  return {
    ok: false,
    code: "sync_stale",
    maxAgeMs: 360_000,
    checkedAt: "2026-07-16T18:00:00.000Z",
    registers: [
      {
        listKey: "projects",
        lastCompleteInboundAt: null,
        ageMs: null,
        ok: false,
        reason: "missing_register",
      },
      {
        listKey: "roadmap",
        lastCompleteInboundAt: null,
        ageMs: null,
        ok: false,
        reason: "missing_register",
      },
      {
        listKey: "todos",
        lastCompleteInboundAt: null,
        ageMs: null,
        ok: false,
        reason: "missing_register",
      },
    ],
    reasons: ["missing_register:projects", "missing_register:roadmap", "missing_register:todos"],
  };
}

beforeEach(() => {
  completions.stamps = {};
  vi.stubEnv("PLX_MC_MCP_ENABLED", "0");
  vi.stubEnv("PLX_MC_SYNC_ENABLED", "");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("PLX_MC_DATABASE_URL", "");
  vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_ENABLED", "");
  vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE", "");
  vi.stubEnv("PLX_MC_GRAPH_NOTIFICATION_URL", "");
});

describe("honesty helpers", () => {
  it("resolveSyncMode prefers in-app over cron", () => {
    expect(resolveSyncMode({ syncEnabled: true, cronConfigured: true })).toBe("in-app");
    expect(resolveSyncMode({ syncEnabled: false, cronConfigured: true })).toBe("cron");
    expect(resolveSyncMode({ syncEnabled: false, cronConfigured: false })).toBe("off");
  });

  it("resolveDataSource is seed when no register has inbound completion", () => {
    expect(resolveDataSource(emptyFreshness())).toBe("seed");
  });

  it("resolveDataSource is live when any required register completed inbound", () => {
    const fresh = emptyFreshness();
    fresh.registers[0] = {
      listKey: "projects",
      lastCompleteInboundAt: "2026-07-16T17:55:00.000Z",
      ageMs: 60_000,
      ok: true,
      reason: "fresh",
    };
    expect(resolveDataSource(fresh)).toBe("live");
  });

  it("resolveDatabaseBound / lastSweepAgeMs / webhooksEnabled", () => {
    expect(resolveDatabaseBound("")).toBe(false);
    expect(resolveDatabaseBound("  ")).toBe(false);
    expect(resolveDatabaseBound("postgres://x")).toBe(true);
    const now = new Date("2026-07-16T18:00:00.000Z");
    expect(resolveLastSweepAgeMs("2026-07-16T17:00:00.000Z", now)).toBe(3_600_000);
    expect(resolveLastSweepAgeMs(null, now)).toBeNull();
    expect(resolveWebhooksEnabled({ enabled: false, configured: true })).toBe(false);
    expect(resolveWebhooksEnabled({ enabled: true, configured: false })).toBe(false);
    expect(resolveWebhooksEnabled({ enabled: true, configured: true })).toBe(true);
  });
});

describe("actionSelfCheck honesty oracle (P2)", () => {
  it("HARD GATE: freshly seeded / no inbound-delta → dataSource seed + honesty fields", async () => {
    // No sync_register_freshness rows — same as ensureSeeded-only DB.
    completions.stamps = {};

    const result = await actionSelfCheck(identity);

    expect(result.dataSource).toBe("seed");
    expect(result.ok).toBe(true);
    expect(result.operator).toBe("vince@petrasoap.com");
    expect(result.taskCount).toBe(3);
    expect(result.bucketCount).toBe(1);

    // Honesty fields present (shape contract).
    expect(result).toMatchObject({
      syncMode: "off",
      cronConfigured: false,
      syncEnabled: false,
      databaseBound: false,
      webhooksEnabled: false,
      mcpEnabled: false,
      dataSource: "seed",
      lastCheckoutDoor: null,
    });
    expect(typeof result.lastSweepAgeMs === "number" || result.lastSweepAgeMs === null).toBe(true);
    expect(result.freshness).toEqual(
      expect.objectContaining({
        ok: false,
        code: "sync_stale",
        registers: expect.any(Array),
        reasons: expect.arrayContaining([
          "missing_register:projects",
          "missing_register:roadmap",
          "missing_register:todos",
        ]),
      })
    );
    expect(result.freshness.registers.every((r) => r.lastCompleteInboundAt === null)).toBe(true);

    // mcpEnabled must NOT be hardcoded true.
    expect(result.mcpEnabled).toBe(false);
  });

  it("reports live when a required register has completed inbound delta", async () => {
    completions.stamps = {
      projects: new Date("2026-07-16T17:55:00.000Z"),
    };

    const result = await actionSelfCheck(identity);
    expect(result.dataSource).toBe("live");
    expect(result.freshness.registers.find((r) => r.listKey === "projects")?.lastCompleteInboundAt).toBeTruthy();
  });

  it("reflects real env for mcpEnabled / syncMode / cronConfigured / databaseBound", async () => {
    vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
    vi.stubEnv("PLX_MC_SYNC_ENABLED", "1");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("PLX_MC_DATABASE_URL", "postgres://plx_mc_app@localhost/plx_mc");

    const honesty = await buildHonestyFields({
      lastSweep: "2026-07-16T17:00:00.000Z",
      now: new Date("2026-07-16T18:00:00.000Z"),
      loadRegisterTimestamps: async () => ({}),
      loadLastCheckoutDoor: async () => "mcp",
    });

    expect(honesty.mcpEnabled).toBe(true);
    expect(honesty.syncEnabled).toBe(true);
    expect(honesty.syncMode).toBe("in-app");
    expect(honesty.cronConfigured).toBe(true);
    expect(honesty.databaseBound).toBe(true);
    expect(honesty.lastSweepAgeMs).toBe(3_600_000);
    expect(honesty.dataSource).toBe("seed");
    expect(honesty.lastCheckoutDoor).toBe("mcp");
  });

  it("webhooksEnabled true only when both env gates are on", async () => {
    vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_ENABLED", "1");
    vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE", "state");
    vi.stubEnv("PLX_MC_GRAPH_NOTIFICATION_URL", "https://example.com/hook");

    const on = await buildHonestyFields({
      loadRegisterTimestamps: async () => ({}),
    });
    expect(on.webhooksEnabled).toBe(true);

    vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_ENABLED", "0");
    const off = await buildHonestyFields({
      loadRegisterTimestamps: async () => ({}),
    });
    expect(off.webhooksEnabled).toBe(false);
  });
});
