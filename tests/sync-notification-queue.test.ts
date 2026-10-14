// P11 — durable scoped-delta queue: dedup, enqueue, authorize-then-process.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";
import { SYNC_INBOUND_SERVICE_PRINCIPAL_ID } from "@/lib/permissions";

type QueueRow = {
  id: number;
  replay_key: string;
  subscription_id: string;
  list_key: string;
  resource: string;
  change_type: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  enqueued_at: Date;
  claimed_at: Date | null;
  processed_at: Date | null;
};

const store = vi.hoisted(() => {
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
  const dedup = new Set<string>();
  const queue: QueueRow[] = [];
  const state = { nextId: 1 };
  return {
    subscriptions,
    dedup,
    queue,
    get nextId() {
      return state.nextId;
    },
    set nextId(v: number) {
      state.nextId = v;
    },
    reset() {
      subscriptions.clear();
      dedup.clear();
      queue.length = 0;
      state.nextId = 1;
    },
  };
});

vi.mock("@/lib/db", () => ({
  async query(text: string, params: unknown[] = []) {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql.includes("FROM graph_subscriptions WHERE id")) {
      const row = store.subscriptions.get(String(params[0]));
      return row ? [row] : [];
    }
    if (sql.startsWith("UPDATE graph_notification_queue") && sql.includes("status = 'done'")) {
      const ids = params[0] as string[];
      for (const row of store.queue) {
        if (ids.includes(String(row.id))) {
          row.status = "done";
          row.processed_at = new Date();
          row.last_error = null;
        }
      }
      return [];
    }
    if (sql.startsWith("UPDATE graph_notification_queue") && sql.includes("status = 'failed'")) {
      const ids = params[0] as string[];
      const err = String(params[1]);
      for (const row of store.queue) {
        if (ids.includes(String(row.id))) {
          row.status = "failed";
          row.processed_at = new Date();
          row.last_error = err;
        }
      }
      return [];
    }
    if (sql.includes("count(*)") && sql.includes("graph_notification_queue")) {
      return [{ n: String(store.queue.filter((q) => q.status === "pending").length) }];
    }
    return [];
  },
  async withTransaction(fn: (q: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<unknown>) {
    const q = async (text: string, params: unknown[] = []) => {
      const sql = text.replace(/\s+/g, " ").trim();
      if (sql.startsWith("INSERT INTO graph_notification_dedup")) {
        const key = String(params[0]);
        if (store.dedup.has(key)) return [];
        store.dedup.add(key);
        return [{ replay_key: key }];
      }
      if (sql.startsWith("INSERT INTO graph_notification_queue")) {
        const replayKey = String(params[0]);
        if (store.queue.some((r) => r.replay_key === replayKey)) return [];
        store.queue.push({
          id: store.nextId++,
          replay_key: replayKey,
          subscription_id: String(params[1]),
          list_key: String(params[2]),
          resource: String(params[3]),
          change_type: (params[4] as string | null) ?? null,
          status: "pending",
          attempts: 0,
          last_error: null,
          enqueued_at: new Date(),
          claimed_at: null,
          processed_at: null,
        });
        return [];
      }
      if (sql.includes("FOR UPDATE SKIP LOCKED") || sql.includes("status = 'pending'")) {
        const limit = Number(params[0] ?? 25);
        return store.queue
          .filter((r) => r.status === "pending")
          .sort((a, b) => a.enqueued_at.getTime() - b.enqueued_at.getTime())
          .slice(0, limit)
          .map((r) => ({
            id: String(r.id),
            list_key: r.list_key,
            replay_key: r.replay_key,
          }));
      }
      if (sql.startsWith("UPDATE graph_notification_queue") && sql.includes("status = 'processing'")) {
        const ids = params[0] as string[];
        for (const row of store.queue) {
          if (ids.includes(String(row.id))) {
            row.status = "processing";
            row.claimed_at = new Date();
            row.attempts += 1;
          }
        }
        return [];
      }
      return [];
    };
    return fn(q);
  },
}));

vi.mock("@/lib/sync/engine", () => ({
  requireSyncServiceWrite: vi.fn(async () => ({
    kind: "service",
    id: SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
    status: "active",
  })),
  runScopedListDelta: vi.fn(async () => ({ pulled: 1, conflicts: 0, skipped: 0, adopted: 0 })),
  runSweep: vi.fn(async () => ({
    pushed: 0,
    pushErrors: 0,
    pulled: 1,
    conflicts: 0,
    skippedInbound: 0,
    counts: {},
    lastSweep: "test",
  })),
}));

