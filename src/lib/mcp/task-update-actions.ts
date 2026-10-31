// Hub task metadata edits. Labels remain DB-only; patchTask owns sync enqueue.
// The row lock, normal patch path and mc_events diff share one transaction.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { withTransaction, type TxQuery } from "@/lib/db";
import { evidenceStandardReport, requiresHumanVerification, type EvidenceStandardReport } from "@/lib/compliance";
import { recordingCreatorRefusal } from "@/lib/compliance/creator-approval";
import { appendEventTx } from "@/lib/compliance/repo";
import type { Task } from "@/lib/mc-data/types";
import { HUMANS, assignmentViolation } from "@/lib/mc-data";
import { authorize, type Capability } from "@/lib/permissions";
import { assertAgentAssigneeAllowed } from "@/lib/permissions/agent-assignee-guard";
import { assertProjectIdAccess, assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { patchTask } from "@/lib/sync";
import { bucketMoveTargetViolation } from "@/lib/sync/bucket-move";
import { cancelTaskTx, reopenTaskTx, type CancelContext } from "@/lib/sync/cancel";
import { TASK_KIND_DEFAULT, assertValidKinds, isKindLabel, kindsOf } from "@/lib/tasks/kind";
import { isUatBlockLabel, isUatSyncLabel, isUatTicketTask } from "@/lib/tasks/uat-labels";
import { BUCKET_ID_RE } from "@/lib/sync/mapping";
import { getBuckets, getEntity, getProjects } from "@/lib/sync/repo";
import { mcpAuditActor, type McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";
import { assertEvidenceStandard } from "./evidence-standard-guard";
import { assertMayCloseOrReopen, cancelContextFor, cancelPatchSchema, reopenPatchSchema, verifyPatchSchema } from "./task-cancel-actions";
import { assertMcpToolAllowed } from "./tool-allowlist";

export const UPDATE_TASK_BATCH_MAX = 100;
export const TASK_LABEL_MAX = 128;
export const TASK_LABEL_COUNT_MAX = 100;
export const TASK_DESCRIPTION_MAX = 32_000;

// Labels a lane-less task may gain or lose without receiving a lane (legacy
// closure; stopgap until the cancelled stage ships). Kind labels, and on a UAT
// ticket task the labels the portal mirrors (TASK-3697), are lane-free too.
export const CLOSURE_LABELS: readonly string[] = [
  "closed:duplicate", "closed:obsolete", "closed:superseded", "closed:delivered", "closed:wontfix", "not-needed",
];
// Tasks in these stages never need a lane.
export const TERMINAL_TASK_STAGES: readonly string[] = ["merged", "verified"];

const labelsSchema = z.array(z.string().trim().min(1).max(TASK_LABEL_MAX))
  .max(TASK_LABEL_COUNT_MAX)
  .transform((labels) => [...new Set(labels)]);

export const taskUpdatePatchSchema = z.object({
  labels: labelsSchema.optional(),
  addLabels: labelsSchema.optional(),
  removeLabels: labelsSchema.optional(),
  description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
  appendDescription: z.string().trim().min(1).max(TASK_DESCRIPTION_MAX).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  cancel: cancelPatchSchema.optional(),
  reopen: reopenPatchSchema.optional(),
  verify: verifyPatchSchema.optional(),
  bucket: z.string().trim().regex(BUCKET_ID_RE, "bucket must be a BKT-* id").optional(),
  note: z.string().trim().min(1).max(500).optional(),
  // TASK-3407: who executes the task (person id or agent:<slug>; null clears)
  // and the human accountable for it. Both need task.assign and a reason.
  assignee: z.string().trim().min(1).max(128).nullable().optional(),
  accountableOwner: z.string().trim().min(1).max(128).optional(),
  reason: z.string().trim().min(10).max(2000).optional(),
}).strict().superRefine((patch, ctx) => {
  if (Object.values(patch).every((value) => value === undefined)) {
    ctx.addIssue({ code: "custom", message: "At least one patch field is required." });
  }
  if ((patch.cancel !== undefined || patch.reopen !== undefined)
    && Object.entries(patch).some(([key, value]) => value !== undefined && key !== "cancel" && key !== "reopen")) {
    ctx.addIssue({ code: "custom", message: "cancel and reopen are stage changes and cannot be combined with other patch fields." });
  }
  if (patch.cancel !== undefined && patch.reopen !== undefined) {
    ctx.addIssue({ code: "custom", message: "cancel cannot be combined with reopen." });
  }
  if (patch.verify !== undefined && Object.entries(patch).some(([key, value]) => value !== undefined && key !== "verify")) {
    ctx.addIssue({ code: "custom", message: "verify is a stage change and cannot be combined with other patch fields." });
  }
  if (patch.labels !== undefined && (patch.addLabels !== undefined || patch.removeLabels !== undefined)) {
    ctx.addIssue({ code: "custom", message: "labels cannot be combined with addLabels or removeLabels." });
  }
  if (patch.description !== undefined && patch.appendDescription !== undefined) {
    ctx.addIssue({ code: "custom", message: "description cannot be combined with appendDescription." });
  }
  if (patch.note !== undefined && patch.bucket === undefined) {
    ctx.addIssue({ code: "custom", message: "note is only valid with bucket." });
  }
  const assigning = patch.assignee !== undefined || patch.accountableOwner !== undefined;
  if (assigning && patch.reason === undefined) {
    ctx.addIssue({ code: "custom", message: "reason (10+ characters) is required to change assignee or accountableOwner." });
  }
  if (patch.reason !== undefined && !assigning) {
    ctx.addIssue({ code: "custom", message: "reason is only valid with assignee or accountableOwner." });
  }
});

/** The directory id of a person named by id or email, or null (TASK-3407). */
function humanDirectoryId(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (HUMANS[v]) return HUMANS[v].id;
  return Object.values(HUMANS).find((h) => (h.email ?? "").toLowerCase() === v)?.id ?? null;
}

export const updateTaskSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  patch: taskUpdatePatchSchema,
}).strict();

