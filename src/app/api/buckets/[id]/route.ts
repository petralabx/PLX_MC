// PATCH /api/buckets/{id} — edit a bucket/initiative (EN-005): owner, health,
// target, started, description, attached repos (allow-list-clamped), PRD link.
// Persisted in the plx_mc DB; the Roadmap SharePoint mirror is a later increment.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { patchBucket } from "@/lib/sync";

const patchBucketSchema = z.object({
  // Deprecated / ignored — authority is session oid only.
  actor: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  health: z.enum(["track", "risk", "off"]).optional(),
  target: z.string().optional(),
  started: z.string().optional(),
  desc: z.string().optional(),
  repos: z.array(z.string()).optional(),
  prd: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const patch = await parseBody(req, patchBucketSchema);
  delete patch.actor;
  const authorized = await requireSessionActor("bucket.update", {
    type: "bucket",
    id,
  });
  const bucket = await patchBucket(id, patch, authorized.auditLabel);
  if (!bucket) throw new ApiError("not_found", `unknown bucket ${id}`, 404);
  return bucket;
});
