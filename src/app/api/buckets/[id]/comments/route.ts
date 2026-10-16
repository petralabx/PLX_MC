// PATCH /api/buckets/{id}/comments — one write to a bucket's discussion thread
// (EN-001 / Item 4): add, edit or delete a single comment, and get the stored
// thread back. App-only — bucket comments are never pushed to SharePoint.
// Needs bucket.comment on the signed-in session and the bucket's project ACL.
// The session is the author; only the author edits or deletes (TASK-3011).
// One operation per request (not the whole thread) so a client can never drop
// or rewrite a comment it has not seen.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { assertBucketProjectAccess } from "@/lib/permissions/project-acl-guard";
import {
  aclPrincipalFromAuthorized,
  requireSessionActor,
} from "@/lib/routing/mutations/actors";
import { applyBucketCommentOp } from "@/lib/sync";
import { getBuckets } from "@/lib/sync/repo";

const text = z.string().trim().min(1).max(5000);
const mentions = z.array(z.string()).max(50);

const bucketCommentOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), body: text, mentions }),
  z.object({ op: z.literal("edit"), id: z.string().min(1), body: text, mentions }),
  z.object({ op: z.literal("delete"), id: z.string().min(1) }),
]);

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const op = await parseBody(req, bucketCommentOpSchema);
  const authorized = await requireSessionActor("bucket.comment", { type: "bucket", id });
  if (!(await getBuckets()).some((bucket) => bucket.id === id)) {
    throw new ApiError("not_found", `unknown bucket ${id}`, 404);
  }
  await assertBucketProjectAccess(id, aclPrincipalFromAuthorized(authorized));
  return applyBucketCommentOp(id, op, sessionAuthorId(authorized.auditLabel));
});
