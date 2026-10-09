// Outcome score component for routing suggestions (TASK-634). Scores each
// candidate by how the requesting runtime has done on similar work (tasks in
// the candidate's bucket) against every runtime in that bucket: pass rate,
// cycle time, and cost per completed task. Built from the TASK-632/633
// outcome folds over mc_events — read-only, no new store.
//
// Neutral by construction: too little history, no peers, or a metrics outage
// gives 0 points, so suggestion order with no history is unchanged. Exact
// references never move; only fuzzy candidates re-rank, and the component is
// capped at OUTCOME_MAX_POINTS. Runtimes that report no cost drop out of the
// cost comparison instead of looking free.

import { eventsByKinds, type EventRow } from "@/lib/compliance/repo";
import { computeCostRollup, resolveTelemetryCheckouts, type CostRollup } from "./cost-rollup";
import {
  MAX_WINDOW_DAYS,
  OUTCOME_EVENT_KINDS,
  computeAgentOutcomes,
  windowSince,
  type AgentOutcomeMetrics,
} from "./outcomes";
import type { RoutingCandidateRecord } from "./types";

/** Largest rank adjustment, in matchScore points, either way. */
export const OUTCOME_MAX_POINTS = 10;
/** Runtime checkouts in the bucket before the component leaves neutral. */
export const OUTCOME_MIN_SAMPLE = 3;
export const OUTCOME_WINDOW_DAYS = MAX_WINDOW_DAYS;
export const OUTCOME_WEIGHTS = { passRate: 0.6, cycleTime: 0.2, cost: 0.2 } as const;

const POOL = "\u0000pool";

export type OutcomeScoreStatus =
  | "scored"
  | "insufficient_history"
  | "no_peer_history"
  | "metrics_unavailable";

export interface OutcomeScoreEvidence {
  runtime: string;
  bucketId: string;
  windowDays: number;
  minSample: number;
  /** The requesting runtime's checkouts/completions on tasks in this bucket. */
  checkouts: number;
  completed: number;
  passRate: number | null;
  medianCycleMs: number | null;
  costPerCompletedTaskCents: number | null;
  /** All runtimes pooled on tasks in this bucket (the comparison baseline). */
  peerRuntimes: number;
  peerCheckouts: number;
  peerPassRate: number | null;
  peerMedianCycleMs: number | null;
  peerCostPerCompletedTaskCents: number | null;
}

export interface OutcomeScoreComponent {
  /** Points added to matchScore for ranking; 0 when neutral. */
  points: number;
  /** Weighted signal in [-1, 1] before scaling to points. */
  signal: number;
  status: OutcomeScoreStatus;
  /** True when the points could move rank (fuzzy candidates only). */
  applied: boolean;
  weights: typeof OUTCOME_WEIGHTS;
  evidence: OutcomeScoreEvidence | null;
}

interface BucketOutcomes {
  byRuntime: Map<string, AgentOutcomeMetrics>;
  pool: AgentOutcomeMetrics | null;
  runtimeCount: number;
  /** Cost per completion across runtimes that reported any cost; null if none did. */
  peerCostPerCompletedTaskCents: number | null;
  costByRuntime: Map<string, CostRollup>;
}

export type OutcomeIndex = Map<string, BucketOutcomes>;

