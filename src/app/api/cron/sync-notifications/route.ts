// GET /api/cron/sync-notifications — drain the Graph scoped-delta work queue.
// Outer admission: CRON_SECRET bearer. Processing: durable sp_sync_inbound +
// sync.service.write only. Webhook never runs this inline. Five-minute delta
// sweep remains the recovery path when webhooks are disabled.

import { ApiError, route } from "@/lib/api/route";
import { secretMatches } from "@/lib/auth/gate";
import {
  cronConfigured,
  cronSecret,
  graphWebhookConfigured,
  graphWebhookEnabled,
} from "@/lib/secrets";
import { requireSyncServiceWrite } from "@/lib/sync/engine";
import { processNotificationQueue } from "@/lib/sync/notification-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled notification drain is not configured (CRON_SECRET unset).", 503);
  }
  if (!(await secretMatches(req.headers.get("authorization"), cronSecret(), "Bearer "))) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const service = await requireSyncServiceWrite();
  if (!graphWebhookEnabled() || !graphWebhookConfigured()) {
    return {
      actorId: service.id,
      enabled: false,
      claimed: 0,
      processed: 0,
      failed: 0,
    };
  }
  const result = await processNotificationQueue({
    authorize: async () => service,
  });
  console.log(
    `[sync] notification queue ok — actor=${service.id} processed=${result.processed} failed=${result.failed}`
  );
  return {
    actorId: service.id,
    enabled: true,
    claimed: result.claimed,
    processed: result.processed,
    failed: result.failed,
  };
});
