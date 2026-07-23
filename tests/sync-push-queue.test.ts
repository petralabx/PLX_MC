// TASK-622 — durable outbound push retry queue: transient classification,
// exponential backoff with Retry-After, terminal budget, fail-open ledger.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as { text: string; params: unknown[] }[],
  attemptsToReturn: 1,
  failNext: false,
}));

vi.mock("@/lib/db", () => ({
  query: async (text: string, params: unknown[] = []) => {
    if (db.failNext) throw new Error("db down");
    db.calls.push({ text, params });
    if (text.includes("RETURNING attempts")) return [{ attempts: db.attemptsToReturn }];
    if (text.trimStart().startsWith("SELECT")) {
      return [{ entity_kind: "task", entity_id: "TASK-9" }];
    }
    return [];
  },
}));

import { GraphError } from "@/lib/sync/graph";
import {
  backoffDelayMs,
  BASE_BACKOFF_MS,
  clearPushRetry,
  getDeferredPushSet,
  isTransientGraphFailure,
  MAX_BACKOFF_MS,
  MAX_PUSH_ATTEMPTS,
  pushRetryKey,
  recordTransientPushFailure,
} from "@/lib/sync/push-queue";

beforeEach(() => {
  db.calls.length = 0;
  db.attemptsToReturn = 1;
  db.failNext = false;
});

describe("isTransientGraphFailure", () => {
  it("classifies 429 and 5xx as transient; 4xx and non-Graph errors as not", () => {
    expect(isTransientGraphFailure(new GraphError(503, "svc unavailable", "u"))).toBe(true);
    expect(isTransientGraphFailure(new GraphError(500, "boom", "u"))).toBe(true);
    expect(isTransientGraphFailure(new GraphError(429, "throttled", "u"))).toBe(true);
    expect(isTransientGraphFailure(new GraphError(400, "bad field", "u"))).toBe(false);
    expect(isTransientGraphFailure(new GraphError(404, "gone", "u"))).toBe(false);
    expect(isTransientGraphFailure(new Error("network"))).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("doubles per attempt from one cadence and caps at the max", () => {
    expect(backoffDelayMs(1)).toBe(BASE_BACKOFF_MS);
    expect(backoffDelayMs(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffDelayMs(4)).toBe(BASE_BACKOFF_MS * 8);
    expect(backoffDelayMs(20)).toBe(MAX_BACKOFF_MS);
  });

  it("never schedules earlier than Retry-After", () => {
    expect(backoffDelayMs(1, 30 * 60_000)).toBe(30 * 60_000);
    expect(backoffDelayMs(6, 1000)).toBe(backoffDelayMs(6));
  });
});

describe("recordTransientPushFailure", () => {
  const now = new Date("2026-07-23T12:00:00Z");

  it("upserts the retry row and schedules the next attempt by attempt count", async () => {
    db.attemptsToReturn = 3;
    const record = await recordTransientPushFailure(
      "task",
      "TASK-1",
      new GraphError(503, "unavailable", "u"),
      now
    );
    expect(record).toMatchObject({ attempts: 3, terminal: false });
    expect(Date.parse(record.nextAttemptAt) - now.getTime()).toBe(backoffDelayMs(3));
    const update = db.calls.find((c) => c.text.trimStart().startsWith("UPDATE"));
    expect(update?.params?.[2]).toBe(record.nextAttemptAt);
  });

  it("honors Retry-After on throttling", async () => {
    const record = await recordTransientPushFailure(
      "task",
      "TASK-1",
      new GraphError(429, "throttled", "u", 45 * 60_000),
      now
    );
    expect(Date.parse(record.nextAttemptAt) - now.getTime()).toBe(45 * 60_000);
  });

  it("goes terminal at the attempt budget and clears the row", async () => {
    db.attemptsToReturn = MAX_PUSH_ATTEMPTS;
    const record = await recordTransientPushFailure(
      "risk",
      "RISK-2",
      new GraphError(502, "bad gateway", "u"),
      now
    );
    expect(record.terminal).toBe(true);
    expect(db.calls.some((c) => c.text.trimStart().startsWith("DELETE"))).toBe(true);
  });

  it("fail-open: ledger failure still returns a non-terminal record", async () => {
    db.failNext = true;
    const record = await recordTransientPushFailure(
      "task",
      "TASK-1",
      new GraphError(503, "unavailable", "u"),
      now
    );
    expect(record).toMatchObject({ attempts: 1, terminal: false });
  });
});

describe("getDeferredPushSet / clearPushRetry", () => {
  it("returns kind:id keys for rows still inside their backoff window", async () => {
    const set = await getDeferredPushSet(new Date());
    expect(set.has(pushRetryKey("task", "TASK-9"))).toBe(true);
  });

  it("fail-open: an unavailable ledger yields an empty deferred set", async () => {
    db.failNext = true;
    const set = await getDeferredPushSet(new Date());
    expect(set.size).toBe(0);
  });

  it("clearPushRetry deletes and never throws", async () => {
    await clearPushRetry("task", "TASK-9");
    expect(db.calls.some((c) => c.text.trimStart().startsWith("DELETE"))).toBe(true);
    db.failNext = true;
    await expect(clearPushRetry("task", "TASK-9")).resolves.toBeUndefined();
  });
});
