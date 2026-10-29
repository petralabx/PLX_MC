// POST /api/cursor/drafts/page — mc_publish_draft_page (review pages, TASK-4135).
// Shared with the HTTP MCP tool through src/lib/mcp/draft-actions.ts.

import { actionPublishDraftPage, publishDraftPageSchema } from "@/lib/mcp/draft-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_publish_draft_page", async (req, _ctx, identity) => {
  return { data: await actionPublishDraftPage(identity, await parseCursorBody(req, publishDraftPageSchema)) };
});
