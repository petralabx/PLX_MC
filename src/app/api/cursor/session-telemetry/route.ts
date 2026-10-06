// POST /api/cursor/session-telemetry — mc_report_session_telemetry (TASK-633).
// An agent session reports its token/cost usage at close; one append-only
// mc_events row per session (dedup on sessionId), aggregated by the
// evaluation loop (/api/agent-metrics, routing suggest envelope).

import {
  actionReportSessionTelemetry,
  sessionTelemetrySchema,
} from "@/lib/mcp/session-telemetry-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_report_session_telemetry", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, sessionTelemetrySchema);
  return { data: await actionReportSessionTelemetry(identity, body) };
});
