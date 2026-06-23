// The compliance verify endpoint (POST /api/compliance/verify) — its CI auth
// boundary (EN-007 review #3). It is carved out of the UI session gate, so the
// COMPLIANCE_CI_TOKEN bearer is its only protection: default-off (503), reject
// (401), run-and-return-verdict (200). The service + secret accessors are mocked
// so this exercises the route's gate without a live DB.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  verifyPrOrQueue: vi.fn(),
  complianceCiTokenConfigured: vi.fn(),
  complianceCiToken: vi.fn(),
}));

vi.mock("@/lib/compliance/service", () => ({ verifyPrOrQueue: m.verifyPrOrQueue }));
vi.mock("@/lib/secrets", () => ({
  complianceCiTokenConfigured: m.complianceCiTokenConfigured,
  complianceCiToken: m.complianceCiToken,
}));

// Imported AFTER the mocks so the route's imports resolve to them.
import { POST } from "@/app/api/compliance/verify/route";

const ctx = { params: Promise.resolve({}) };
const reqBody = { repo: "PLX_MC", prNumber: 1, headSha: "abc123", changedPaths: [] };
const call = (authHeader?: string) =>
  POST(
    new Request("http://test/api/compliance/verify", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authHeader ? { authorization: authHeader } : {}) },
      body: JSON.stringify(reqBody),
    }),
    ctx
  );

beforeEach(() => {
  m.verifyPrOrQueue.mockReset().mockResolvedValue({ verdict: "pass", reasons: [] });
  m.complianceCiTokenConfigured.mockReset().mockReturnValue(true);
  m.complianceCiToken.mockReset().mockReturnValue("ci-token");
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/compliance/verify — CI auth boundary", () => {
  it("is default-off: 503 when COMPLIANCE_CI_TOKEN is unset, and never verifies", async () => {
    m.complianceCiTokenConfigured.mockReturnValue(false);
    const resp = await call("Bearer ci-token");
    expect(resp.status).toBe(503);
    expect((await resp.json()).error.code).toBe("verify_disabled");
    expect(m.verifyPrOrQueue).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer with 401 and never verifies", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(m.verifyPrOrQueue).not.toHaveBeenCalled();
  });

  it("verifies on a valid bearer and returns the verdict envelope", async () => {
    const resp = await call("Bearer ci-token");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ data: { verdict: "pass" } });
    expect(m.verifyPrOrQueue).toHaveBeenCalledTimes(1);
  });
});
