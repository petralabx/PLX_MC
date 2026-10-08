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
import { patchTask } from "@/lib/sync";
import { reopenTask } from "@/lib/sync/cancel";
import { getEntity } from "@/lib/sync/repo";

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
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { actor: _ignored, ...patch } = await parseBody(req, patchTaskSchema);
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
  });
  if (!task) throw new ApiError("not_found", `unknown task ${id}`, 404);
  return task;
});
