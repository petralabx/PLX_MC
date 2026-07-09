// GitHub Actions OIDC verifier for POST /api/compliance/verify.
// Uses jose JWKS + jwtVerify against token.actions.githubusercontent.com.
// Fail-closed when OIDC is enabled but misconfigured. Never log tokens.

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import {
  complianceOidcAudience,
  complianceOidcConfigured,
  complianceOidcRepoAllowlist,
} from "@/lib/secrets";

export const GITHUB_ACTIONS_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_ACTIONS_OIDC_JWKS_URL = new URL(
  "https://token.actions.githubusercontent.com/.well-known/jwks"
);

// Lazy so tests can mock jose before the first verify call (module import
// must not pin a JWKS handle created against the real createRemoteJWKSet).
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) jwks = createRemoteJWKSet(GITHUB_ACTIONS_OIDC_JWKS_URL);
  return jwks;
}

export type GitHubActionsOidcClaims = {
  repository: string;
  sub: string;
  iss: string;
  aud: string | string[];
};

export type VerifyGitHubActionsOidcResult =
  | { ok: true; claims: GitHubActionsOidcClaims }
  | { ok: false; reason: string };

/** Parse owner/repo from a GitHub Actions OIDC `sub` claim when `repository` is absent. */
export function repositoryFromSub(sub: string): string | null {
  // Typical form: repo:ORG/REPO:ref:refs/heads/main (also :environment:, :job_workflow_ref:, …)
  const match = /^repo:([^/]+\/[^:]+):/.exec(sub);
  return match ? match[1] : null;
}

function normalizeAud(aud: unknown): string | string[] {
  if (typeof aud === "string") return aud;
  if (Array.isArray(aud) && aud.every((v) => typeof v === "string")) {
    return aud as string[];
  }
  return "";
}

export async function verifyGitHubActionsOidc(
  token: string
): Promise<VerifyGitHubActionsOidcResult> {
  if (!complianceOidcConfigured()) {
    return { ok: false, reason: "misconfigured" };
  }

  const audience = complianceOidcAudience();
  const allowlist = complianceOidcRepoAllowlist();

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, getJwks(), {
      issuer: GITHUB_ACTIONS_OIDC_ISSUER,
      audience,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    const reason =
      err instanceof joseErrors.JWTExpired
        ? "expired"
        : err instanceof joseErrors.JWTClaimValidationFailed
          ? `claim_invalid:${err.claim ?? "unknown"}`
          : err instanceof joseErrors.JOSEError
            ? err.code ?? "jose_error"
            : "invalid_token";
    return { ok: false, reason };
  }

  const iss = typeof payload.iss === "string" ? payload.iss : "";
  if (iss !== GITHUB_ACTIONS_OIDC_ISSUER) {
    return { ok: false, reason: "wrong_issuer" };
  }

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const repositoryClaim =
    typeof payload.repository === "string" && payload.repository.length > 0
      ? payload.repository
      : repositoryFromSub(sub);

  if (!repositoryClaim) {
    return { ok: false, reason: "missing_repository" };
  }

  if (!allowlist.includes(repositoryClaim)) {
    return { ok: false, reason: "repo_not_allowlisted" };
  }

  return {
    ok: true,
    claims: {
      repository: repositoryClaim,
      sub,
      iss,
      aud: normalizeAud(payload.aud),
    },
  };
}
