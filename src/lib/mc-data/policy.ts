// Assignment & accountability policy (EN-003 / WS-1). Pure predicates over a
// Task, reused by the client store (lib/mc-data/store.ts) and the server
// mutation (lib/sync/state.ts) so client and server enforce the SAME rules:
//   1. human-only tasks reject an agent executor;
//   2. a task cannot advance past `planned` without a human accountable owner;
//   3. a task cannot reach a done stage (merged/verified) with an incomplete
//      evidence bundle (the completion contract — reuses evidenceComplete).

import { AGENTS, CURRENT_USER, HUMANS, STAGE_IDX } from "./data";
import { evidenceComplete } from "./helpers";
import type { StageKey, Task } from "./types";

// The last stage a task may occupy without a human accountable owner.
export const ACCOUNTABLE_GATE_STAGE: StageKey = "planned";

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
// unresolvable fall back to the hub's default accountable human (CURRENT_USER).
// Shared by MCP task creation and the checkout backfill so a task created and
// checked out by the same session lands on the same owner.
export function resolveHumanAccountableOwner(operator: string): string {
  const normalized = operator.trim().toLowerCase();
  const byEmail = Object.values(HUMANS).find(
    (h) => (h.email ?? "").toLowerCase() === normalized
  );
  return byEmail?.id ?? HUMANS[normalized]?.id ?? CURRENT_USER;
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

// Why this task cannot move to `nextStage`, or null when the move is allowed.
export function stageAdvanceViolation(
  task: Pick<Task, "id" | "accountableOwner" | "evidence" | "assignee" | "agentRunApproved">,
  nextStage: StageKey
): string | null {
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
  return null;
}
