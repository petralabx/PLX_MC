// POST /api/drafts/{id}/accept {version} — the draft's author, signed in,
// accepts the version they read (Draft Projects step 3, PRD decision 1).
// Creates the project, buckets and tasks through the existing create functions
// and returns each draft key's new id. Needs draft.accept, which no service
// principal holds; an open blocking finding refuses it (PRD decision 2).

import { z } from "zod";

import { parseBody, route } from "@/lib/api/route";
import { acceptDraft, draftLink } from "@/lib/drafts/accept";
import { draftSummary } from "@/lib/drafts/service";
import { draftActorFromSession } from "@/lib/drafts/session";

export const dynamic = "force-dynamic";

const acceptSchema = z.object({ version: z.number().int().positive() }).strict();

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await draftActorFromSession("draft.accept");
  const { version } = await parseBody(req, acceptSchema);
  const result = await acceptDraft(actor, id, version);
  return {
    draft: draftSummary(result.draft),
    created: result.created,
    alreadyAccepted: result.alreadyAccepted,
    link: draftLink(id, version),
  };
});
