// POST /api/drafts/{id}/submit {base} — the author, signed in, submits the
// working copy they read for review (New draft form, TASK-4109). base is the
// editBase GET returned: a draft that has moved since refuses with 409
// draft_changed, so a person never submits content they did not see. Submit
// freezes the next version after the completeness and preflight checks pass
// (422 draft_not_ready lists what is missing). Off when PLX_MC_DRAFTS_ENABLED=0.

import { z } from "zod";

import { parseBody, route } from "@/lib/api/route";
import { draftEditBaseSchema } from "@/lib/drafts/schema";
import { defaultDraftDeps, draftSummary, submitDraft } from "@/lib/drafts/service";
import { draftActorFromSession } from "@/lib/drafts/session";

export const dynamic = "force-dynamic";

const submitSchema = z.object({ base: draftEditBaseSchema }).strict();

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await draftActorFromSession("draft.create");
  const { base } = await parseBody(req, submitSchema);
  const result = await submitDraft(actor, id, defaultDraftDeps, { base });
  return { draft: draftSummary(result.draft), frozen: result.frozen, duplicates: result.duplicates };
});
