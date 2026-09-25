// Pure helpers for the Activity screen (activity-view.tsx). No React, no I/O.

import type { ActivityFreshness, RepoActivityReport } from "@/lib/compliance";

/** Relative age of an ISO timestamp ("3h ago", "2d ago"), or "never". */
export function fmtAge(iso: string | null, now: Date = new Date()): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return "never";
  const minutes = Math.max(0, Math.floor((now.getTime() - ms) / 60_000));
  if (minutes < 60) return "just now";
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Block rate as a whole percent; em dash when there were no verdicts. */
export function fmtRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Median cycle time ("45m", "3.5h"); em dash when unknown. */
export function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** Freshness → existing `.pill` tone classes. */
export function freshnessTone(freshness: ActivityFreshness): "ok" | "warn" | "hot" | "muted" {
  if (freshness === "fresh") return "ok";
  if (freshness === "stale") return "warn";
  if (freshness === "dormant") return "hot";
  return "muted";
}

/** True when any repo has events or backfill coverage — otherwise the empty state. */
export function hasActivitySignal(report: RepoActivityReport): boolean {
  return report.repos.some(
    (row) => row.lastActivityAt !== null || row.openPrs !== null || row.unattributed !== null
  );
}
