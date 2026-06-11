// POST /api/sync/conflicts/{id}/resolve — a human picks the winner (§5.1;
// manual resolution only, the choice is audited).

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { resolveConflict } from "@/lib/sync";

const resolveSchema = z.object({
  winner: z.enum(["mc", "sp"]),
  actor: z.string().min(1),
});

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { winner, actor } = await parseBody(req, resolveSchema);
  const resolved = await resolveConflict(id, winner, actor);
  if (!resolved) throw new ApiError("not_found", `unknown or already-resolved conflict ${id}`, 404);
  return { resolved: true };
});
