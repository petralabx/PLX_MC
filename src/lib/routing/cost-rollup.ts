// Cost-per-completed-task roll-ups (TASK-633), per runtime and per bucket.
// Derived from the same append-only mc_events rows as outcomes.ts
// (agent.session_telemetry, checkout, task.completed) — no new store. The
// bucket comes from the task's current bucket, passed in as a taskId→bucket
// map. Kept apart from outcomes.ts so the metrics shape there is untouched.

import { eventsByKinds, type EventRow } from "@/lib/compliance/repo";
import { snapshot } from "@/lib/sync";
import { OUTCOME_EVENT_KINDS, type AgentTelemetrySummary } from "./outcomes";

export const UNBUCKETED = "unbucketed";

export interface CostRollup extends AgentTelemetrySummary {
  /** Distinct tasks with a task.completed event in this group. */
  completedTasks: number;
  /** costCents / completedTasks; null until a task completes. */
  costPerCompletedTaskCents: number | null;
  tokensPerCompletedTask: number | null;
}

export interface RuntimeCostRollup extends CostRollup {
  runtime: string;
}

export interface BucketCostRollup extends CostRollup {
  bucket: string;
  runtimes: RuntimeCostRollup[];
}

export interface CostRollupResult {
  byRuntime: RuntimeCostRollup[];
  byBucket: BucketCostRollup[];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

interface Acc extends AgentTelemetrySummary {
  completed: Set<string>;
}
const newAcc = (): Acc => ({ sessions: 0, tokensIn: 0, tokensOut: 0, costCents: 0, completed: new Set() });

function finish(a: Acc): CostRollup {
  const completedTasks = a.completed.size;
  const tokens = a.tokensIn + a.tokensOut;
  return {
    sessions: a.sessions,
    tokensIn: a.tokensIn,
    tokensOut: a.tokensOut,
    costCents: a.costCents,
    completedTasks,
    costPerCompletedTaskCents: completedTasks > 0 ? a.costCents / completedTasks : null,
    tokensPerCompletedTask: completedTasks > 0 ? tokens / completedTasks : null,
  };
}

/**
 * Pure: fold outcome events (any order) into per-runtime and per-bucket cost
 * roll-ups. A telemetry row is attributed to its own taskId, else to the task
 * of its checkoutId. Rows tied to no known task land in the "unbucketed" group.
 */
export function computeCostRollup(
  events: EventRow[],
  taskBucket: ReadonlyMap<string, string>
): CostRollupResult {
  const checkoutTask = new Map<string, string>();
  for (const ev of events) {
    const id = ev.payload?.checkoutId;
    if (ev.kind === "checkout" && ev.taskId && typeof id === "string") checkoutTask.set(id, ev.taskId);
  }

  const byRuntime = new Map<string, Acc>();
  const byBucket = new Map<string, Map<string, Acc>>();
  const slot = (runtime: string, taskId: string | null) => {
    const bucket = (taskId && taskBucket.get(taskId)) || UNBUCKETED;
    let r = byRuntime.get(runtime);
    if (!r) byRuntime.set(runtime, (r = newAcc()));
    let runtimes = byBucket.get(bucket);
    if (!runtimes) byBucket.set(bucket, (runtimes = new Map()));
    let b = runtimes.get(runtime);
    if (!b) runtimes.set(runtime, (b = newAcc()));
    return [r, b] as const;
  };

  for (const ev of events) {
    const runtime = ev.actor || "unknown";
    if (ev.kind === "agent.session_telemetry") {
      const checkoutId = ev.payload?.checkoutId;
      const taskId = ev.taskId ?? (typeof checkoutId === "string" ? checkoutTask.get(checkoutId) ?? null : null);
      for (const a of slot(runtime, taskId)) {
        a.sessions += 1;
        a.tokensIn += num(ev.payload?.tokensIn);
        a.tokensOut += num(ev.payload?.tokensOut);
        a.costCents += num(ev.payload?.costCents);
      }
    } else if (ev.kind === "task.completed" && ev.taskId) {
      for (const a of slot(runtime, ev.taskId)) a.completed.add(ev.taskId);
    }
  }

  const runtimeRows = (m: Map<string, Acc>): RuntimeCostRollup[] =>
    [...m.entries()]
      .map(([runtime, a]) => ({ runtime, ...finish(a) }))
      .sort((a, b) => a.runtime.localeCompare(b.runtime));

  return {
    byRuntime: runtimeRows(byRuntime),
    byBucket: [...byBucket.entries()]
      .map(([bucket, runtimes]) => {
        const total = newAcc();
        for (const a of runtimes.values()) {
          total.sessions += a.sessions;
          total.tokensIn += a.tokensIn;
          total.tokensOut += a.tokensOut;
          total.costCents += a.costCents;
          a.completed.forEach((t) => total.completed.add(t));
        }
        return { bucket, ...finish(total), runtimes: runtimeRows(runtimes) };
      })
      .sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };
}

/** Load events + the task→bucket map and compute the roll-up. */
export async function loadCostRollup(): Promise<CostRollupResult> {
  const [events, snap] = await Promise.all([eventsByKinds([...OUTCOME_EVENT_KINDS]), snapshot()]);
  return computeCostRollup(events, new Map(snap.tasks.map((t) => [t.id, t.bucket])));
}
