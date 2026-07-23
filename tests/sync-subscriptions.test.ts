// P11 — subscription create/renew/disable + identity verification (no live Graph).

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const subscriptions = new Map<
    string,
    {
      id: string;
      list_key: string;
      resource: string;
      notification_url: string;
      expiration_datetime: Date;
      status: string;
      created_at: Date;
      updated_at: Date;
      last_renewed_at: Date | null;
      disabled_at: Date | null;
    }
  >();
  return {
    subscriptions,
    reset() {
      subscriptions.clear();
    },
  };
});

vi.mock("@/lib/db", () => ({
  async query(text: string, params: unknown[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SELECT") && sql.includes("FROM graph_subscriptions WHERE id")) {
      const row = db.subscriptions.get(String(params[0]));
      return row ? [row] : [];
    }
    if (sql.startsWith("SELECT") && sql.includes("status = 'active'") && sql.includes("ORDER BY list_key")) {
      return [...db.subscriptions.values()]
        .filter((r) => r.status === "active")
        .sort((a, b) => a.list_key.localeCompare(b.list_key));
    }
    if (sql.startsWith("SELECT") && sql.includes("expiration_datetime <=")) {
      const cutoff = new Date(String(params[0]));
      return [...db.subscriptions.values()]
        .filter((r) => r.status === "active" && r.expiration_datetime <= cutoff)
        .map((r) => ({ id: r.id, expiration_datetime: r.expiration_datetime }));
    }
    if (sql.startsWith("INSERT INTO graph_subscriptions")) {
      const [id, listKey, resource, notificationUrl, expiration, status] = params as string[];
      const now = new Date();
      const row = {
        id,
        list_key: listKey,
        resource,
        notification_url: notificationUrl,
        expiration_datetime: new Date(expiration),
        status,
        created_at: now,
        updated_at: now,
        last_renewed_at: null as Date | null,
        disabled_at: null as Date | null,
      };
      db.subscriptions.set(id, row);
      return [row];
    }
    if (sql.startsWith("UPDATE graph_subscriptions") && sql.includes("disabled_at")) {
      const row = db.subscriptions.get(String(params[0]));
      if (!row) return [];
      row.status = "disabled";
      row.disabled_at = new Date();
      row.updated_at = new Date();
      return [row];
    }
    if (sql.startsWith("UPDATE graph_subscriptions") && sql.includes("last_renewed_at")) {
      const row = db.subscriptions.get(String(params[0]));
      if (!row || row.status !== "active") return [];
      row.expiration_datetime = new Date(String(params[1]));
      row.last_renewed_at = new Date();
      row.updated_at = new Date();
      return [];
    }
    return [];
  },
}));

import {
  buildListSubscriptionResource,
  defaultSubscriptionExpiry,
} from "@/lib/sync/graph";
import {
  buildReplayKey,
  disableSubscription,
  ensureAllListSubscriptions,
  ensureListSubscription,
  persistSubscription,
  renewExpiringSubscriptions,
  SUBSCRIBED_LIST_KEYS,
  verifyClientState,
  verifyNotificationIdentity,
} from "@/lib/sync/subscriptions";

beforeEach(() => db.reset());

describe("graph subscription helpers (no live Graph)", () => {
  it("builds list resource paths and default expiry under Graph max", () => {
    expect(buildListSubscriptionResource("site-1", "list-9")).toBe("sites/site-1/lists/list-9");
    const exp = new Date(defaultSubscriptionExpiry(new Date("2026-07-14T00:00:00.000Z")));
    expect(exp.getTime()).toBeGreaterThan(Date.parse("2026-07-14T00:00:00.000Z"));
  });

  it("ensureListSubscription persists locally without calling live Graph", async () => {
    const create = vi.fn();
    const { subscription, createdLive } = await ensureListSubscription("todos", {
      enabled: () => true,
      configured: () => true,
      clientState: () => "cs",
      notificationUrl: () => "https://mc.example/api/sync/webhook",
      siteContext: async () => ({ siteId: "site-1", listIds: { todos: "list-todos" } }),
      create,
      allowLiveGraph: false,
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    });
    expect(createdLive).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(subscription.listKey).toBe("todos");
    expect(subscription.resource).toBe("sites/site-1/lists/list-todos");
    expect(subscription.status).toBe("active");
    expect(subscription.id.startsWith("sub_local_todos_")).toBe(true);
  });

  it("renewExpiringSubscriptions updates expiry without live Graph when allowLiveGraph=false", async () => {
    await persistSubscription({
      id: "sub-1",
      listKey: "todos",
      resource: "sites/s/lists/t",
      notificationUrl: "https://mc.example/api/sync/webhook",
      expirationDatetime: "2026-07-14T13:00:00.000Z",
    });
    const renew = vi.fn();
    const result = await renewExpiringSubscriptions({
      enabled: () => true,
      configured: () => true,
      allowLiveGraph: false,
      renew,
      withinMs: 24 * 60 * 60 * 1000,
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    });
    expect(renew).not.toHaveBeenCalled();
    expect(result.renewed).toBe(1);
    const stored = db.subscriptions.get("sub-1")!;
    expect(stored.last_renewed_at).not.toBeNull();
    expect(stored.expiration_datetime.getTime()).toBeGreaterThan(
      Date.parse("2026-07-14T13:00:00.000Z")
    );
  });

  it("disableSubscription marks disabled without live Graph delete", async () => {
    await persistSubscription({
      id: "sub-2",
      listKey: "roadmap",
      resource: "sites/s/lists/r",
      notificationUrl: "https://mc.example/api/sync/webhook",
      expirationDatetime: "2026-07-20T00:00:00.000Z",
    });
    const remove = vi.fn();
    const disabled = await disableSubscription("sub-2", { allowLiveGraph: false, remove });
    expect(remove).not.toHaveBeenCalled();
    expect(disabled?.status).toBe("disabled");
  });
});