// Validate each item inside the action: malformed items must not abort siblings.
export const updateTasksSchema = z.object({
  items: z.array(z.unknown().describe(
    "One {taskId, patch} object using mc_update_task fields. Invalid items return their own error."
  )).min(1).max(UPDATE_TASK_BATCH_MAX),
}).strict();

type EditableFields = Pick<Task, "labels" | "description" | "title" | "priority" | "bucket" | "assignee" | "accountableOwner">;
type TaskDiff = Partial<Record<keyof EditableFields | "stage", { before: unknown; after: unknown }>>;

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("invalid_request", parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), 400);
  }
  return parsed.data;
}

// The result of a stage change (cancel, reopen, verify) or of a no-op replay.
function stageChangeResult(taskId: string, task: Task, diff: TaskDiff, eventSeq: string | undefined) {
  return {
    taskId,
    fields: { labels: task.labels, description: task.description ?? "", title: task.title, priority: task.priority },
    diff,
    eventSeq,
    link: taskLink(taskId),
  };
}

// The portal's mirror of a submitter's Verify (TASK-3697): a UAT ticket task
// moves from merged to verified, with an audited task.verified event. Verified
// again changes nothing, so a retried mirror succeeds. Runs on the caller's
// locked row; patchTask still applies the owner, evidence and approval-gate
// checks, and refuses with 409 stage_blocked, which a retry cannot fix.
async function verifyUatTicketTx(
  q: TxQuery, taskId: string, before: Task, note: string | undefined, ctx: CancelContext
) {
  if (!isUatTicketTask(before)) {
    throw new ApiError("invalid_request", `Only a UAT ticket task (kind:code plus uat:<feedbackId>) can be verified here; ${taskId} is not one.`, 400);
  }
  if (before.stage === "verified") return stageChangeResult(taskId, before, {}, undefined);
  if (before.stage !== "merged") {
    throw new ApiError("not_merged", `${taskId} is ${before.stage}; a UAT ticket task is verified only after its fix merged.`, 409);
  }
  const task = await patchTask(
    taskId,
    { stage: "verified", activityLine: { who: ctx.actor, what: "verified (the submitter confirmed the fix)", kind: "move" } },
    ctx.actor,
    { query: q, attribution: ctx.attribution, uatVerify: true }
  );
  if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  const eventSeq = await appendEventTx(q, {
    kind: "task.verified",
    actor: ctx.eventActor,
    repo: ctx.eventRepo,
    taskId,
    payload: { ...ctx.eventExtra, previousStage: before.stage, verifiedBy: ctx.actorId, note: note?.trim() || null },
  });
  return stageChangeResult(taskId, task, { stage: { before: before.stage, after: task.stage } }, eventSeq);
}

