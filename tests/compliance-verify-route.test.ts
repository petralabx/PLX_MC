// The compliance verify endpoint (POST /api/compliance/verify) — its CI auth
// boundary (EN-007 review #3). Dual-auth: GitHub Actions OIDC and/or
// COMPLIANCE_CI_TOKEN bearer. Default-off (503), reject (401), run-and-return
// verdict (200). Service + secret accessors + OIDC verifier are mocked so this
// exercises the route's gate without a live DB or JWKS.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  verifyPrOrQueue: vi.fn(),
  complianceCiTokenConfigured: vi.fn(),
  complianceCiToken: vi.fn(),
  complianceOidcEnabled: vi.fn(),
  complianceOidcConfigured: vi.fn(),
  verifyGitHubActionsOidc: vi.fn(),
}));

vi.mock("@/lib/compliance/service", () => ({ verifyPrOrQueue: m.verifyPrOrQueue }));
vi.mock("@/lib/secrets", () => ({
  complianceCiTokenConfigured: m.complianceCiTokenConfigured,
  complianceCiToken: m.complianceCiToken,
  complianceOidcEnabled: m.complianceOidcEnabled,
  complianceOidcConfigured: m.complianceOidcConfigured,
}));
vi.mock("@/lib/compliance/github-oidc", () => ({
  verifyGitHubActionsOidc: m.verifyGitHubActionsOidc,
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
  m.complianceOidcEnabled.mockReset().mockReturnValue(false);
  m.complianceOidcConfigured.mockReset().mockReturnValue(false);
  m.verifyGitHubActionsOidc.mockReset().mockResolvedValue({ ok: false, reason: "invalid_token" });
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/compliance/verify — CI auth boundary", () => {
  it("is default-off: 503 when neither OIDC nor COMPLIANCE_CI_TOKEN configured, and never verifies", async () => {
    m.complianceCiTokenConfigured.mockReturnValue(false);
    m.complianceOidcEnabled.mockReturnValue(false);
    m.complianceOidcConfigured.mockReturnValue(false);
    const resp = await call("Bearer ci-token");
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error.code).toBe("verify_disabled");
    expect(body.error.message).toMatch(/neither OIDC nor COMPLIANCE_CI_TOKEN/i);
    expect(m.verifyPrOrQueue).not.toHaveBeenCalled();
    expect(m.verifyGitHubActionsOidc).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer with 401 and never verifies", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("Basic ci-token")).status).toBe(401);
    expect(m.verifyPrOrQueue).not.toHaveBeenCalled();
  });

  it("verifies on a valid bearer and returns the verdict envelope", async () => {
    const resp = await call("Bearer ci-token");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ data: { verdict: "pass" } });
    expect(m.verifyPrOrQueue).toHaveBeenCalledTimes(1);
  });

  it("verifies on valid OIDC even when bearer is unset", async () => {
    m.complianceCiTokenConfigured.mockReturnValue(false);
    m.complianceOidcEnabled.mockReturnValue(true);
    m.complianceOidcConfigured.mockReturnValue(true);
    m.verifyGitHubActionsOidc.mockResolvedValue({
      ok: true,
      claims: { repository: "org/repo", sub: "repo:org/repo:ref:refs/heads/main", iss: "https://token.actions.githubusercontent.com", aud: "aud" },
    });
    const resp = await call("Bearer oidc-jwt");
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ data: { verdict: "pass" } });
    expect(m.verifyGitHubActionsOidc).toHaveBeenCalledWith("oidc-jwt");
    expect(m.verifyPrOrQueue).toHaveBeenCalledTimes(1);
    expect(m.complianceCiToken).not.toHaveBeenCalled();
  });

  it("verifies on valid OIDC even when bearer is wrong", async () => {
    m.complianceOidcEnabled.mockReturnValue(true);
    m.complianceOidcConfigured.mockReturnValue(true);
    m.verifyGitHubActionsOidc.mockResolvedValue({
      ok: true,
      claims: { repository: "org/repo", sub: "repo:org/repo:ref:refs/heads/main", iss: "https://token.actions.githubusercontent.com", aud: "aud" },
    });
    const resp = await call("Bearer wrong-bearer");
    expect(resp.status).toBe(200);
    expect(m.verifyPrOrQueue).toHaveBeenCalledTimes(1);
  });

  it("falls back to bearer when OIDC fails", async () => {
    m.complianceOidcEnabled.mockReturnValue(true);
    m.complianceOidcConfigured.mockReturnValue(true);
    m.verifyGitHubActionsOidc.mockResolvedValue({ ok: false, reason: "expired" });
    const resp = await call("Bearer ci-token");
    expect(resp.status).toBe(200);
    expect(m.verifyGitHubActionsOidc).toHaveBeenCalledWith("ci-token");
    expect(m.verifyPrOrQueue).toHaveBeenCalledTimes(1);
  });

  it("rejects with 401 when OIDC fails and bearer is wrong", async () => {
    m.complianceOidcEnabled.mockReturnValue(true);
    m.complianceOidcConfigured.mockReturnValue(true);
    m.verifyGitHubActionsOidc.mockResolvedValue({ ok: false, reason: "expired" });
    const resp = await call("Bearer nope");
    expect(resp.status).toBe(401);
    expect((await resp.json()).error.code).toBe("unauthorized");
    expect(m.verifyPrOrQueue).not.toHaveBeenCalled();
  });

  it("rejects with 401 when OIDC fails and bearer is missing", async () => {
    m.complianceCiTokenConfigured.mockReturnValue(false);
    m.complianceOidcEnabled.mockReturnValue(true);
    m.complianceOidcConfigured.mockReturnValue(true);
    m.verifyGitHubActionsOidc.mockResolvedValue({ ok: false, reason: "invalid_token" });
    // Bearer present so we reach OIDC; auth still fails after OIDC + no bearer path
    const resp = await call("Bearer oidc-jwt");
    expect(resp.status).toBe(401);
    expect(m.verifyPrOrQueue).not.toHaveBeenCalled();
  });

  it("skips OIDC when enabled but misconfigured; bearer still works", async () => {
    m.complianceOidcEnabled.mockReturnValue(true);
    m.complianceOidcConfigured.mockReturnValue(false);
    const resp = await call("Bearer ci-token");
    expect(resp.status).toBe(200);
    expect(m.verifyGitHubActionsOidc).not.toHaveBeenCalled();
    expect(m.verifyPrOrQueue).toHaveBeenCalledTimes(1);
  });

  it("is 503 when OIDC disabled/misconfigured and bearer unset", async () => {
    m.complianceCiTokenConfigured.mockReturnValue(false);
    m.complianceOidcEnabled.mockReturnValue(true);
    m.complianceOidcConfigured.mockReturnValue(false);
    const resp = await call("Bearer anything");
    expect(resp.status).toBe(503);
    expect((await resp.json()).error.code).toBe("verify_disabled");
    expect(m.verifyPrOrQueue).not.toHaveBeenCalled();
    expect(m.verifyGitHubActionsOidc).not.toHaveBeenCalled();
  });
});
