// GET /api/cron/missed-tick — the watchdog HTTP entry the GitHub Actions
// scheduler calls. Auth matches the other cron routes. Invocation is a direct
// request: nothing here waits on a Vercel Cron tick.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkMissedTick: vi.fn(),
  cronConfigured: vi.fn(),
  cronSecret: vi.fn(),
}));

vi.mock("@/lib/sync/health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/health")>()),
  checkMissedTick: m.checkMissedTick,
}));
vi.mock("@/lib/secrets", () => ({ cronConfigured: m.cronConfigured, cronSecret: m.cronSecret }));

import { MISSED_TICK_REDUNDANCY_GRACE_MS, MISSED_TICK_THRESHOLD_MS } from "@/lib/sync/health";

import { GET } from "@/app/api/cron/missed-tick/route";

const ctx = { params: Promise.resolve({}) };
const call = (authHeader?: string) =>
  GET(
    new Request("http://test/api/cron/missed-tick", authHeader ? { headers: { authorization: authHeader } } : {}),
    ctx
  );

beforeEach(() => {
  m.checkMissedTick.mockReset().mockResolvedValue({ stale: true, alerted: true, ageMs: 1_800_000 });
  m.cronConfigured.mockReset().mockReturnValue(true);
  m.cronSecret.mockReset().mockReturnValue("topsecret");
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/cron/missed-tick", () => {
  it("is default-off: 503 when CRON_SECRET is unset, and never checks", async () => {
    m.cronConfigured.mockReturnValue(false);
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(503);
    expect((await resp.json()).error.code).toBe("cron_disabled");
    expect(m.checkMissedTick).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer with 401 and never checks", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(m.checkMissedTick).not.toHaveBeenCalled();
  });

  it("runs the watchdog on a direct request (no Vercel Cron header required)", async () => {
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({
      data: { missedTick: { stale: true, alerted: true, ageMs: 1_800_000 } },
    });
    expect(m.checkMissedTick).toHaveBeenCalledWith({ thresholdMs: MISSED_TICK_THRESHOLD_MS });
  });

  it("adds one cadence of grace only when the redundancy workflow observes before sweeping", async () => {
    const resp = await GET(
      new Request("http://test/api/cron/missed-tick?beforeSweep=1", {
        headers: { authorization: "Bearer topsecret" },
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    expect(m.checkMissedTick).toHaveBeenCalledWith({
      thresholdMs: MISSED_TICK_THRESHOLD_MS + MISSED_TICK_REDUNDANCY_GRACE_MS,
    });
  });
});
