// Assignment & accountability policy (EN-003 / WS-1). Pure predicates over a
// Task, reused by the client store (lib/mc-data/store.ts) and the server
// mutation (lib/sync/state.ts) so client and server enforce the SAME rules:
//   1. human-only tasks reject an agent executor;
//   2. a task cannot advance past `planned` without a human accountable owner;
//   3. a task cannot reach a done stage (merged/verified) with an incomplete
//      evidence bundle (the completion contract — reuses evidenceComplete).

import { AGENTS, OPERATOR_ID, HUMANS, STAGE_IDX } from "./data";
import { bandOf, evidenceComplete } from "./helpers";
import type { ApprovalGate, StageKey, Task, TaskQuestion } from "./types";

// The last stage a task may occupy without a human accountable owner.
export const ACCOUNTABLE_GATE_STAGE: StageKey = "planned";

// Terminal stages: first entry into any of these stamps entities.completed_at
// (TASK-2528). ONE shared set; cancelled is terminal but never "done" (TASK-2529).
export const TERMINAL_STAGES: readonly StageKey[] = ["merged", "verified", "cancelled"];

// Stages that no longer count as open work: done or cancelled. Counts, suggestions
// and sweeps use this one predicate so cancelled never reads as open.
export function isClosedStage(stage: StageKey): boolean {
  return TERMINAL_STAGES.includes(stage);
}

/** Stage-derived progress: cancelled closes work without counting as delivered. */
export interface TaskProgressCounts {
  done: number;
  cancelled: number;
  closedTasks: number;
  inProgress: number;
  notStarted: number;
  remaining: number;
  total: number;
  /** Closed / total (0–1); null for an empty task set. */
  pctDone: number | null;
}

export function taskProgressTotals(done: number, inProgress: number, notStarted: number, cancelled: number): TaskProgressCounts {
  const closedTasks = done + cancelled;
  const remaining = inProgress + notStarted;
  const total = closedTasks + remaining;
  return { done, cancelled, closedTasks, inProgress, notStarted, remaining, total, pctDone: total > 0 ? closedTasks / total : null };
}

export function countTaskProgress(tasks: readonly Pick<Task, "stage">[]): TaskProgressCounts {
  let done = 0;
  let cancelled = 0;
  let inProgress = 0;
  let notStarted = 0;
  for (const task of tasks) {
    if (isClosedStage(task.stage)) {
      if (task.stage === "cancelled") cancelled += 1;
      else done += 1;
    } else if (bandOf(task.stage) === "doing") inProgress += 1;
    else notStarted += 1;
  }
  return taskProgressTotals(done, inProgress, notStarted, cancelled);
}

// Stages that mean "done" for the completion contract.
const DONE_STAGES: StageKey[] = ["merged", "verified"];

export function isAgentId(id: string | null | undefined): boolean {
  return !!id && id in AGENTS;
}

// A human accountable owner is any non-empty id that is not an agent (invited
// people live outside AGENTS, so "not an agent" is the human test here).
export function hasHumanAccountableOwner(task: Pick<Task, "accountableOwner">): boolean {
  return !!task.accountableOwner && !isAgentId(task.accountableOwner);
}

// Resolve the operator identity behind an agent session (the Entra/session
// email an MCP request is admitted under, or an already-short directory id) to
// the human directory id that should own agent-driven work. Known Petra emails
// and directory ids map to that human; service aliases (cos@…) and anything
// unresolvable fall back to the hub's default accountable human (OPERATOR_ID).
// Shared by MCP task creation and the checkout backfill so a task created and
// checked out by the same session lands on the same owner.
export function resolveHumanAccountableOwner(operator: string): string {
  const normalized = operator.trim().toLowerCase();
  const byEmail = Object.values(HUMANS).find(
    (h) => (h.email ?? "").toLowerCase() === normalized
  );
  return byEmail?.id ?? HUMANS[normalized]?.id ?? OPERATOR_ID;
}

