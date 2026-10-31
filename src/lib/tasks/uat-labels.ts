// UAT ticket task labels (TASK-3697). Client-safe and pure, like kind-labels.ts.
// One portal Feedback ticket attempt = one MC task: kind:code plus
// uat:<feedbackId> (Steward lease contract, TASK-2759), and uat-attempt:<n>
// for each re-attempt (TASK-2866 option 2). Steward marks a ticket it gave up
// on with uat:blocked and uat:cause:<cause>; the portal mirrors an open
// question as uat:hold, and a re-test nobody answered as uat:stale
// (TASK-4200). Labels stay DB-only jsonb; no schema change.

export const UAT_LABEL_PREFIX = "uat:";
export const UAT_BLOCKED_LABEL = "uat:blocked";
export const UAT_HOLD_LABEL = "uat:hold";
/**
 * The portal closed the ticket as STALE: nobody answered its re-test within 9
 * Toronto business days (Vince, 2026-10-30, TASK-4200). Only the portal's
 * mc_update_task closeStale adds it, to a merged UAT ticket task.
 */
export const UAT_STALE_LABEL = "uat:stale";
export const UAT_CAUSE_PREFIX = "uat:cause:";
export const NEEDS_VINCE_LABEL = "needs-vince";

const UAT_ATTEMPT_RE = /^uat-attempt:[1-9]\d*$/;
// uat:<feedbackId>: one segment, so uat:cause:<cause> never reads as a ticket.
const UAT_TICKET_RE = /^uat:[^\s:]+$/;
// The backfill script's copy omits uat:stale on purpose (TASK-4265: editing a
// scripts/*backfill* file makes the PR migration-class). The script reads
// uat:stale as a ticket id and skips such a task, which is the safe side.
const UAT_STATE_LABELS: readonly string[] = [UAT_BLOCKED_LABEL, UAT_HOLD_LABEL, UAT_STALE_LABEL];

/** The uat:<feedbackId> label that names the portal ticket, or null. */
export function uatTicketLabel(labels: readonly string[] | undefined): string | null {
  return (labels ?? []).find((label) => UAT_TICKET_RE.test(label) && !UAT_STATE_LABELS.includes(label)) ?? null;
}

/** A UAT ticket task: kind:code plus a uat:<feedbackId> label. */
export function isUatTicketTask(task: { labels?: readonly string[] }): boolean {
  return (task.labels ?? []).includes("kind:code") && uatTicketLabel(task.labels) !== null;
}

/**
 * Closed as STALE (TASK-4200): a merged UAT ticket task carrying uat:stale.
 * Rollups count it closed and unconfirmed, never done and never open. A late
 * PASS moves it to verified and a cancel to cancelled; both keep the label.
 * A move that ends the close drops it (endsStaleClose, in repo.updateEntity).
 */
export function isStaleClosed(task: { stage: string; labels?: readonly string[] }): boolean {
  return task.stage === "merged" && isUatTicketTask(task) && (task.labels ?? []).includes(UAT_STALE_LABEL);
}

/**
 * A stage move that ends a STALE close: into an open stage, or from verified
 * back to merged, where the history label would read as a live close. Moves to
 * verified or cancelled keep the label. repo.updateEntity, the one write path
 * for every stage change (patchTask, reopen, the SharePoint pull, keep-SP),
 * drops uat:stale in the same write.
 */
export function endsStaleClose(from: string | undefined, to: string | undefined): boolean {
  if (to === undefined || to === from) return false;
  if (to === "merged") return from === "verified";
  return to !== "verified" && to !== "cancelled";
}

const UAT_VERIFY_DOOR = "only the portal's mc_update_task verify (task.uat_sync) moves it to verified";

/**
 * Why a write may not move a task to verified, or null (TASK-3963): a UAT
 * ticket task is verified only when its submitter confirms the fix, through
 * the portal's verify (`portalVerify`, TASK-3697). patchTask and
 * repo.updateEntity both hold it, so every door that writes a stage does
 * (TASK-4286). `after` is the task with the write applied.
 */
export function uatVerifyViolation(
  id: string,
  before: { stage?: string; labels?: readonly string[] },
  after: { labels?: readonly string[] },
  nextStage: string | undefined,
  portalVerify: boolean
): string | null {
  if (nextStage !== "verified" || before.stage === "verified" || portalVerify) return null;
  return isUatTicketTask(before) || isUatTicketTask(after) ? `Task ${id} is a UAT ticket task; ${UAT_VERIFY_DOOR}.` : null;
}

/**
 * Why a new task may not start at this stage, or null (TASK-4286): a UAT
 * ticket task starts before merged. Only its PR's merge moves it to merged
 * (the compliance projection), and only the portal's verify to verified.
 * Labels compare as createTask stores them.
 */
export function uatCreateStageViolation(labels: readonly string[], stage: string | undefined): string | null {
  if ((stage !== "merged" && stage !== "verified") || !isUatTicketTask({ labels })) return null;
  return `The new task is a UAT ticket task, so it cannot start at ${stage}: only its PR's merge moves it to merged, and ${UAT_VERIFY_DOOR}.`;
}

const STALE_LABEL_DOOR = `${UAT_STALE_LABEL} is set only by the portal's mc_update_task closeStale (task.uat_sync)`;

/**
 * Why a new task may not carry these labels, or null: no door creates a task
 * with uat:stale. Labels compare as createTask stores them, trimmed and lower case.
 */
export function staleLabelCreateViolation(labels: readonly string[] | undefined): string | null {
  return (labels ?? []).some((label) => label.trim().toLowerCase() === UAT_STALE_LABEL)
    ? `${STALE_LABEL_DOOR}; a task cannot be created with it.`
    : null;
}

/**
 * Why a label write may not change uat:stale, or null. Adding it needs the
 * portal's closeStale (`mayAdd`), and no door adds a near-copy: a stored
 * padded " uat:stale" reads as an add of the label once an MCP label edit
 * trims it, so every later MCP label edit on the task, the portal's uat:hold
 * and uat-attempt mirror included, would be refused. A case variant such as
 * "UAT:Stale" is refused as createTask refuses it (trimmed, lower case). No
 * patch removes it, and while it is on, the task
 * keeps kind:code and its ticket label. A write that ends the close
 * (`endsClose`, see endsStaleClose) is free of both rules, because the label
 * goes with it.
 */
export function staleLabelPatchViolation(
  before: readonly string[] | undefined, after: readonly string[], mayAdd: boolean, endsClose = false
): string | null {
  const prior = before ?? [];
  const had = prior.includes(UAT_STALE_LABEL);
  const has = after.includes(UAT_STALE_LABEL);
  const addsNearCopy = after.some(
    (label) => label !== UAT_STALE_LABEL && label.trim().toLowerCase() === UAT_STALE_LABEL && !prior.includes(label)
  );
  if (addsNearCopy || (!had && has && !mayAdd)) return `${STALE_LABEL_DOOR}; it cannot be added here.`;
  if (!had || endsClose) return null;
  if (!has) return `${STALE_LABEL_DOOR}; no patch removes it, and a move to an open stage drops it.`;
  const keepsTicket =
    prior.includes("kind:code") === after.includes("kind:code") && uatTicketLabel(prior) === uatTicketLabel(after);
  return keepsTicket ? null : `while ${UAT_STALE_LABEL} is on it, the task keeps kind:code and its uat:<feedbackId> label.`;
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
