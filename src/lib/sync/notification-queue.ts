// Durable scoped-delta notification work queue (P11).
// Webhook path: verify → enqueue → respond immediately (never runSweep inline).
// Cron path: authorize durable sp_sync_inbound, claim pending rows, process.

import { query, withTransaction } from "@/lib/db";
import { requireSyncServiceWrite, runScopedListDelta, runSweep } from "./engine";
import {
  buildReplayKey,
  verifyNotificationIdentity,
  type StoredSubscription,
} from "./subscriptions";

export type QueueStatus = "pending" | "processing" | "done" | "failed";

export interface GraphNotificationItem {
  subscriptionId: string;
  clientState?: string;
  changeType?: string;
  resource: string;
  resourceData?: {
    id?: string;
    "@odata.etag"?: string;
    [key: string]: unknown;
  };
}

export interface EnqueueResult {
  enqueued: boolean;
  duplicate: boolean;
  replayKey: string;
  listKey?: string;
  reason?: string;
}

export interface ProcessQueueResult {
  claimed: number;
  processed: number;
  failed: number;
  skippedUnauthorized?: boolean;
}

export type ScopedDeltaRunner = (listKey: string, actorId: string) => Promise<void>;

/**
 * Default processor (TASK-627): targeted inbound pull of the notified list.
 * Unknown list keys fall back to one full sweep — the 5-min cron remains the
 * correctness recovery path either way.
 */
export async function defaultScopedDeltaRunner(
  listKey: string,
  actorId: string
): Promise<void> {
  const scoped = await runScopedListDelta(listKey);
  if (scoped == null) {
    await runSweep(actorId);
  }
}

export async function enqueueScopedDelta(
  notification: GraphNotificationItem,
  opts: { expectedClientState?: string } = {}
): Promise<EnqueueResult> {
  const verified = await verifyNotificationIdentity({
    subscriptionId: notification.subscriptionId,
    resource: notification.resource,
    clientState: notification.clientState,
    expectedClientState: opts.expectedClientState,
  });
  if (!verified.ok) {
    return {
      enqueued: false,
      duplicate: false,
      replayKey: "",
      reason: verified.reason,
    };
  }
  const subscription = verified.subscription;
  const replayKey = buildReplayKey({
    subscriptionId: notification.subscriptionId,
    resource: notification.resource,
    changeType: notification.changeType,
    resourceId:
      typeof notification.resourceData?.id === "string"
        ? notification.resourceData.id
        : null,
    etag:
      typeof notification.resourceData?.["@odata.etag"] === "string"
        ? notification.resourceData["@odata.etag"]
        : null,
  });

  return withTransaction(async (q) => {
    const dedup = await q<{ replay_key: string }>(
      `INSERT INTO graph_notification_dedup (replay_key, subscription_id, list_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (replay_key) DO NOTHING
       RETURNING replay_key`,
      [replayKey, subscription.id, subscription.listKey]
    );
    if (!dedup.length) {
      return {
        enqueued: false,
        duplicate: true,
        replayKey,
        listKey: subscription.listKey,
      };
    }
    await q(
      `INSERT INTO graph_notification_queue
         (replay_key, subscription_id, list_key, resource, change_type, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (replay_key) DO NOTHING`,
      [
        replayKey,
        subscription.id,
        subscription.listKey,
        notification.resource,
        notification.changeType ?? null,
      ]
    );
    return {
      enqueued: true,
      duplicate: false,
      replayKey,
      listKey: subscription.listKey,
    };
  });
}

export async function enqueueNotifications(
  notifications: GraphNotificationItem[],
  opts: { expectedClientState?: string } = {}
): Promise<{ accepted: number; duplicates: number; rejected: number; results: EnqueueResult[] }> {
  const results: EnqueueResult[] = [];
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  for (const n of notifications) {
    const result = await enqueueScopedDelta(n, opts);
    results.push(result);
    if (result.enqueued) accepted += 1;
    else if (result.duplicate) duplicates += 1;
    else rejected += 1;
  }
  return { accepted, duplicates, rejected, results };
}

async function claimPending(limit: number): Promise<
  { id: string; list_key: string; replay_key: string }[]
> {
  return withTransaction(async (q) => {
    const rows = await q<{ id: string; list_key: string; replay_key: string }>(
      `SELECT id::text AS id, list_key, replay_key
         FROM graph_notification_queue
        WHERE status = 'pending'
        ORDER BY enqueued_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await q(
      `UPDATE graph_notification_queue
          SET status = 'processing',
              claimed_at = now(),
              attempts = attempts + 1
        WHERE id::text = ANY($1::text[])`,
      [ids]
    );
    return rows;
  });
}

/**
 * Drain pending queue under durable sync service principal. Does not run from
 * the webhook path. Inject `runScopedDelta` in tests to avoid live sweeps.
 */
export async function processNotificationQueue(
  opts: {
    limit?: number;
    runScopedDelta?: ScopedDeltaRunner;
    authorize?: () => Promise<{ id: string }>;
  } = {}
): Promise<ProcessQueueResult> {
  const limit = opts.limit ?? 25;
  const runScopedDelta = opts.runScopedDelta ?? defaultScopedDeltaRunner;
  const authorize = opts.authorize ?? requireSyncServiceWrite;

  let actor: { id: string };
  try {
    actor = await authorize();
  } catch {
    return { claimed: 0, processed: 0, failed: 0, skippedUnauthorized: true };
  }

  const claimed = await claimPending(limit);
  if (!claimed.length) {
    return { claimed: 0, processed: 0, failed: 0 };
  }

  // One sweep covers all notified lists in this batch (engine has no scoped export in P11 owns).
  const uniqueLists = [...new Set(claimed.map((c) => c.list_key))];
  let processed = 0;
  let failed = 0;
  try {
    for (const listKey of uniqueLists) {
      await runScopedDelta(listKey, actor.id);
    }
    const ids = claimed.map((c) => c.id);
    await query(
      `UPDATE graph_notification_queue
          SET status = 'done', processed_at = now(), last_error = NULL
        WHERE id::text = ANY($1::text[])`,
      [ids]
    );
    processed = claimed.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const ids = claimed.map((c) => c.id);
    await query(
      `UPDATE graph_notification_queue
          SET status = 'failed', last_error = $2, processed_at = now()
        WHERE id::text = ANY($1::text[])`,
      [ids, message.slice(0, 500)]
    );
    failed = claimed.length;
  }

  return { claimed: claimed.length, processed, failed };
}

export async function pendingQueueCount(): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM graph_notification_queue WHERE status = 'pending'`
  );
  return Number(rows[0]?.n ?? 0);
}

export type { StoredSubscription };
