// Hub task metadata edits. Labels remain DB-only; patchTask owns sync enqueue.
// The row lock, normal patch path and mc_events diff share one transaction.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { withTransaction } from "@/lib/db";
import { appendEventTx } from "@/lib/compliance/repo";
import type { Task } from "@/lib/mc-data/types";
import { assertProjectIdAccess, assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { patchTask } from "@/lib/sync";
import { bucketMoveTargetViolation } from "@/lib/sync/bucket-move";
import { cancelTaskTx, reopenTaskTx } from "@/lib/sync/cancel";
import { BUCKET_ID_RE } from "@/lib/sync/mapping";
import { getBuckets, getEntity, getProjects } from "@/lib/sync/repo";
import type { McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";
import { assertMayCloseOrReopen, cancelContextFor, cancelPatchSchema, reopenPatchSchema } from "./task-cancel-actions";
import { assertMcpToolAllowed } from "./tool-allowlist";

export const UPDATE_TASK_BATCH_MAX = 100;
export const TASK_LABEL_MAX = 128;
export const TASK_LABEL_COUNT_MAX = 100;
export const TASK_DESCRIPTION_MAX = 32_000;

// Labels a lane-less task may gain or lose without receiving a lane (legacy
// closure; stopgap until the cancelled stage ships).
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
  bucket: z.string().trim().regex(BUCKET_ID_RE, "bucket must be a BKT-* id").optional(),
  note: z.string().trim().min(1).max(500).optional(),
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
  if (patch.labels !== undefined && (patch.addLabels !== undefined || patch.removeLabels !== undefined)) {
    ctx.addIssue({ code: "custom", message: "labels cannot be combined with addLabels or removeLabels." });
  }
  if (patch.description !== undefined && patch.appendDescription !== undefined) {
    ctx.addIssue({ code: "custom", message: "description cannot be combined with appendDescription." });
  }
  if (patch.note !== undefined && patch.bucket === undefined) {
    ctx.addIssue({ code: "custom", message: "note is only valid with bucket." });
  }
});

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

type EditableFields = Pick<Task, "labels" | "description" | "title" | "priority" | "bucket">;
type TaskDiff = Partial<Record<keyof EditableFields | "stage", { before: unknown; after: unknown }>>;

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("invalid_request", parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), 400);
  }
  return parsed.data;
}

export async function actionUpdateTask(identity: McpIdentity, input: unknown) {
  assertMcpToolAllowed(identity, "mc_update_task");
  const { taskId, patch } = parseInput(updateTaskSchema, input);
  const authorized = requireMcpActor(identity, "task.progress", { type: "task", id: taskId });
  if (patch.cancel || patch.reopen) {
    // Authorize before the transaction: a denial is audited on its own connection
    // and must survive the rollback an exception would trigger inside it.
    const current = await getEntity("task", taskId);
    if (!current) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity));
    await assertMayCloseOrReopen(identity, current.data as unknown as Task, patch.cancel ? "cancel" : "reopen");
  }
  return withTransaction(async (q) => {
    const row = await getEntity("task", taskId, q, true);
    if (!row) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity), q);
    const before = row.data as unknown as Task;

    // Stage changes with their own audited event; the lane/label rules below are
    // for metadata edits and must not block closing an old, unlabeled task.
    if (patch.cancel || patch.reopen) {
      const ctx = cancelContextFor(identity, authorized.actorId);
      const done = patch.cancel
        ? await cancelTaskTx(q, taskId, patch.cancel, ctx)
        : await reopenTaskTx(q, taskId, patch.reopen!, ctx);
      return {
        taskId,
        fields: { labels: done.task.labels, description: done.task.description ?? "", title: done.task.title, priority: done.task.priority },
        diff: { stage: { before: before.stage, after: done.task.stage } } as TaskDiff,
        eventSeq: done.eventSeq,
        link: taskLink(taskId),
      };
    }

    // Removals happen first so a lane can be replaced in one incremental call.
    const labels = parseInput(labelsSchema, patch.labels ?? [...new Set([
      ...(before.labels ?? []).filter((label) => !(patch.removeLabels ?? []).includes(label.trim())),
      ...(patch.addLabels ?? []),
    ].map((label) => label.trim()))]);
    const lanes = labels.filter((label) => label.startsWith("lane:"));
    const delta = [...labels.filter((label) => !(before.labels ?? []).includes(label)),
      ...(before.labels ?? []).filter((label) => !labels.includes(label))];
    const sent = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key);
    const closureOnly = delta.length > 0 && delta.every((label) => CLOSURE_LABELS.includes(label))
      && sent.every((key) => key === "labels" || key === "addLabels" || key === "removeLabels");
    const bucketOnly = sent.every((key) => key === "bucket" || key === "note");
    const laneOptional = TERMINAL_TASK_STAGES.includes(before.stage) || closureOnly || bucketOnly;
    if (lanes.length > 1 || (lanes.length === 1 && !lanes[0].slice("lane:".length).trim())
      || (lanes.length === 0 && !laneOptional)) {
      throw new ApiError("invalid_request", "The resulting labels must contain exactly one non-empty lane:* label. Add a lane for an unlabeled task; remove the old lane when replacing it. Lane-less tasks may only gain or lose closure labels in a label-only patch (" + CLOSURE_LABELS.join(", ") + "), be moved by bucket alone, or be in a terminal stage.", 400);
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
    if (patch.description !== undefined) requested.description = patch.description;
    if (patch.appendDescription !== undefined) {
      requested.description = parseInput(z.string().max(TASK_DESCRIPTION_MAX),
        [before.description ?? "", patch.appendDescription].filter(Boolean).join("\n\n"));
    }
    const changed: Partial<EditableFields> = {};
    const diff: TaskDiff = {};
    for (const field of Object.keys(requested) as (keyof EditableFields)[]) {
      const previous = before[field] ?? (field === "description" ? "" : []);
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
      actor: `${identity.runtime}:${identity.operatorEmail}`,
      repo: identity.repo,
      taskId,
      payload: {
        servicePrincipalId: identity.servicePrincipalId,
        workerId: identity.workerId,
        diff,
      },
    });
    if (diff.bucket) {
      await appendEventTx(q, {
        kind: "task.moved",
        actor: `${identity.runtime}:${identity.operatorEmail}`,
        repo: identity.repo,
        taskId,
        payload: {
          from: diff.bucket.before, to: diff.bucket.after, note: patch.note ?? null,
          actor: `${identity.runtime}:${identity.operatorEmail}`,
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
    };
  });
}