// TASK-3697: task.uat_sync covers a portal ticket's mirror onto its UAT ticket
// task: verify, cancel, or a label-only patch. Such a patch from a holder (the
// portal) is held to the mirror rules; a holder without task.progress may send
// nothing else, on no other task.
const UAT_SYNC_FIELDS: readonly string[] = ["verify", "cancel", "labels", "addLabels", "removeLabels"];

function holds(identity: McpIdentity, capability: Capability): boolean {
  return authorize({ actor: identity.actor, capability }).allowed;
}

function uatSyncForbidden(message: string): ApiError {
  return new ApiError("forbidden", `task.uat_sync: ${message}`, 403);
}

export async function actionUpdateTask(identity: McpIdentity, input: unknown) {
  assertMcpToolAllowed(identity, "mc_update_task");
  const { taskId, patch } = parseInput(updateTaskSchema, input);
  // TASK-4313: the portal now also holds task.progress, so a patch made only of
  // UAT_SYNC_FIELDS still takes the UAT ticket mirror path (and its rules).
  const sentFields = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key);
  const uatSyncOnly = holds(identity, "task.uat_sync")
    && (!holds(identity, "task.progress") || sentFields.every((key) => UAT_SYNC_FIELDS.includes(key)));
  const authorized = requireMcpActor(identity, uatSyncOnly ? "task.uat_sync" : "task.progress", { type: "task", id: taskId });
  if (uatSyncOnly) {
    if (!sentFields.every((key) => UAT_SYNC_FIELDS.includes(key))) {
      throw uatSyncForbidden(`only verify, cancel and label edits are allowed; got ${sentFields.join(", ")}.`);
    }
  }
  if (patch.assignee !== undefined || patch.accountableOwner !== undefined) {
    requireMcpActor(identity, "task.assign", { type: "task", id: taskId });
    if (patch.assignee) assertAgentAssigneeAllowed(identity.actor, patch.assignee, { capability: "task.assign" });
  }
  // task.uat_sync already authorized the portal's cancel and verify.
  if ((patch.cancel || patch.reopen || patch.verify) && !uatSyncOnly) {
    // Authorize before the transaction: a denial is audited on its own connection
    // and must survive the rollback an exception would trigger inside it.
    const current = await getEntity("task", taskId);
    if (!current) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity));
    await assertMayCloseOrReopen(identity, current.data as unknown as Task, patch.cancel ? "cancel" : patch.reopen ? "reopen" : "verify");
  }
  // A reopen the creator gate refuses is recorded after the rollback (TASK-4293).
  return recordingCreatorRefusal(() => withTransaction(async (q) => {
    const row = await getEntity("task", taskId, q, true);
    if (!row) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity), q);
    const before = row.data as unknown as Task;
    const uatTicket = isUatTicketTask(before);
    if (uatSyncOnly && !uatTicket) {
      throw uatSyncForbidden(`${taskId} is not a UAT ticket task (kind:code plus uat:<feedbackId>).`);
    }

    if (patch.verify) {
      return verifyUatTicketTx(q, taskId, before, patch.verify.note, cancelContextFor(identity, authorized.actorId));
    }

    // Stage changes with their own audited event; the lane/label rules below are
    // for metadata edits and must not block closing an old, unlabeled task.
    if (patch.cancel || patch.reopen) {
      // The portal's cancel mirror is idempotent like its other mirrors (TASK-3697).
      if (uatSyncOnly && before.stage === "cancelled") return stageChangeResult(taskId, before, {}, undefined);
      const ctx = cancelContextFor(identity, authorized.actorId);
      const done = patch.cancel
        ? await cancelTaskTx(q, taskId, patch.cancel, ctx)
        : await reopenTaskTx(q, taskId, patch.reopen!, ctx);
      return stageChangeResult(taskId, done.task, { stage: { before: before.stage, after: done.task.stage } }, done.eventSeq);
    }

    // Removals happen first so a lane can be replaced in one incremental call.
    const requestedLabels = parseInput(labelsSchema, patch.labels ?? [...new Set([
      ...(before.labels ?? []).filter((label) => !(patch.removeLabels ?? []).includes(label.trim())),
      ...(patch.addLabels ?? []),
    ].map((label) => label.trim()))]);
    // Exactly one valid kind:* stays on the task. If the patch removes the only
    // kind the task had, kind:needs-review takes its place. A legacy kind-less
    // task is not given one by unrelated label edits; the kind backfill owns that.
    const requestedKinds = kindsOf(requestedLabels);
    assertValidKinds(requestedKinds);
    const labels = requestedKinds.length === 0 && kindsOf(before.labels ?? []).length > 0
      ? [...requestedLabels, TASK_KIND_DEFAULT] : requestedLabels;
    const lanes = labels.filter((label) => label.startsWith("lane:"));
    const delta = [...labels.filter((label) => !(before.labels ?? []).includes(label)),
      ...(before.labels ?? []).filter((label) => !labels.includes(label))];
    const sent = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key);
    const syncLabel = (label: string) =>
      CLOSURE_LABELS.includes(label) || isKindLabel(label) || (uatTicket && isUatSyncLabel(label));
    // Steward blocks a ticket task before any lane is leased (TASK-3967); the portal may not.
    const laneFree = (label: string) => syncLabel(label) || (uatTicket && isUatBlockLabel(label));
    const labelOnly = sent.every((key) => key === "labels" || key === "addLabels" || key === "removeLabels");
    // A UAT ticket task's no-op replay passes too, so a retried mirror succeeds.
    const closureOnly = (delta.length > 0 || uatTicket) && delta.every(laneFree) && labelOnly;
    if (uatSyncOnly && !(closureOnly && delta.every(syncLabel))) {
      throw uatSyncForbidden("it may only add or remove uat:hold, uat-attempt:<n>, kind:* or closure labels.");
    }
    // The portal's edit must leave a UAT ticket task, or its next mirror is refused.
    if (uatSyncOnly && !isUatTicketTask({ labels })) {
      throw uatSyncForbidden(`${taskId} must keep kind:code and its uat:<feedbackId> label.`);
    }
    const bucketOnly = sent.every((key) => key === "bucket" || key === "note");
    const assignOnly = sent.every((key) => key === "assignee" || key === "accountableOwner" || key === "reason");
    const laneOptional = TERMINAL_TASK_STAGES.includes(before.stage) || closureOnly || bucketOnly || assignOnly;
    if (lanes.length > 1 || (lanes.length === 1 && !lanes[0].slice("lane:".length).trim())
      || (lanes.length === 0 && !laneOptional)) {
      throw new ApiError("invalid_request", "The resulting labels must contain exactly one non-empty lane:* label. Add a lane for an unlabeled task; remove the old lane when replacing it. Lane-less tasks may only gain or lose kind:* or closure labels in a label-only patch (" + CLOSURE_LABELS.join(", ") + "; on a UAT ticket task also uat:hold, uat-attempt:<n>, uat:blocked and uat:cause:<x>), be moved by bucket alone, or be in a terminal stage.", 400);
    }

    if (patch.bucket !== undefined && patch.bucket !== before.bucket) {
      const [buckets, projects] = [await getBuckets(q), await getProjects(q)];
      const target = buckets.find((bucket) => bucket.id === patch.bucket);
      const project = projects.find((candidate) => candidate.id === target?.project);
      const violation = bucketMoveTargetViolation(target, project);
      if (violation) throw new ApiError("invalid_request", `Cannot move ${taskId} to ${patch.bucket}: ${violation}.`, 400);
      // Source access was asserted above; moving into a restricted project needs the same.
      await assertProjectIdAccess(target!.project, aclPrincipalFromMcp(identity), q);
    }

    const requested: Partial<EditableFields> = { labels };
    if (patch.title !== undefined) requested.title = patch.title;
    if (patch.priority !== undefined) requested.priority = patch.priority;
    if (patch.bucket !== undefined) requested.bucket = patch.bucket;
    if (patch.assignee !== undefined) {
      const violation = assignmentViolation(before, patch.assignee);
      if (violation) throw new ApiError("invalid_request", violation, 400);
      requested.assignee = patch.assignee;
    }
    if (patch.accountableOwner !== undefined) {
      const owner = humanDirectoryId(patch.accountableOwner);
      if (!owner) {
        throw new ApiError("invalid_request", `accountableOwner must be a person in the directory (got ${patch.accountableOwner}).`, 400);
      }
      requested.accountableOwner = owner;
    }
    if (patch.description !== undefined) requested.description = patch.description;
    if (patch.appendDescription !== undefined) {
      requested.description = parseInput(z.string().max(TASK_DESCRIPTION_MAX),
        [before.description ?? "", patch.appendDescription].filter(Boolean).join("\n\n"));
    }
    // Evidence standard (TASK-3165): only the text this call writes is checked,
    // against the labels the task will have. A throw rolls the transaction back.
    const written = patch.description ?? patch.appendDescription;
    const evidenceStandard = written !== undefined && requiresHumanVerification(labels)
      ? evidenceStandardReport(written, true) : undefined;
    if (evidenceStandard) assertEvidenceStandard("The task description", evidenceStandard);
    const changed: Partial<EditableFields> = {};
    const diff: TaskDiff = {};
    for (const field of Object.keys(requested) as (keyof EditableFields)[]) {
      const previous = before[field] ?? (field === "description" ? "" : field === "assignee" || field === "accountableOwner" ? null : []);
      const next = requested[field];
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      Object.assign(changed, { [field]: next });
      diff[field] = { before: previous, after: next };
    }
    const task = await patchTask(taskId, changed, identity.operatorEmail, {
      query: q,
      attribution: { source: "service", actorId: authorized.actorId },
    });
    if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    const eventSeq = await appendEventTx(q, {
      kind: "task.updated",
      actor: mcpAuditActor(identity),
      repo: identity.repo,
      taskId,
      payload: {
        servicePrincipalId: identity.servicePrincipalId,
        workerId: identity.workerId,
        diff,
      },
    });
    if (diff.assignee || diff.accountableOwner) {
      await appendEventTx(q, {
        kind: "task.assignment.changed",
        actor: mcpAuditActor(identity),
        repo: identity.repo,
        taskId,
        payload: {
          ...(diff.assignee ? { assignee: diff.assignee } : {}),
          ...(diff.accountableOwner ? { accountableOwner: diff.accountableOwner } : {}),
          reason: patch.reason ?? null,
          servicePrincipalId: identity.servicePrincipalId,
          workerId: identity.workerId,
        },
      });
    }
    if (diff.bucket) {
      await appendEventTx(q, {
        kind: "task.moved",
        actor: mcpAuditActor(identity),
        repo: identity.repo,
        taskId,
        payload: {
          from: diff.bucket.before, to: diff.bucket.after, note: patch.note ?? null,
          actor: mcpAuditActor(identity),
          servicePrincipalId: identity.servicePrincipalId, workerId: identity.workerId,
        },
      });
    }
    return {
      taskId,
      fields: { labels: task.labels, description: task.description ?? "", title: task.title, priority: task.priority, bucket: task.bucket },
      diff,
      eventSeq,
      link: taskLink(taskId),
      ...(evidenceStandard ? { evidenceStandard } : {}),
    };
  }), { actor: mcpAuditActor(identity), repo: identity.repo, door: "mcp" });
}

