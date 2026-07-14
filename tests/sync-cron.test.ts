// The Vercel Cron sweep endpoint (GET /api/cron/sweep) — its auth boundary.
// Outer CRON_SECRET bearer + durable sp_sync_inbound (requireSyncServiceWrite).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  runSweep: vi.fn(),
  requireSyncServiceWrite: vi.fn(),
  cronConfigured: vi.fn(),
  cronSecret: vi.fn(),
}));

vi.mock("@/lib/sync/engine", () => ({
  runSweep: m.runSweep,
  requireSyncServiceWrite: m.requireSyncServiceWrite,
}));
vi.mock("@/lib/secrets", () => ({
  cronConfigured: m.cronConfigured,
  cronSecret: m.cronSecret,
  entraAuthConfigured: () => false,
}));

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
  m.requireSyncServiceWrite.mockReset().mockResolvedValue({
    kind: "service",
    id: "sp_sync_inbound",
    status: "active",
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
    expect(m.requireSyncServiceWrite).toHaveBeenCalledTimes(1);
    expect(m.runSweep).toHaveBeenCalledTimes(1);
    expect(m.runSweep).toHaveBeenCalledWith("sp_sync_inbound");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[sync] sweep ok"));
  });
});
