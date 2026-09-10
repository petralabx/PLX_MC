import { z } from "zod";
import { actionCreateBucket, actionListBuckets, actionUpdateBucket } from "@/lib/mcp/actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

const createBucketSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  owner: z.string().min(1).optional(),
  health: z.enum(["track", "risk", "off"]).optional(),
  target: z.string().optional(),
  started: z.string().optional(),
  repos: z.array(z.string()).optional(),
  prd: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
});

const updateBucketSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    owner: z.string().min(1).optional(),
    health: z.enum(["track", "risk", "off"]).optional(),
    target: z.string().optional(),
    started: z.string().optional(),
    repos: z.array(z.string()).optional(),
    prd: z.string().nullable().optional(),
    project: z.string().nullable().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.description !== undefined ||
      body.owner !== undefined ||
      body.health !== undefined ||
      body.target !== undefined ||
      body.started !== undefined ||
      body.repos !== undefined ||
      body.prd !== undefined ||
      body.project !== undefined,
    { message: "Provide at least one field to update besides id." }
  );

export const POST = cursorRoute("mc_create_bucket", async (req, _ctx, identity) => {
  const result = await actionCreateBucket(
    identity,
    await parseCursorBody(req, createBucketSchema)
  );
  return { data: result };
});

export const PATCH = cursorRoute("mc_update_bucket", async (req, _ctx, identity) => {
  const result = await actionUpdateBucket(
    identity,
    await parseCursorBody(req, updateBucketSchema)
  );
  return { data: result };
});

export const GET = cursorRoute("mc_list_buckets", async (req, _ctx, identity) => {
  const params = new URL(req.url).searchParams;
  const result = await actionListBuckets(identity, {
    q: params.get("q") ?? undefined,
    project: params.get("project") ?? undefined,
  });
  return { data: result };
});
