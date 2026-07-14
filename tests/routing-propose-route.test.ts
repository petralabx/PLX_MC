// P6 — POST /api/routing/propose route: OIDC auth + claim binding + propose.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  oidcEnabled: true,
  oidcConfigured: true,
  verifyResult: {
    ok: true as boolean,
    claims: {
      repository: "petralabx/PLX_MC",
      repositoryId: "999",
      sub: "repo:petralabx/PLX_MC:ref:refs/pull/42/merge",
      iss: "https://token.actions.githubusercontent.com",
      aud: "plx-mc-compliance-verify",
      eventName: "pull_request",
      ref: "refs/pull/42/merge",
      sha: "abc123",
      jobWorkflowRef: null as string | null,
      workflowRef: null as string | null,
      runId: "77",
      repositoryOwner: "petralabx",
    },
    reason: "" as string,
  },
  bindResult: { ok: true as boolean, reason: "" as string },
  proposeResult: {
    proposalId: "rpp_petralabx_PLX_MC:42",
    revisionId: "rpr_x",
    state: "action_required" as const,
    deepLink: "https://mc.plxcustomer.io/routing?proposal=rpp_x",
    sessionId: null as string | null,
    candidates: [] as unknown[],
    bodyContentHash: "deadbeef",
    policyVersion: "routing.v1",
  },
}));

vi.mock("@/lib/secrets", () => ({
  complianceOidcEnabled: () => m.oidcEnabled,
  complianceOidcConfigured: () => m.oidcConfigured,
}));

vi.mock("@/lib/compliance/github-oidc", () => ({
  verifyGitHubActionsOidc: async () =>
    m.verifyResult.ok
      ? { ok: true, claims: m.verifyResult.claims }
      : { ok: false, reason: m.verifyResult.reason },
  bindOidcClaimsToPropose: () =>
    m.bindResult.ok ? { ok: true } : { ok: false, reason: m.bindResult.reason },
}));

vi.mock("@/lib/compliance/service", () => ({
  proposeRoutingFromPr: async (input: { body?: string }) => {
    // Prove route never requires callers to persist body; service receives it in-memory.
    expect(typeof input.body === "string" || input.body === undefined).toBe(true);
    return m.proposeResult;
  },
}));

import { POST } from "@/app/api/routing/propose/route";

const emptyCtx = { params: Promise.resolve({}) };

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/routing/propose", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

const goodBody = {
  repository: "petralabx/PLX_MC",
  repositoryId: "999",
  eventName: "pull_request",
  action: "opened",
  prNumber: 42,
  headSha: "abc123",
  title: "x",
  body: "in-memory only",
};

beforeEach(() => {
  m.oidcEnabled = true;
  m.oidcConfigured = true;
  m.verifyResult.ok = true;
  m.verifyResult.reason = "";
  m.bindResult.ok = true;
  m.bindResult.reason = "";
});

describe("POST /api/routing/propose", () => {
  it("returns 503 when OIDC is not configured", async () => {
    m.oidcConfigured = false;
    const res = await POST(req(goodBody, "Bearer tok"), emptyCtx);
    expect(res.status).toBe(503);
  });

  it("returns 401 without bearer", async () => {
    const res = await POST(req(goodBody), emptyCtx);
    expect(res.status).toBe(401);
  });

  it("returns 401 when OIDC verify fails", async () => {
    m.verifyResult.ok = false;
    m.verifyResult.reason = "expired";
    const res = await POST(req(goodBody, "Bearer bad"), emptyCtx);
    expect(res.status).toBe(401);
  });

  it("returns 403 when claim binding fails", async () => {
    m.bindResult.ok = false;
    m.bindResult.reason = "repository_mismatch";
    const res = await POST(req(goodBody, "Bearer good"), emptyCtx);
    expect(res.status).toBe(403);
  });

  it("returns proposal envelope on success without echoing raw body", async () => {
    const res = await POST(req(goodBody, "Bearer good"), emptyCtx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data.proposalId).toBe(m.proposeResult.proposalId);
    expect(json.data.state).toBe("action_required");
    expect(json.data.deepLink).toMatch(/routing\?proposal=/);
    expect(JSON.stringify(json)).not.toMatch(/in-memory only/);
  });
});
