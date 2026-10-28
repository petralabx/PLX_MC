// POST /api/cursor/drafts/artifact — mc_upload_draft_artifact (Draft Projects, TASK-4130).
// Shared with the HTTP MCP tool through src/lib/mcp/draft-actions.ts.

import { actionUploadDraftArtifact, uploadDraftArtifactSchema } from "@/lib/mcp/draft-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

// A 3 MiB file goes to SharePoint before the draft records it.
export const maxDuration = 60;

export const POST = cursorRoute("mc_upload_draft_artifact", async (req, _ctx, identity) => {
  return { data: await actionUploadDraftArtifact(identity, await parseCursorBody(req, uploadDraftArtifactSchema)) };
});
