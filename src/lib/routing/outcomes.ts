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

/** Event kinds the per-principal view folds (kept apart from OUTCOME_EVENT_KINDS so the per-runtime sample is unchanged). */
export const PRINCIPAL_EVENT_KINDS = [
  "checkout",
  "task.completed",
  "task.promoted",
  "task.progress",
  "gate.passed",
  "gate.blocked",
  "approval.decided",
] as const;

export const UNATTRIBUTED_PRINCIPAL = "unattributed";
export const MAX_WINDOW_DAYS = 90;
const EVENT_SAMPLE_LIMIT = 5000;

export interface PrincipalOutcomeMetrics {
  /** Service principal (checkout `permissionActorId`); "unattributed" when the stamp carried none. */
  principal: string;
  /** Runtime labels this principal acted as. */
  runtimes: string[];
  checkouts: number;
  completed: number;
  /** completed / checkouts; null until the principal has any checkout. */
  successRate: number | null;
  /** Re-checkouts on a task after it completed. */
  reworkCheckouts: number;
  /** Times a task this principal completed went back to a pre-Merged stage. */
  reopens: number;
  /** (reworkCheckouts + reopens) / completed; null until something completed. */
  reworkRate: number | null;
  medianCycleMs: number | null;
  gatePassed: number;
  gateBlocked: number;
  /** gatePassed / (gatePassed + gateBlocked); null with no agent gate events. */
  gatePassRate: number | null;
  approvalsApproved: number;
  approvalsRejected: number;
}