describe("clientState + subscription/resource identity", () => {
  it("verifyClientState is timing-safe and rejects mismatches", () => {
    expect(verifyClientState("secret", "secret")).toBe(true);
    expect(verifyClientState("secret", "other")).toBe(false);
    expect(verifyClientState("", "secret")).toBe(false);
    expect(verifyClientState(null, "secret")).toBe(false);
  });

  it("verifyNotificationIdentity requires clientState, active sub, and resource match", async () => {
    await persistSubscription({
      id: "sub-ok",
      listKey: "todos",
      resource: "sites/s/lists/todos",
      notificationUrl: "https://mc.example/api/sync/webhook",
      expirationDatetime: "2026-07-20T00:00:00.000Z",
    });
    const badState = await verifyNotificationIdentity({
      subscriptionId: "sub-ok",
      resource: "sites/s/lists/todos",
      clientState: "wrong",
      expectedClientState: "right",
    });
    expect(badState).toEqual({ ok: false, reason: "invalid_client_state" });

    const badSub = await verifyNotificationIdentity({
      subscriptionId: "missing",
      resource: "sites/s/lists/todos",
      clientState: "right",
      expectedClientState: "right",
    });
    expect(badSub).toEqual({ ok: false, reason: "unknown_subscription" });

    const badRes = await verifyNotificationIdentity({
      subscriptionId: "sub-ok",
      resource: "sites/s/lists/other",
      clientState: "right",
      expectedClientState: "right",
    });
    expect(badRes).toEqual({ ok: false, reason: "resource_mismatch" });

    const ok = await verifyNotificationIdentity({
      subscriptionId: "sub-ok",
      resource: "sites/s/lists/todos",
      clientState: "right",
      expectedClientState: "right",
    });
    expect(ok.ok).toBe(true);
  });

  it("buildReplayKey is stable for identical notification identity parts", () => {
    const a = buildReplayKey({
      subscriptionId: "sub-1",
      resource: "sites/s/lists/t",
      changeType: "updated",
      resourceId: "9",
      etag: 'W/"1"',
    });
    const b = buildReplayKey({
      subscriptionId: "sub-1",
      resource: "sites/s/lists/t",
      changeType: "updated",
      resourceId: "9",
      etag: 'W/"1"',
    });
    expect(a).toBe(b);
    expect(a).toBe(
      createHash("sha256").update("sub-1|sites/s/lists/t|updated|9|W/\"1\"").digest("hex")
    );
  });
});

describe("ensureAllListSubscriptions — P11 go-live (TASK-626)", () => {
  const LIST_IDS = { todos: "lt", risks: "lr", projects: "lp", roadmap: "lm" };

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      enabled: () => true,
      configured: () => true,
      clientState: () => "cs",
      notificationUrl: () => "https://mc.example/api/sync/webhook",
      siteContext: async () => ({ siteId: "site-1", listIds: LIST_IDS }),
      now: () => new Date("2026-07-14T12:00:00.000Z"),
      ...overrides,
    };
  }

  it("creates local placeholders for every subscribed register (idempotent)", async () => {
    const first = await ensureAllListSubscriptions(deps({ allowLiveGraph: false }));
    expect(first).toHaveLength(SUBSCRIBED_LIST_KEYS.length);
    expect(first.every((r) => r.created && !r.createdLive)).toBe(true);

    const second = await ensureAllListSubscriptions(deps({ allowLiveGraph: false }));
    expect(second.every((r) => !r.created)).toBe(true);
  });

  it("live mode replaces local placeholders with real Graph subscriptions", async () => {
    await ensureAllListSubscriptions(deps({ allowLiveGraph: false }));
    let n = 0;
    const create = vi.fn(async (input: { resource: string }) => ({
      id: `sub-live-${(n += 1)}`,
      resource: input.resource,
      changeType: "updated",
      notificationUrl: "https://mc.example/api/sync/webhook",
      expirationDateTime: "2026-07-16T12:00:00.000Z",
      clientState: "cs",
    }));
    const results = await ensureAllListSubscriptions(deps({ allowLiveGraph: true, create }));
    expect(create).toHaveBeenCalledTimes(SUBSCRIBED_LIST_KEYS.length);
    expect(results.every((r) => r.createdLive)).toBe(true);
    // Placeholders were disabled; live rows are the only active ones.
    const live = [...db.subscriptions.values()].filter((r) => r.status === "active");
    expect(live).toHaveLength(SUBSCRIBED_LIST_KEYS.length);
    expect(live.every((r) => r.id.startsWith("sub-live-"))).toBe(true);
  });

  it("live mode keeps existing live subscriptions (no churn)", async () => {
    let n = 0;
    const create = vi.fn(async (input: { resource: string }) => ({
      id: `sub-live-${(n += 1)}`,
      resource: input.resource,
      changeType: "updated",
      notificationUrl: "https://mc.example/api/sync/webhook",
      expirationDateTime: "2026-07-16T12:00:00.000Z",
      clientState: "cs",
    }));
    await ensureAllListSubscriptions(deps({ allowLiveGraph: true, create }));
    create.mockClear();
    const again = await ensureAllListSubscriptions(deps({ allowLiveGraph: true, create }));
    expect(create).not.toHaveBeenCalled();
    expect(again.every((r) => !r.created)).toBe(true);
  });

  it("returns empty when the webhook is disabled or unconfigured", async () => {
    expect(await ensureAllListSubscriptions(deps({ enabled: () => false }))).toEqual([]);
    expect(await ensureAllListSubscriptions(deps({ configured: () => false }))).toEqual([]);
  });
});
