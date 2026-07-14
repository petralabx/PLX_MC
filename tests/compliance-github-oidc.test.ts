// P6 — OIDC claim binding for routing propose + extended claim extraction.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  complianceOidcConfigured: vi.fn(),
  complianceOidcAudience: vi.fn(),
  complianceOidcRepoAllowlist: vi.fn(),
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  JWTExpired: class JWTExpired extends Error {
    code = "ERR_JWT_EXPIRED";
    constructor(message = "expired") {
      super(message);
      this.name = "JWTExpired";
    }
  },
  JWTClaimValidationFailed: class JWTClaimValidationFailed extends Error {
    code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
    claim: string;
    constructor(message = "claim failed", claim = "aud") {
      super(message);
      this.name = "JWTClaimValidationFailed";
      this.claim = claim;
    }
  },
  JOSEError: class JOSEError extends Error {
    code: string;
    constructor(message = "jose error", code = "ERR_JOSE_GENERIC") {
      super(message);
      this.name = "JOSEError";
      this.code = code;
    }
  },
}));

vi.mock("@/lib/secrets", () => ({
  complianceOidcConfigured: m.complianceOidcConfigured,
  complianceOidcAudience: m.complianceOidcAudience,
  complianceOidcRepoAllowlist: m.complianceOidcRepoAllowlist,
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: m.createRemoteJWKSet,
  jwtVerify: m.jwtVerify,
  errors: {
    JWTExpired: m.JWTExpired,
    JWTClaimValidationFailed: m.JWTClaimValidationFailed,
    JOSEError: m.JOSEError,
  },
}));

import {
  GITHUB_ACTIONS_OIDC_ISSUER,
  bindOidcClaimsToPropose,
  repositoryFromSub,
  verifyGitHubActionsOidc,
  type GitHubActionsOidcClaims,
} from "@/lib/compliance/github-oidc";

const ALLOWED_REPO = "petralabx/PLX_MC";
const AUDIENCE = "plx-mc-compliance-verify";

function configuredOk() {
  m.complianceOidcConfigured.mockReturnValue(true);
  m.complianceOidcAudience.mockReturnValue(AUDIENCE);
  m.complianceOidcRepoAllowlist.mockReturnValue([ALLOWED_REPO]);
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    iss: GITHUB_ACTIONS_OIDC_ISSUER,
    sub: `repo:${ALLOWED_REPO}:ref:refs/pull/42/merge`,
    aud: AUDIENCE,
    repository: ALLOWED_REPO,
    repository_id: "999001",
    event_name: "pull_request",
    ref: "refs/pull/42/merge",
    sha: "abc123def",
    job_workflow_ref: `${ALLOWED_REPO}/.github/workflows/mc-routing-metadata.yml@refs/heads/main`,
    run_id: "555",
    repository_owner: "petralabx",
    ...overrides,
  };
}

function claims(over: Partial<GitHubActionsOidcClaims> = {}): GitHubActionsOidcClaims {
  return {
    repository: ALLOWED_REPO,
    repositoryId: "999001",
    sub: `repo:${ALLOWED_REPO}:ref:refs/pull/42/merge`,
    iss: GITHUB_ACTIONS_OIDC_ISSUER,
    aud: AUDIENCE,
    eventName: "pull_request",
    ref: "refs/pull/42/merge",
    sha: "abc123def",
    jobWorkflowRef: `${ALLOWED_REPO}/.github/workflows/mc-routing-metadata.yml@refs/heads/main`,
    workflowRef: null,
    runId: "555",
    repositoryOwner: "petralabx",
    ...over,
  };
}

beforeEach(() => {
  m.complianceOidcConfigured.mockReset();
  m.complianceOidcAudience.mockReset();
  m.complianceOidcRepoAllowlist.mockReset();
  m.createRemoteJWKSet.mockReset().mockReturnValue(Symbol("jwks"));
  m.jwtVerify.mockReset();
  configuredOk();
  delete process.env.PLX_MC_ROUTING_OIDC_WORKFLOW_REFS;
});

describe("repositoryFromSub", () => {
  it("parses owner/repo from a GitHub Actions sub claim", () => {
    expect(repositoryFromSub(`repo:${ALLOWED_REPO}:ref:refs/heads/main`)).toBe(ALLOWED_REPO);
    expect(repositoryFromSub("not-a-sub")).toBeNull();
  });
});

