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
}

/** Every registry repo, in registry order. */
export const TRACKED_REPOS: readonly TrackedRepo[] = Object.freeze(
  ((trackedReposRegistry as { repos?: Array<{ repo?: unknown; display_name?: unknown }> }).repos ?? [])
    .map((entry) => {
      const repo = typeof entry.repo === "string" ? entry.repo.trim() : "";
      const displayName = typeof entry.display_name === "string" ? entry.display_name : repo;
      return { repo, displayName };
    })
    .filter((entry) => entry.repo.length > 0)
);

/** Every registry repo as its canonical owner/name slug, in registry order. */
export const TRACKED_REPO_SLUGS: readonly string[] = Object.freeze(
  TRACKED_REPOS.map((entry) => entry.repo)
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
