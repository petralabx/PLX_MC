// Honesty-oracle fields for mc_self_check (P4 Graph probe + P5 checkout door).
// dataSource: live requires recorded inbound delta AND acquirable Graph token.

import { latestCheckoutDoor } from "@/lib/compliance/repo";
import { cronConfigured, graphWebhookConfigured, graphWebhookEnabled } from "@/lib/secrets";
import {
  ROUTING_REQUIRED_REGISTERS,
  evaluateSyncFreshness,
  type SyncFreshnessResult,
} from "@/lib/sync/freshness";
import { probeGraphTokenOk } from "@/lib/sync/graph";
import { getRegisterInboundCompletions } from "@/lib/sync/repo";
import { syncEnabled } from "@/lib/sync/scheduler";
import { mcpEnabled } from "./auth";

export type SyncMode = "in-app" | "cron" | "off";
export type DataSource = "seed" | "live";

export interface HonestyFields {
  syncMode: SyncMode;
  cronConfigured: boolean;
  syncEnabled: boolean;
  databaseBound: boolean;
  lastSweepAgeMs: number | null;
  freshness: SyncFreshnessResult;
  webhooksEnabled: boolean;
  mcpEnabled: boolean;
  graphTokenOk: boolean;
  dataSource: DataSource;
  /** Most recent checkout door from audit (`mcp` | `compliance`), if any. */
  lastCheckoutDoor: string | null;
}

/** Cadence mode: in-app scheduler wins when enabled; else cron if secret present. */
export function resolveSyncMode(opts: {
  syncEnabled: boolean;
  cronConfigured: boolean;
}): SyncMode {
  if (opts.syncEnabled) return "in-app";
  if (opts.cronConfigured) return "cron";
  return "off";
}

export function resolveDatabaseBound(
  databaseUrl: string | undefined = process.env.PLX_MC_DATABASE_URL
): boolean {
  return !!(databaseUrl ?? "").trim();
}

export function resolveLastSweepAgeMs(
  lastSweep: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!lastSweep) return null;
  const t = new Date(lastSweep).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, now.getTime() - t);
}

/**
 * live = any required register has a completed inbound delta stamp AND Graph
 * token + site/list probe succeeded. Otherwise seed (either leg missing).
 */
export function resolveDataSource(
  freshness: SyncFreshnessResult,
  graphTokenOk: boolean
): DataSource {
  const anyCompleted = freshness.registers.some((r) => r.lastCompleteInboundAt != null);
  return anyCompleted && graphTokenOk ? "live" : "seed";
}

export function resolveWebhooksEnabled(opts?: {
  enabled?: boolean;
  configured?: boolean;
}): boolean {
  const enabled = opts?.enabled ?? graphWebhookEnabled();
  const configured = opts?.configured ?? graphWebhookConfigured();
  return enabled && configured;
}

async function loadLastCheckoutDoorSafe(): Promise<string | null> {
  try {
    return await latestCheckoutDoor();
  } catch {
    return null;
  }
}

/** Load freshness + honesty flags; Graph probe is fail-soft (never throws). */
export async function buildHonestyFields(opts?: {
  lastSweep?: string | null;
  now?: Date;
  loadRegisterTimestamps?: () => Promise<Partial<Record<string, Date | string | null | undefined>>>;
  probeGraphToken?: () => Promise<boolean>;
  loadLastCheckoutDoor?: () => Promise<string | null>;
}): Promise<HonestyFields> {
  const now = opts?.now ?? new Date();
  const syncOn = syncEnabled();
  const cronOn = cronConfigured();
  const freshness = await evaluateSyncFreshness({
    now,
    requiredRegisters: ROUTING_REQUIRED_REGISTERS,
    loadRegisterTimestamps:
      opts?.loadRegisterTimestamps ?? (() => getRegisterInboundCompletions()),
  });
  const databaseBound = resolveDatabaseBound();
  const lastCheckoutDoor = opts?.loadLastCheckoutDoor
    ? await opts.loadLastCheckoutDoor()
    : databaseBound
      ? await loadLastCheckoutDoorSafe()
      : null;

  let graphTokenOk = false;
  try {
    graphTokenOk = await (opts?.probeGraphToken ?? (() => probeGraphTokenOk()))();
  } catch {
    graphTokenOk = false;
  }

  return {
    syncMode: resolveSyncMode({ syncEnabled: syncOn, cronConfigured: cronOn }),
    cronConfigured: cronOn,
    syncEnabled: syncOn,
    databaseBound,
    lastSweepAgeMs: resolveLastSweepAgeMs(opts?.lastSweep, now),
    freshness,
    webhooksEnabled: resolveWebhooksEnabled(),
    mcpEnabled: mcpEnabled(),
    graphTokenOk,
    dataSource: resolveDataSource(freshness, graphTokenOk),
    lastCheckoutDoor,
  };
}
