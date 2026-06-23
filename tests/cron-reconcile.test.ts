// The scheduled reconcile endpoint (GET /api/cron/reconcile) — its auth
// boundary (EN-007 Step 7). It runs on Vercel Cron with no user session, so the
// CRON_SECRET bearer is its only protection: default-off (503), reject (401),
// run (200). reconcileSweep + the secret accessors are mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  reconcileSweep: vi.fn(),
  cronConfigured: vi.fn(),
  cronSecret: vi.fn(),
}));

vi.mock("@/lib/compliance/service", () => ({ reconcileSweep: m.reconcileSweep }));
vi.mock("@/lib/secrets", () => ({ cronConfigured: m.cronConfigured, cronSecret: m.cronSecret }));

// Imported AFTER the mocks so the route's imports resolve to them.
import { GET } from "@/app/api/cron/reconcile/route";

const ctx = { params: Promise.resolve({}) };
const call = (authHeader?: string) =>
  GET(
    new Request("http://test/api/cron/reconcile", authHeader ? { headers: { authorization: authHeader } } : {}),
    ctx
  );

beforeEach(() => {
  m.reconcileSweep.mockReset().mockResolvedValue({ processed: 0, resolved: 0, failed: 0 });
  m.cronConfigured.mockReset().mockReturnValue(true);
  m.cronSecret.mockReset().mockReturnValue("topsecret");
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/cron/reconcile — auth boundary", () => {
  it("is default-off: 503 when CRON_SECRET is unset, and never reconciles", async () => {
    m.cronConfigured.mockReturnValue(false);
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(503);
    expect((await resp.json()).error.code).toBe("cron_disabled");
    expect(m.reconcileSweep).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer with 401 and never reconciles", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(m.reconcileSweep).not.toHaveBeenCalled();
  });

  it("reconciles on a valid bearer and returns the result envelope", async () => {
    m.reconcileSweep.mockResolvedValue({ processed: 2, resolved: 2, failed: 0 });
    const resp = await call("Bearer topsecret");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ data: { processed: 2, resolved: 2, failed: 0 } });
    expect(m.reconcileSweep).toHaveBeenCalledTimes(1);
  });
});
