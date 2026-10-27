// GET /api/cursor/drafts — mc_list_drafts; POST /api/cursor/drafts — mc_save_draft
// (Draft Projects, TASK-4059). Shared with the HTTP MCP tools through
// src/lib/mcp/draft-actions.ts; off when PLX_MC_DRAFTS_ENABLED=0.

import { actionListDrafts, actionSaveDraft, saveDraftSchema } from "@/lib/mcp/draft-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const GET = cursorRoute("mc_list_drafts", async (req, _ctx, identity) => {
  const params = new URL(req.url).searchParams;
  const flag = (name: string) => (params.get(name) === null ? {} : { [name]: params.get(name) === "true" });
  return {
    data: await actionListDrafts(identity, {
      ...(params.get("status") ? { status: params.get("status") } : {}),
      ...(params.get("q") ? { q: params.get("q") } : {}),
      ...flag("mine"),
      ...flag("needsMyReview"),
    }),
  };
});

export const POST = cursorRoute("mc_save_draft", async (req, _ctx, identity) => {
  return { data: await actionSaveDraft(identity, await parseCursorBody(req, saveDraftSchema)) };
});
