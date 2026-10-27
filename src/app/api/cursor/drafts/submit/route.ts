// POST /api/cursor/drafts/submit — mc_submit_draft (Draft Projects, TASK-4059).
// Shared with the HTTP MCP tool through src/lib/mcp/draft-actions.ts.

import { actionSubmitDraft, submitDraftSchema } from "@/lib/mcp/draft-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_submit_draft", async (req, _ctx, identity) => {
  return { data: await actionSubmitDraft(identity, await parseCursorBody(req, submitDraftSchema)) };
});
