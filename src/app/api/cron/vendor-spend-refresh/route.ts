// GET /api/cron/vendor-spend-refresh — scheduled adapter refresh on the
// deployed (Vercel) app, mirroring the sync sweep cron pattern: Vercel injects
// `Authorization: Bearer $CRON_SECRET`; default-off (503) until CRON_SECRET is
// set. Pulls MTD daily so the current month stays fresh. `?period=` (any
// spend period) is the seed script's YTD backfill path: the session-gated
// POST /api/vendor-spend/refresh needs an Entra session (TASK-3011).

import { ApiError, route } from "@/lib/api/route";
import { cronConfigured, cronSecret } from "@/lib/secrets";
import { refreshAutomatedVendors, SPEND_PERIODS, type SpendPeriod } from "@/lib/vendor-spend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError(
      "cron_disabled",
      "Scheduled vendor-spend refresh is not configured (CRON_SECRET unset).",
      503
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const period = new URL(req.url).searchParams.get("period") ?? "mtd";
  if (!(SPEND_PERIODS as readonly string[]).includes(period)) {
    throw new ApiError("invalid_request", `Unknown period "${period}" (expected ${SPEND_PERIODS.join("|")}).`, 400);
  }
  const outcomes = await refreshAutomatedVendors(period as SpendPeriod);
  const degraded = outcomes.filter((o) => o.status !== "ok").length;
  console.log(
    `[vendor-spend] refresh ok — vendors=${outcomes.length} degraded=${degraded}`
  );
  return { outcomes };
});
