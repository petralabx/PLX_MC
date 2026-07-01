// Repo registry governance (EN-002 / WS-2). Pure predicates + builders over the
// repo allow-list, reused by the client store (lib/mc-data/store.ts) and the
// server task mutation (lib/sync/state.ts) so humans AND agents are bound to the
// SAME allow-list:
//   1. only repos in the registry may be attached to a bucket/task anywhere;
//   2. a new repo joins the registry only through request → approve, and an
//      approval is restricted to an approver (Owner/Admin role);
//   3. a requested repo is validated against the GitHub org at request time —
//      an unverified request stays pending rather than fabricating membership.

import {
  ALLOWED_REPO_ORGS,
  DEFAULT_NEW_REPO_ORG,
} from "./data";
import type { Actor, Repo, RepoRequest, RepoVisibility } from "./types";

// Roles that may approve a repo request (mirrors the directory role model from
// EN-003 / WS-1: vince is "Owner"; "Admin" is reserved for future grants).
const APPROVER_ROLES = new Set(["Owner", "Admin"]);

export function isAllowedRepoOrg(owner: string): boolean {
  return (ALLOWED_REPO_ORGS as readonly string[]).includes(owner);
}

export function defaultNewRepoOrg(): string {
  return DEFAULT_NEW_REPO_ORG;
}

export function isApprover(actor: Actor | undefined | null): boolean {
  return !!actor && actor.kind === "human" && APPROVER_ROLES.has(actor.role);
}

// Allow-list membership: a repo id may be attached only when it is in the
// registry. The registry is the single allow-list for humans and agents alike.
export function isAllowedRepo(repoId: string, registry: Record<string, Repo>): boolean {
  return repoId in registry;
}

// The repo ids in `repoIds` that are NOT in the registry (the rejected set).
export function disallowedRepos(repoIds: string[], registry: Record<string, Repo>): string[] {
  return repoIds.filter((id) => !isAllowedRepo(id, registry));
}

// Keep only allow-listed repo ids (used to clamp an attach at the boundary).
export function allowedReposOnly(repoIds: string[], registry: Record<string, Repo>): string[] {
  return repoIds.filter((id) => isAllowedRepo(id, registry));
}

// Deterministic registry id from a requested repo name: lowercase kebab-case,
// matching the existing registry id style (e.g. "PLX_MC" → "plx-mc").
export function repoIdFromName(name: string): string {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Build a registry Repo from an approved request. Honest defaults only: the
// validation-resolved fields (visibility, default branch, language) are used
// when present, never invented.
export function repoFromRequest(req: RepoRequest): Repo {
  const visibility: RepoVisibility = req.visibility ?? "private";
  return {
    id: repoIdFromName(req.name),
    name: req.name,
    lang: req.lang ?? "—",
    def: req.def ?? "main",
    owner: req.owner || DEFAULT_NEW_REPO_ORG,
    visibility,
    scope: req.scope ?? "",
  };
}
