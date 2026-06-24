// Pure helpers for the MC-SOP-Guide screen. No React — unit-testable, and they
// keep the views presentational. Only `import type` from the domain barrel so
// the client bundle never pulls in the server-only fs source.

import type { SopState, SopStatus, SopSummaryRow } from "@/lib/governance-sops";

// ─── Stat strip ───────────────────────────────────────────────────────────────

export interface GSStats {
  total: number;
  active: number;
  planned: number;
  degraded: number;
}

export function deriveStats(rows: SopSummaryRow[]): GSStats {
  let active = 0;
  let planned = 0;
  let degraded = 0;
  for (const r of rows) {
    if (r.state === "degraded") degraded++;
    else if (r.state === "planned") planned++;
    else if (r.meta.status === "active") active++;
  }
  return { total: rows.length, active, planned, degraded };
}

// ─── Filter universes ─────────────────────────────────────────────────────────

export function deriveCategories(rows: SopSummaryRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const t of r.meta.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function deriveStatuses(rows: SopSummaryRow[]): SopStatus[] {
  const order: SopStatus[] = ["active", "draft", "superseded", "planned"];
  const present = new Set(rows.map((r) => r.meta.status));
  return order.filter((s) => present.has(s));
}

// ─── Filter state + predicate ─────────────────────────────────────────────────

export interface GSFilterState {
  text?: string;
  categories?: string[];
  statuses?: SopStatus[];
}

export function matchesText(row: SopSummaryRow, q: string): boolean {
  const t = q.toLowerCase();
  const m = row.meta;
  return (
    m.title.toLowerCase().includes(t) ||
    m.description.toLowerCase().includes(t) ||
    m.audience.toLowerCase().includes(t) ||
    m.owner.toLowerCase().includes(t) ||
    m.slug.toLowerCase().includes(t) ||
    m.tags.some((tag) => tag.toLowerCase().includes(t))
  );
}

export function applyFilters(rows: SopSummaryRow[], filter: GSFilterState): SopSummaryRow[] {
  return rows.filter((row) => {
    if (filter.text?.trim() && !matchesText(row, filter.text.trim())) return false;
    if (filter.categories?.length && !filter.categories.some((c) => row.meta.tags.includes(c))) {
      return false;
    }
    if (filter.statuses?.length && !filter.statuses.includes(row.meta.status)) return false;
    return true;
  });
}

export function hasActiveFilters(filter: GSFilterState): boolean {
  return Boolean(filter.text?.trim() || filter.categories?.length || filter.statuses?.length);
}

// ─── Labels + tones ───────────────────────────────────────────────────────────

export function statusLabel(status: SopStatus): string {
  const labels: Record<SopStatus, string> = {
    active: "Active",
    draft: "Draft",
    superseded: "Superseded",
    planned: "Coming soon",
  };
  return labels[status];
}

/** CSS tone class for the status badge. */
export function statusTone(status: SopStatus): "ok" | "warn" | "muted" {
  if (status === "active") return "ok";
  if (status === "draft") return "warn";
  return "muted"; // superseded / planned
}

/** CSS tone for a row's availability dot + left border. */
export function stateTone(state: SopState): "ok" | "muted" | "hot" {
  if (state === "ready") return "ok";
  if (state === "planned") return "muted";
  return "hot"; // degraded
}

export function degradedReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    source_missing: "Source missing",
    source_empty: "Source empty",
    read_error: "Read error",
    planned: "Coming soon",
  };
  return labels[reason] ?? reason;
}
