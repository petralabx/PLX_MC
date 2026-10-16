// PATCH /api/tasks/{id}/comments — one write to a task's discussion thread
// (EN-001 / WS-3): add, edit or delete a single comment, and get the stored
// thread back. App-only — task comments are never pushed to SharePoint.
// Needs task.progress on the signed-in session and the task's project ACL.
// The session is the author; only the author edits or deletes (TASK-3043, the
// rule PATCH /api/buckets/{id}/comments follows). One operation per request
// (not the whole thread) so a client can never drop or rewrite a comment it
// has not seen.

import { commentOpSchema } from "@/lib/api/comment-op";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import {
  aclPrincipalFromAuthorized,
  requireSessionActor,
} from "@/lib/routing/mutations/actors";
import { applyTaskCommentOp } from "@/lib/sync";

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const op = await parseBody(req, commentOpSchema);
  const authorized = await requireSessionActor("task.progress", { type: "task", id });
  await assertTaskProjectAccess(id, aclPrincipalFromAuthorized(authorized));
  const thread = await applyTaskCommentOp(id, op, sessionAuthorId(authorized.auditLabel));
  if (!thread) throw new ApiError("not_found", `unknown task ${id}`, 404);
  return thread;
});
