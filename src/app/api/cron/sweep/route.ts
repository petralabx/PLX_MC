// GET /api/cron/sweep — the scheduled two-way SharePoint sweep on the deployed
// (Vercel) app. The in-app setInterval scheduler stays OFF on serverless
// (TOOLS.md: timers don't fire reliably there); a Vercel Cron job (vercel.json,
// every 5 min) calls this endpoint instead. Auth is the Vercel-injected
// `Authorization: Bearer $CRON_SECRET`; default-off (503) until CRON_SECRET is
// set. After outer cron admission, writes require durable sp_sync_inbound
// + sync.service.write (P4). Graph webhook delivery remains P11.

import { ApiError, route } from "@/lib/api/route";
import { secretMatches } from "@/lib/auth/gate";
import { cronConfigured, cronSecret } from "@/lib/secrets";
import { requireSyncServiceWrite, runSweep } from "@/lib/sync/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled sweep is not configured (CRON_SECRET unset).", 503);
  }
  if (!(await secretMatches(req.headers.get("authorization"), cronSecret(), "Bearer "))) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const service = await requireSyncServiceWrite();
  const result = await runSweep(service.id);
  console.log(
    `[sync] sweep ok — pushed=${result.pushed} pulled=${result.pulled} conflicts=${result.conflicts} errors=${result.pushErrors}`
  );
  return result;
});
