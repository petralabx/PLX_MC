// Local filesystem source adapter — DEV-ONLY.
// Reads ledger files from allowlisted paths derived from the registry.
// Refuses to operate when process.env.NODE_ENV === 'production'.
// Rejects path traversal — no path component may be '..'.
//
// This adapter is intentionally simple: it reads each repo's ledger_glob
// directory by scanning the allowlisted root (derived from the glob prefix)
// for files matching the glob pattern.

import { readdir, readFile } from "node:fs/promises";
import { normalize, resolve } from "node:path";

import type { LedgerRef, RegistryConfig, RepoEntry } from "@/lib/loop-ledgers/types";
import type {
  DiscoveredLedger,
  LedgerDetailResult,
  LedgerSource,
  LedgerSourceResult,
} from "./source";

// ─── Path safety ──────────────────────────────────────────────────────────────

/**
 * Returns true if the path (relative or absolute) contains a '..' segment,
 * which could escape the intended root directory.
 */
function hasTraversal(p: string): boolean {
  // Normalize first, then check segments
  const normalized = normalize(p);
  return normalized.split(/[\\/]/).some((seg) => seg === "..");
}

/**
 * Resolve a ledger path against a local root directory, rejecting any path
 * that would escape the root after normalization.
 *
 * Returns null if the path is unsafe.
 */
function safeResolve(root: string, relativePath: string): string | null {
  if (hasTraversal(relativePath)) return null;
  const abs = resolve(root, relativePath);
  const rootAbs = resolve(root);
  if (!abs.startsWith(rootAbs + "/") && abs !== rootAbs) return null;
  return abs;
}

// ─── Glob matching (mirrors github-api.ts) ────────────────────────────────────

function matchGlob(pattern: string, filePath: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*");
  return new RegExp("^" + escaped + "$").test(filePath);
}

/** Extract the directory prefix before the first glob character. */
function globDir(pattern: string): string {
  const idx = pattern.search(/[*?[{]/);
  if (idx === -1) return pattern;
  const slashBefore = pattern.lastIndexOf("/", idx);
  return slashBefore === -1 ? "" : pattern.slice(0, slashBefore);
}

// ─── Per-repo discovery ───────────────────────────────────────────────────────

async function discoverRepoLocal(
  entry: RepoEntry,
  repoRoot: string
): Promise<LedgerSourceResult> {
  const dir = globDir(entry.ledger_glob);
  const dirPath = safeResolve(repoRoot, dir);
  if (!dirPath) {
    return {
      ok: false,
      repo: entry.repo,
      reason: "not_found",
      note: `local path for repo "${entry.repo}" contains unsafe traversal`,
    };
  }

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return {
      ok: false,
      repo: entry.repo,
      reason: "not_found",
      note: `local directory "${dirPath}" not found for repo "${entry.repo}"`,
    };
  }

  const matchingPaths = entries
    .map((name) => (dir ? `${dir}/${name}` : name))
    .filter((p) => matchGlob(entry.ledger_glob, p));

  if (matchingPaths.length === 0) {
    return {
      ok: false,
      repo: entry.repo,
      reason: "no_ledgers",
      note: `local directory "${dirPath}": glob "${entry.ledger_glob}" matched no files`,
    };
  }

  const ledgers: DiscoveredLedger[] = [];
  for (const p of matchingPaths) {
    const absPath = safeResolve(repoRoot, p);
    if (!absPath) continue;
    try {
      const raw = await readFile(absPath, "utf-8");
      ledgers.push({ ref: { repo: entry.repo, branch: entry.default_branch, path: p }, raw });
    } catch {
      // Single file read failure is skipped — repo result is still ok=true with remaining files
    }
  }

  return { ok: true, repo: entry.repo, ledgers };
}

// ─── LocalFsSource ────────────────────────────────────────────────────────────

export interface LocalFsOptions {
  /**
   * Map of "owner/repo" → absolute local directory path.
   * Every registry repo must have an entry here; repos without an entry
   * return a not_found degraded result.
   */
  repoRoots: Record<string, string>;
}

/** Dev-only source adapter that reads ledgers from the local filesystem. */
export class LocalFsSource implements LedgerSource {
  private readonly roots: Record<string, string>;

  constructor(opts: LocalFsOptions) {
    this.roots = opts.repoRoots;
  }

  async listLedgers(registry: RegistryConfig): Promise<LedgerSourceResult[]> {
    if (process.env.NODE_ENV === "production") {
      return registry.repos.map((entry) => ({
        ok: false as const,
        repo: entry.repo,
        reason: "disabled" as const,
        note: "LocalFsSource is disabled in production",
      }));
    }

    return Promise.all(
      registry.repos.map((entry) => {
        const root = this.roots[entry.repo];
        if (!root) {
          return Promise.resolve({
            ok: false as const,
            repo: entry.repo,
            reason: "not_found" as const,
            note: `no local root configured for repo "${entry.repo}"`,
          });
        }
        return discoverRepoLocal(entry, root);
      })
    );
  }

  async getLedger(ref: LedgerRef): Promise<LedgerDetailResult> {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, ref, reason: "disabled", note: "LocalFsSource is disabled in production" };
    }

    const root = this.roots[ref.repo];
    if (!root) {
      return {
        ok: false,
        ref,
        reason: "not_found",
        note: `no local root configured for repo "${ref.repo}"`,
      };
    }

    const absPath = safeResolve(root, ref.path);
    if (!absPath) {
      return {
        ok: false,
        ref,
        reason: "not_found",
        note: `path "${ref.path}" is unsafe (traversal detected)`,
      };
    }

    try {
      const raw = await readFile(absPath, "utf-8");
      return { ok: true, ref, raw };
    } catch {
      return {
        ok: false,
        ref,
        reason: "not_found",
        note: `local file "${absPath}" not found or unreadable`,
      };
    }
  }
}
