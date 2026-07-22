// P4 honesty-oracle — hard gate: live requires inbound delta AND graphTokenOk.
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

const graphProbe = vi.hoisted(() => ({
  ok: false as boolean,
  throws: false as boolean,
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
  getBoringGateRow: vi.fn(async () => null),
  upsertBoringGateRow: vi.fn(),
}));

vi.mock("@/lib/sync/graph", () => ({
  probeGraphTokenOk: vi.fn(async () => {
    if (graphProbe.throws) throw new Error("probe boom");
    return graphProbe.ok;
  }),
  GRAPH_TOKEN_PROBE_TIMEOUT_MS: 8_000,
  clearSiteContextCache: vi.fn(),
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
import { probeGraphTokenOk } from "@/lib/sync/graph";
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
  graphProbe.ok = false;
  graphProbe.throws = false;
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
    expect(resolveDataSource(emptyFreshness(), true)).toBe("seed");
    expect(resolveDataSource(emptyFreshness(), false)).toBe("seed");
  });

  it("resolveDataSource is seed when inbound exists but graphTokenOk is false", () => {
    const fresh = emptyFreshness();
    fresh.registers[0] = {
      listKey: "projects",
      lastCompleteInboundAt: "2026-07-16T17:55:00.000Z",
      ageMs: 60_000,
      ok: true,
      reason: "fresh",
    };
    expect(resolveDataSource(fresh, false)).toBe("seed");
  });

  it("resolveDataSource is live only when inbound completed AND graphTokenOk", () => {
    const fresh = emptyFreshness();
    fresh.registers[0] = {
      listKey: "projects",
      lastCompleteInboundAt: "2026-07-16T17:55:00.000Z",
      ageMs: 60_000,
      ok: true,
      reason: "fresh",
    };
    expect(resolveDataSource(fresh, true)).toBe("live");
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

  it("resolveLastSweepAgeMs parses UTC display stamp YYYY.MM.DD · HH:mm", () => {
    const now = new Date("2026-07-20T16:40:00.000Z");
    expect(resolveLastSweepAgeMs("2026.07.20 · 15:40", now)).toBe(3_600_000);
  });

  it("resolveLastSweepAgeMs returns null for absent or invalid stamps", () => {
    const now = new Date("2026-07-16T18:00:00.000Z");
    expect(resolveLastSweepAgeMs(undefined, now)).toBeNull();
    expect(resolveLastSweepAgeMs("", now)).toBeNull();
    expect(resolveLastSweepAgeMs("not-a-date", now)).toBeNull();
    expect(resolveLastSweepAgeMs("2026.07.20", now)).toBeNull();
    expect(resolveLastSweepAgeMs("2026.07.20 · 99:99", now)).toBeNull();
    expect(resolveLastSweepAgeMs("2026.02.31 · 12:00", now)).toBeNull();
    expect(resolveLastSweepAgeMs("2026-02-31T12:00:00.000Z", now)).toBeNull();
    expect(resolveLastSweepAgeMs("2026-03-03T12:00:00", now)).toBeNull();
  });
});

describe("probeGraphTokenOk fail-soft", () => {
  it("returns false when resolveSite throws / times out (never throws)", async () => {
    const { probeGraphTokenOk: realProbe } = await vi.importActual<typeof import("@/lib/sync/graph")>(
      "@/lib/sync/graph"
    );
    await expect(
      realProbe({
        timeoutMs: 50,
        resolveSite: async () => {
          throw new Error("missing secret");
        },
      })
    ).resolves.toBe(false);

    await expect(
      realProbe({
        timeoutMs: 20,
        resolveSite: async () =>
          new Promise(() => {
            /* hang until timeout */
          }),
      })
    ).resolves.toBe(false);
  });

  it("returns true when site/list resolution succeeds", async () => {
    const { probeGraphTokenOk: realProbe } = await vi.importActual<typeof import("@/lib/sync/graph")>(
      "@/lib/sync/graph"
    );
    await expect(
      realProbe({
        resolveSite: async () => ({ siteId: "site", listIds: { todos: "1" } }),
      })
    ).resolves.toBe(true);
  });
});

describe("actionSelfCheck honesty oracle (P4)", () => {
  it("HARD GATE: freshly seeded / no inbound-delta → dataSource seed + honesty fields", async () => {
    completions.stamps = {};
    graphProbe.ok = false;

    const result = await actionSelfCheck(identity);

    expect(result.dataSource).toBe("seed");
    expect(result.graphTokenOk).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.operator).toBe("vince@petrasoap.com");
    expect(result.taskCount).toBe(3);
    expect(result.bucketCount).toBe(1);

    expect(result).toMatchObject({
      syncMode: "off",
      cronConfigured: false,
      inAppSchedulerEnabled: false,
      databaseBound: false,
      webhooksEnabled: false,
      mcpEnabled: false,
      graphTokenOk: false,
      dataSource: "seed",
      lastCheckoutDoor: null,
      boringTickStreak: 0,
      boringGateN: 7,
      boringGateMet: false,
      lastBoringEvalAt: null,
      lastBoringOutcome: null,
    });
    expect(result).not.toHaveProperty("syncEnabled");
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
    expect(result.mcpEnabled).toBe(false);
    expect(probeGraphTokenOk).toHaveBeenCalled();
  });

  it("stays seed when inbound delta exists but Graph token probe fails", async () => {
    completions.stamps = {
      projects: new Date("2026-07-16T17:55:00.000Z"),
    };
    graphProbe.ok = false;

    const result = await actionSelfCheck(identity);
    expect(result.graphTokenOk).toBe(false);
    expect(result.dataSource).toBe("seed");
  });

  it("reports live when inbound delta completed AND graphTokenOk", async () => {
    completions.stamps = {
      projects: new Date("2026-07-16T17:55:00.000Z"),
    };
    graphProbe.ok = true;

    const result = await actionSelfCheck(identity);
    expect(result.graphTokenOk).toBe(true);
    expect(result.dataSource).toBe("live");
    expect(result.freshness.registers.find((r) => r.listKey === "projects")?.lastCompleteInboundAt).toBeTruthy();
  });

  it("graphTokenOk false and dataSource seed when probe throws (fail-soft)", async () => {
    completions.stamps = {
      projects: new Date("2026-07-16T17:55:00.000Z"),
    };
    graphProbe.throws = true;

    const result = await actionSelfCheck(identity);
    expect(result.graphTokenOk).toBe(false);
    expect(result.dataSource).toBe("seed");
    expect(result.ok).toBe(true);
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
      probeGraphToken: async () => false,
      loadLastCheckoutDoor: async () => "mcp",
    });

    expect(honesty.mcpEnabled).toBe(true);
    expect(honesty.inAppSchedulerEnabled).toBe(true);
    expect(honesty.syncMode).toBe("in-app");
    expect(honesty.cronConfigured).toBe(true);
    expect(honesty.databaseBound).toBe(true);
    expect(honesty.lastSweepAgeMs).toBe(3_600_000);
    expect(honesty.graphTokenOk).toBe(false);
    expect(honesty.dataSource).toBe("seed");
    expect(honesty.lastCheckoutDoor).toBe("mcp");
  });

  it("webhooksEnabled true only when both env gates are on", async () => {
    vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_ENABLED", "1");
    vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_CLIENT_STATE", "state");
    vi.stubEnv("PLX_MC_GRAPH_NOTIFICATION_URL", "https://example.com/hook");

    const on = await buildHonestyFields({
      loadRegisterTimestamps: async () => ({}),
      probeGraphToken: async () => false,
    });
    expect(on.webhooksEnabled).toBe(true);

    vi.stubEnv("PLX_MC_GRAPH_WEBHOOK_ENABLED", "0");
    const off = await buildHonestyFields({
      loadRegisterTimestamps: async () => ({}),
      probeGraphToken: async () => false,
    });
    expect(off.webhooksEnabled).toBe(false);
  });

  it("cron mode names inAppSchedulerEnabled false while syncMode stays cron", async () => {
    vi.stubEnv("PLX_MC_SYNC_ENABLED", "");
    vi.stubEnv("CRON_SECRET", "cron-secret");

    const honesty = await buildHonestyFields({
      lastSweep: "2026.07.20 · 15:40",
      now: new Date("2026-07-20T16:40:00.000Z"),
      loadRegisterTimestamps: async () => ({}),
      probeGraphToken: async () => false,
    });

    expect(honesty.inAppSchedulerEnabled).toBe(false);
    expect(honesty.cronConfigured).toBe(true);
    expect(honesty.syncMode).toBe("cron");
    expect(honesty.lastSweepAgeMs).toBe(3_600_000);
    expect(honesty).not.toHaveProperty("syncEnabled");
  });

  it("buildHonestyFields folds injected probe into dataSource live discriminator", async () => {
    const seed = await buildHonestyFields({
      loadRegisterTimestamps: async () => ({
        projects: new Date("2026-07-16T17:55:00.000Z"),
      }),
      probeGraphToken: async () => false,
    });
    expect(seed.graphTokenOk).toBe(false);
    expect(seed.dataSource).toBe("seed");

    const live = await buildHonestyFields({
      loadRegisterTimestamps: async () => ({
        projects: new Date("2026-07-16T17:55:00.000Z"),
      }),
      probeGraphToken: async () => true,
    });
    expect(live.graphTokenOk).toBe(true);
    expect(live.dataSource).toBe("live");
  });
});
