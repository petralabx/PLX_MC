// POST /api/cursor/drafts/review — mc_review_draft (Draft Projects, TASK-4059).
// Shared with the HTTP MCP tool through src/lib/mcp/draft-actions.ts.

import { actionReviewDraft, reviewDraftSchema } from "@/lib/mcp/draft-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_review_draft", async (req, _ctx, identity) => {
  return { data: await actionReviewDraft(identity, await parseCursorBody(req, reviewDraftSchema)) };
});
