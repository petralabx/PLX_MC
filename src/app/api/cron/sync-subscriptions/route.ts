// GET /api/cron/sync-subscriptions — ensure + renew Graph change-notification
// subscriptions (P11, TASK-626). Outer admission: CRON_SECRET bearer. Writes:
// durable sp_sync_inbound + sync.service.write. Live Graph create/renew is
// double-gated: PLX_MC_GRAPH_SUBSCRIPTIONS_LIVE=1 (env) AND the
// mirror-is-boring gate met (AGENTS.md entry gate, checked at runtime).
// Without both, subscriptions stay local placeholders and the five-minute
// delta sweep remains the correctness backbone.

import { ApiError, route } from "@/lib/api/route";
import {
  cronConfigured,
  cronSecret,
  graphSubscriptionsLive,
  graphWebhookConfigured,
  graphWebhookEnabled,
} from "@/lib/secrets";
import { loadBoringGateFieldsSafe } from "@/lib/sync/boring-gate";
import { requireSyncServiceWrite } from "@/lib/sync/engine";
import {
  ensureAllListSubscriptions,
  renewExpiringSubscriptions,
} from "@/lib/sync/subscriptions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (!cronConfigured()) {
    throw new ApiError("cron_disabled", "Scheduled subscription renewal is not configured (CRON_SECRET unset).", 503);
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret()}`) {
    throw new ApiError("unauthorized", "Invalid or missing cron authorization.", 401);
  }
  const service = await requireSyncServiceWrite();
  if (!graphWebhookEnabled() || !graphWebhookConfigured()) {
    return {
      actorId: service.id,
      enabled: false,
      live: false,
      ensured: 0,
      renewed: 0,
      skipped: 0,
    };
  }
  const boring = await loadBoringGateFieldsSafe();
  const allowLiveGraph = graphSubscriptionsLive() && boring.boringGateMet;
  const ensured = await ensureAllListSubscriptions({ allowLiveGraph });
  const result = await renewExpiringSubscriptions({ allowLiveGraph });
  console.log(
    `[sync] subscriptions ok — actor=${service.id} live=${allowLiveGraph} (flag=${graphSubscriptionsLive()} boringGateMet=${boring.boringGateMet}) ensured=${ensured.filter((e) => e.created).length} renewed=${result.renewed}`
  );
  return {
    actorId: service.id,
    enabled: true,
    live: allowLiveGraph,
    boringGateMet: boring.boringGateMet,
    ensured: ensured.filter((e) => e.created).length,
    ensuredLive: ensured.filter((e) => e.createdLive).length,
    renewed: result.renewed,
    skipped: result.skipped,
  };
});
