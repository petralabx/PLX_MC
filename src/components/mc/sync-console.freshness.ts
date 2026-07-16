// Fail-closed staleness helpers for the Sync / Conflicts console (honesty-oracle P6).
// Resolutions stay paused until evaluateSyncFreshness reports required registers fresh.

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
