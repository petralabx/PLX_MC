// GET /api/drafts/{id}[?version=N] — one draft for the Drafts screen (Draft
// Projects step 3): the working copy, reviews (each marked stale when given on
// an older version), every frozen version's digest, the preflight problems,
// and what the signed-in person may do with it. With version, that frozen
// version's content too. Off when PLX_MC_DRAFTS_ENABLED=0.

import { ApiError, route } from "@/lib/api/route";
import { draftDigest } from "@/lib/drafts/schema";
import { draftPreflight, getVisibleDraft, getVisibleDraftVersion, isDraftWriter } from "@/lib/drafts/service";
import { draftActorFromSession } from "@/lib/drafts/session";
import { getDraftVersion } from "@/lib/drafts/store";
import { acceptInProgress, isStaleReview, openBlockingFindings } from "@/lib/drafts/types";

export const dynamic = "force-dynamic";

export const GET = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await draftActorFromSession("task.read");
  const raw = new URL(req.url).searchParams.get("version");
  const requested = raw === null ? null : Number(raw);
  if (requested !== null && (!Number.isInteger(requested) || requested < 1)) {
    throw new ApiError("invalid_request", "version must be a whole number of 1 or more.");
  }
  const draft = await getVisibleDraft(actor, id);
  const versions = [];
  for (let v = 1; v <= draft.version; v++) {
    const frozen = await getDraftVersion(id, v);
    if (frozen) versions.push({ version: frozen.version, digest: frozen.digest, frozenBy: frozen.frozenBy, frozenAt: frozen.frozenAt });
  }
  const isAuthor = isDraftWriter(draft, actor);
  const blocking = openBlockingFindings(draft).map((r) => r.id);
  const unsubmitted = draft.version > 0 && draftDigest(draft.working) !== draft.digest;
  const open = draft.status === "drafting" || draft.status === "in_review";
  const accepting = acceptInProgress(draft);
  return {
    draft: { ...draft, reviews: draft.reviews.map((r) => ({ ...r, stale: isStaleReview(r, draft) })) },
    versions,
    version: requested !== null ? await getVisibleDraftVersion(actor, id, requested) : null,
    preflight: open ? await draftPreflight(actor, draft) : [],
    viewer: {
      email: actor.email,
      isAuthor,
      openBlockingFindings: blocking,
      unsubmittedEdits: unsubmitted,
      acceptInProgress: accepting,
      // A draft with edits that are not submitted takes no review (draft_not_in_review).
      canReview: draft.status === "in_review" && !accepting,
      canAccept: isAuthor && draft.status === "in_review" && !unsubmitted && blocking.length === 0 && !accepting,
    },
  };
});
