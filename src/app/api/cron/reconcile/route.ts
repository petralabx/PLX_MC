// GET /api/cron/reconcile — the scheduled replay of the fail-closed compliance
// reconciliation queue (EN-007 decision 10 / runbook Step 7). Like the sweep
// cron it runs on Vercel Cron (vercel.json) rather than an in-app timer, since
// serverless timers are unreliable (TOOLS.md). Auth is the Vercel-injected
// `Authorization: Bearer $CRON_SECRET`; default-off (503) until CRON_SECRET is
// set. Cheap no-op when the queue is empty — held PR checks (raised during an
// MC/DB outage) replay here and only then clear.

import { ApiError, route } from "@/lib/api/route";
import { reconcileSweep } from "@/lib/compliance/service";
import { cronConfigured, cronSecret } from "@/lib/secrets";

// The compliance service (pg) is Node-only; never cache a reconcile trigger.
export const dynamic = "force-dynamic";
// Replaying a backlog can run several verify/ingest calls; give it headroom.
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled reconcile is not configured (CRON_SECRET unset).", 503);
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const result = await reconcileSweep();
  // Only log when it actually did something — an empty queue is the common case.
  if (result.processed > 0) {
    console.log(
      `[compliance] reconcile ok — processed=${result.processed} resolved=${result.resolved} failed=${result.failed}`
    );
  }
  return result;
});
