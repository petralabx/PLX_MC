// POST /api/buckets — create a bucket/initiative (EN-005). Lands pending until
// the Roadmap SharePoint mirror increment; persisted in the plx_mc DB so it
// survives a reload. Attached repos are allow-list-clamped server-side.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { createBucket } from "@/lib/sync";

const createBucketSchema = z.object({
  name: z.string().min(1),
  owner: z.string().min(1).optional(),
  health: z.enum(["track", "risk", "off"]).optional(),
  target: z.string().optional(),
  started: z.string().optional(),
  desc: z.string().optional(),
  repos: z.array(z.string()).optional(),
  prd: z.string().nullable().optional(),
});

export const POST = route(async (req) => createBucket(await parseBody(req, createBucketSchema)));
