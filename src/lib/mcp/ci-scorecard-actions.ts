// mc_report_ci_scorecard (TASK-3913) — POST /api/cursor/ci-scorecard. The
// Monday CI metrics task posts weekly_metrics.py's JSON for one window. It is
// stored once per window (a replay is a no-op) and graded when read, on
// GET /api/ci-scorecard and the CI scorecard screen.

import { z } from "zod";

import { ApiError } from "@/lib/api/route";
import { CURRENT_PHASE, buildScorecard } from "@/lib/ci-scorecard";
import { snapshotSchema } from "@/lib/ci-scorecard/schema";
import { recordSnapshot } from "@/lib/ci-scorecard/store";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";

/** A week of three repos is tens of KB; this keeps one mc_events row small. */
export const MAX_SNAPSHOT_BYTES = 256 * 1024;

export const ciScorecardReportSchema = z.object({ snapshot: snapshotSchema });

export type CiScorecardReport = z.infer<typeof ciScorecardReportSchema>;

export async function actionReportCiScorecard(
  identity: McpIdentity,
  body: CiScorecardReport
): Promise<{
  recorded: boolean;
  noop: boolean;
  windowStart: string;
  windowEnd: string;
  phase: number;
  overall: number | null;
}> {
  requireMcpActor(identity, "telemetry.report", { type: "routing" });
  const bytes = Buffer.byteLength(JSON.stringify(body.snapshot));
  if (bytes > MAX_SNAPSHOT_BYTES) {
    throw new ApiError("payload_too_large", `A snapshot is at most ${MAX_SNAPSHOT_BYTES} bytes; this one is ${bytes}.`, 413);
  }
  const { recorded, seq } = await recordSnapshot({
    snapshot: body.snapshot,
    actor: identity.runtime,
    repo: identity.repo,
    operator: identity.operatorEmail,
    servicePrincipalId: identity.servicePrincipalId,
  });
  // The week's score on its own: grading never depends on another week.
  const [week] = buildScorecard([
    { seq: seq ?? "0", recordedAt: new Date().toISOString(), snapshot: body.snapshot },
  ]).history;
  return {
    recorded,
    // A replay changed nothing, so the route writes no audit row for it.
    noop: !recorded,
    windowStart: body.snapshot.window.start,
    windowEnd: body.snapshot.window.end,
    phase: CURRENT_PHASE,
    overall: week?.overall ?? null,
  };
}
