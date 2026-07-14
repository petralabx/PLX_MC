// GitHub Actions OIDC verifier for compliance verify + routing propose.
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
  /** Numeric GitHub repository id when present on the token. */
  repositoryId: string | null;
  sub: string;
  iss: string;
  aud: string | string[];
  eventName: string | null;
  ref: string | null;
  sha: string | null;
  jobWorkflowRef: string | null;
  workflowRef: string | null;
  runId: string | null;
  repositoryOwner: string | null;
};

export type VerifyGitHubActionsOidcResult =
  | { ok: true; claims: GitHubActionsOidcClaims }
  | { ok: false; reason: string };

/** Submitted metadata that must bind tightly to verified OIDC claims. */
export interface ProposeOidcBindingInput {
  /** Full owner/repo name (e.g. petralabx/PLX_MC). */
  repository: string;
  /** Durable numeric repository id (string or number). */
  repositoryId: string | number;
  /** Must be pull_request. */
  eventName: string;
  prNumber: number;
  /** Head SHA of the PR. */
  headSha: string;
  /** Optional merge commit SHA (closed+merged). */
  mergeSha?: string | null;
  /** Optional head ref (refs/heads/... or branch name). */
  headRef?: string | null;
  /** Workflow ref the job claims to run (must match approved allowlist when set). */
  workflowRef?: string | null;
}

export type BindOidcProposeResult =
  | { ok: true }
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

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function claimString(payload: Record<string, unknown>, key: string): string | null {
  return asOptionalString(payload[key]);
}

/** Approved workflow refs for routing propose (comma-separated env, optional). */
export function approvedRoutingWorkflowRefs(): string[] {
  const raw = process.env.PLX_MC_ROUTING_OIDC_WORKFLOW_REFS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

  const repositoryIdRaw = payload.repository_id;
  const repositoryId =
    typeof repositoryIdRaw === "number" || typeof repositoryIdRaw === "string"
      ? String(repositoryIdRaw)
      : null;

  return {
    ok: true,
    claims: {
      repository: repositoryClaim,
      repositoryId,
      sub,
      iss,
      aud: normalizeAud(payload.aud),
      eventName: claimString(payload, "event_name"),
      ref: claimString(payload, "ref"),
      sha: claimString(payload, "sha"),
      jobWorkflowRef: claimString(payload, "job_workflow_ref"),
      workflowRef: claimString(payload, "workflow_ref"),
      runId: claimString(payload, "run_id"),
      repositoryOwner: claimString(payload, "repository_owner"),
    },
  };
}

/**
 * Bind verified OIDC claims to the submitted propose payload.
 * Rejects fork/cross-repository mismatch, wrong event, ref/SHA drift, and
 * unapproved workflow refs when an allowlist is configured.
 */
export function bindOidcClaimsToPropose(
  claims: GitHubActionsOidcClaims,
  submitted: ProposeOidcBindingInput
): BindOidcProposeResult {
  const submittedRepo = submitted.repository.trim();
  if (!submittedRepo || claims.repository !== submittedRepo) {
    return { ok: false, reason: "repository_mismatch" };
  }

  // Fork / cross-repo: sub must be repo:OWNER/NAME:… for the same repository.
  const subRepo = repositoryFromSub(claims.sub);
  if (subRepo && subRepo !== submittedRepo) {
    return { ok: false, reason: "cross_repository_sub" };
  }
  if (claims.sub.includes(":pull_request_target:") || /:fork\b/i.test(claims.sub)) {
    return { ok: false, reason: "fork_or_untrusted_ref" };
  }
  if (claims.repositoryOwner) {
    const owner = submittedRepo.split("/")[0] ?? "";
    if (owner && claims.repositoryOwner !== owner) {
      return { ok: false, reason: "repository_owner_mismatch" };
    }
  }

  const submittedId = String(submitted.repositoryId);
  if (!submittedId || submittedId === "undefined" || submittedId === "null") {
    return { ok: false, reason: "missing_repository_id" };
  }
  if (claims.repositoryId != null && claims.repositoryId !== submittedId) {
    return { ok: false, reason: "repository_id_mismatch" };
  }

  const eventName = (submitted.eventName || "").trim();
  if (eventName !== "pull_request") {
    return { ok: false, reason: "event_not_pull_request" };
  }
  if (claims.eventName != null && claims.eventName !== "pull_request") {
    return { ok: false, reason: "oidc_event_mismatch" };
  }

  if (!Number.isInteger(submitted.prNumber) || submitted.prNumber < 1) {
    return { ok: false, reason: "invalid_pr_number" };
  }

  const headSha = submitted.headSha.trim().toLowerCase();
  if (!headSha) {
    return { ok: false, reason: "missing_head_sha" };
  }
  if (claims.sha != null && claims.sha.toLowerCase() !== headSha) {
    // Closed+merged jobs may present merge SHA on the token; accept either.
    const mergeSha = (submitted.mergeSha ?? "").trim().toLowerCase();
    if (!mergeSha || claims.sha.toLowerCase() !== mergeSha) {
      return { ok: false, reason: "sha_mismatch" };
    }
  }

  // PR ref binding: when the token carries ref, it must be the PR merge ref or head.
  if (claims.ref != null) {
    const prMergeRef = `refs/pull/${submitted.prNumber}/merge`;
    const prHeadRef = `refs/pull/${submitted.prNumber}/head`;
    const headRef = (submitted.headRef ?? "").trim();
    const normalizedHead = headRef.startsWith("refs/")
      ? headRef
      : headRef
        ? `refs/heads/${headRef}`
        : "";
    const allowed = new Set(
      [prMergeRef, prHeadRef, normalizedHead].filter((r) => r.length > 0)
    );
    if (!allowed.has(claims.ref)) {
      return { ok: false, reason: "pr_ref_mismatch" };
    }
  }

  const approved = approvedRoutingWorkflowRefs();
  if (approved.length > 0) {
    const workflow =
      submitted.workflowRef?.trim() ||
      claims.jobWorkflowRef ||
      claims.workflowRef ||
      "";
    if (!workflow || !approved.includes(workflow)) {
      return { ok: false, reason: "workflow_ref_not_approved" };
    }
  }

  return { ok: true };
}
