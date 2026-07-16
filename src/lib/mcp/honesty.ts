// Honesty-oracle fields for mc_self_check (P2 thin v1).
// Local-only: no Graph network probe. dataSource discriminates seed vs live
// from recorded inbound deltas on sync_register_freshness.

import { latestCheckoutDoor } from "@/lib/compliance/repo";
import { cronConfigured, graphWebhookConfigured, graphWebhookEnabled } from "@/lib/secrets";
import {
  ROUTING_REQUIRED_REGISTERS,
  evaluateSyncFreshness,
  type SyncFreshnessResult,
} from "@/lib/sync/freshness";
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
 * live = any required register has a completed inbound delta stamp.
 * seed = no required register has ever recorded one (fresh ensureSeeded state).
 */
export function resolveDataSource(freshness: SyncFreshnessResult): DataSource {
  const anyCompleted = freshness.registers.some((r) => r.lastCompleteInboundAt != null);
  return anyCompleted ? "live" : "seed";
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

/** Load freshness + honesty flags from local env/DB (no Graph). */
export async function buildHonestyFields(opts?: {
  lastSweep?: string | null;
  now?: Date;
  loadRegisterTimestamps?: () => Promise<Partial<Record<string, Date | string | null | undefined>>>;
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

  return {
    syncMode: resolveSyncMode({ syncEnabled: syncOn, cronConfigured: cronOn }),
    cronConfigured: cronOn,
    syncEnabled: syncOn,
    databaseBound,
    lastSweepAgeMs: resolveLastSweepAgeMs(opts?.lastSweep, now),
    freshness,
    webhooksEnabled: resolveWebhooksEnabled(),
    mcpEnabled: mcpEnabled(),
    dataSource: resolveDataSource(freshness),
    lastCheckoutDoor,
  };
}
