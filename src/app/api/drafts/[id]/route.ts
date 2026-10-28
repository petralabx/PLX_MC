// GET /api/drafts/{id}[?version=N] — one draft for the Drafts screen (Draft
// Projects step 3): the working copy, reviews (each marked stale when given on
// an older version), every frozen version's digest, the preflight problems,
// and what the signed-in person may do with it. With version, that frozen
// version's content too.
// PATCH /api/drafts/{id} {base, ...sections} — the author saves the New draft
// form (TASK-4109). base is the editBase GET returned; once the draft has moved
// (an agent's save, another tab), the save refuses with 409 draft_changed.
// viewer.canUpload tells the form to offer file uploads (TASK-4131).
// Off when PLX_MC_DRAFTS_ENABLED=0.

import { ApiError, parseBody, route } from "@/lib/api/route";
import { completenessIssues } from "@/lib/drafts/preflight";
import { draftDigest, draftEditBaseSchema, draftSectionsSchema } from "@/lib/drafts/schema";
import {
  draftEditBase,
  draftPreflight,
  draftSummary,
  getVisibleDraft,
  getVisibleDraftVersion,
  isDraftWriter,
  saveDraft,
} from "@/lib/drafts/service";
import { draftActorFromSession } from "@/lib/drafts/session";
import { getDraftVersion } from "@/lib/drafts/store";
import { acceptInProgress, isStaleReview, openBlockingFindings } from "@/lib/drafts/types";
import { evidenceStoreEnabled } from "@/lib/secrets";

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
  // Once an Accept has claimed the draft its content is pinned (service assertAcceptNotStarted).
  const acceptStarted = Object.keys(draft.materialized).length > 0 || draft.acceptedBy !== null;
  return {
    draft: { ...draft, reviews: draft.reviews.map((r) => ({ ...r, stale: isStaleReview(r, draft) })) },
    versions,
    version: requested !== null ? await getVisibleDraftVersion(actor, id, requested) : null,
    preflight: open ? await draftPreflight(actor, draft) : [],
    completeness: open ? completenessIssues(draft.working) : [],
    viewer: {
      email: actor.email,
      isAuthor,
      openBlockingFindings: blocking,
      unsubmittedEdits: unsubmitted,
      acceptInProgress: accepting,
      // A draft with edits that are not submitted takes no review (draft_not_in_review).
      canReview: draft.status === "in_review" && !accepting,
      canAccept: isAuthor && draft.status === "in_review" && !unsubmitted && blocking.length === 0 && !accepting,
      canEdit: isAuthor && open && !accepting && !acceptStarted,
      canSubmit: isAuthor && draft.status === "drafting" && !accepting,
      canWithdraw: isAuthor && open && !accepting,
      // Files go to the shared Mission Control library: a restricted draft keeps links only.
      canUpload: isAuthor && open && !accepting && !acceptStarted && draft.visibility === "shared" && evidenceStoreEnabled(),
      editBase: draftEditBase(draft),
    },
  };
});

const saveSchema = draftSectionsSchema
  .extend({ base: draftEditBaseSchema })
  .refine((body) => Object.keys(body).some((k) => k !== "base"), "Send at least one of title, plan, research, visibility, members or reviewers.");

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await draftActorFromSession("draft.create");
  const { base, ...sections } = await parseBody(req, saveSchema);
  const result = await saveDraft(actor, id, sections, { base });
  return { draft: draftSummary(result.draft), changed: result.changed, editBase: draftEditBase(result.draft) };
});
