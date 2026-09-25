// Fail-closed staleness helpers for the Sync / Conflicts console (honesty-oracle P6).
// Resolutions stay paused until evaluateSyncFreshness reports required registers fresh.

import type { DataSource } from "@/lib/mc-data/store";
import type { SyncFreshnessResult } from "@/lib/sync/freshness";

/** Canonical banner copy when required registers are stale or freshness is unknown. */
export const SYNC_STALE_BANNER = "sync stale — resolutions paused";

/**
 * Fail-closed: null/unknown freshness pauses resolutions (never assume fresh).
 * Only an explicit `ok: true` result unlocks Keep MC / Keep SharePoint.
 */
export function resolutionsPausedFromFreshness(
  freshness: Pick<SyncFreshnessResult, "ok"> | null | undefined
): boolean {
  return freshness == null || !freshness.ok;
}

/** Banner text when paused; null when resolutions may proceed. */
export function syncStaleBannerText(
  freshness: Pick<SyncFreshnessResult, "ok"> | null | undefined
): string | null {
  return resolutionsPausedFromFreshness(freshness) ? SYNC_STALE_BANNER : null;
}

export interface ConnectionStatus {
  tone: "ok" | "off";
  label: string;
}

/**
 * The console's SharePoint "Connection" field, derived — never a constant.
 * "Connected · Microsoft 365" only on evidence: the store's data is live AND
 * freshness confirms a complete inbound sweep. Fail-closed like the helpers
 * above: unknown freshness is "unverified", not connected.
 */
export function connectionStatus(
  source: DataSource,
  freshness: Pick<SyncFreshnessResult, "ok"> | null | undefined
): ConnectionStatus {
  if (source === "offline") return { tone: "off", label: "Offline · showing cached or demo data" };
  if (freshness == null) return { tone: "off", label: "Unverified · sync health unknown" };
  if (!freshness.ok) return { tone: "off", label: "Stale · no recent complete sweep" };
  return { tone: "ok", label: "Connected · Microsoft 365" };
}
