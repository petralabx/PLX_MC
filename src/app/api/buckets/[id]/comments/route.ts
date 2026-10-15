// PATCH /api/buckets/{id}/comments — persist a bucket's discussion thread
// (EN-001 / Item 4). The store mirrors the whole comment array (the same shape
// task comments round-trip through PATCH /api/tasks/{id}); the server replaces
// the thread atomically and returns the stored comments. App-only — bucket
// comments are never pushed to SharePoint. Needs bucket.comment on the signed-in
// session and the bucket's project ACL; the session is the author, and other
// people's comments are kept as stored (TASK-3011).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { assertBucketProjectAccess } from "@/lib/permissions/project-acl-guard";
import {
  aclPrincipalFromAuthorized,
  requireSessionActor,
} from "@/lib/routing/mutations/actors";
import { setBucketComments } from "@/lib/sync";

// Mirrors the task discussion comment shape (api/tasks/[id]/route.ts) — a
// free-form note with a capped body and resolved @mentions.
const commentSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string().min(1).max(5000),
  ts: z.string(),
  mentions: z.array(z.string()).max(50),
  editedTs: z.string().optional(),
});

const patchBucketCommentsSchema = z.object({
  // Deprecated / ignored — the author is the session (TASK-3011).
  actor: z.string().min(1).optional(),
  comments: z.array(commentSchema).max(500),
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { comments } = await parseBody(req, patchBucketCommentsSchema);
  const authorized = await requireSessionActor("bucket.comment", { type: "bucket", id });
  await assertBucketProjectAccess(id, aclPrincipalFromAuthorized(authorized));
  return setBucketComments(id, comments, sessionAuthorId(authorized.auditLabel));
});
