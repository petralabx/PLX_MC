// Read-only application loader for loop-ledgers.
// Orchestrates: source discovery → per-file validation → scariest-first sort.
// Degraded source rows are INCLUDED as visible rows — never silently dropped.
// No writes, no mutation, no DDL.
// Consumers must import through the barrel (src/lib/loop-ledgers/index.ts).

import { riskRank, validateLedgerRaw } from "@/lib/loop-ledgers/validator";
import type {
  LedgerRef,
  LedgerValidationResult,
  RegistryConfig,
  RepoEntry,
} from "@/lib/loop-ledgers/types";
import type { LedgerSource, SourceDegradedReason } from "./sources/source";

// ─── Loader row types ─────────────────────────────────────────────────────────

/**
 * A ledger row — the validator ran on the file content.
 * `validationResult` carries health, freshness, and artifact data.
 */
export interface LedgerRow {
  kind: "ledger";
  ref: LedgerRef;
  repo: string;
  repoDisplayName: string;
  validationResult: LedgerValidationResult;
  commitSha?: string;
}

/**
 * A degraded-source row — the repo was unreachable, unauthorised, empty, etc.
 * Rendered loudly in the UI; never silently dropped from the list.
 */
export interface DegradedSourceRow {
  kind: "degraded-source";
  repo: string;
  repoDisplayName: string;
  reason: SourceDegradedReason;
  note: string;
}

/** Union of both row types returned by listLedgerSummaries. */
export type LoaderSummaryRow = LedgerRow | DegradedSourceRow;

/** Result of getLedgerDetail — one validated ledger or a degraded result. */
export type LoaderDetailResult =
  | {
      ok: true;
      ref: LedgerRef;
      repo: string;
      repoDisplayName: string;
      validationResult: LedgerValidationResult;
      commitSha?: string;
    }
  | {
      ok: false;
      ref: LedgerRef;
      repo: string;
      repoDisplayName: string;
      reason: SourceDegradedReason;
      note: string;
    };

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Map a source degraded reason to a numeric risk rank (lower = scarier). */
function sourceReasonRank(reason: SourceDegradedReason): number {
  switch (reason) {
    case "token_missing":
    case "permission_denied":
    case "network_error":
      return 0;
    case "rate_limit":
      return 1;
    case "not_found":
      return 2;
    case "invalid_json":
    case "schema_mismatch":
      return 0; // structural failures are as scary as permission issues
    case "truncated":
      return 1;
    case "no_ledgers":
      return 4;
    case "disabled":
      return 4;
    default:
      return 1;
  }
}

/** Unified rank for any row type (lower = scarier). */
function rowRank(row: LoaderSummaryRow): number {
  if (row.kind === "degraded-source") return sourceReasonRank(row.reason);
  return riskRank(row.validationResult);
}

/** Average confidence for a ledger row (null if not a valid ledger with artifacts). */
function avgRowConfidence(row: LoaderSummaryRow): number | null {
  if (row.kind !== "ledger" || !row.validationResult.valid) return null;
  const arts = row.validationResult.ledger.artifacts;
  const valid = arts
    .map((a) => a.confidence)
    .filter((c): c is number => typeof c === "number" && c >= 0 && c <= 1);
  if (!valid.length) return null;
  return valid.reduce((s, x) => s + x, 0) / valid.length;
}

/** generated_at string for a ledger row (empty string for degraded rows). */
function rowGeneratedAt(row: LoaderSummaryRow): string {
  if (row.kind !== "ledger" || !row.validationResult.valid) return "";
  return row.validationResult.ledger.generated_at;
}

/**
 * Sort a row array scariest-first (pure — returns a new array).
 * Tiebreak: lower avg confidence first; then newer generated_at first.
 */
function sortRowsScariest(rows: LoaderSummaryRow[]): LoaderSummaryRow[] {
  return [...rows].sort((a, b) => {
    const ra = rowRank(a);
    const rb = rowRank(b);
    if (ra !== rb) return ra - rb;

    // Tiebreak 1: lower avg confidence first (null sorts after low-confidence)
    const ca = avgRowConfidence(a);
    const cb = avgRowConfidence(b);
    const normA = ca === null ? 2 : ca;
    const normB = cb === null ? 2 : cb;
    if (normA !== normB) return normA - normB;

    // Tiebreak 2: newer generated_at first (descending lexicographic on ISO dates)
    const ga = rowGeneratedAt(a);
    const gb = rowGeneratedAt(b);
    return gb.localeCompare(ga);
  });
}

/** Find a registry entry by repo slug. */
function findEntry(registry: RegistryConfig, repo: string): RepoEntry | undefined {
  return registry.repos.find((e) => e.repo === repo);
}

/**
 * Minimal glob matcher (mirrors the copy in sources/github-api.ts).
 * Supports `*` (non-slash chars) and `**` (any chars including `/`).
 */
