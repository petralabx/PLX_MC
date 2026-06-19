// POST /api/repos/{id}/reject — approver-gated rejection of a pending request
// (EN-005 / WS-5). Nothing joins the registry; the actor's approver role is
// checked server-side.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { rejectRepoRequest } from "@/lib/sync";

const decisionSchema = z.object({ actor: z.string().min(1) });

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { actor } = await parseBody(req, decisionSchema);
  return rejectRepoRequest(id, actor);
});
