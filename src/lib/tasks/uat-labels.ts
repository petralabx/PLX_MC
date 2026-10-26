// UAT ticket task labels (TASK-3697). Client-safe and pure, like kind-labels.ts.
// One portal Feedback ticket attempt = one MC task: kind:code plus
// uat:<feedbackId> (Steward lease contract, TASK-2759), and uat-attempt:<n>
// for each re-attempt (TASK-2866 option 2). Steward marks a ticket it gave up
// on with uat:blocked and uat:cause:<cause>; the portal mirrors an open
// question as uat:hold. Labels stay DB-only jsonb; no schema change.

export const UAT_LABEL_PREFIX = "uat:";
export const UAT_BLOCKED_LABEL = "uat:blocked";
export const UAT_HOLD_LABEL = "uat:hold";
export const UAT_CAUSE_PREFIX = "uat:cause:";
export const NEEDS_VINCE_LABEL = "needs-vince";

const UAT_ATTEMPT_RE = /^uat-attempt:[1-9]\d*$/;
// uat:<feedbackId>: one segment, so uat:cause:<cause> never reads as a ticket.
const UAT_TICKET_RE = /^uat:[^\s:]+$/;
const UAT_STATE_LABELS: readonly string[] = [UAT_BLOCKED_LABEL, UAT_HOLD_LABEL];

/** The uat:<feedbackId> label that names the portal ticket, or null. */
export function uatTicketLabel(labels: readonly string[] | undefined): string | null {
  return (labels ?? []).find((label) => UAT_TICKET_RE.test(label) && !UAT_STATE_LABELS.includes(label)) ?? null;
}

/** A UAT ticket task: kind:code plus a uat:<feedbackId> label. */
export function isUatTicketTask(task: { labels?: readonly string[] }): boolean {
  return (task.labels ?? []).includes("kind:code") && uatTicketLabel(task.labels) !== null;
}

/** Labels the portal mirrors from its ticket onto a UAT ticket task: uat:hold and uat-attempt:<n>. */
export function isUatSyncLabel(label: string): boolean {
  return label === UAT_HOLD_LABEL || UAT_ATTEMPT_RE.test(label);
}

/** Labels Steward writes when it gives up on a ticket: uat:blocked and uat:cause:<cause>. */
export function isUatBlockLabel(label: string): boolean {
  return label === UAT_BLOCKED_LABEL || (label.startsWith(UAT_CAUSE_PREFIX) && label.length > UAT_CAUSE_PREFIX.length);
}

/** The causes Steward gave for a block (uat:cause:<cause>), in label order. */
export function uatBlockCauses(labels: readonly string[] | undefined): string[] {
  return (labels ?? [])
    .filter((label) => label.startsWith(UAT_CAUSE_PREFIX) && label.length > UAT_CAUSE_PREFIX.length)
    .map((label) => label.slice(UAT_CAUSE_PREFIX.length));
}

/** Steward gave up on the ticket after its retries (uat:blocked). */
export function isStewardBlocked(task: { labels?: readonly string[] }): boolean {
  return (task.labels ?? []).includes(UAT_BLOCKED_LABEL);
}

/** The task waits on Vince (needs-vince). */
export function needsVince(task: { labels?: readonly string[] }): boolean {
  return (task.labels ?? []).includes(NEEDS_VINCE_LABEL);
}

/** Steward blocked the ticket, or the task waits on Vince. */
export function hasHumanBlockLabel(task: { labels?: readonly string[] }): boolean {
  return isStewardBlocked(task) || needsVince(task);
}
