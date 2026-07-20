// Repo registry governance (EN-002 / WS-2). Pure predicates + builders over the
// repo allow-list, reused by the client store (lib/mc-data/store.ts) and the
// server task mutation (lib/sync/state.ts) so humans AND agents are bound to the
// SAME allow-list:
//   1. only repos in the registry may be attached to a bucket/task anywhere;
//   2. a new repo joins the registry only through request → approve, and an
//      approval is restricted to an approver (Owner/Admin role);
//   3. a requested repo is validated against the GitHub org at request time —
//      an unverified request stays pending rather than fabricating membership.

import { authorize, directoryRoleToAccessRole } from "@/lib/permissions";

import {
  ALLOWED_REPO_ORGS,
  DEFAULT_NEW_REPO_ORG,
} from "./data";
import type { Actor, Repo, RepoRequest, RepoVisibility } from "./types";

export function isAllowedRepoOrg(owner: string): boolean {
  return (ALLOWED_REPO_ORGS as readonly string[]).includes(owner);
}

export function defaultNewRepoOrg(): string {
  return DEFAULT_NEW_REPO_ORG;
}

// module-shim — remove after 2026-10-14
// Compatibility wrapper: synchronous callers keep calling isApprover(); the
// check now delegates to authorize({ capability: "repo.approve" }).
export function isApprover(actor: Actor | undefined | null): boolean {
  if (!actor || actor.kind !== "human") return false;
  const role = directoryRoleToAccessRole(actor.role);
  if (role !== "owner" && role !== "admin") return false;
  return authorize({
    actor: { kind: "human", id: actor.id, role, status: "active" },
    capability: "repo.approve",
  }).allowed;
}

// Allow-list membership: a repo id may be attached only when it is in the
// registry. The registry is the single allow-list for humans and agents alike.
export function isAllowedRepo(repoId: string, registry: Record<string, Repo>): boolean {
  return repoId in registry;
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

export type ResolveRepoOk = { ok: true; id: string };
export type ResolveRepoErr = { ok: false; message: string };
export type ResolveRepoResult = ResolveRepoOk | ResolveRepoErr;

export type NormalizeReposResult = {
  /** De-duped registry ids in first-seen order. */
  ids: string[];
  /** Original inputs that could not be resolved (fail-closed). */
  rejected: Array<{ input: string; message: string }>;
};

/**
 * Resolve one `repos[]` input to a registry **id**.
 *
 * Accepted forms (case-insensitive, trimmed):
 * 1. exact registry id (`portal-web`)
 * 2. exact registry `name` when unique (`plx-customer-portal`)
 * 3. `owner/name` GitHub slug matching registry `owner` + `name`
 *
 * This is a different namespace from `MC_REPO` / `X-MC-Repo` (full GitHub slug
 * for checkout/compliance). Unknown inputs stay rejected — never invented.
 */
export function resolveRepoInput(raw: string, registry: Record<string, Repo>): ResolveRepoResult {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: "Empty repo reference is not allowed." };
  }
  const key = trimmed.toLowerCase();
  const entries = Object.values(registry);

  for (const repo of entries) {
    if (repo.id.toLowerCase() === key) return { ok: true, id: repo.id };
  }

  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const owner = trimmed.slice(0, slash).toLowerCase();
    const name = trimmed.slice(slash + 1).toLowerCase();
    if (!name || name.includes("/")) {
      return {
        ok: false,
        message: `"${trimmed}" is not a registry id. Use a registry id (e.g. portal-web), a unique name, or owner/name.`,
      };
    }
    const slugMatches = entries.filter(
      (r) => r.owner.toLowerCase() === owner && r.name.toLowerCase() === name
    );
    if (slugMatches.length === 1) return { ok: true, id: slugMatches[0].id };
    if (slugMatches.length > 1) {
      return {
        ok: false,
        message: `"${trimmed}" matches multiple registry repos: ${slugMatches
          .map((r) => r.id)
          .join(", ")}. Use a registry id.`,
      };
    }
    const nameMatches = entries.filter((r) => r.name.toLowerCase() === name);
    if (nameMatches.length === 1) {
      return {
        ok: false,
        message: `"${trimmed}" is not a registry id. Did you mean \`${nameMatches[0].id}\`?`,
      };
    }
    return {
      ok: false,
      message: `"${trimmed}" is not a registry id. These repos are not in the registry: ${trimmed}. Request and get them approved first.`,
    };
  }

  const nameMatches = entries.filter((r) => r.name.toLowerCase() === key);
  if (nameMatches.length === 1) return { ok: true, id: nameMatches[0].id };
  if (nameMatches.length > 1) {
    return {
      ok: false,
      message: `"${trimmed}" matches multiple registry repos: ${nameMatches
        .map((r) => r.id)
        .join(", ")}. Use a registry id or owner/name slug.`,
    };
  }

  const kebab = repoIdFromName(trimmed);
  if (kebab && kebab in registry) {
    return {
      ok: false,
      message: `"${trimmed}" is not a registry id. Did you mean \`${kebab}\`?`,
    };
  }

  return {
    ok: false,
    message: `"${trimmed}" is not a registry id. These repos are not in the registry: ${trimmed}. Request and get them approved first.`,
  };
}

/** Normalize many `repos[]` inputs to registry ids; collect unresolved originals. */
export function normalizeRepoInputs(
  inputs: string[],
  registry: Record<string, Repo>
): NormalizeReposResult {
  const ids: string[] = [];
  const rejected: Array<{ input: string; message: string }> = [];
  const seen = new Set<string>();
  for (const raw of inputs) {
    const resolved = resolveRepoInput(raw, registry);
    if (!resolved.ok) {
      rejected.push({ input: String(raw ?? ""), message: resolved.message });
      continue;
    }
    if (seen.has(resolved.id)) continue;
    seen.add(resolved.id);
    ids.push(resolved.id);
  }
  return { ids, rejected };
}

/** Join reject messages for a 422 `repo_not_allowed` body. */
export function formatRepoNotAllowedMessage(
  rejected: Array<{ input: string; message: string }>
): string {
  if (rejected.length === 0) return "These repos are not in the registry.";
  if (rejected.length === 1) return rejected[0].message;
  return rejected.map((r) => r.message).join(" ");
}

// Inputs that do not resolve to a registry id (after normalize). Originals kept
// so notices can quote what the caller sent.
export function disallowedRepos(repoIds: string[], registry: Record<string, Repo>): string[] {
  return normalizeRepoInputs(repoIds, registry).rejected.map((r) => r.input);
}

// Keep only allow-listed repos, returned as registry **ids** (slugs/names resolved).
export function allowedReposOnly(repoIds: string[], registry: Record<string, Repo>): string[] {
  return normalizeRepoInputs(repoIds, registry).ids;
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