import { requireSyncServiceWrite, runScopedListDelta, runSweep } from "@/lib/sync/engine";
import {
  enqueueScopedDelta,
  pendingQueueCount,
  processNotificationQueue,
} from "@/lib/sync/notification-queue";

beforeEach(() => {
  store.reset();
  vi.mocked(requireSyncServiceWrite).mockClear();
  vi.mocked(runSweep).mockReset();
  vi.mocked(runScopedListDelta).mockReset();
  vi.mocked(runScopedListDelta).mockResolvedValue({ pulled: 1, conflicts: 0, skipped: 0, adopted: 0 });
  store.subscriptions.set("sub-1", {
    id: "sub-1",
    list_key: "todos",
    resource: "sites/s/lists/todos",
    notification_url: "https://mc.example/api/sync/webhook",
    expiration_datetime: new Date("2026-07-20T00:00:00.000Z"),
    status: "active",
    created_at: new Date(),
    updated_at: new Date(),
    last_renewed_at: null,
    disabled_at: null,
  });
});

describe("enqueueScopedDelta", () => {
  it("rejects invalid clientState without enqueueing", async () => {
    const result = await enqueueScopedDelta(
      {
        subscriptionId: "sub-1",
        resource: "sites/s/lists/todos",
        clientState: "wrong",
        changeType: "updated",
      },
      { expectedClientState: "right" }
    );
    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("invalid_client_state");
    expect(await pendingQueueCount()).toBe(0);
  });

  it("enqueues once and dedups replay keys on second delivery", async () => {
    const notification = {
      subscriptionId: "sub-1",
      resource: "sites/s/lists/todos",
      clientState: "right",
      changeType: "updated",
      resourceData: { id: "42", "@odata.etag": 'W/"1"' },
    };
    const first = await enqueueScopedDelta(notification, { expectedClientState: "right" });
    expect(first.enqueued).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.listKey).toBe("todos");
    expect(await pendingQueueCount()).toBe(1);

    const second = await enqueueScopedDelta(notification, { expectedClientState: "right" });
    expect(second.enqueued).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await pendingQueueCount()).toBe(1);
  });
});

describe("processNotificationQueue authorization", () => {
  it("processes under durable sync service principal with injectable runner", async () => {
    await enqueueScopedDelta(
      {
        subscriptionId: "sub-1",
        resource: "sites/s/lists/todos",
        clientState: "right",
        changeType: "updated",
        resourceData: { id: "1" },
      },
      { expectedClientState: "right" }
    );
    const runScopedDelta = vi.fn(async () => {});
    const result = await processNotificationQueue({
      runScopedDelta,
      authorize: async () => ({ id: SYNC_INBOUND_SERVICE_PRINCIPAL_ID }),
    });
    expect(result.claimed).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(runScopedDelta).toHaveBeenCalledWith("todos", SYNC_INBOUND_SERVICE_PRINCIPAL_ID);
    expect(runSweep).not.toHaveBeenCalled();
    expect(store.queue[0].status).toBe("done");
  });

  it("skips when authorize denies (no durable SP)", async () => {
    await enqueueScopedDelta(
      {
        subscriptionId: "sub-1",
        resource: "sites/s/lists/todos",
        clientState: "right",
        changeType: "updated",
        resourceData: { id: "2" },
      },
      { expectedClientState: "right" }
    );
    const runScopedDelta = vi.fn(async () => {});
    const result = await processNotificationQueue({
      runScopedDelta,
      authorize: async () => {
        throw new ApiError("forbidden", "denied", 403);
      },
    });
    expect(result.skippedUnauthorized).toBe(true);
    expect(result.processed).toBe(0);
    expect(runScopedDelta).not.toHaveBeenCalled();
    expect(store.queue[0].status).toBe("pending");
  });
});


describe("default notification recovery", () => {
  it("marks the notification failed when both scoped delta and backup sweep fail", async () => {
    await enqueueScopedDelta({ subscriptionId: "sub-1", resource: "sites/s/lists/todos", clientState: "right" }, { expectedClientState: "right" });
    vi.mocked(runScopedListDelta).mockRejectedValueOnce(new Error("scoped failure"));
    vi.mocked(runSweep).mockRejectedValueOnce(new Error("backup failure"));
    const result = await processNotificationQueue();
    expect(result).toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(runSweep).toHaveBeenCalledWith(SYNC_INBOUND_SERVICE_PRINCIPAL_ID);
    expect(store.queue[0]).toMatchObject({ status: "failed", last_error: "backup failure" });
  });
});
