// GET /api/cursor/knowledge/search?q=&limit= — mc_search_knowledge: Ask the
// Brain search through the shared brain-ask client. Read-only (task.read).

import { actionSearchKnowledge } from "@/lib/mcp/read-actions";
import { cursorRoute } from "@/lib/mcp/route";

export const GET = cursorRoute("mc_search_knowledge", async (req, _ctx, identity) => {
  const sp = new URL(req.url).searchParams;
  const limitRaw = sp.get("limit");
  return {
    data: await actionSearchKnowledge(identity, {
      q: sp.get("q") ?? "",
      limit: limitRaw ? Number(limitRaw) : undefined,
    }),
  };
});
