// GET /api/cron/vendor-spend-refresh — scheduled adapter refresh on the
// deployed (Vercel) app, mirroring the sync sweep cron pattern: Vercel injects
// `Authorization: Bearer $CRON_SECRET`; default-off (503) until CRON_SECRET is
// set. Pulls MTD daily so the current month stays fresh; the YTD backfill is
// the seed script's job.

import { ApiError, route } from "@/lib/api/route";
import { secretMatches } from "@/lib/auth/gate";
import { cronConfigured, cronSecret } from "@/lib/secrets";
import { refreshAutomatedVendors } from "@/lib/vendor-spend";

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
  if (!(await secretMatches(req.headers.get("authorization"), cronSecret(), "Bearer "))) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const outcomes = await refreshAutomatedVendors("mtd");
  const degraded = outcomes.filter((o) => o.status !== "ok").length;
  console.log(
    `[vendor-spend] refresh ok — vendors=${outcomes.length} degraded=${degraded}`
  );
  return { outcomes };
});
