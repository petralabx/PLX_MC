// Cancelled end stage (TASK-2529): the stage-transition service. Cancel and
// reopen each run in ONE transaction: row lock, validation, the stage change plus
// the entities.cancellation write (patchTask -> updateEntity), and the audited
// task.cancelled / task.reopened event. Callers (MCP tools, REST routes) own
// authorization; this owns the data rules.
import { ApiError } from "@/lib/api/route";
import { appendEventTx } from "@/lib/compliance/repo";
import { withTransaction, type TxQuery } from "@/lib/db";
import {
  type CancelInput,
} from "@/lib/mc-data/cancellation";
import { isClosedStage } from "@/lib/mc-data/policy";
import type { StageKey, Task } from "@/lib/mc-data/types";
import { buildCancellation } from "./cancel-validate";
import * as repo from "./repo";
import { patchTask, type MutationAttribution } from "./state";

export interface CancelContext {
  /** Audit label for the activity/audit trail (operator email). */
  actor: string;
  /** cancelledBy: the authorized actor id. */
  actorId: string;
  /** mc_events actor, e.g. `runtime:operator`. */
  eventActor: string;
  eventRepo?: string;
  attribution?: MutationAttribution;
  /** Extra event payload (service principal, worker id). */
  eventExtra?: Record<string, unknown>;
}

async function lockedTask(q: TxQuery, taskId: string): Promise<Task> {
  const row = await repo.getEntity("task", taskId, q, true);
  if (!row) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  return row.data as unknown as Task;
}

export async function cancelTaskTx(q: TxQuery, taskId: string, input: CancelInput, ctx: CancelContext) {
  const before = await lockedTask(q, taskId);
  if (before.stage === "cancelled") {
    throw new ApiError("already_cancelled", `${taskId} is already cancelled; reopen it first to cancel again.`, 409);
  }
  const cancellation = await buildCancellation(taskId, input, ctx.actorId, q);
  const task = await patchTask(
    taskId,
    {
      stage: "cancelled",
      activityLine: { who: ctx.actor, what: `cancelled (${cancellation.reason}${cancellation.replacedBy ? ` → ${cancellation.replacedBy}` : ""})`, kind: "move" },
    },
    ctx.actor,
    { query: q, attribution: ctx.attribution, cancellation }
  );
  if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  const eventSeq = await appendEventTx(q, {
    kind: "task.cancelled",
    actor: ctx.eventActor,
    repo: ctx.eventRepo,
    taskId,
    payload: {
      ...ctx.eventExtra,
      reason: cancellation.reason,
      replacedBy: cancellation.replacedBy,
      previousStage: before.stage,
      cancelledBy: ctx.actorId,
      note: cancellation.note ?? null,
    },
  });
  return { task, cancellation, previousStage: before.stage, eventSeq };
}

export function cancelTask(taskId: string, input: CancelInput, ctx: CancelContext) {
  return withTransaction((q) => cancelTaskTx(q, taskId, input, ctx));
}

export interface ReopenInput {
  /** Target non-terminal stage; default is the stage before the cancel. */
  stage?: StageKey;
  note?: string;
}

async function stageBeforeCancel(q: TxQuery, taskId: string): Promise<StageKey | null> {
  const rows = await q<{ prev: string | null }>(
    `SELECT payload->>'previousStage' AS prev FROM mc_events
      WHERE kind = 'task.cancelled' AND task_id = $1 ORDER BY seq DESC LIMIT 1`,
    [taskId]
  );
  return (rows[0]?.prev as StageKey | undefined) ?? null;
}

export async function reopenTaskTx(q: TxQuery, taskId: string, input: ReopenInput, ctx: CancelContext) {
  const before = await lockedTask(q, taskId);
  if (before.stage !== "cancelled") {
    throw new ApiError("not_cancelled", `${taskId} is ${before.stage}, not cancelled; nothing to reopen.`, 409);
  }
  const previous = await stageBeforeCancel(q, taskId);
  const stage = input.stage ?? (previous && !isClosedStage(previous) ? previous : "backlog");
  if (isClosedStage(stage)) {
    throw new ApiError("invalid_request", `Cannot reopen ${taskId} into terminal stage ${stage}; pick a non-terminal stage.`, 400);
  }
  // patchTask -> updateEntity clears entities.cancellation on leaving cancelled;
  // completed_at is write-once and is not touched (TASK-2528).
  const task = await patchTask(
    taskId,
    { stage, activityLine: { who: ctx.actor, what: `reopened to ${stage}`, kind: "move" } },
    ctx.actor,
    { query: q, attribution: ctx.attribution, reopen: true }
  );
  if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  const note = input.note?.trim() || null;
  const eventSeq = await appendEventTx(q, {
    kind: "task.reopened",
    actor: ctx.eventActor,
    repo: ctx.eventRepo,
    taskId,
    payload: {
      ...ctx.eventExtra,
      previousStage: "cancelled",
      stage,
      reopenedBy: ctx.actorId,
      priorCancellation: before.cancellation ?? null,
      note,
    },
  });
  return { task, stage, eventSeq };
}

export function reopenTask(taskId: string, input: ReopenInput, ctx: CancelContext) {
  return withTransaction((q) => reopenTaskTx(q, taskId, input, ctx));
}
