// Graph subscription lifecycle (P11): persist create/renew/disable locally and
// call Graph only through injectable seams. Phase acceptance never creates a
// live Graph subscription — tests inject mocks.

import { createHash, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";
import {
  graphNotificationUrl,
  graphWebhookClientState,
  graphWebhookConfigured,
  graphWebhookEnabled,
} from "@/lib/secrets";
import {
  buildListSubscriptionResource,
  createGraphSubscription,
  defaultSubscriptionExpiry,
  deleteGraphSubscription,
  renewGraphSubscription,
  siteContext,
  type GraphSubscription,
  type SiteContext,
} from "./graph";

export type SubscriptionStatus = "active" | "disabled" | "expired";

export interface StoredSubscription {
  id: string;
  listKey: string;
  resource: string;
  notificationUrl: string;
  expirationDatetime: string;
  status: SubscriptionStatus;
  createdAt: string;
  updatedAt: string;
  lastRenewedAt: string | null;
  disabledAt: string | null;
}

export interface GraphSubscriptionDeps {
  enabled?: () => boolean;
  configured?: () => boolean;
  clientState?: () => string;
  notificationUrl?: () => string;
  siteContext?: () => Promise<SiteContext>;
  create?: typeof createGraphSubscription;
  renew?: typeof renewGraphSubscription;
  remove?: typeof deleteGraphSubscription;
  now?: () => Date;
  /** When false, create/renew/disable skip live Graph calls (acceptance default). */
  allowLiveGraph?: boolean;
}

function depsWithDefaults(deps: GraphSubscriptionDeps = {}) {
  return {
    enabled: deps.enabled ?? graphWebhookEnabled,
    configured: deps.configured ?? graphWebhookConfigured,
    clientState: deps.clientState ?? graphWebhookClientState,
    notificationUrl: deps.notificationUrl ?? graphNotificationUrl,
    siteContext: deps.siteContext ?? siteContext,
    create: deps.create ?? createGraphSubscription,
    renew: deps.renew ?? renewGraphSubscription,
    remove: deps.remove ?? deleteGraphSubscription,
    now: deps.now ?? (() => new Date()),
    allowLiveGraph: deps.allowLiveGraph ?? false,
  };
}

function rowToStored(r: {
  id: string;
  list_key: string;
  resource: string;
  notification_url: string;
  expiration_datetime: Date | string;
  status: SubscriptionStatus;
  created_at: Date | string;
  updated_at: Date | string;
  last_renewed_at: Date | string | null;
  disabled_at: Date | string | null;
}): StoredSubscription {
  const iso = (v: Date | string | null): string | null => {
    if (v == null) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  };
  return {
    id: r.id,
    listKey: r.list_key,
    resource: r.resource,
    notificationUrl: r.notification_url,
    expirationDatetime: iso(r.expiration_datetime)!,
    status: r.status,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    lastRenewedAt: iso(r.last_renewed_at),
    disabledAt: iso(r.disabled_at),
  };
}

export async function getSubscriptionById(id: string): Promise<StoredSubscription | null> {
  const rows = await query<{
    id: string;
    list_key: string;
    resource: string;
    notification_url: string;
    expiration_datetime: Date;
    status: SubscriptionStatus;
    created_at: Date;
    updated_at: Date;
    last_renewed_at: Date | null;
    disabled_at: Date | null;
  }>(
    `SELECT id, list_key, resource, notification_url, expiration_datetime, status,
            created_at, updated_at, last_renewed_at, disabled_at
       FROM graph_subscriptions WHERE id = $1`,
    [id]
  );
  return rows[0] ? rowToStored(rows[0]) : null;
}

export async function listActiveSubscriptions(): Promise<StoredSubscription[]> {
  const rows = await query<{
    id: string;
    list_key: string;
    resource: string;
    notification_url: string;
    expiration_datetime: Date;
    status: SubscriptionStatus;
    created_at: Date;
    updated_at: Date;
    last_renewed_at: Date | null;
    disabled_at: Date | null;
  }>(
    `SELECT id, list_key, resource, notification_url, expiration_datetime, status,
            created_at, updated_at, last_renewed_at, disabled_at
       FROM graph_subscriptions
      WHERE status = 'active'
      ORDER BY list_key`
  );
  return rows.map(rowToStored);
}

export async function persistSubscription(row: {
  id: string;
  listKey: string;
  resource: string;
  notificationUrl: string;
  expirationDatetime: string;
  status?: SubscriptionStatus;
}): Promise<StoredSubscription> {
  const status = row.status ?? "active";
  const rows = await query<{
    id: string;
    list_key: string;
    resource: string;
    notification_url: string;
    expiration_datetime: Date;
    status: SubscriptionStatus;
    created_at: Date;
    updated_at: Date;
    last_renewed_at: Date | null;
    disabled_at: Date | null;
  }>(
    `INSERT INTO graph_subscriptions
       (id, list_key, resource, notification_url, expiration_datetime, status, updated_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       list_key = EXCLUDED.list_key,
       resource = EXCLUDED.resource,
       notification_url = EXCLUDED.notification_url,
       expiration_datetime = EXCLUDED.expiration_datetime,
       status = EXCLUDED.status,
       updated_at = now(),
       disabled_at = CASE WHEN EXCLUDED.status = 'disabled' THEN now() ELSE graph_subscriptions.disabled_at END
     RETURNING id, list_key, resource, notification_url, expiration_datetime, status,
               created_at, updated_at, last_renewed_at, disabled_at`,
    [row.id, row.listKey, row.resource, row.notificationUrl, row.expirationDatetime, status]
  );
  return rowToStored(rows[0]);
}

/**
 * Create (or replace local record for) a list subscription. Live Graph create
 * is gated by `allowLiveGraph` — acceptance keeps it false.
 */
export async function ensureListSubscription(
  listKey: string,
  deps: GraphSubscriptionDeps = {}
): Promise<{ subscription: StoredSubscription; createdLive: boolean }> {
  const d = depsWithDefaults(deps);
  if (!d.enabled() || !d.configured()) {
    throw new Error("graph webhook disabled or not configured");
  }
  const ctx = await d.siteContext();
  const listId = ctx.listIds[listKey];
  if (!listId) throw new Error(`unknown list_key ${listKey}`);
  const resource = buildListSubscriptionResource(ctx.siteId, listId);
  const expiration = defaultSubscriptionExpiry(d.now());
  const notificationUrl = d.notificationUrl();
  const clientState = d.clientState();

  let createdLive = false;
  let graphSub: GraphSubscription;
  if (d.allowLiveGraph) {
    graphSub = await d.create({
      resource,
      notificationUrl,
      clientState,
      expirationDateTime: expiration,
    });
    createdLive = true;
  } else {
    // Local-only persistence for tests / acceptance (no live Graph call).
    graphSub = {
      id: `sub_local_${listKey}_${createHash("sha256").update(resource).digest("hex").slice(0, 12)}`,
      resource,
      changeType: "updated",
      notificationUrl,
      expirationDateTime: expiration,
      clientState,
    };
  }

  const subscription = await persistSubscription({
    id: graphSub.id,
    listKey,
    resource: graphSub.resource,
    notificationUrl: graphSub.notificationUrl,
    expirationDatetime: graphSub.expirationDateTime,
    status: "active",
  });
  return { subscription, createdLive };
}

/** Registers covered by change notifications when P11 goes live (TASK-626). */
export const SUBSCRIBED_LIST_KEYS = ["todos", "risks", "projects", "roadmap"] as const;

export interface EnsureAllResult {
  listKey: string;
  created: boolean;
  createdLive: boolean;
  id: string;
}

/**
 * Ensure every subscribed register has an active subscription (TASK-626).
 * Idempotent: an existing active row is kept, except when live Graph is
 * allowed and the row is still a local `sub_local_*` placeholder — that row
 * is disabled and replaced by a real Graph subscription.
 */
export async function ensureAllListSubscriptions(
  deps: GraphSubscriptionDeps & { listKeys?: readonly string[] } = {}
): Promise<EnsureAllResult[]> {
  const d = depsWithDefaults(deps);
  if (!d.enabled() || !d.configured()) return [];
  const listKeys = deps.listKeys ?? SUBSCRIBED_LIST_KEYS;
  const active = await listActiveSubscriptions();
  const results: EnsureAllResult[] = [];
  for (const listKey of listKeys) {
    const existing = active.find((s) => s.listKey === listKey);
    const isLocalPlaceholder = existing?.id.startsWith("sub_local_") ?? false;
    if (existing && !(d.allowLiveGraph && isLocalPlaceholder)) {
      results.push({ listKey, created: false, createdLive: false, id: existing.id });
      continue;
    }
    if (existing && isLocalPlaceholder && d.allowLiveGraph) {
      // Replace the acceptance placeholder with a real Graph subscription.
      await disableSubscription(existing.id, { ...deps, allowLiveGraph: false });
    }
    const { subscription, createdLive } = await ensureListSubscription(listKey, deps);
    results.push({ listKey, created: true, createdLive, id: subscription.id });
  }
  return results;
}

/** Renew subscriptions expiring within `withinMs` (default 12h). */
export async function renewExpiringSubscriptions(
  deps: GraphSubscriptionDeps & { withinMs?: number } = {}
): Promise<{ renewed: number; skipped: number }> {
  const d = depsWithDefaults(deps);
  if (!d.enabled() || !d.configured()) {
    return { renewed: 0, skipped: 0 };
  }
  const withinMs = deps.withinMs ?? 12 * 60 * 60 * 1000;
  const cutoff = new Date(d.now().getTime() + withinMs).toISOString();
  const rows = await query<{ id: string; expiration_datetime: Date }>(
    `SELECT id, expiration_datetime FROM graph_subscriptions
      WHERE status = 'active' AND expiration_datetime <= $1::timestamptz`,
    [cutoff]
  );
  let renewed = 0;
  let skipped = 0;
  for (const row of rows) {
    const nextExpiry = defaultSubscriptionExpiry(d.now());
    if (d.allowLiveGraph) {
      await d.renew(row.id, nextExpiry);
    }
    await query(
      `UPDATE graph_subscriptions
          SET expiration_datetime = $2::timestamptz,
              last_renewed_at = now(),
              updated_at = now()
        WHERE id = $1 AND status = 'active'`,
      [row.id, nextExpiry]
    );
    renewed += 1;
  }
  if (rows.length === 0) skipped = 0;
  return { renewed, skipped };
}

export async function disableSubscription(
  subscriptionId: string,
  deps: GraphSubscriptionDeps = {}
): Promise<StoredSubscription | null> {
  const d = depsWithDefaults(deps);
  const existing = await getSubscriptionById(subscriptionId);
  if (!existing) return null;
  if (d.allowLiveGraph) {
    try {
      await d.remove(subscriptionId);
    } catch {
      // Best-effort Graph delete; local disable still proceeds.
    }
  }
  const rows = await query<{
    id: string;
    list_key: string;
    resource: string;
    notification_url: string;
    expiration_datetime: Date;
    status: SubscriptionStatus;
    created_at: Date;
    updated_at: Date;
    last_renewed_at: Date | null;
    disabled_at: Date | null;
  }>(
    `UPDATE graph_subscriptions
        SET status = 'disabled', disabled_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, list_key, resource, notification_url, expiration_datetime, status,
                created_at, updated_at, last_renewed_at, disabled_at`,
    [subscriptionId]
  );
  return rows[0] ? rowToStored(rows[0]) : null;
}

/** Timing-safe clientState compare against the configured secret. */
export function verifyClientState(
  received: string | undefined | null,
  expected?: string
): boolean {
  const want = expected ?? (() => {
    try {
      return graphWebhookClientState();
    } catch {
      return "";
    }
  })();
  if (!received || !want) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a notification against a stored active subscription: clientState,
 * subscription id, and resource identity must all match.
 */
export async function verifyNotificationIdentity(input: {
  subscriptionId: string;
  resource: string;
  clientState?: string | null;
  expectedClientState?: string;
}): Promise<{ ok: true; subscription: StoredSubscription } | { ok: false; reason: string }> {
  if (!verifyClientState(input.clientState, input.expectedClientState)) {
    return { ok: false, reason: "invalid_client_state" };
  }
  const subscription = await getSubscriptionById(input.subscriptionId);
  if (!subscription || subscription.status !== "active") {
    return { ok: false, reason: "unknown_subscription" };
  }
  if (subscription.resource !== input.resource) {
    return { ok: false, reason: "resource_mismatch" };
  }
  return { ok: true, subscription };
}

export function buildReplayKey(parts: {
  subscriptionId: string;
  resource: string;
  changeType?: string | null;
  resourceId?: string | null;
  etag?: string | null;
}): string {
  const raw = [
    parts.subscriptionId,
    parts.resource,
    parts.changeType ?? "",
    parts.resourceId ?? "",
    parts.etag ?? "",
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}
