// Model separate SQL statement snapshots and checkout row locks. This exercises
// the real repo functions; without their shared lock, concurrent PRs both win.
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  heads: new Map<string, number | null>(),
  tail: Promise.resolve(),
  outsideTransaction: 0,
  locks: 0,
}));

vi.mock("@/lib/db", () => {
  const statement = async (sql: string, params: unknown[] = []) => {
    const snapshot = new Map(h.heads);
    // Let both unguarded callers take a snapshot before either writes.
    await Promise.resolve();
    const sha = String(params[1]);
    const pr = params[2] as number;
    if (sql.includes("INSERT INTO mc_dispatch_heads")) {
      if (snapshot.has(sha)) return [];
      h.heads.set(sha, params[3] as number | null);
      return [{ seq: "1" }];
    }
    if (sql.includes("UPDATE mc_dispatch_heads")) {
      if (!snapshot.has(sha) || snapshot.get(sha) !== null) return [];
      h.heads.set(sha, pr);
      return [{ pr }];
    }
    if (sql.includes("pr IS NOT NULL")) {
      return [...snapshot.values()].filter((p) => p !== null && p !== params[1]).map((pr) => ({ pr }));
    }
    if (sql.includes("SELECT pr FROM mc_dispatch_heads")) {
      return snapshot.has(sha) ? [{ pr: snapshot.get(sha) }] : [];
    }
    throw new Error("Unexpected SQL in binding regression");
  };
  return {
    query: async (sql: string, params: unknown[]) => {
      h.outsideTransaction++;
      return statement(sql, params);
    },
    withTransaction: async (fn: (q: (sql: string, params?: unknown[]) => Promise<object[]>) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      let locked = false;
      try {
        return await fn(async (sql, params = []) => {
          if (sql.includes("FROM mc_dispatch") && sql.includes("FOR UPDATE")) {
            expect(params).toEqual(["dsp_checkout"]);
            const previous = h.tail;
            h.tail = new Promise<void>((resolve) => { release = resolve; });
            await previous;
            locked = true;
            h.locks++;
            return [{ id: "dsp_checkout" }];
          }
          expect(locked, "Every head read/write must follow the checkout lock").toBe(true);
          return statement(sql, params);
        });
      } finally {
        release?.();
      }
    },
  };
});

import { bindDispatchHeadPr, recordDispatchHead } from "@/lib/compliance/repo";

const bind = (headSha: string, pr: number) => bindDispatchHeadPr({ dispatchId: "dsp_checkout", headSha, pr, recordedBy: "gate" });
const record = (headSha: string, pr: number | null) => recordDispatchHead({ dispatchId: "dsp_checkout", headSha, pr, beforeSha: null, source: "gate", recordedBy: "gate" });
beforeEach(() => {
  h.heads.clear();
  h.tail = Promise.resolve();
  h.outsideTransaction = 0;
  h.locks = 0;
});

it("allows only one PR across concurrent binds of different unbound heads", async () => {
  h.heads.set("a", null);
  h.heads.set("b", null);
  const results = await Promise.all([bind("a", 7), bind("b", 8)]);
  expect(results).toEqual([7, 7]);
  expect([...h.heads.values()]).toEqual([7, null]);
  expect(h.outsideTransaction).toBe(0);
  expect(h.locks).toBe(2);
});

it("serializes head insertion against binding another head", async () => {
  h.heads.set("a", null);
  await Promise.all([bind("a", 7), record("b", 8)]);
  expect([...h.heads.entries()]).toEqual([["a", 7]]);
  expect(await bind("a", 8)).toBe(7);
  expect(h.outsideTransaction).toBe(0);
});

it("serializes concurrent first heads for different PRs", async () => {
  expect(await Promise.all([record("a", 7), record("b", 8)])).toEqual([true, false]);
  expect([...h.heads.entries()]).toEqual([["a", 7]]);
});

it("keeps same-PR insertion and retries idempotent, and permits unbound launcher heads", async () => {
  expect(await record("a", null)).toBe(true);
  expect(await bind("a", 7)).toBe(7);
  expect(await record("b", 7)).toBe(true);
  expect(await record("b", 7)).toBe(false);
  expect(await bind("missing", 7)).toBeNull();
});
