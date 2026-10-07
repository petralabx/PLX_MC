// Cancelled end stage (TASK-2529): pure shape + validation for entities.cancellation.
// The column is task-only (CHECK from migration 033) and, like completed_at, is the
// source of truth: read paths merge it into the task, writes never persist it in jsonb.

export const CANCEL_REASONS = ["duplicate", "obsolete", "superseded", "delivered_without_pr"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

// duplicate and superseded name the task that took over the work.
const REPLACEMENT_REQUIRED: readonly CancelReason[] = ["duplicate", "superseded"];

export interface Cancellation {
  reason: CancelReason;
  replacedBy: string | null;
  cancelledAt: string; // ISO-8601 timestamptz
  cancelledBy: string; // actor id
  note?: string;
}

export interface CancelInput {
  reason?: unknown;
  replacedBy?: unknown;
  note?: unknown;
}

const TASK_ID = /^TASK-[0-9]+$/;

/** Shape/enum rules only; whether replacedBy exists is the server's job. Returns an error message or null. */
export function cancelInputViolation(
  taskId: string,
  input: CancelInput
): string | null {
  const reason = input.reason;
  if (typeof reason !== "string" || !reason) {
    return `reason is required (one of ${CANCEL_REASONS.join(", ")}).`;
  }
  if (!(CANCEL_REASONS as readonly string[]).includes(reason)) {
    return `unknown reason "${reason}" (expected one of ${CANCEL_REASONS.join(", ")}).`;
  }
  const replacedBy = input.replacedBy;
  const hasReplacement = replacedBy !== undefined && replacedBy !== null && replacedBy !== "";
  if (REPLACEMENT_REQUIRED.includes(reason as CancelReason) && !hasReplacement) {
    return `replacedBy is required when reason is ${reason}.`;
  }
  if (hasReplacement) {
    if (typeof replacedBy !== "string" || !TASK_ID.test(replacedBy)) {
      return `replacedBy must be a TASK-n id; got ${JSON.stringify(replacedBy)}.`;
    }
    if (replacedBy === taskId) return "replacedBy must not be the task itself.";
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return "note must be a string.";
  }
  return null;
}

// ToDos "Cancel Reason" choice labels (config/sharepoint-schema.json).
export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  duplicate: "Duplicate",
  obsolete: "Obsolete",
  superseded: "Superseded",
  delivered_without_pr: "Delivered without PR",
};

export function cancelReasonFromLabel(label: unknown): CancelReason | undefined {
  return CANCEL_REASONS.find((r) => CANCEL_REASON_LABEL[r] === label);
}
