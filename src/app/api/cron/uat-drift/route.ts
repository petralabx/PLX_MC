// GET /api/cron/uat-drift — the daily portal-vs-Mission Control check of the
// BKT-UAT ticket tasks (TASK-3706). Vercel Cron (vercel.json) with the injected
// `Authorization: Bearer $CRON_SECRET` (unset → 503), plus a kill switch,
// PLX_MC_UAT_DRIFT_CRON_ENABLED (default off), because it writes one
// uat.drift.checked row to mc_events. It never fixes anything.

import { ApiError, route } from "@/lib/api/route";
import { secretMatches } from "@/lib/auth/gate";
import { loadUatTickets, recordUatDriftCheck } from "@/lib/compliance/uat-tickets";
import { cronConfigured, cronSecret, uatDriftCronEnabled } from "@/lib/secrets";

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
  const report = await loadUatTickets();
  await recordUatDriftCheck(report);
  console.log("[uat-drift] ok — tasks=%d findings=%d portal=%s", Object.keys(report.facts).length, report.drift.length, report.portal.status);
  return { enabled: true, findings: report.drift.length, portal: report.portal.status };
});
