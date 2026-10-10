// PATCH /api/tasks/{id} — update task fields.
// Actor = Entra oid from session; body.actor is ignored (P8).

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import {
  aclPrincipalFromAuthorized,
  requireSessionActor,
} from "@/lib/routing/mutations/actors";
import { assertAgentAssigneeAllowed } from "@/lib/permissions/agent-assignee-guard";
import { assertBucketProjectAccess, assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import * as complianceRepo from "@/lib/compliance/repo";
import { cancelPatchSchema } from "@/lib/mcp/task-cancel-actions";
import { patchTask } from "@/lib/sync";
import { cancelTask, reopenTask } from "@/lib/sync/cancel";
import { getBuckets, getEntity, getProjects } from "@/lib/sync/repo";
import { assertMoveTargetProjectOpen } from "@/lib/sync/bucket-move";

const STAGES = ["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"] as const;

export const subtaskSchema = z.object({
  id: z.string(),
  t: z.string(),
  done: z.boolean(),
  who: z.string(),
  description: z.string().optional(),
  assignee: z.string().nullable().optional(),
  due: z.string().optional(),
  status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
});

export const commentSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string().min(1).max(5000),
  ts: z.string(),
  mentions: z.array(z.string()).max(50),
  editedTs: z.string().optional(),
});

export const patchTaskSchema = z.object({
  // Deprecated / ignored — authority is session oid only.
  actor: z.string().min(1).optional(),
  assignee: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  stage: z.enum(STAGES).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
  due: z.string().optional(),
  description: z.string().optional(),
  bucket: z.string().min(1).optional(),
  labels: z.array(z.string()).max(25).optional(),
  coassignees: z.array(z.string()).optional(),
  subtasks: z.array(subtaskSchema).optional(),
  comments: z.array(commentSchema).max(500).optional(),
  accountableOwner: z.string().nullable().optional(),
  humanOnly: z.boolean().optional(),
  repos: z.array(z.string()).max(50).optional(),
  targetEnv: z.enum(["staging", "production"]).optional(),
  agentRunApproved: z.boolean().optional(),
  // Entering cancelled: {reason, replacedBy?, note?}, alone (TASK-2598).
  cancel: cancelPatchSchema.optional(),
}).superRefine((patch, ctx) => {
  if (patch.cancel !== undefined
    && Object.entries(patch).some(([key, value]) => value !== undefined && key !== "cancel" && key !== "actor")) {
    ctx.addIssue({ code: "custom", message: "cancel is a stage change and cannot be combined with other fields." });
  }
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { actor: _ignored, cancel, ...patch } = await parseBody(req, patchTaskSchema);
  const capability =
    patch.stage === "verified" || patch.stage === "merged"
      ? "task.complete"
      : "task.progress";
  const authorized = await requireSessionActor(capability, { type: "task", id });
  // Same rule as actionCreateTask: only a signed-in person or sp_mcp_portal
  // may set an `agent:` assignee (agent fleet P8).
  assertAgentAssigneeAllowed(authorized.actor, patch.assignee, { capability });
  const principal = aclPrincipalFromAuthorized(authorized);
  await assertTaskProjectAccess(id, principal);
  if (patch.bucket) {
    await assertBucketProjectAccess(patch.bucket, principal);
    // Closed-project rule: only a real move into a bucket is checked (a no-op re-send passes).
    const before = await getEntity("task", id);
    if (before && (before.data as { bucket?: string }).bucket !== patch.bucket) {
      const target = (await getBuckets()).find((b) => b.id === patch.bucket);
      assertMoveTargetProjectOpen((await getProjects()).find((p) => p.id === target?.project), `${id} to ${patch.bucket}`);
    }
  }
  // Entering cancelled needs task.cancel on the session principal (admin/owner)
  // and runs through the cancel service, which validates the reason and appends
  // task.cancelled in the same transaction (TASK-2529).
  if (cancel) {
    let canceller;
    try {
      canceller = await requireSessionActor("task.cancel", { type: "task", id });
    } catch (err) {
      if (err instanceof ApiError && err.code === "forbidden") {
        await complianceRepo.appendEvent({
          kind: "task.cancel_denied",
          actor: `human:${authorized.auditLabel}`,
          taskId: id,
          payload: { capability: "task.cancel" },
        });
      }
      throw err;
    }
    const { task } = await cancelTask(id, cancel, {
      actor: canceller.auditLabel,
      actorId: canceller.actorId,
      eventActor: `human:${canceller.auditLabel}`,
      attribution: { source: "human", actorId: canceller.actorId },
    });
    return task;
  }
  // Leaving cancelled is a reopen: it needs task.reopen on the session principal,
  // runs through the reopen service (clears cancellation, emits task.reopened) and
  // is never a silent side effect of a generic stage change (TASK-2529).
  const { stage, ...rest } = patch;
  let reopened = false;
  if (stage) {
    const current = await getEntity("task", id);
    if (current?.data.stage === "cancelled") {
      let reopener;
      try {
        reopener = await requireSessionActor("task.reopen", { type: "task", id });
      } catch (err) {
        if (err instanceof ApiError && err.code === "forbidden") {
          await complianceRepo.appendEvent({
            kind: "task.reopen_denied",
            actor: `human:${authorized.auditLabel}`,
            taskId: id,
            payload: { capability: "task.reopen", requestedStage: stage },
          });
        }
        throw err;
      }
      await reopenTask(id, { stage }, {
        actor: reopener.auditLabel,
        actorId: reopener.actorId,
        eventActor: `human:${reopener.auditLabel}`,
        attribution: { source: "human", actorId: reopener.actorId },
      });
      reopened = true;
    }
  }
  const task = await patchTask(id, reopened ? rest : patch, authorized.auditLabel, {
    attribution: { source: "human", actorId: authorized.actorId },
    enforceClosedProject: true,
  });
  if (!task) throw new ApiError("not_found", `unknown task ${id}`, 404);
  return task;
});
