// mc_report_session_telemetry (TASK-633) — shared by POST
// /api/cursor/session-telemetry (the stdio client's proxy target) and the HTTP
// MCP transport. An agent session reports its token/cost usage at close; one
// append-only mc_events row per session (dedup on sessionId), rolled up by
// /api/agent-metrics.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appendEvent } from "@/lib/compliance/repo";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { mcpJsonResult } from "./envelope";

export const sessionTelemetrySchema = z.object({
  sessionId: z.string().min(1).max(120),
  taskId: z.string().min(1).optional(),
  checkoutId: z.string().min(1).optional(),
  model: z.string().max(120).optional(),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  costCents: z.number().int().min(0).optional(),
});

export type SessionTelemetryInput = z.infer<typeof sessionTelemetrySchema>;

export async function actionReportSessionTelemetry(
  identity: McpIdentity,
  body: SessionTelemetryInput
): Promise<{ recorded: true; sessionId: string }> {
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
  return { recorded: true, sessionId: body.sessionId };
}

export function registerSessionTelemetryTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_report_session_telemetry",
    "Report this agent session's token usage and cost estimate (cents) at close. One row per sessionId; a replay is a no-op. Feeds per-runtime and per-bucket cost-per-completed-task in /api/agent-metrics?rollup=cost.",
    sessionTelemetrySchema.shape,
    async (args) => mcpJsonResult({ data: await actionReportSessionTelemetry(identity, args) })
  );
}
