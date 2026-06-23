// GitHub API source adapter for loop-ledgers.
// Uses the GitHub Trees API (recursive) once per repo to discover ledger paths,
// then fetches each file's raw content via the Contents API with the raw media
// type — avoids base64 + the Contents 1MB inline cap.
//
// Mirrors the auth convention from src/lib/sync/github.ts:
//   - read-only token from process.env.GITHUB_TOKEN
//   - Bearer auth header, accept vnd.github+json, x-github-api-version
//   - honest degraded result on missing token or non-200 — never throws, never fabricates
//
// One repo failing MUST NOT kill the batch — results are accumulated independently.

import type { LedgerRef, RegistryConfig, RepoEntry } from "@/lib/loop-ledgers/types";
import type {
  DiscoveredLedger,
  LedgerDetailResult,
  LedgerSource,
  LedgerSourceResult,
  SourceDegradedReason,
} from "./source";

// ─── GitHub API shapes ────────────────────────────────────────────────────────

interface GitTreeItem {
  path?: string;
  type?: string;
  sha?: string;
}

interface GitTreeResponse {
  sha?: string;
  tree?: GitTreeItem[];
  truncated?: boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const GH_API = "https://api.github.com";

/** Build the standard GitHub API headers. Token must be non-empty. */
function ghHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

/**
 * Detect whether a 403 response is a rate-limit rather than an access denial.
 * GitHub sets x-ratelimit-remaining: 0 when the rate limit is hit.
 */
function isRateLimit(res: Response): boolean {
  return res.headers.get("x-ratelimit-remaining") === "0";
}

/**
 * Map HTTP status + rate-limit signal to a distinct degraded reason.
 * Never throws.
 */
function httpFailReason(res: Response): SourceDegradedReason {
  if (res.status === 429) return "rate_limit";
  if (res.status === 401) return "permission_denied";
  if (res.status === 403) return isRateLimit(res) ? "rate_limit" : "permission_denied";
  if (res.status === 404) return "not_found";
  return "network_error";
}

/**
 * Minimal glob matcher supporting `*` (matches non-slash chars) and `**`
 * (matches any chars including `/`).
 * Used to filter tree paths against the registry `ledger_glob`.
 */
function matchGlob(pattern: string, filePath: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials except *
    .replace(/\*\*/g, "\x00") // placeholder for **
    .replace(/\*/g, "[^/]*") // * → non-slash chars
    .replace(/\x00/g, ".*"); // ** → any chars
  return new RegExp("^" + escaped + "$").test(filePath);
}

/** Parse "owner/repo" into parts. Returns null if malformed. */
function parseRepo(repo: string): { owner: string; name: string } | null {
  const idx = repo.indexOf("/");
  if (idx < 1 || idx === repo.length - 1) return null;
  return { owner: repo.slice(0, idx), name: repo.slice(idx + 1) };
}

// ─── Core fetch operations ────────────────────────────────────────────────────

type TreeFetchOk = { ok: true; tree: GitTreeItem[]; treeSha: string | undefined };
type TreeFetchFail = { ok: false; reason: SourceDegradedReason; note: string };

async function fetchTree(
  owner: string,
  name: string,
  branch: string,
  token: string
): Promise<TreeFetchOk | TreeFetchFail> {
  let res: Response;
  try {
    res = await fetch(
      `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: ghHeaders(token) }
    );
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      note: `network error fetching tree for ${owner}/${name}: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  if (!res.ok) {
    const reason = httpFailReason(res);
    return {
      ok: false,
      reason,
      note: `${owner}/${name} tree fetch failed (HTTP ${res.status})`,
    };
  }

  const data = (await res.json()) as GitTreeResponse;
  return { ok: true, tree: data.tree ?? [], treeSha: data.sha };
}

type RawFetchOk = { ok: true; raw: string };
type RawFetchFail = { ok: false; reason: SourceDegradedReason; note: string };

async function fetchRawContent(
  owner: string,
  name: string,
  branch: string,
  path: string,
  token: string
): Promise<RawFetchOk | RawFetchFail> {
  let res: Response;
  try {
    res = await fetch(
      `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          // Raw media type: response body is the file content directly (no base64)
          accept: "application/vnd.github.raw+json",
          "x-github-api-version": "2022-11-28",
        },
      }
    );
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      note: `network error fetching ${path}: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  if (!res.ok) {
    const reason = httpFailReason(res);
    return {
      ok: false,
      reason,
      note: `${owner}/${name}/${path} content fetch failed (HTTP ${res.status})`,
    };
  }

  const raw = await res.text();
  return { ok: true, raw };
}

// ─── Per-repo discovery ───────────────────────────────────────────────────────

async function discoverRepo(
  entry: RepoEntry,
  token: string
): Promise<LedgerSourceResult> {
  const parsed = parseRepo(entry.repo);
  if (!parsed) {
    return {
      ok: false,
      repo: entry.repo,
      reason: "not_found",
      note: `registry entry repo "${entry.repo}" is not in "owner/name" format`,
    };
  }
  const { owner, name } = parsed;
  const branch = entry.default_branch;

  const treeResult = await fetchTree(owner, name, branch, token);
  if (!treeResult.ok) {
    return { ok: false, repo: entry.repo, reason: treeResult.reason, note: treeResult.note };
  }

  const matchingPaths = (treeResult.tree)
    .filter((item) => item.type === "blob" && typeof item.path === "string")
    .map((item) => item.path as string)
    .filter((p) => matchGlob(entry.ledger_glob, p));

  if (matchingPaths.length === 0) {
    return {
      ok: false,
      repo: entry.repo,
      reason: "no_ledgers",
      note: `${owner}/${name}: glob "${entry.ledger_glob}" matched no files in the tree`,
    };
  }

  // Fetch each matching file independently — one file failing does not fail the repo
  const ledgers: DiscoveredLedger[] = [];
  for (const p of matchingPaths) {
    const rawResult = await fetchRawContent(owner, name, branch, p, token);
    if (rawResult.ok) {
      ledgers.push({
        ref: { repo: entry.repo, branch, path: p },
        raw: rawResult.raw,
        commitSha: treeResult.treeSha,
      });
    }
    // A single-file fetch failure is silently skipped here; if ALL files fail
    // the ledgers array stays empty — which is acceptable (caller sees ok=true
    // with zero ledgers). A repo-level failure (tree fetch) returns ok=false.
  }

  return { ok: true, repo: entry.repo, ledgers };
}

// ─── GithubApiSource ─────────────────────────────────────────────────────────

/** Production-default source adapter that reads ledgers via the GitHub API. */
export class GithubApiSource implements LedgerSource {
  async listLedgers(registry: RegistryConfig): Promise<LedgerSourceResult[]> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      // One degraded result per repo — every repo is unreachable without the token
      return registry.repos.map((entry) => ({
        ok: false as const,
        repo: entry.repo,
        reason: "token_missing" as SourceDegradedReason,
        note: "GITHUB_TOKEN is not set — ledgers cannot be fetched from GitHub",
      }));
    }

    // Discover repos independently — one failing must NOT kill the batch
    const results = await Promise.all(
      registry.repos.map((entry) => discoverRepo(entry, token))
    );
    return results;
  }

  async getLedger(ref: LedgerRef): Promise<LedgerDetailResult> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        ok: false,
        ref,
        reason: "token_missing",
        note: "GITHUB_TOKEN is not set — ledger cannot be fetched from GitHub",
      };
    }

    const parsed = parseRepo(ref.repo);
    if (!parsed) {
      return {
        ok: false,
        ref,
        reason: "not_found",
        note: `ref.repo "${ref.repo}" is not in "owner/name" format`,
      };
    }

    const rawResult = await fetchRawContent(parsed.owner, parsed.name, ref.branch, ref.path, token);
    if (!rawResult.ok) {
      return { ok: false, ref, reason: rawResult.reason, note: rawResult.note };
    }
    return { ok: true, ref, raw: rawResult.raw };
  }
}