describe("verifyGitHubActionsOidc", () => {
  it("fail-closed: returns misconfigured when OIDC is not configured", async () => {
    m.complianceOidcConfigured.mockReturnValue(false);
    const result = await verifyGitHubActionsOidc("any-token");
    expect(result).toEqual({ ok: false, reason: "misconfigured" });
    expect(m.jwtVerify).not.toHaveBeenCalled();
  });

  it("rejects garbage / invalid tokens without calling success path", async () => {
    m.jwtVerify.mockRejectedValue(new m.JOSEError("compact serialization", "ERR_JWS_INVALID"));
    const result = await verifyGitHubActionsOidc("not.a.jwt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ERR_JWS_INVALID");
  });

  it("rejects expired tokens", async () => {
    m.jwtVerify.mockRejectedValue(new m.JWTExpired());
    const result = await verifyGitHubActionsOidc("expired.jwt.token");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects wrong audience (jose claim validation)", async () => {
    m.jwtVerify.mockRejectedValue(new m.JWTClaimValidationFailed("unexpected aud", "aud"));
    const result = await verifyGitHubActionsOidc("wrong-aud.jwt");
    expect(result).toEqual({ ok: false, reason: "claim_invalid:aud" });
  });

  it("rejects wrong issuer after verify (defense in depth)", async () => {
    m.jwtVerify.mockResolvedValue({
      payload: payload({ iss: "https://evil.example" }),
      protectedHeader: { alg: "RS256" },
    });
    const result = await verifyGitHubActionsOidc("evil-iss.jwt");
    expect(result).toEqual({ ok: false, reason: "wrong_issuer" });
  });

  it("rejects when repository is not on the allowlist", async () => {
    m.jwtVerify.mockResolvedValue({
      payload: payload({
        repository: "other-org/other-repo",
        sub: "repo:other-org/other-repo:ref:refs/heads/main",
      }),
      protectedHeader: { alg: "RS256" },
    });
    const result = await verifyGitHubActionsOidc("other-repo.jwt");
    expect(result).toEqual({ ok: false, reason: "repo_not_allowlisted" });
  });

  it("happy path: returns extended claims for an allowlisted repo", async () => {
    m.jwtVerify.mockResolvedValue({
      payload: payload(),
      protectedHeader: { alg: "RS256" },
    });
    const result = await verifyGitHubActionsOidc("good.jwt.token");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.repository).toBe(ALLOWED_REPO);
      expect(result.claims.repositoryId).toBe("999001");
      expect(result.claims.eventName).toBe("pull_request");
      expect(result.claims.sha).toBe("abc123def");
      expect(result.claims.ref).toBe("refs/pull/42/merge");
    }
  });

  it("happy path: derives repository from sub when repository claim is absent", async () => {
    m.jwtVerify.mockResolvedValue({
      payload: payload({ repository: undefined }),
      protectedHeader: { alg: "RS256" },
    });
    const result = await verifyGitHubActionsOidc("sub-only.jwt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.repository).toBe(ALLOWED_REPO);
  });
});

describe("bindOidcClaimsToPropose", () => {
  const base = {
    repository: ALLOWED_REPO,
    repositoryId: "999001",
    eventName: "pull_request" as const,
    prNumber: 42,
    headSha: "abc123def",
    headRef: "feat/x",
  };

  it("accepts tightly bound claims", () => {
    expect(bindOidcClaimsToPropose(claims(), base)).toEqual({ ok: true });
  });

  it("rejects cross-repository mismatch", () => {
    expect(
      bindOidcClaimsToPropose(claims(), { ...base, repository: "petralabx/other" })
    ).toEqual({ ok: false, reason: "repository_mismatch" });
  });

  it("rejects repository id mismatch", () => {
    expect(
      bindOidcClaimsToPropose(claims(), { ...base, repositoryId: "111" })
    ).toEqual({ ok: false, reason: "repository_id_mismatch" });
  });

  it("rejects non-pull_request events", () => {
    expect(
      bindOidcClaimsToPropose(claims(), { ...base, eventName: "push" })
    ).toEqual({ ok: false, reason: "event_not_pull_request" });
  });

  it("rejects sha mismatch (replay / drift)", () => {
    expect(
      bindOidcClaimsToPropose(claims(), { ...base, headSha: "zzzz" })
    ).toEqual({ ok: false, reason: "sha_mismatch" });
  });

  it("rejects fork-like sub claims", () => {
    expect(
      bindOidcClaimsToPropose(
        claims({ sub: `repo:${ALLOWED_REPO}:fork` }),
        base
      )
    ).toEqual({ ok: false, reason: "fork_or_untrusted_ref" });
  });

  it("rejects PR ref mismatch", () => {
    expect(
      bindOidcClaimsToPropose(claims({ ref: "refs/heads/main" }), base)
    ).toEqual({ ok: false, reason: "pr_ref_mismatch" });
  });

  it("rejects unapproved workflow refs when allowlist is set", () => {
    process.env.PLX_MC_ROUTING_OIDC_WORKFLOW_REFS =
      "petralabx/PLX_MC/.github/workflows/mc-routing-metadata.yml@refs/heads/main";
    expect(
      bindOidcClaimsToPropose(claims(), {
        ...base,
        workflowRef: "evil/repo/.github/workflows/x.yml@refs/heads/main",
      })
    ).toEqual({ ok: false, reason: "workflow_ref_not_approved" });
  });
});
