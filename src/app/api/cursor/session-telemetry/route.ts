// POST /api/cursor/session-telemetry — mc_report_session_telemetry (TASK-633).
// An agent session reports its token/cost usage at close; one append-only
// mc_events row per session (dedup on sessionId), aggregated by the
// evaluation loop (/api/agent-metrics, routing suggest envelope).

import { z } from "zod";
import { appendEvent } from "@/lib/compliance/repo";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { requireMcpActor } from "@/lib/routing/mutations/actors";

const telemetrySchema = z.object({
  sessionId: z.string().min(1).max(120),
  taskId: z.string().min(1).optional(),
  checkoutId: z.string().min(1).optional(),
  model: z.string().max(120).optional(),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  costCents: z.number().int().min(0).optional(),
});

export const POST = cursorRoute("mc_report_session_telemetry", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, telemetrySchema);
  requireMcpActor(identity, "telemetry.report", { type: "routing" });
  await appendEvent({
    kind: "agent.session_telemetry",
    actor: identity.runtime,
    repo: identity.repo,
    taskId: body.taskId ?? null,
    payload: {
      sessionId: body.sessionId,
      checkoutId: body.checkoutId ?? null,
      model: body.model ?? null,
      tokensIn: body.tokensIn,
      tokensOut: body.tokensOut,
      costCents: body.costCents ?? null,
      operator: identity.operatorEmail,
      servicePrincipalId: identity.servicePrincipalId,
    },
    // One telemetry row per reported session — replays are no-ops.
    dedupKey: `telemetry:${body.sessionId}`,
  });
  return {
    data: { recorded: true, sessionId: body.sessionId },
  };
});
