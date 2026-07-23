// POST/GET /api/sync/webhook — Microsoft Graph change-notification callback (P11).
// Validation handshake: return validationToken as plaintext (Response pass-through).
// Notifications: verify clientState + subscription/resource, enqueue scoped-delta
// work, respond immediately — never run a sweep inline.
// Default-off via PLX_MC_GRAPH_WEBHOOK_ENABLED + clientState/notification URL.

import { after } from "next/server";

import { ApiError, route } from "@/lib/api/route";
import {
  graphInlineDrainEnabled,
  graphWebhookClientState,
  graphWebhookConfigured,
  graphWebhookEnabled,
} from "@/lib/secrets";
import {
  enqueueNotifications,
  processNotificationQueue,
  type GraphNotificationItem,
} from "@/lib/sync/notification-queue";

export const dynamic = "force-dynamic";

function validationTokenFrom(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("validationToken");
  return fromQuery && fromQuery.length > 0 ? fromQuery : null;
}

function parseNotifications(body: unknown): GraphNotificationItem[] {
  if (!body || typeof body !== "object") return [];
  const value = (body as { value?: unknown }).value;
  if (!Array.isArray(value)) return [];
  const out: GraphNotificationItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const n = raw as Record<string, unknown>;
    if (typeof n.subscriptionId !== "string" || typeof n.resource !== "string") continue;
    out.push({
      subscriptionId: n.subscriptionId,
      resource: n.resource,
      clientState: typeof n.clientState === "string" ? n.clientState : undefined,
      changeType: typeof n.changeType === "string" ? n.changeType : undefined,
      resourceData:
        n.resourceData && typeof n.resourceData === "object"
          ? (n.resourceData as GraphNotificationItem["resourceData"])
          : undefined,
    });
  }
  return out;
}

async function handleWebhook(req: Request) {
  const token = validationTokenFrom(req);
  if (token) {
    // Graph requires the exact token as text/plain — not the JSON envelope.
    return new Response(token, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (!graphWebhookEnabled() || !graphWebhookConfigured()) {
    throw new ApiError(
      "webhook_disabled",
      "Graph webhook is not enabled or not configured (default-off).",
      503
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    throw new ApiError("invalid_json", "Webhook body must be valid JSON.", 400);
  }

  const notifications = parseNotifications(payload);
  if (!notifications.length) {
    return { accepted: 0, duplicates: 0, rejected: 0 };
  }

  const result = await enqueueNotifications(notifications, {
    expectedClientState: graphWebhookClientState(),
  });
  // Immediate ack; the queue drains AFTER the response is sent (TASK-627 —
  // <60s edit-to-UI). Authorization inside the drain is the durable
  // sp_sync_inbound principal, same as the cron path, which stays recovery.
  if (result.accepted > 0 && graphInlineDrainEnabled()) {
    const drain = async () => {
      try {
        const drained = await processNotificationQueue();
        console.log(
          `[sync] inline notification drain — processed=${drained.processed} failed=${drained.failed}`
        );
      } catch (err) {
        console.error(
          "[sync] inline notification drain failed (cron drain remains): %s",
          err instanceof Error ? err.message : String(err)
        );
      }
    };
    try {
      after(drain);
    } catch {
      // Outside a Next request scope (tests / direct invocation): still drain,
      // fire-and-forget.
      void drain();
    }
  }
  return {
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected: result.rejected,
  };
}

export const GET = route(handleWebhook);
export const POST = route(handleWebhook);