// The email of a known person, given their directory id or email, or null when
// the value names no person (a service alias such as cos@…, an agent, or
// nothing). Lower-cased, so callers can compare it directly.
export function humanEmailFor(idOrEmail: string | null | undefined): string | null {
  const normalized = (idOrEmail ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const human =
    HUMANS[normalized] ??
    Object.values(HUMANS).find((h) => (h.email ?? "").toLowerCase() === normalized);
  const email = human?.email?.trim().toLowerCase();
  return email || null;
}

// Why an actor cannot be the executor of this task, or null when allowed.
export function assignmentViolation(
  task: Pick<Task, "id" | "humanOnly">,
  actorId: string | null
): string | null {
  if (task.humanOnly && isAgentId(actorId)) {
    return `${task.id} is human-only — an agent can't be its executor.`;
  }
  return null;
}

export function agentRunApprovalNeeded(
  task: Pick<Task, "assignee" | "agentRunApproved">
): boolean {
  const executor = task.assignee ? AGENTS[task.assignee] : undefined;
  return !!executor && executor.mode === "approve" && !task.agentRunApproved;
}

/** Hard cap on an mc_get_approval_gate long-poll; keeps the route inside the serverless budget. */
export const APPROVAL_WAIT_MAX_MS = 25_000;

// Runtime approval gates (TASK-629): the A2A input-required state.
export function pendingApprovalGates(
  task: Pick<Task, "approvalGates">
): ApprovalGate[] {
  return (task.approvalGates ?? []).filter((g) => g.status === "pending");
}

export function inputRequired(task: Pick<Task, "approvalGates">): boolean {
  return pendingApprovalGates(task).length > 0;
}

/**
 * The id a question is addressed to (TASK-3567): a directory id ("ricardo"),
 * or the lowercased email of a person not in the directory. An email that
 * belongs to a listed person becomes their directory id, so it matches
 * sessionAuthorId and the viewer id. Null for an unknown directory id or an
 * agent: bots never answer questions.
 */
export function normalizeAddressee(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("@")) {
    const listed = Object.values(HUMANS).find((h) => h.email?.toLowerCase() === value);
    return listed ? listed.id : value;
  }
  if (isAgentId(value)) return null;
  return Object.prototype.hasOwnProperty.call(HUMANS, value) ? value : null;
}

// Open questions addressed to one person (TASK-3567). `personId` is a directory
// id or a lowercased email, as the viewer id is. The stored addressee is
// normalized again here, so a question asked by email still reaches the person
// once the directory lists that email.
export function openQuestionsFor(
  task: Pick<Task, "questions">,
  personId: string
): TaskQuestion[] {
  return (task.questions ?? []).filter(
    (q) => q.status === "open" && normalizeAddressee(q.addressee) === personId
  );
}

// Why this task cannot move to `nextStage`, or null when the move is allowed.
export function stageAdvanceViolation(
  task: Pick<
    Task,
    "id" | "accountableOwner" | "evidence" | "assignee" | "agentRunApproved" | "approvalGates"
  >,
  nextStage: StageKey
): string | null {
  // Cancelling closes work; it needs no owner/approval and is validated by the
  // cancel service (reason, replacedBy), not by the advance gates (TASK-2529).
  if (nextStage === "cancelled") return null;
  const nextIdx = STAGE_IDX[nextStage];
  if (nextIdx > STAGE_IDX[ACCOUNTABLE_GATE_STAGE] && !hasHumanAccountableOwner(task)) {
    return `${task.id} needs a human accountable owner before it can move past Planned.`;
  }
  // Agent autonomy gate (EN-005): an approve-mode agent executor can't take the
  // task into the doing band without an explicit operator approval of the run.
  // auto-mode agents are not gated here (subject only to the EN-003 gates).
  if (agentRunApprovalNeeded(task) && nextIdx >= STAGE_IDX.progress) {
    const executor = AGENTS[task.assignee ?? ""];
    return `${task.id} is run by ${executor.name} (needs-approval mode) — an operator must approve the run before it advances to In Progress.`;
  }
  if (DONE_STAGES.includes(nextStage) && task.evidence && !evidenceComplete(task.evidence)) {
    return `${task.id} can't be marked ${nextStage} until its evidence bundle is complete.`;
  }
  // Runtime approval gate (TASK-629): input-required freezes the stage until a
  // human decides every pending gate — no advance in either direction.
  const pending = pendingApprovalGates(task);
  if (pending.length > 0) {
    return `${task.id} is input-required — a human must decide the pending approval gate (${pending[0].reason}) before it can change stage.`;
  }
  return null;
}
