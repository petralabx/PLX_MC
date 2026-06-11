// POST /api/sync/errors/{id}/retry — retry a rejected outbound write; the
// mapping layer's normalization (§5.2) makes the retry succeed.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { retryError } from "@/lib/sync";

const retrySchema = z.object({ actor: z.string().min(1) });

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { actor } = await parseBody(req, retrySchema);
  const retried = await retryError(id, actor);
  if (!retried) throw new ApiError("not_found", `unknown error ${id} or retry rejected`, 404);
  return { retried: true };
});