const PRE_MERGE_STAGES = new Set(["backlog", "specced", "approved", "planned", "progress", "qa", "review"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Pure: fold events (any order) into per-service-principal metrics. Principals
 * come from existing payloads only — checkout.permissionActorId, carried to
 * completion by checkoutId, and to gate/approval/reopen events by the task's
 * latest checkout. Gate events for operator PRs are ignored (agents only).
 */
export function computePrincipalOutcomes(events: EventRow[]): PrincipalOutcomeMetrics[] {
  const ordered = [...events].sort((a, b) => Number(a.seq) - Number(b.seq));

  interface Acc {
    runtimes: Set<string>;
    checkouts: number;
    completed: number;
    reworkCheckouts: number;
    reopens: number;
    cycles: number[];
    gatePassed: number;
    gateBlocked: number;
    approvalsApproved: number;
    approvalsRejected: number;
  }
  const byPrincipal = new Map<string, Acc>();
  const acc = (principal: string): Acc => {
    let entry = byPrincipal.get(principal);
    if (!entry) {
      entry = {
        runtimes: new Set(),
        checkouts: 0,
        completed: 0,
        reworkCheckouts: 0,
        reopens: 0,
        cycles: [],
        gatePassed: 0,
        gateBlocked: 0,
        approvalsApproved: 0,
        approvalsRejected: 0,
      };
      byPrincipal.set(principal, entry);
    }
    return entry;
  };

  const checkouts = new Map<string, { principal: string; ts: number }>();
  const latestByTask = new Map<string, { principal: string; runtime: string }>();
  const latestByTaskRuntime = new Map<string, string>();
  const doneBy = new Map<string, string>(); // task -> principal that completed it, until reopened

  for (const ev of ordered) {
    const runtime = ev.actor || "unknown";
    const taskId = ev.taskId;
    if (ev.kind === "checkout") {
      const principal = str(ev.payload?.permissionActorId) ?? UNATTRIBUTED_PRINCIPAL;
      const entry = acc(principal);
      entry.runtimes.add(runtime);
      entry.checkouts += 1;
      if (taskId) {
        if (doneBy.has(taskId)) {
          entry.reworkCheckouts += 1;
          doneBy.delete(taskId); // this rework is counted; a later progress must not recount it as a reopen
        }
        latestByTask.set(taskId, { principal, runtime });
        latestByTaskRuntime.set(`${taskId}\u0000${runtime}`, principal);
      }
      const checkoutId = str(ev.payload?.checkoutId);
      if (checkoutId) checkouts.set(checkoutId, { principal, ts: Date.parse(ev.ts) });
    } else if (ev.kind === "task.completed") {
      const checkoutId = str(ev.payload?.checkoutId);
      const started = checkoutId ? checkouts.get(checkoutId) : undefined;
      const principal =
        started?.principal ?? str(ev.payload?.permissionActorId) ?? UNATTRIBUTED_PRINCIPAL;
      const entry = acc(principal);
      entry.runtimes.add(runtime);
      entry.completed += 1;
      if (taskId) doneBy.set(taskId, principal);
      if (started && Number.isFinite(started.ts)) {
        const cycle = Date.parse(ev.ts) - started.ts;
        if (Number.isFinite(cycle) && cycle >= 0) entry.cycles.push(cycle);
      }
    } else if (ev.kind === "task.promoted") {
      // Merge promotion is a completion marker for reopen detection only.
      if (taskId && !doneBy.has(taskId)) {
        doneBy.set(taskId, latestByTask.get(taskId)?.principal ?? UNATTRIBUTED_PRINCIPAL);
      }
    } else if (ev.kind === "task.progress") {
      const stage = str(ev.payload?.stage);
      const owner = taskId ? doneBy.get(taskId) : undefined;
      if (taskId && owner !== undefined && stage && PRE_MERGE_STAGES.has(stage)) {
        acc(owner).reopens += 1;
        doneBy.delete(taskId);
      }
    } else if (ev.kind === "gate.passed" || ev.kind === "gate.blocked") {
      if (ev.payload?.actorKind !== "agent") continue;
      const principal =
        (taskId ? latestByTaskRuntime.get(`${taskId}\u0000${runtime}`) : undefined) ??
        UNATTRIBUTED_PRINCIPAL;
      const entry = acc(principal);
      entry.runtimes.add(runtime);
      if (ev.kind === "gate.passed") entry.gatePassed += 1;
      else entry.gateBlocked += 1;
    } else if (ev.kind === "approval.decided") {
      const principal = (taskId ? latestByTask.get(taskId)?.principal : undefined) ?? UNATTRIBUTED_PRINCIPAL;
      const entry = acc(principal);
      if (ev.payload?.decision === "approved") entry.approvalsApproved += 1;
      else if (ev.payload?.decision === "rejected") entry.approvalsRejected += 1;
    }
  }

  return [...byPrincipal.entries()]
    .map(([principal, a]) => {
      const gates = a.gatePassed + a.gateBlocked;
      return {
        principal,
        runtimes: [...a.runtimes].sort(),
        checkouts: a.checkouts,
        completed: a.completed,
        successRate: a.checkouts > 0 ? a.completed / a.checkouts : null,
        reworkCheckouts: a.reworkCheckouts,
        reopens: a.reopens,
        reworkRate: a.completed > 0 ? (a.reworkCheckouts + a.reopens) / a.completed : null,
        medianCycleMs: median(a.cycles),
        gatePassed: a.gatePassed,
        gateBlocked: a.gateBlocked,
        gatePassRate: gates > 0 ? a.gatePassed / gates : null,
        approvalsApproved: a.approvalsApproved,
        approvalsRejected: a.approvalsRejected,
      };
    })
    .sort((a, b) => a.principal.localeCompare(b.principal));
}

/** Window start (ISO) for a rolling `windowDays`; undefined = unbounded (legacy). */
export function windowSince(windowDays: number | undefined, now = Date.now()): string | undefined {
  return windowDays === undefined ? undefined : new Date(now - windowDays * 86_400_000).toISOString();
}

export interface OutcomeWindowOptions {
  /** Rolling window in days (1..MAX_WINDOW_DAYS); omit for the legacy newest-5000 sample. */
  windowDays?: number;
}

/** Load and compute over the durable event log. */
export async function loadAgentOutcomes(opts: OutcomeWindowOptions = {}): Promise<AgentOutcomeMetrics[]> {
  const events = await eventsByKinds([...OUTCOME_EVENT_KINDS], EVENT_SAMPLE_LIMIT, windowSince(opts.windowDays));
  return computeAgentOutcomes(events);
}

/** Per-service-principal view over the same window. `truncated` = hit the sample cap. */
export async function loadPrincipalOutcomes(
  opts: OutcomeWindowOptions = {}
): Promise<{ principals: PrincipalOutcomeMetrics[]; truncated: boolean }> {
  const events = await eventsByKinds([...PRINCIPAL_EVENT_KINDS], EVENT_SAMPLE_LIMIT, windowSince(opts.windowDays));
  return { principals: computePrincipalOutcomes(events), truncated: events.length >= EVENT_SAMPLE_LIMIT };
}
