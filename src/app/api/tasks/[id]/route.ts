// PATCH /api/tasks/{id} — update task fields.
// Actor = Entra oid from session; body.actor is ignored (P8).

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import {
  aclPrincipalFromAuthorized,
  requireSessionActor,
} from "@/lib/routing/mutations/actors";
import { assertBucketProjectAccess, assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { patchTask } from "@/lib/sync";

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
  const principal = aclPrincipalFromAuthorized(authorized);
  await assertTaskProjectAccess(id, principal);
  if (patch.bucket) {
    await assertBucketProjectAccess(patch.bucket, principal);
  }
  const task = await patchTask(id, patch, authorized.auditLabel, {
    attribution: { source: "human", actorId: authorized.actorId },
  });
  if (!task) throw new ApiError("not_found", `unknown task ${id}`, 404);
  return task;
});