/** Pure: group outcome events by the bucket of their task. */
export function buildOutcomeIndex(
  events: EventRow[],
  taskBucket: ReadonlyMap<string, string>,
  durableCheckoutTask: ReadonlyMap<string, string> = new Map()
): OutcomeIndex {
  const eventsByBucket = new Map<string, EventRow[]>();
  for (const ev of events) {
    if (ev.kind !== "checkout" && ev.kind !== "task.completed") continue;
    const bucket = ev.taskId ? taskBucket.get(ev.taskId) : undefined;
    if (!bucket) continue;
    let list = eventsByBucket.get(bucket);
    if (!list) eventsByBucket.set(bucket, (list = []));
    list.push(ev);
  }

  // Tasks outside taskBucket (hidden or unknown) drop out of the cost fold.
  const hidden = new Set<string>();
  for (const ev of events) if (ev.taskId && !taskBucket.has(ev.taskId)) hidden.add(ev.taskId);
  const costByBucket = new Map(
    computeCostRollup(events, taskBucket, hidden, durableCheckoutTask).byBucket.map((b) => [b.bucket, b])
  );

  const index: OutcomeIndex = new Map();
  for (const [bucket, list] of eventsByBucket) {
    const byRuntime = new Map(computeAgentOutcomes(list).map((o) => [o.runtime, o]));
    const pool = computeAgentOutcomes(list.map((ev) => ({ ...ev, actor: POOL })))[0] ?? null;
    const reported = (costByBucket.get(bucket)?.runtimes ?? []).filter((r) => r.costCents > 0);
    const reportedCompletions = reported.reduce((n, r) => n + r.completedTasks, 0);
    index.set(bucket, {
      byRuntime,
      pool,
      runtimeCount: byRuntime.size,
      peerCostPerCompletedTaskCents:
        reportedCompletions > 0
          ? reported.reduce((n, r) => n + r.costCents, 0) / reportedCompletions
          : null,
      costByRuntime: new Map(reported.map((r) => [r.runtime, r])),
    });
  }
  return index;
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Lower is better: positive when `mine` beats `peer`. */
function lowerIsBetter(mine: number | null, peer: number | null): number | null {
  if (mine === null || peer === null) return null;
  const scale = Math.max(mine, peer);
  return scale > 0 ? clamp((peer - mine) / scale) : 0;
}

function neutral(status: OutcomeScoreStatus, evidence: OutcomeScoreEvidence | null): OutcomeScoreComponent {
  return { points: 0, signal: 0, status, applied: false, weights: OUTCOME_WEIGHTS, evidence };
}

/** Pure: the outcome component for `runtime` on a candidate in `bucketId`. */
export function scoreOutcome(
  index: OutcomeIndex | null,
  runtime: string,
  bucketId: string
): OutcomeScoreComponent {
  if (!index) return neutral("metrics_unavailable", null);
  const bucket = index.get(bucketId);
  const mine = bucket?.byRuntime.get(runtime);
  const pool = bucket?.pool ?? null;
  const evidence: OutcomeScoreEvidence = {
    runtime,
    bucketId,
    windowDays: OUTCOME_WINDOW_DAYS,
    minSample: OUTCOME_MIN_SAMPLE,
    checkouts: mine?.checkouts ?? 0,
    completed: mine?.completed ?? 0,
    passRate: mine?.successRate ?? null,
    medianCycleMs: mine?.medianCycleMs ?? null,
    costPerCompletedTaskCents: bucket?.costByRuntime.get(runtime)?.costPerCompletedTaskCents ?? null,
    peerRuntimes: bucket?.runtimeCount ?? 0,
    peerCheckouts: pool?.checkouts ?? 0,
    peerPassRate: pool?.successRate ?? null,
    peerMedianCycleMs: pool?.medianCycleMs ?? null,
    peerCostPerCompletedTaskCents: bucket?.peerCostPerCompletedTaskCents ?? null,
  };
  if (!bucket || !mine || !pool || mine.checkouts < OUTCOME_MIN_SAMPLE) {
    return neutral("insufficient_history", evidence);
  }
  if (bucket.runtimeCount < 2) return neutral("no_peer_history", evidence);

  const parts: Array<[number | null, number]> = [
    [
      evidence.passRate !== null && evidence.peerPassRate !== null
        ? clamp(evidence.passRate - evidence.peerPassRate)
        : null,
      OUTCOME_WEIGHTS.passRate,
    ],
    [lowerIsBetter(evidence.medianCycleMs, evidence.peerMedianCycleMs), OUTCOME_WEIGHTS.cycleTime],
    [
      lowerIsBetter(evidence.costPerCompletedTaskCents, evidence.peerCostPerCompletedTaskCents),
      OUTCOME_WEIGHTS.cost,
    ],
  ];
  let weighted = 0;
  let totalWeight = 0;
  for (const [value, weight] of parts) {
    if (value === null) continue;
    weighted += value * weight;
    totalWeight += weight;
  }
  const signal = totalWeight > 0 ? weighted / totalWeight : 0;
  const points = Math.round(signal * OUTCOME_MAX_POINTS * 10) / 10;
  return { points, signal, status: "scored", applied: false, weights: OUTCOME_WEIGHTS, evidence };
}

export type OutcomeScoredCandidate<T extends RoutingCandidateRecord> = T & {
  outcomeScore: OutcomeScoreComponent;
};

/**
 * Pure: attach the outcome component to every candidate and re-rank. Exact
 * references keep their engine slots. Fuzzy candidates re-sort among the
 * fuzzy slots by matchScore + points, ties keep the engine order. With every
 * component neutral the engine order is returned unchanged.
 */
export function applyOutcomeScores<T extends RoutingCandidateRecord>(
  candidates: T[],
  runtime: string,
  index: OutcomeIndex | null
): OutcomeScoredCandidate<T>[] {
  const scored = candidates.map((c, order) => {
    const component = scoreOutcome(index, runtime, c.bucketId);
    const applied = c.authorizationTrust === "fuzzy" && component.points !== 0;
    return { c, order, component: { ...component, applied } };
  });
  const fuzzy = scored
    .filter((s) => s.c.authorizationTrust === "fuzzy")
    .sort((a, b) => {
      const diff =
        b.c.matchScore + (b.component.applied ? b.component.points : 0) -
        (a.c.matchScore + (a.component.applied ? a.component.points : 0));
      return diff !== 0 ? diff : a.order - b.order;
    });
  let next = 0;
  const ordered = scored.some((s) => s.component.applied)
    ? scored.map((s) => (s.c.authorizationTrust === "fuzzy" ? fuzzy[next++] : s))
    : scored;
  return ordered.map(({ c, component }, i) => ({
    ...c,
    rank: i + 1,
    reasons: component.applied
      ? [...c.reasons, `outcome:${component.points > 0 ? "+" : ""}${component.points}`]
      : c.reasons,
    outcomeScore: component,
  }));
}

/** Load the outcome index over the rolling window for the given task→bucket map. */
export async function loadOutcomeIndex(taskBucket: ReadonlyMap<string, string>): Promise<OutcomeIndex> {
  const events = await eventsByKinds(
    [...OUTCOME_EVENT_KINDS],
    undefined,
    windowSince(OUTCOME_WINDOW_DAYS)
  );
  return buildOutcomeIndex(events, taskBucket, await resolveTelemetryCheckouts(events));
}
