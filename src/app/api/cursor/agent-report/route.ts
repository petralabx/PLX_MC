// POST /api/cursor/agent-report — agent fleet P8 (D12). A runner records one
// free-form report per agent run: one append-only agent.report event in
// mc_events, deduped on report:<agentSlug>:<runId>. Built like
// session-telemetry. Readers use GET /api/events?kind=agent.report.

import { z } from "zod";
import { appendEvent } from "@/lib/compliance/repo";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { requireMcpActor } from "@/lib/routing/mutations/actors";

/** Largest report body: 32 KB of UTF-8 markdown. */
const AGENT_REPORT_MAX_MARKDOWN_BYTES = 32 * 1024;

// Ids join into the dedup key with ":", so they may not contain one.
const agentSlug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "agentSlug must be a lowercase registry slug");
const runKey = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "must use letters, digits, '.', '_' or '-'");

const agentReportSchema = z.object({
  agentSlug,
  loopId: runKey,
  runId: runKey,
  title: z.string().trim().min(1).max(300),
  markdown: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= AGENT_REPORT_MAX_MARKDOWN_BYTES,
      `markdown must be at most ${AGENT_REPORT_MAX_MARKDOWN_BYTES} bytes (32 KB)`
    ),
});

export const POST = cursorRoute("mc_report_agent_run", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, agentReportSchema);
  requireMcpActor(identity, "telemetry.report", { type: "routing" });
  const dedupKey = `report:${body.agentSlug}:${body.runId}`;
  const seq = await appendEvent({
    kind: "agent.report",
    actor: identity.runtime,
    repo: identity.repo,
    taskId: null,
    payload: {
      agentSlug: body.agentSlug,
      loopId: body.loopId,
      runId: body.runId,
      title: body.title,
      markdown: body.markdown,
      operator: identity.operatorEmail,
      servicePrincipalId: identity.servicePrincipalId,
    },
    // One report per agent run — a repeat runId adds nothing.
    dedupKey,
  });
  return {
    data: {
      recorded: seq !== undefined,
      agentSlug: body.agentSlug,
      runId: body.runId,
      dedupKey,
    },
  };
});
