// The Vercel Cron sweep endpoint (GET /api/cron/sweep) — its auth boundary.
// The in-app setInterval scheduler stays OFF on serverless (TOOLS.md), so the
// deployed app's 5-min cadence runs through this endpoint and its ONLY
// protection is the CRON_SECRET bearer check. These prove default-off (503),
// reject (401), and run-exactly-once (200) without a live DB/Graph — runSweep
// and the secret accessors are mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  runSweep: vi.fn(),
  cronConfigured: vi.fn(),
  cronSecret: vi.fn(),
}));

vi.mock("@/lib/sync", () => ({ runSweep: m.runSweep }));
vi.mock("@/lib/secrets", () => ({ cronConfigured: m.cronConfigured, cronSecret: m.cronSecret }));

// Imported AFTER the mocks so the route's imports resolve to them.
import { GET } from "@/app/api/cron/sweep/route";

const ctx = { params: Promise.resolve({}) };
const call = (authHeader?: string) =>
  GET(
    new Request("http://test/api/cron/sweep", authHeader ? { headers: { authorization: authHeader } } : {}),
    ctx
  );

beforeEach(() => {
  m.runSweep.mockReset().mockResolvedValue({
    pushed: 1,
    pushErrors: 0,
    pulled: 0,
    conflicts: 0,
    skippedInbound: 0,
    counts: {},
    lastSweep: "2026.06.23 · 00:00",
  });
  m.cronConfigured.mockReset().mockReturnValue(true);
  m.cronSecret.mockReset().mockReturnValue("topsecret");
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/cron/sweep — auth boundary", () => {
  it("is default-off: 503 when CRON_SECRET is unset, and never sweeps", async () => {
    m.cronConfigured.mockReturnValue(false);
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(503);
    expect((await resp.json()).error.code).toBe("cron_disabled");
    expect(m.runSweep).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer with 401 and never sweeps", async () => {
    const resp = await call();
    expect(resp.status).toBe(401);
    expect((await resp.json()).error.code).toBe("unauthorized");
    expect(m.runSweep).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer with 401 and never sweeps", async () => {
    const resp = await call("Bearer nope");
    expect(resp.status).toBe(401);
    expect(m.runSweep).not.toHaveBeenCalled();
  });

  it("runs exactly one sweep on a valid bearer and returns the result envelope", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ data: { pushed: 1, pulled: 0, conflicts: 0, pushErrors: 0 } });
    expect(m.runSweep).toHaveBeenCalledTimes(1);
    expect(m.runSweep).toHaveBeenCalledWith("scribe");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[sync] sweep ok"));
  });
});
