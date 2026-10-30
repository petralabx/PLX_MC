// GET /api/uat-scorecard — the UAT scorecard (TASK-4196): the stored weeks of
// the portal's UAT fix-loop numbers, graded against the team's targets.
// `latest` is the newest closed week, else the newest ended week without a
// final read (lost, or pending), else this week so far; `history` the weekly
// scores, oldest first, with the open weeks last; `rubric` the targets;
// `source` whether the daily pull is on, and, while it is, its newest failure
// of a week it still reads that no later read of that week answers. Optional
// `?weeks=1..52` (default 12) bounds the history. Session-authenticated read.

import { z } from "zod";

import { ApiError, route } from "@/lib/api/route";
import { requireSessionActor } from "@/lib/routing/mutations/actors";
import { cronConfigured, portalBaseUrl, uatDriftCronEnabled, uatPortalReadEnabled } from "@/lib/secrets";
import { buildScorecard, unansweredPullFailure, type ScorecardResponse } from "@/lib/uat-scorecard";
import { listPullFailures, listSnapshots } from "@/lib/uat-scorecard/store";

export const dynamic = "force-dynamic";

const querySchema = z.object({ weeks: z.coerce.number().int().min(1).max(52).default(12) });

export const GET = route(async (req): Promise<ScorecardResponse> => {
  await requireSessionActor("task.read");
  const raw = new URL(req.url).searchParams.get("weeks");
  const parsed = querySchema.safeParse({ weeks: raw === null || raw === "" ? undefined : raw });
  if (!parsed.success) {
    throw new ApiError("invalid_query", "weeks must be an integer 1-52.");
  }
  const now = new Date();
  const [snapshots, failures] = await Promise.all([listSnapshots(), listPullFailures(now)]);
  const scorecard = buildScorecard(snapshots, now);
  const portalRead = uatPortalReadEnabled();
  const dailyCheck = cronConfigured() && uatDriftCronEnabled();
  return {
    ...scorecard,
    history: scorecard.history.slice(-parsed.data.weeks),
    source: {
      portalRead,
      dailyCheck,
      portalOrigin: portalBaseUrl(),
      // While no pull can run, no later read can answer a failure: the source note says why instead.
      lastPullFailure: portalRead && dailyCheck ? unansweredPullFailure(failures, snapshots, now) : null,
    },
  };
});
