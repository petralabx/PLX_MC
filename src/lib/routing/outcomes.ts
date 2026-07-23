// Per-task agent outcome metrics (TASK-632) + session telemetry aggregation
// (TASK-633), computed from the append-only mc_events substrate — no separate
// metrics store to drift. Pure computation over events; the loader wraps the
// compliance repo. Consumed by /api/agent-metrics and the routing suggest
// envelope (TASK-634).

import { eventsByKinds, type EventRow } from "@/lib/compliance/repo";

export const OUTCOME_EVENT_KINDS = [
  "checkout",
  "task.completed",
  "agent.session_telemetry",
] as const;

export interface AgentTelemetrySummary {
  sessions: number;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
}

export interface AgentOutcomeMetrics {
  /** Agent runtime label (checkout/complete `actor`). */
  runtime: string;
  checkouts: number;
  completed: number;
  /** completed / checkouts; null until the runtime has any checkout. */
  successRate: number | null;
  /** Checkouts raised on a task AFTER that task already completed once. */
  reworkCheckouts: number;
  reworkRate: number | null;
  /** Median checkout→completion latency across matched checkoutIds. */
  medianCycleMs: number | null;
  telemetry: AgentTelemetrySummary;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Pure: fold outcome events (any order) into per-runtime metrics. */
export function computeAgentOutcomes(events: EventRow[]): AgentOutcomeMetrics[] {
  const ordered = [...events].sort((a, b) => Number(a.seq) - Number(b.seq));

  interface Acc {
    checkouts: number;
    completed: number;
    reworkCheckouts: number;
    cycles: number[];
    telemetry: AgentTelemetrySummary;
  }
  const byRuntime = new Map<string, Acc>();
  const acc = (runtime: string): Acc => {
    let entry = byRuntime.get(runtime);
    if (!entry) {
      entry = {
        checkouts: 0,
        completed: 0,
        reworkCheckouts: 0,
        cycles: [],
        telemetry: { sessions: 0, tokensIn: 0, tokensOut: 0, costCents: 0 },
      };
      byRuntime.set(runtime, entry);
    }
    return entry;
  };

  const checkoutAt = new Map<string, { runtime: string; ts: number }>();
  const taskCompletedOnce = new Set<string>();

  for (const ev of ordered) {
    const runtime = ev.actor || "unknown";
    if (ev.kind === "checkout") {
      const entry = acc(runtime);
      entry.checkouts += 1;
      if (ev.taskId && taskCompletedOnce.has(ev.taskId)) {
        entry.reworkCheckouts += 1;
      }
      const checkoutId = ev.payload?.checkoutId;
      if (typeof checkoutId === "string") {
        checkoutAt.set(checkoutId, { runtime, ts: Date.parse(ev.ts) });
      }
    } else if (ev.kind === "task.completed") {
      const entry = acc(runtime);
      entry.completed += 1;
      if (ev.taskId) taskCompletedOnce.add(ev.taskId);
      const checkoutId = ev.payload?.checkoutId;
      if (typeof checkoutId === "string") {
        const started = checkoutAt.get(checkoutId);
        if (started && Number.isFinite(started.ts)) {
          const cycle = Date.parse(ev.ts) - started.ts;
          if (Number.isFinite(cycle) && cycle >= 0) acc(started.runtime).cycles.push(cycle);
        }
      }
    } else if (ev.kind === "agent.session_telemetry") {
      const entry = acc(runtime);
      entry.telemetry.sessions += 1;
      entry.telemetry.tokensIn += num(ev.payload?.tokensIn);
      entry.telemetry.tokensOut += num(ev.payload?.tokensOut);
      entry.telemetry.costCents += num(ev.payload?.costCents);
    }
  }

  return [...byRuntime.entries()]
    .map(([runtime, a]) => ({
      runtime,
      checkouts: a.checkouts,
      completed: a.completed,
      successRate: a.checkouts > 0 ? a.completed / a.checkouts : null,
      reworkCheckouts: a.reworkCheckouts,
      reworkRate: a.checkouts > 0 ? a.reworkCheckouts / a.checkouts : null,
      medianCycleMs: median(a.cycles),
      telemetry: a.telemetry,
    }))
    .sort((a, b) => a.runtime.localeCompare(b.runtime));
}

/** Load and compute over the durable event log. */
export async function loadAgentOutcomes(): Promise<AgentOutcomeMetrics[]> {
  const events = await eventsByKinds([...OUTCOME_EVENT_KINDS]);
  return computeAgentOutcomes(events);
}