// Batch items return receipts, not the full fields/diff: 100 items carrying
// 32 KB descriptions plus before/after would pass Vercel's 4.5 MB response cap
// after the writes have committed. The full diff stays in the task.updated event.
export type UpdateTaskItemOutcome =
  | { index: number; ok: true; taskId: string; changed: string[]; eventSeq: string | undefined }
  | { index: number; ok: false; error: { code: string; message: string } };

const BATCH_ERROR_MESSAGE_MAX = 500;

export async function actionUpdateTasks(identity: McpIdentity, input: unknown) {
  assertMcpToolAllowed(identity, "mc_update_tasks");
  requireMcpActor(identity, "task.progress");
  const { items } = parseInput(updateTasksSchema, input);
  const results: UpdateTaskItemOutcome[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const data = await actionUpdateTask(identity, item);
      results.push({ index, ok: true, taskId: data.taskId, changed: Object.keys(data.diff), eventSeq: data.eventSeq });
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
  return { results, updated, failed: results.length - updated };
}

export function registerTaskUpdateTools(server: McpServer, identity: McpIdentity): void {
  // Full strict schemas preserve unknown-field rejection at the MCP boundary.
  server.registerTool("mc_update_task", {
    description: "Edit task metadata with {taskId, patch}: labels (replace), addLabels/removeLabels (incremental), description (replace), appendDescription (two-newline append), title, priority, bucket (move to a BKT-* id; optional note; audits task.moved). Exactly one lane:* must remain, except lane-less tasks may gain/lose closed:duplicate|obsolete|superseded|delivered|wontfix or not-needed, be moved by bucket alone, or be in a terminal stage; labels cannot mix with incremental fields, nor description with appendDescription. Moves reject unknown, archived or closed-project targets and restricted projects without access; stage, labels, PRs and checkouts are untouched and the ToDos bucket syncs outbound. Also cancel {reason: duplicate|obsolete|superseded|delivered_without_pr, replacedBy?: TASK-n (required for duplicate/superseded), note?} and reopen {stage?, note?} (default: the stage before the cancel; clears cancellation, keeps completedAt): stage changes that cannot be combined with other fields; cancel needs the task.cancel capability and reopen task.reopen, granted to the authenticated principal (the operator email grants nothing); audits task.cancelled / task.reopened. Rejects all other fields, including evidence and checkouts. Audits task.updated. Labels stay DB-only; other fields use normal ToDos sync. Hub only.",
    inputSchema: updateTaskSchema,
  }, async (args) => mcpJsonResult({ data: await actionUpdateTask(identity, args) }));
  server.registerTool("mc_update_tasks", {
    description: "Batch mc_update_task: {items:[{taskId, patch}]}, 1–100 items. Same patch fields (including cancel/reopen) and constraints as mc_update_task. Each item commits independently and returns a compact receipt {index, ok, taskId, changed[], eventSeq} or ok:false + error (full diff is in the task.updated event; use mc_update_task for it); one invalid item never aborts the others.",
    inputSchema: updateTasksSchema,
  }, async (args) => mcpJsonResult({ data: await actionUpdateTasks(identity, args) }));
}
