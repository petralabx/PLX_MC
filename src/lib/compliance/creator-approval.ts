// Creator-principal approval gate (TASK-3530). A task created by a gated
// principal (permissions/grants.ts) waits for a creator approver before any
// checkout, launch or move into progress. Every refusal lands in mc_events.
// The approve action lives in approvals.ts. This file imports no sync module,
// so lib/sync/state.ts can call it without an import cycle.

import { ApiError } from "@/lib/api/route";
import type { StageKey, Task } from "@/lib/mc-data/types";
import { creatorApprovalPending, creatorApprovalViolation } from "@/lib/mc-data/policy";
import { appendEvent } from "./repo";

export interface CreatorApprovalGuardContext {
  /** Audit label of the caller (runtime, session label or principal). */
  actor: string;
  actorId?: string | null;
  repo?: string | null;
  door?: string | null;
}

async function refuse(
  task: Pick<Task, "id" | "creatorApproval">,
  action: "checkout" | "stage",
  message: string,
  ctx: CreatorApprovalGuardContext,
  requestedStage?: StageKey
): Promise<never> {
  // The event is written on its own connection, so it survives the rollback
  // that the throw below triggers in a caller's transaction.
  await appendEvent({
    kind: "creator_approval.blocked",
    actor: ctx.actor,
    repo: ctx.repo ?? null,
    taskId: task.id,
    payload: {
      action,
      requestedStage: requestedStage ?? null,
      creatorPrincipal: task.creatorApproval?.principal ?? null,
      actorId: ctx.actorId ?? null,
      door: ctx.door ?? null,
    },
  });
  throw new ApiError("creator_approval_pending", message, 409);
}

/** Refuse a checkout (or launch) of a task whose creator approval is pending. */
export async function assertCreatorApprovedForCheckout(
  task: Pick<Task, "id" | "creatorApproval">,
  ctx: CreatorApprovalGuardContext
): Promise<void> {
  if (!creatorApprovalPending(task)) return;
  await refuse(
    task,
    "checkout",
    `${task.id} was created by ${task.creatorApproval!.principal} and waits for creator approval (vince@ or cos@) before it can be checked out or launched.`,
    ctx
  );
}

/** Refuse a stage move that a pending creator approval blocks. */
export async function assertCreatorApprovedForStage(
  task: Pick<Task, "id" | "creatorApproval">,
  nextStage: StageKey,
  ctx: CreatorApprovalGuardContext
): Promise<void> {
  const violation = creatorApprovalViolation(task, nextStage);
  if (violation) await refuse(task, "stage", violation, ctx, nextStage);
}
