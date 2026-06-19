// POST /api/repos/{id}/approve — approver-gated promotion of a pending request to
// the persisted registry/allow-list (EN-005 / WS-5). Re-validates against the
// GitHub org at this boundary; the actor's approver role is checked server-side
// (the client's claim is never trusted).

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { approveRepoRequest } from "@/lib/sync";

const decisionSchema = z.object({ actor: z.string().min(1) });

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const { actor } = await parseBody(req, decisionSchema);
  return approveRepoRequest(id, actor);
});
