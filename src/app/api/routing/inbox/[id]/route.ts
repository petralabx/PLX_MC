// GET /api/routing/inbox/[id] — proposal detail for the Routing Inbox.

import { ApiError, route } from "@/lib/api/route";
import {
  assertRoutingInboxEnabled,
  requireInboxActor,
} from "../_lib/guard";
import { getInboxProposalDetail } from "../_lib/queries";

export const GET = route(async (_req, ctx) => {
  assertRoutingInboxEnabled();
  await requireInboxActor("routing.resolve");

  const { id } = await ctx.params;
  if (!id?.trim()) {
    throw new ApiError("invalid_request", "proposal id required.", 400);
  }

  try {
    const detail = await getInboxProposalDetail(id);
    if (!detail) throw new ApiError("not_found", `unknown proposal ${id}`, 404);
    return detail;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|databaseUrl|DATABASE|password authentication|does not exist/i.test(message)) {
      throw new ApiError("unavailable", "Routing store unavailable.", 503);
    }
    throw err;
  }
});
