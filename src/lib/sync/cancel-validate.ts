// Cancelled end stage (TASK-2529): validation shared by the cancel service and the
// SharePoint inbound path. A leaf module (repo + pure types only) so the sync
// engine can use it without an import cycle through state.ts.
import { ApiError } from "@/lib/api/route";
import type { TxQuery } from "@/lib/db";
import {
  cancelInputViolation,
  cancelReasonFromLabel,
  type CancelInput,
  type Cancellation,
  type CancelReason,
} from "@/lib/mc-data/cancellation";
import * as repo from "./repo";

/** Shape rules plus "replacedBy must be an existing task". Throws ApiError(400). */
export async function buildCancellation(
  taskId: string,
  input: CancelInput,
  cancelledBy: string,
  q?: TxQuery,
  now: Date = new Date()
): Promise<Cancellation> {
  const violation = cancelInputViolation(taskId, input);
  if (violation) throw new ApiError("invalid_request", `Cannot cancel ${taskId}: ${violation}`, 400);
  const replacedBy = typeof input.replacedBy === "string" && input.replacedBy ? input.replacedBy : null;
  if (replacedBy && !(await repo.getEntity("task", replacedBy, q))) {
    throw new ApiError("invalid_request", `Cannot cancel ${taskId}: replacedBy ${replacedBy} is not an existing task.`, 400);
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  return {
    reason: input.reason as CancelReason,
    replacedBy,
    cancelledAt: now.toISOString(),
    cancelledBy,
    ...(note ? { note } : {}),
  };
}

/**
 * Validate an inbound SharePoint edit to Status=Cancelled (CancelReason /
 * ReplacedBy columns). Same rules as mc_update_task cancel; the caller raises a
 * Sync conflict on `ok: false` instead of applying the stage.
 */
export async function inboundCancellation(
  taskId: string,
  fields: Record<string, unknown>,
  cancelledBy: string
): Promise<{ ok: true; cancellation: Cancellation } | { ok: false; error: string }> {
  const reason = cancelReasonFromLabel(fields.CancelReason);
  const replacedBy = typeof fields.ReplacedBy === "string" ? fields.ReplacedBy.trim() : "";
  try {
    return {
      ok: true,
      cancellation: await buildCancellation(taskId, { reason, replacedBy: replacedBy || null }, cancelledBy),
    };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    throw err;
  }
}
