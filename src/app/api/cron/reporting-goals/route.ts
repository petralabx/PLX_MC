// GET /api/cron/reporting-goals — the daily Goals & Production refresh at 06:00
// Toronto, Monday to Friday. Vercel Cron runs in UTC, so vercel.json calls this
// at 10:00 and 11:00 UTC on weekdays and only the call that lands at 06:00
// Toronto (EDT or EST) refreshes. Vercel injects `Authorization: Bearer
// $CRON_SECRET`; default-off (503) until CRON_SECRET is set.

import { timingSafeEqual } from "node:crypto";

import { ApiError, route } from "@/lib/api/route";
import { isoWeekday, runRefresh, startRefresh, torontoDate, torontoHour } from "@/lib/reporting/goals";
import { cronConfigured, cronSecret, reportingDatabaseConfigured } from "@/lib/secrets";

export const dynamic = "force-dynamic";
// A 120 s attempt budget plus retries.
export const maxDuration = 300;

const REFRESH_HOUR = 6;

function bearerMatches(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${cronSecret()}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled Goals & production refresh is not configured (CRON_SECRET unset).", 503);
  }
  if (!bearerMatches(req.headers.get("authorization"))) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const now = new Date();
  const today = torontoDate(now);
  const hour = torontoHour(now);
  if (hour !== REFRESH_HOUR || isoWeekday(today) > 5) {
    return { ran: false, reason: "outside_window", today, torontoHour: hour };
  }
  if (!reportingDatabaseConfigured()) {
    console.warn("[reporting-goals] scheduled refresh skipped: REPORTING_DATABASE_URL is not set");
    return { ran: false, reason: "not_configured", today };
  }
  const claim = await startRefresh("cron", "cron", now);
  if (claim.kind !== "claimed") {
    return { ran: false, reason: "already_running", today, runId: claim.run.id };
  }
  const run = await runRefresh(claim.run);
  return { ran: true, today, run };
});
