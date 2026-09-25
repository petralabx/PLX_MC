// GET /api/cron/github-backfill[?days=N] — nightly coverage sweep: for every
// fleet registry repo, merged PRs (last N days, default 7) with no MC task link.
// Runs on Vercel Cron (vercel.json) like the other crons; auth is the
// Vercel-injected `Authorization: Bearer $CRON_SECRET`, default-off (503) until
// CRON_SECRET is set. Additionally kill-switched by
// PLX_MC_GITHUB_BACKFILL_ENABLED (default off) because it writes one
// `github.backfill.report` row to mc_events, which the Activity screen reads.
// Fail-open: a degraded repo or a failed report write never fails the run.

import { ApiError, route } from "@/lib/api/route";
import {
  defaultBackfillDeps,
  parseBackfillDays,
  recordBackfillReport,
  runGithubBackfill,
} from "@/lib/compliance/backfill";
import { cronConfigured, cronSecret, githubBackfillEnabled } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled GitHub backfill is not configured (CRON_SECRET unset).", 503);
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  if (!githubBackfillEnabled()) {
    return { enabled: false };
  }
  const days = parseBackfillDays(new URL(req.url).searchParams.get("days"));
  const report = await runGithubBackfill(defaultBackfillDeps(), { days });
  let recorded = true;
  try {
    await recordBackfillReport(report);
  } catch (err) {
    recorded = false;
    console.error(
      "[github-backfill] report write failed: %s",
      err instanceof Error ? err.message : "unknown error"
    );
  }
  console.log(
    "[github-backfill] ok — repos=%d merged=%d unattributed=%d degraded=%d recorded=%s",
    report.repos.length,
    report.totals.merged,
    report.totals.unattributed,
    report.totals.degraded,
    recorded
  );
  return { enabled: true, recorded, report };
});
