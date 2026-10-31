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

export type CreatorApprovalAction = "checkout" | "stage";

/**
 * Write one creator_approval.blocked event on its own connection. Call it
 * after any transaction that the refusal rolls back has released its
 * connection, so a refusal never waits on a second pool connection.
 */
export async function recordCreatorApprovalBlocked(
  task: Pick<Task, "id" | "creatorApproval">,
  action: CreatorApprovalAction,
  ctx: CreatorApprovalGuardContext,
  requestedStage?: StageKey
): Promise<void> {
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
}

/**
 * A stage move that a pending creator approval refuses. patchTask throws it
 * inside a transaction; the transaction's owner records it after the rollback
 * with recordingCreatorRefusal.
 */
export class CreatorApprovalRefusal extends ApiError {
  constructor(
    readonly task: Pick<Task, "id" | "creatorApproval">,
    readonly requestedStage: StageKey,
    readonly ctx: CreatorApprovalGuardContext,
    message: string
  ) {
    super("creator_approval_pending", message, 409);
  }

  /** `over` lets the caller that owns the transaction name itself (TASK-4293). */
  record(over?: Partial<CreatorApprovalGuardContext>): Promise<void> {
    return recordCreatorApprovalBlocked(this.task, "stage", { ...this.ctx, ...over }, this.requestedStage);
  }
}

/**
 * Run a transaction and record a creator-gate refusal it threw, once the
 * rollback has released its connection. Every caller that can move a gated
 * task into progress or later inside its own transaction goes through here,
 * so each refusal leaves one event (TASK-4293). cancelTask does not, since a
 * cancel is never gated. Neither does the projection's patchLocked: its builds
 * never set a stage on a pending task. promoteMerged records the merge with no
 * stage (TASK-4307), and linkPr's heldMergeReady skips one. An MCP caller passes
 * its audit actor, repo and door.
 */
export async function recordingCreatorRefusal<T>(
  transaction: () => Promise<T>,
  ctx?: Partial<CreatorApprovalGuardContext>
): Promise<T> {
  try {
    return await transaction();
  } catch (err) {
    if (err instanceof CreatorApprovalRefusal) await err.record(ctx);
    throw err;
  }
}

/** Refuse a checkout (or launch) of a task whose creator approval is pending. */
export async function assertCreatorApprovedForCheckout(
  task: Pick<Task, "id" | "creatorApproval">,
  ctx: CreatorApprovalGuardContext
): Promise<void> {
  if (!creatorApprovalPending(task)) return;
  await recordCreatorApprovalBlocked(task, "checkout", ctx);
  throw new ApiError(
    "creator_approval_pending",
    `${task.id} was created by ${task.creatorApproval!.principal} and waits for creator approval (vince@ or cos@) before it can be checked out or launched.`,
    409
  );
}

/**
 * Refuse a stage move that a pending creator approval blocks. It records
 * nothing: the caller records the refusal with CreatorApprovalRefusal.record()
 * once no transaction holds a connection.
 */
export function assertCreatorApprovedForStage(
  task: Pick<Task, "id" | "creatorApproval">,
  nextStage: StageKey,
  ctx: CreatorApprovalGuardContext
): void {
  const violation = creatorApprovalViolation(task, nextStage);
  if (violation) throw new CreatorApprovalRefusal(task, nextStage, ctx, violation);
}
