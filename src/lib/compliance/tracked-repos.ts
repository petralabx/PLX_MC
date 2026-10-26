// Fleet repo registry accessor — config/tracked-repos-registry.json, keyed on
// GitHub owner/name, is the single source of truth for which repos the fleet
// governs. Loaded at build time via a JSON import (works on Vercel; no fs).
// Pure: no I/O. Other repo lists are either derived from this (the Hub MCP
// checkout allowlist) or a legitimate subset (routing pilots, go-live slugs,
// loop-ledgers registry, the MC REPOS seed); tests/tracked-repos-drift.test.ts
// pins every one of them to it with registryDrift().

import trackedReposRegistry from "../../../config/tracked-repos-registry.json";

export interface TrackedRepo {
  /** Canonical owner/name slug. */
  repo: string;
  displayName: string;
  /** Registry enrollment status (`active`, `pending_adoption`, …); "" when absent. */
  status: string;
}

/** Every registry repo, in registry order. */
export const TRACKED_REPOS: readonly TrackedRepo[] = Object.freeze(
  (
    (trackedReposRegistry as {
      repos?: Array<{ repo?: unknown; display_name?: unknown; status?: unknown }>;
    }).repos ?? []
  )
    .map((entry) => {
      const repo = typeof entry.repo === "string" ? entry.repo.trim() : "";
      const displayName = typeof entry.display_name === "string" ? entry.display_name : repo;
      const status = typeof entry.status === "string" ? entry.status : "";
      return { repo, displayName, status };
    })
    .filter((entry) => entry.repo.length > 0)
);

const INTEGRATION_BRANCHES: ReadonlyMap<string, string> = new Map(
  (
    (trackedReposRegistry as { repos?: Array<{ repo?: unknown; integration_branch?: unknown }> }).repos ?? []
  ).flatMap((entry) =>
    typeof entry.repo === "string" && typeof entry.integration_branch === "string" && entry.integration_branch.trim()
      ? [[entry.repo.trim().toLowerCase(), entry.integration_branch.trim()] as const]
      : []
  )
);

/**
 * The branch a task's work must reach before the task counts as merged: the
 * registry's integration_branch (staging for the portal, main for the others).
 * Takes the owner/name slug or the bare repo name that PR events and task.prs
 * rows carry; case is ignored. A slug the registry does not list is matched by
 * its repo name, so a slug and its bare name always agree. A name two registry
 * owners share, or a repo the registry does not list, falls back to "main"
 * (TASK-3797).
 */
export function integrationBranchFor(repo: string): string {
  const key = repo.trim().toLowerCase();
  const exact = INTEGRATION_BRANCHES.get(key);
  if (exact) return exact;
  const name = key.slice(key.lastIndexOf("/") + 1);
  const byName = [...INTEGRATION_BRANCHES].filter(([slug]) => slug.slice(slug.lastIndexOf("/") + 1) === name);
  return byName.length === 1 ? byName[0][1] : "main";
}

/** Every registry repo as its canonical owner/name slug, in registry order. */
export const TRACKED_REPO_SLUGS: readonly string[] = Object.freeze(
  TRACKED_REPOS.map((entry) => entry.repo)
);

/**
 * Registry repos with status === "active" only. Gates that admit work (the Hub
 * MCP checkout allowlist) derive from this so a pending/sandbox entry stays
 * fail-closed; subset drift checks still use the full TRACKED_REPO_SLUGS.
 */
export const ACTIVE_TRACKED_REPO_SLUGS: readonly string[] = Object.freeze(
  TRACKED_REPOS.filter((entry) => entry.status === "active").map((entry) => entry.repo)
);

export interface RegistryDrift {
  /** List entries that are not registry repos (exact owner/name match). */
  unknown: string[];
  /** Registry repos absent from the list — only a failure for a derived list. */
  missing: string[];
  /** List entries that appear more than once. */
  duplicates: string[];
}

/**
 * Compare a repo list against the registry by exact owner/name (canonical
 * casing, so `petralabx/plx_mc` is drift from `petralabx/PLX_MC`). A subset
 * list is healthy when `unknown` and `duplicates` are empty; a derived list is
 * healthy only when all three are empty.
 */
export function registryDrift(
  list: readonly string[],
  registry: readonly string[] = TRACKED_REPO_SLUGS
): RegistryDrift {
  const known = new Set(registry);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const slug of list) {
    if (seen.has(slug) && !duplicates.includes(slug)) duplicates.push(slug);
    seen.add(slug);
  }
  return {
    unknown: [...seen].filter((slug) => !known.has(slug)),
    missing: registry.filter((slug) => !seen.has(slug)),
    duplicates,
  };
}