function matchGlob(pattern: string, filePath: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*");
  return new RegExp("^" + escaped + "$").test(filePath);
}

// ─── Public loader API ────────────────────────────────────────────────────────

/**
 * Discover, fetch, and validate all ledgers across every repo in the registry.
 *
 * - Calls source.listLedgers() to get per-repo results.
 * - For each ok result, validates each DiscoveredLedger via P1 validateLedgerRaw.
 * - Degraded source rows are included as DegradedSourceRow entries (never dropped).
 * - Returns a scariest-first sorted list.
 *
 * Never throws — all errors surface as degraded rows.
 */
export async function listLedgerSummaries(
  registry: RegistryConfig,
  source: LedgerSource
): Promise<LoaderSummaryRow[]> {
  let sourceResults;
  try {
    sourceResults = await source.listLedgers(registry);
  } catch (err) {
    // If the source itself throws (should never happen per contract), produce
    // one degraded row per repo so the caller always gets a complete list.
    return registry.repos.map((entry) => ({
      kind: "degraded-source" as const,
      repo: entry.repo,
      repoDisplayName: entry.display_name,
      reason: "network_error" as SourceDegradedReason,
      note: `source.listLedgers threw unexpectedly: ${err instanceof Error ? err.message : "unknown"}`,
    }));
  }

  const rows: LoaderSummaryRow[] = [];

  for (const result of sourceResults) {
    const entry = findEntry(registry, result.repo);
    const displayName = entry?.display_name ?? result.repo;

    if (!result.ok) {
      rows.push({
        kind: "degraded-source",
        repo: result.repo,
        repoDisplayName: displayName,
        reason: result.reason,
        note: result.note,
      });
      continue;
    }

    for (const discovered of result.ledgers) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(discovered.raw);
      } catch {
        // Treat unparseable raw content as invalid_json degraded row
        rows.push({
          kind: "degraded-source",
          repo: result.repo,
          repoDisplayName: displayName,
          reason: "invalid_json",
          note: `ledger at "${discovered.ref.path}" is not parseable JSON`,
        });
        continue;
      }

      const validationResult = validateLedgerRaw(parsed);

      rows.push({
        kind: "ledger",
        ref: discovered.ref,
        repo: result.repo,
        repoDisplayName: displayName,
        validationResult,
        commitSha: discovered.commitSha,
      });
    }
  }

  return sortRowsScariest(rows);
}

/**
 * Fetch and validate a single ledger identified by its LedgerRef.
 *
 * Never throws — errors surface as ok=false LoaderDetailResult.
 */
export async function getLedgerDetail(
  ref: LedgerRef,
  registry: RegistryConfig,
  source: LedgerSource
): Promise<LoaderDetailResult> {
  const entry = findEntry(registry, ref.repo);

  // Registry is the allowlist — off-registry refs are rejected without a fetch.
  if (!entry) {
    return {
      ok: false,
      ref,
      repo: ref.repo,
      repoDisplayName: ref.repo,
      reason: "not_found",
      note: `repo "${ref.repo}" is not in the registry`,
    };
  }

  // Branch must match the registry default_branch.
  if (ref.branch !== entry.default_branch) {
    return {
      ok: false,
      ref,
      repo: ref.repo,
      repoDisplayName: entry.display_name,
      reason: "not_found",
      note: `branch "${ref.branch}" does not match registry default_branch "${entry.default_branch}" for repo "${ref.repo}"`,
    };
  }

  // Path must match the registry ledger_glob.
  if (!matchGlob(entry.ledger_glob, ref.path)) {
    return {
      ok: false,
      ref,
      repo: ref.repo,
      repoDisplayName: entry.display_name,
      reason: "not_found",
      note: `path "${ref.path}" does not match registry glob "${entry.ledger_glob}" for repo "${ref.repo}"`,
    };
  }

  const displayName = entry.display_name;

  let detailResult;
  try {
    detailResult = await source.getLedger(ref);
  } catch (err) {
    return {
      ok: false,
      ref,
      repo: ref.repo,
      repoDisplayName: displayName,
      reason: "network_error",
      note: `source.getLedger threw unexpectedly: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  if (!detailResult.ok) {
    return {
      ok: false,
      ref,
      repo: ref.repo,
      repoDisplayName: displayName,
      reason: detailResult.reason,
      note: detailResult.note,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(detailResult.raw);
  } catch {
    return {
      ok: false,
      ref,
      repo: ref.repo,
      repoDisplayName: displayName,
      reason: "invalid_json",
      note: `ledger at "${ref.path}" is not parseable JSON`,
    };
  }

  const validationResult = validateLedgerRaw(parsed);

  return {
    ok: true,
    ref,
    repo: ref.repo,
    repoDisplayName: displayName,
    validationResult,
    commitSha: detailResult.commitSha,
  };
}
