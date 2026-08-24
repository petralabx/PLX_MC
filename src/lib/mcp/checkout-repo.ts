// Resolve the GitHub slug bound onto an MCP checkout credential.
// X-MC-Repo / identity.repo is the connector default (Hub → petralabx/PLX_MC,
// Portal → petralabx/plx-customer-portal). Optional `repo` may override that
// default only for reviewed consumer slugs. Unknown slugs fail closed.
// Do not silently default Hub identity to a consumer repo.
//
// This is the checkout/compliance slug namespace (owner/name), not repos[]
// registry ids (portal-web, plx-mc, …).

import { ApiError } from "@/lib/api/route";

export const MCP_CHECKOUT_REPO_ALLOWLIST = ["petralabx/local-inference"] as const;

const GITHUB_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const ALLOWLIST_BY_LOWER = new Map<string, string>(
  MCP_CHECKOUT_REPO_ALLOWLIST.map((slug) => [slug.toLowerCase(), slug])
);

export function resolveCheckoutRepo(identityRepo: string, requestedRepo?: string): string {
  const requested = requestedRepo?.trim() ?? "";
  if (!requested) {
    return identityRepo;
  }
  if (!GITHUB_SLUG_RE.test(requested)) {
    throw new ApiError(
      "invalid_repo",
      "repo must be a full GitHub slug (e.g. petralabx/local-inference).",
      400
    );
  }
  const identity = identityRepo.trim();
  if (requested.toLowerCase() === identity.toLowerCase()) {
    return identity;
  }
  const canonical = ALLOWLIST_BY_LOWER.get(requested.toLowerCase());
  if (!canonical) {
    throw new ApiError(
      "repo_not_allowlisted",
      `repo '${requested}' is not on the MCP checkout allowlist.`,
      403
    );
  }
  return canonical;
}
