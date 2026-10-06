// GET /api/cron/missed-tick — missed-tick watchdog for the independent
// scheduler (TASK-624). GitHub Actions sweep-redundancy.yml calls this route.
// It is deliberately NOT a vercel.json cron: the reconcile cron also evaluates
// health, but that schedule dies with Vercel Cron and would silence the alert.
// Auth matches the other cron routes (`Authorization: Bearer $CRON_SECRET`);
// default-off (503) until CRON_SECRET is set. Fail-open inside checkMissedTick.

import { ApiError, route } from "@/lib/api/route";
import { cronConfigured, cronSecret } from "@/lib/secrets";
import {
  checkMissedTick,
  MISSED_TICK_REDUNDANCY_GRACE_MS,
  MISSED_TICK_THRESHOLD_MS,
} from "@/lib/sync/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError(
      "cron_disabled",
      "Missed-tick watchdog is not configured (CRON_SECRET unset).",
      503
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  // beforeSweep=1 is the redundancy workflow's pre-recovery observation.
  // It keeps the 15-minute cadence from alerting on itself; an extended gap
  // still alerts before the following sweep refreshes the stamps.
  const beforeSweep = new URL(req.url).searchParams.get("beforeSweep") === "1";
  const thresholdMs = beforeSweep
    ? MISSED_TICK_THRESHOLD_MS + MISSED_TICK_REDUNDANCY_GRACE_MS
    : MISSED_TICK_THRESHOLD_MS;
  const missedTick = await checkMissedTick({ thresholdMs });
  if (missedTick.stale) {
    console.error(
      `[sync] missed-tick — last complete sweep ageMs=${missedTick.ageMs ?? "never"} alerted=${missedTick.alerted}`
    );
  }
  return { missedTick };
});
