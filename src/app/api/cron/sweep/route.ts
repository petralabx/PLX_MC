// GET /api/cron/sweep — the scheduled two-way SharePoint sweep on the deployed
// (Vercel) app. The in-app setInterval scheduler stays OFF on serverless
// (TOOLS.md: timers don't fire reliably there); a Vercel Cron job (vercel.json,
// every 5 min) calls this endpoint instead. Auth is the Vercel-injected
// `Authorization: Bearer $CRON_SECRET`; default-off (503) until CRON_SECRET is
// set. Logs the same "[sync] sweep ok …" line the in-app scheduler emits so the
// observability story is identical across both run modes.

import { ApiError, route } from "@/lib/api/route";
import { cronConfigured, cronSecret } from "@/lib/secrets";
import { runSweep } from "@/lib/sync";

// The engine (pg + Graph fetch) is Node-only; never cache a sweep trigger.
export const dynamic = "force-dynamic";
// A sweep walks Graph deltas for two lists and pushes any pending writes; give
// it more than the default serverless budget so a catch-up sweep can't be cut
// off mid-write (Vercel caps this per plan — Pro honors up to 300s).
export const maxDuration = 60;

// The ops persona the in-app scheduler also attributes sweeps to (engine's
// SYNC_ACTOR), so an audited sweep reads identically whichever path ran it.
const CRON_ACTOR = "scribe";

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled sweep is not configured (CRON_SECRET unset).", 503);
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const result = await runSweep(CRON_ACTOR);
  console.log(
    `[sync] sweep ok — pushed=${result.pushed} pulled=${result.pulled} conflicts=${result.conflicts} errors=${result.pushErrors}`
  );
  return result;
});
