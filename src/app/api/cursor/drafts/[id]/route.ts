// GET /api/cursor/drafts/{id}[?version=N] — mc_get_draft (Draft Projects,
// TASK-4059). Shared with the HTTP MCP tool through src/lib/mcp/draft-actions.ts.

import { ApiError } from "@/lib/api/route";
import { actionGetDraft } from "@/lib/mcp/draft-actions";
import { cursorRoute } from "@/lib/mcp/route";

export const GET = cursorRoute("mc_get_draft", async (req, ctx, identity) => {
  const { id } = await ctx.params;
  const raw = new URL(req.url).searchParams.get("version");
  const version = raw === null ? undefined : Number(raw);
  if (version !== undefined && !Number.isInteger(version)) {
    throw new ApiError("invalid_request", "version must be a whole number.");
  }
  return { data: await actionGetDraft(identity, { draftId: id, ...(version !== undefined ? { version } : {}) }) };
});