// Batch items return receipts, not the full fields/diff: 100 items carrying
// 32 KB descriptions plus before/after would pass Vercel's 4.5 MB response cap
// after the writes have committed. The full diff stays in the task.updated event.
export type UpdateTaskItemOutcome =
  | {
      index: number; ok: true; taskId: string; changed: string[]; eventSeq: string | undefined;
      /** Present when the item wrote description text on work a person must verify (TASK-3165). */
      evidenceStandard?: BatchEvidenceStandard;
    }
  | { index: number; ok: false; error: { code: string; message: string } };

const BATCH_ERROR_MESSAGE_MAX = 500;

// Evidence findings are capped the same way (TASK-3165). One 32 KB description
// of short passive bullets gives about 2,000 findings, so a full 100-item batch
// returned about 19 MB after every write had committed. The caps bound the
// findings to about 100 KB per batch, whatever the text. All findings for one
// item: send its text again with mc_update_task, which returns the full report.
/** Findings returned per item: enough to show what to fix first. */
export const BATCH_FINDINGS_PER_ITEM_MAX = 10;
/** Findings returned in the whole batch (25 items at the per-item cap). */
export const BATCH_FINDINGS_TOTAL_MAX = 250;
/** Characters per returned finding message; an excerpt can hold one very long word. */
export const BATCH_FINDING_MESSAGE_MAX = 300;

