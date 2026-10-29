// GET /api/cursor/drafts/{id}/page[?version=N] — mc_render_draft_page (review
// pages, TASK-4135). Shared with the HTTP MCP tool through src/lib/mcp/draft-actions.ts.

import { ApiError } from "@/lib/api/route";
import { actionRenderDraftPage } from "@/lib/mcp/draft-actions";
import { cursorRoute } from "@/lib/mcp/route";

export const GET = cursorRoute("mc_render_draft_page", async (req, ctx, identity) => {
  const { id } = await ctx.params;
  const raw = new URL(req.url).searchParams.get("version");
  const version = raw === null ? undefined : Number(raw);
  if (version !== undefined && !Number.isInteger(version)) {
    throw new ApiError("invalid_request", "version must be a whole number.");
  }
  return { data: await actionRenderDraftPage(identity, { draftId: id, ...(version !== undefined ? { version } : {}) }) };
});
