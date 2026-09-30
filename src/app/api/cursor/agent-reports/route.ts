// GET /api/cursor/agent-reports — agent fleet P8b. Reads the agent.report
// events that POST /api/cursor/agent-report writes, newest first, with the
// same key auth as /api/cursor/tasks. Filters: agentSlug, loopId. Paging:
// limit (default 20, at most 100) and cursor=<nextCursor of the last page>.
// Only sp_mcp_portal holds agent_report.read.

import { listAgentReports } from "@/lib/compliance/repo";
import { parseAgentReportsQuery, toAgentReport } from "@/lib/mcp/agent-reports";
import { cursorRoute } from "@/lib/mcp/route";
import { requireMcpActor } from "@/lib/routing/mutations/actors";

export const GET = cursorRoute("mc_list_agent_reports", async (req, _ctx, identity) => {
  requireMcpActor(identity, "agent_report.read", { type: "routing" });
  const query = parseAgentReportsQuery(new URL(req.url).searchParams);
  // One extra row tells whether a next page exists.
  const rows = await listAgentReports({
    agentSlug: query.agentSlug,
    loopId: query.loopId,
    beforeSeq: query.cursor,
    limit: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  return {
    data: {
      reports: page.map(toAgentReport),
      nextCursor: hasMore ? page[page.length - 1].seq : null,
      hasMore,
    },
  };
});