export type BatchEvidenceStandard = EvidenceStandardReport & {
  /** Findings the check produced; `findings` holds the first ones only. */
  findingsTotal: number;
  /** True when `findings` leaves some out. */
  findingsTruncated: boolean;
};

function batchEvidenceStandard(report: EvidenceStandardReport, budget: number): BatchEvidenceStandard {
  const findings = report.findings.slice(0, Math.min(BATCH_FINDINGS_PER_ITEM_MAX, budget)).map((finding) =>
    finding.message.length > BATCH_FINDING_MESSAGE_MAX
      ? { ...finding, message: `${finding.message.slice(0, BATCH_FINDING_MESSAGE_MAX - 1)}…` } : finding);
  return { ...report, findings, findingsTotal: report.findings.length, findingsTruncated: findings.length < report.findings.length };
}

export async function actionUpdateTasks(identity: McpIdentity, input: unknown) {
  assertMcpToolAllowed(identity, "mc_update_tasks");
  requireMcpActor(identity, "task.progress");
  const { items } = parseInput(updateTasksSchema, input);
  const results: UpdateTaskItemOutcome[] = [];
  const findings = { total: 0, returned: 0 };
  let checked = false;
  for (const [index, item] of items.entries()) {
    try {
      const data = await actionUpdateTask(identity, item);
      const report = "evidenceStandard" in data && data.evidenceStandard
        ? batchEvidenceStandard(data.evidenceStandard, BATCH_FINDINGS_TOTAL_MAX - findings.returned) : undefined;
      if (report) {
        checked = true;
        findings.total += report.findingsTotal;
        findings.returned += report.findings.length;
      }
      results.push({
        index, ok: true, taskId: data.taskId, changed: Object.keys(data.diff), eventSeq: data.eventSeq,
        ...(report ? { evidenceStandard: report } : {}),
      });
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("[mcp] mc_update_tasks item %d failed:", index, err);
      results.push({
        index,
        ok: false,
        error: err instanceof ApiError
          ? { code: err.code, message: err.message.slice(0, BATCH_ERROR_MESSAGE_MAX) }
          : { code: "internal", message: "Internal error." },
      });
    }
  }
  const updated = results.filter((result) => result.ok).length;
  return {
    results, updated, failed: results.length - updated,
    ...(checked ? { evidenceFindings: { ...findings, truncated: findings.returned < findings.total } } : {}),
  };
}

