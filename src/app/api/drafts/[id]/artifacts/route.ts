// POST /api/drafts/{id}/artifacts {base, kind, fileName, contentType, name?, contentBase64}
// — the author, signed in, uploads a diagram, screenshot or web page from the New
// draft form (TASK-4131). The core mc_upload_draft_artifact uses (TASK-4130) stores
// it under Drafts/DRF-n/ in the Mission Control library and links it from the
// draft's artifacts. base is the editBase the form read: a draft that has moved
// refuses with 409 draft_changed before anything is stored. Returns the linked
// artifact and the new editBase. Off when PLX_MC_DRAFTS_ENABLED=0, and until a
// person sets PLX_MC_EVIDENCE_STORE_ENABLED=1.

import { parseBody, route } from "@/lib/api/route";
import { draftEditBaseSchema } from "@/lib/drafts/schema";
import { draftActorFromSession } from "@/lib/drafts/session";
import { uploadDraftArtifact, uploadDraftArtifactSchema } from "@/lib/mcp/draft-actions";

export const dynamic = "force-dynamic";
// A 3 MiB file goes to SharePoint before the draft records it.
export const maxDuration = 60;

const uploadSchema = uploadDraftArtifactSchema.omit({ draftId: true }).extend({ base: draftEditBaseSchema });

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await draftActorFromSession("draft.create");
  const { base, ...file } = await parseBody(req, uploadSchema);
  const { artifact, duplicate, editBase, draft } = await uploadDraftArtifact(actor, { ...file, draftId: id }, { base });
  return { artifact, duplicate, editBase, draft };
});
