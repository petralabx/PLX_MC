// POST /api/cursor/ci-scorecard — mc_report_ci_scorecard (TASK-3913). The Monday
// CI metrics task posts `{ snapshot }`, the JSON of agentic-swarm's
// scripts/ci-audit/weekly_metrics.py: one append-only mc_events row per window
// (a replay is a no-op), graded on GET /api/ci-scorecard.

import { actionReportCiScorecard, ciScorecardReportSchema } from "@/lib/mcp/ci-scorecard-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_report_ci_scorecard", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, ciScorecardReportSchema);
  return { data: await actionReportCiScorecard(identity, body) };
});
