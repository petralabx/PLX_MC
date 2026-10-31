// GET /api/cron/uat-drift — the daily portal-vs-Mission Control check of the
// BKT-UAT ticket tasks (TASK-3706), then the UAT scorecard's pull of last week
// and this week from the portal (TASK-4196). Vercel Cron (vercel.json) with the
// injected `Authorization: Bearer $CRON_SECRET` (unset → 503), plus a kill
// switch, PLX_MC_UAT_DRIFT_CRON_ENABLED (default off), because it writes to
// mc_events: one uat.drift.checked row, up to two uat.scorecard.snapshot rows,
// and a uat.scorecard.pull_failed row for each week whose pull fails, one per
// week per UTC hour. It never fixes anything.

import { ApiError, route } from "@/lib/api/route";
import { secretMatches } from "@/lib/auth/gate";
import { loadUatTickets, recordUatDriftCheck } from "@/lib/compliance/uat-tickets";
import { cronConfigured, cronSecret, uatDriftCronEnabled } from "@/lib/secrets";
import { pullScorecardWeeks } from "@/lib/uat-scorecard/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled UAT drift check is not configured (CRON_SECRET unset).", 503);
  }
  if (!(await secretMatches(req.headers.get("authorization"), cronSecret(), "Bearer "))) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  if (!uatDriftCronEnabled()) return { enabled: false };
  // A failed drift check still fails the run, but only after the scorecard
  // pull, which never throws: each week reads and stores on its own.
  let drift: { findings: number; portal: string } | null = null;
  let driftError: unknown = null;
  try {
    const report = await loadUatTickets();
    await recordUatDriftCheck(report);
    console.log("[uat-drift] ok — tasks=%d findings=%d portal=%s", Object.keys(report.facts).length, report.drift.length, report.portal.status);
    drift = { findings: report.drift.length, portal: report.portal.status };
  } catch (err) {
    driftError = err;
  }
  const scorecard = await pullScorecardWeeks();
  console.log("[uat-drift] scorecard %s — %s", scorecard.status, scorecard.weeks.map((w) => `${w.week}=${w.status}`).join(" "));
  if (!drift) throw driftError;
  return { enabled: true, findings: drift.findings, portal: drift.portal, scorecard };
});
