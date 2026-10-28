// POST /api/drafts/{id}/withdraw {reason} — the author, signed in, withdraws an
// open draft (New draft form, TASK-4109), with a reason of 10 characters or
// more that stays on the draft. A withdrawn draft can no longer change. Off
// when PLX_MC_DRAFTS_ENABLED=0.

import { z } from "zod";

import { parseBody, route } from "@/lib/api/route";
import { draftTextSchema } from "@/lib/drafts/schema";
import { draftSummary, withdrawDraft } from "@/lib/drafts/service";
import { draftActorFromSession } from "@/lib/drafts/session";

export const dynamic = "force-dynamic";

const withdrawSchema = z.object({ reason: draftTextSchema(10, 2_000) }).strict();

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await draftActorFromSession("draft.create");
  const { reason } = await parseBody(req, withdrawSchema);
  return { draft: draftSummary(await withdrawDraft(actor, id, reason)) };
});