export function registerTaskUpdateTools(server: McpServer, identity: McpIdentity): void {
  // Full strict schemas preserve unknown-field rejection at the MCP boundary.
  server.registerTool("mc_update_task", {
    description: "Edit task metadata with {taskId, patch}: labels (replace), addLabels/removeLabels (incremental), description (replace), appendDescription (two-newline append), title, priority, bucket (move to a BKT-* id; optional note; audits task.moved). Exactly one kind:* (code|admin-setup|human-test|decision|blocked-external|needs-review) must remain: two kinds or an unknown kind is rejected, and removing the only kind leaves kind:needs-review; swap with removeLabels:[old], addLabels:[new] in one call. Exactly one lane:* must remain, except lane-less tasks may gain/lose kind:* labels, closed:duplicate|obsolete|superseded|delivered|wontfix or not-needed (and, on a UAT ticket task with kind:code plus uat:<feedbackId>, uat:hold and uat-attempt:<n>), be moved by bucket alone, or be in a terminal stage; labels cannot mix with incremental fields, nor description with appendDescription. Moves reject unknown, archived or closed-project targets and restricted projects without access; stage, labels, PRs and checkouts are untouched and the ToDos bucket syncs outbound. assignee (person id or agent:<slug>; null clears) and accountableOwner (a person) need the task.assign capability plus reason (10+ characters), and audit task.assignment.changed. Also cancel {reason: duplicate|obsolete|superseded|delivered_without_pr, replacedBy?: TASK-n (required for duplicate/superseded), note?} and reopen {stage?, note?} (default: the stage before the cancel; clears cancellation, keeps completedAt): stage changes that cannot be combined with other fields; cancel needs the task.cancel capability and reopen task.reopen, granted to the authenticated principal (the operator email grants nothing); audits task.cancelled / task.reopened. Also verify {note?}: moves a merged UAT ticket task to verified (verified again changes nothing), audits task.verified, cannot be combined with other fields, and needs task.uat_sync. Only the portal holds task.uat_sync; with it the portal may only verify, cancel, or edit kind:*, closure, uat:hold and uat-attempt:<n> labels, and only on UAT ticket tasks. Rejects all other fields, including evidence and checkouts. Audits task.updated. Labels stay DB-only; other fields use normal ToDos sync. On a task a person must verify (verify:human or kind:human-test), new description text must be STE-lite: warns until 2026-10-24 (result.evidenceStandard), then refused with evidence_standard. Hub only, apart from the portal's UAT ticket mirror.",
    inputSchema: updateTaskSchema,
  }, async (args) => mcpJsonResult({ data: await actionUpdateTask(identity, args) }));
  server.registerTool("mc_update_tasks", {
    description: "Batch mc_update_task: {items:[{taskId, patch}]}, 1–100 items. Same patch fields (including cancel/reopen) and constraints as mc_update_task, including the one-kind:* rule. Each item commits independently and returns a compact receipt {index, ok, taskId, changed[], eventSeq} or ok:false + error (full diff is in the task.updated event; use mc_update_task for it); one invalid item never aborts the others.",
    inputSchema: updateTasksSchema,
  }, async (args) => mcpJsonResult({ data: await actionUpdateTasks(identity, args) }));
}
