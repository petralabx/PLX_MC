// Revenue scope (Progress Huddle 2026-10-23: "filter out distribution, keep
// liquid sales"): the Revenue card's month with chosen customer classes left
// out, read from revenueByClass so it adds up with the class table to the cent.
// The card itself and the goal stay on every class; this is a second figure
// beside it. Pure.

import type { CustomerClass } from "./forecast-list";
import type { RevenueByClass } from "./revenue-by-class";

/** all: every class; mfg: Exclusive Distribution left out (Manufacturing, Mixed, Unclassified stay). */
export type RevenueScope = "all" | "mfg";

export const SCOPE_EXCLUDES: Record<RevenueScope, readonly CustomerClass[]> = {
  all: [],
  mfg: ["Exclusive Distribution"],
};

export interface RevenueScopeView {
  scope: RevenueScope;
  excluded: readonly CustomerClass[];
  /** CAD cents for the classes in scope. */
  totalCadCents: number;
  /** CAD cents left out. */
  excludedCadCents: number;
  /** Of the monthly target; null when the target isn't positive. */
  progress: number | null;
  /** Carried from revenueByClass: false when the class split and the card are a refresh apart. */
  matchesCard: boolean;
}

export function revenueScope(byClass: RevenueByClass, scope: RevenueScope, targetCents: number): RevenueScopeView {
  const excluded = SCOPE_EXCLUDES[scope];
  let totalCadCents = 0;
  let excludedCadCents = 0;
  for (const row of byClass.rows) {
    if (excluded.includes(row.customerClass)) excludedCadCents += row.totalCadCents;
    else totalCadCents += row.totalCadCents;
  }
  return {
    scope,
    excluded,
    totalCadCents,
    excludedCadCents,
    progress: targetCents > 0 ? totalCadCents / targetCents : null,
    matchesCard: byClass.matchesCard,
  };
}
