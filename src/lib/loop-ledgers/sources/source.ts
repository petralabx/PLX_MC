// LedgerSource interface and result types for the loop-ledgers source adapters.
// Consumers must import through the barrel (src/lib/loop-ledgers/index.ts).

import type { LedgerRef, RegistryConfig } from "@/lib/loop-ledgers/types";

// ─── Degraded-reason taxonomy ─────────────────────────────────────────────────

/**
 * All possible reasons a source operation can produce a degraded result.
 * Names intentionally match the codes that riskRank() already handles by
 * string check in validator.ts (token_missing, permission_denied, rate_limited,
 * no_ledgers, unreachable) so sorting works without touching P1.
 *
 * - not_found         HTTP 404 — repo or branch does not exist
 * - permission_denied HTTP 403 (non-rate-limit) — private repo, no access or token missing access
 * - token_missing     GITHUB_TOKEN env var is absent — honest degraded, never a throw
 * - rate_limit        HTTP 429 or HTTP 403 with x-ratelimit-remaining=0
 * - no_ledgers        Repo reachable + authorized but the configured glob matched zero files
 * - invalid_json      File fetched but JSON.parse failed
 * - schema_mismatch   File parseable but schema_version !== 'vmc-quality-ledger/v1'
 * - network_error     fetch() threw — DNS failure, timeout, or host unreachable
 * - disabled          Adapter is explicitly disabled (local-fs in production)
 * - truncated         GitHub Trees API returned truncated=true — tree is partial, glob results unreliable
 */
export type SourceDegradedReason =
  | "not_found"
  | "permission_denied"
  | "token_missing"
  | "rate_limit"
  | "no_ledgers"
  | "invalid_json"
  | "schema_mismatch"
  | "network_error"
  | "disabled"
  | "truncated";

// ─── Per-file discovery record ────────────────────────────────────────────────

/** One ledger discovered within a repo — carries the raw file content + its ref. */
export interface DiscoveredLedger {
  ref: LedgerRef;
  /** Raw file content as a UTF-8 string (not validated — the loader validates). */
  raw: string;
  /** Commit SHA or tree SHA at the time of discovery, if the source provides it. */
  commitSha?: string;
}

// ─── LedgerSourceResult (per-repo) ───────────────────────────────────────────

/**
 * Result of discovering all ledgers for one repo entry.
 *
 * ok=true  → repo was reachable and authorised; `ledgers` holds every file the
 *             glob matched (may be empty — but that returns ok=false/no_ledgers
 *             instead, so a non-empty ok=true means at least one file was found).
 *
 * ok=false → a distinct degraded reason explains why the repo could not be read.
 *             One repo failing MUST NOT kill the batch; the caller accumulates
 *             both ok and degraded results independently.
 */
export type LedgerSourceResult =
  | {
      ok: true;
      repo: string;
      ledgers: DiscoveredLedger[];
    }
  | {
      ok: false;
      repo: string;
      reason: SourceDegradedReason;
      note: string;
    };

// ─── LedgerDetailResult (single ledger) ──────────────────────────────────────

/**
 * Result of fetching one ledger by its ref.
 *
 * ok=true  → raw content returned; `commitSha` is set when the source can
 *             provide the commit/tree SHA at read time.
 *
 * ok=false → distinct degraded reason; the caller must surface this loudly.
 */
export type LedgerDetailResult =
  | {
      ok: true;
      ref: LedgerRef;
      raw: string;
      commitSha?: string;
    }
  | {
      ok: false;
      ref: LedgerRef;
      reason: SourceDegradedReason;
      note: string;
    };

// ─── LedgerSource interface ───────────────────────────────────────────────────

/**
 * Read-only source adapter for cross-repo ledger discovery.
 *
 * Implementations must:
 * - Never throw — all errors surface as ok=false degraded results.
 * - Never fabricate content — missing token / non-200 → degraded, not fake data.
 * - Handle one repo failing without affecting other repos in the batch.
 */
export interface LedgerSource {
  /**
   * Discover and fetch all ledger files for every repo in the registry.
   * Returns exactly one result per registry entry (ok or degraded).
   * Order mirrors the registry `repos` array.
   */
  listLedgers(registry: RegistryConfig): Promise<LedgerSourceResult[]>;

  /**
   * Fetch the raw content of a single ledger identified by its ref.
   * Returns ok=false with a distinct reason on any failure.
   */
  getLedger(ref: LedgerRef): Promise<LedgerDetailResult>;
}
