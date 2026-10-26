// Revenue scope (Progress Huddle 2026-10-23: "filter out distribution, keep
// liquid sales"): the Revenue card's month with chosen customer classes left
// out, read from revenueByClass so it adds up with the class table to the cent.
// At scope=mfg the card's headline, status and pace read this figure; the
// goal stays the same monthly target (TASK-3934). Freight and other charges
// (Sage line type 2, an entry's freight) never count toward the goal
// (TASK-3952): goalCadCents leaves them out and progress, status and pace read
// it. Pure.

import type { CustomerClass } from "./forecast-list";
import { prorateCents } from "./money";
import type { RevenueByClass } from "./revenue-by-class";
import type { GoalStatus } from "./rules";

/** all: every class; mfg: Exclusive Distribution left out (Manufacturing, Mixed, Unclassified stay). */
export type RevenueScope = "all" | "mfg";

export const SCOPE_EXCLUDES: Record<RevenueScope, readonly CustomerClass[]> = {
  all: [],
  mfg: ["Exclusive Distribution"],
};

export interface RevenueScopeView {
  scope: RevenueScope;
  excluded: readonly CustomerClass[];
  /** CAD cents for the classes in scope, charges included (the class table's figure). */
  totalCadCents: number;
  /** Of totalCadCents, freight and other charges: left out of the goal. */
  chargesCadCents: number;
  /** totalCadCents less chargesCadCents: what counts toward the goal (the card's headline). */
  goalCadCents: number;
  /** Of goalCadCents, shipments entered by hand (their product value; freight is in chargesCadCents). */
  byHandGoalCadCents: number;
  /** CAD cents of the classes left out, their charges included. */
  excludedCadCents: number;
  /** Of the monthly target; null when the target isn't positive. */
  progress: number | null;
  /** Against the unchanged target's due-so-far; null without pace input. */
  status: GoalStatus | null;
  /** CAD cents a working day to reach the target from this scope's total; null without pace input. */
  neededPerDayCents: number | null;
  /** Carried from revenueByClass: false when the class split and the card are a refresh apart. */
  matchesCard: boolean;
}

/** The card's pace inputs: the target's due-so-far and the working days left (same as rules.ts). */
export interface RevenueScopePace {
  dueSoFarCents: number;
  remaining: number;
}

export function revenueScope(
  byClass: RevenueByClass,
  scope: RevenueScope,
  targetCents: number,
  pace?: RevenueScopePace,
): RevenueScopeView {
  const excluded = SCOPE_EXCLUDES[scope];
  let totalCadCents = 0;
  let excludedCadCents = 0;
  let chargesCadCents = 0;
  let byHandGoalCadCents = 0;
  for (const row of byClass.rows) {
    if (excluded.includes(row.customerClass)) {
      excludedCadCents += row.totalCadCents;
      continue;
    }
    totalCadCents += row.totalCadCents;
    chargesCadCents += row.charges.totalCadCents;
    byHandGoalCadCents += row.byHand.cadCents - row.charges.byHandCadCents;
  }
  const goalCadCents = totalCadCents - chargesCadCents;
  return {
    scope,
    excluded,
    totalCadCents,
    chargesCadCents,
    goalCadCents,
    byHandGoalCadCents,
    excludedCadCents,
    progress: targetCents > 0 ? goalCadCents / targetCents : null,
    status: pace ? (goalCadCents >= pace.dueSoFarCents ? "on_track" : "behind") : null,
    neededPerDayCents: pace
      ? pace.remaining > 0
        ? prorateCents(Math.max(0, targetCents - goalCadCents), 1, pace.remaining)
        : 0
      : null,
    matchesCard: byClass.matchesCard,
  };
}
