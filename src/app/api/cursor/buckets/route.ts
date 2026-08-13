import { z } from "zod";
import { actionCreateBucket, actionListBuckets } from "@/lib/mcp/actions";
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

export const POST = cursorRoute("mc_create_bucket", async (req, _ctx, identity) => {
  const result = await actionCreateBucket(
    identity,
    await parseCursorBody(req, createBucketSchema)
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
