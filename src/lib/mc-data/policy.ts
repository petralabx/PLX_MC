// Assignment & accountability policy (EN-003 / WS-1). Pure predicates over a
// Task, reused by the client store (lib/mc-data/store.ts) and the server
// mutation (lib/sync/state.ts) so client and server enforce the SAME rules:
//   1. human-only tasks reject an agent executor;
//   2. a task cannot advance past `planned` without a human accountable owner;
//   3. a task cannot reach a done stage (merged/verified) with an incomplete
//      evidence bundle (the completion contract — reuses evidenceComplete).

import { AGENTS, STAGE_IDX } from "./data";
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
  const executor = task.assignee ? AGENTS[task.assignee] : undefined;
  if (executor && executor.mode === "approve" && !task.agentRunApproved && nextIdx >= STAGE_IDX.progress) {
    return `${task.id} is run by ${executor.name} (needs-approval mode) — an operator must approve the run before it advances to In Progress.`;
  }
  if (DONE_STAGES.includes(nextStage) && task.evidence && !evidenceComplete(task.evidence)) {
    return `${task.id} can't be marked ${nextStage} until its evidence bundle is complete.`;
  }
  return null;
}
