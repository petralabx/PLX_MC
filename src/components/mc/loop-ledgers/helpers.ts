// Pure helper functions for the Loop Ledgers UI screen.
// No React — all functions are pure and unit-testable without a DOM environment.
// Consumers: index.tsx (display) and tests/loop-ledgers-ui.test.ts (unit tests).

// Only `import type` from @/lib/loop-ledgers — this guarantees the client
// bundle does NOT pull in the server-only local-fs adapter (node:fs/promises).
import type {
  Freshness,
  LedgerRef,
  SafetyClass,
  Severity,
  SourceDegradedReason,
} from "@/lib/loop-ledgers";
import type { LedgerRow, LoaderSummaryRow } from "@/lib/loop-ledgers";

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface LLStats {
  repos: number;
  ledgers: number;
  degraded: number;
  stale: number;
  critical: number;
  redSafety: number;
}

/**
 * Derive display stat-card counts from a list of summary rows.
 * - repos: distinct repo slugs
 * - ledgers: rows with kind="ledger" (valid or not)
 * - degraded: degraded-source rows + invalid ledger rows (valid=false)
 * - stale: ledger rows with freshnessInfo.level="stale"
 * - critical: ledger rows with ≥1 critical-severity artifact
 * - redSafety: ledger rows with ≥1 red safety-class artifact
 */
export function deriveIndexStats(rows: LoaderSummaryRow[]): LLStats {
  const repoSet = new Set<string>();
  let ledgers = 0;
  let degraded = 0;
  let stale = 0;
  let critical = 0;
  let redSafety = 0;

  for (const row of rows) {
    repoSet.add(row.repo);
    if (row.kind === "degraded-source") {
      degraded++;
    } else {
      ledgers++;
      const { validationResult } = row;
      if (!validationResult.valid) degraded++;
      if (validationResult.freshnessInfo.level === "stale") stale++;
      const s = validationResult.ledger?.summary;
      if ((s?.by_severity?.critical ?? 0) > 0) critical++;
      if ((s?.by_safety_class?.red ?? 0) > 0) redSafety++;
    }
  }

  return { repos: repoSet.size, ledgers, degraded, stale, critical, redSafety };
}

// ─── Attention banner counts ──────────────────────────────────────────────────

export interface AttentionCounts {
  invalid: number;
  unreachable: number;
  stale: number;
}

const UNREACHABLE_REASONS = new Set<SourceDegradedReason>([
  "not_found",
  "permission_denied",
  "token_missing",
  "rate_limit",
  "network_error",
]);

/**
 * Break down how many rows need attention and why.
 * - invalid: structural failures (schema_mismatch, invalid_json, validator errors)
 * - unreachable: network/access failures (permission, token, network, not_found, rate_limit)
 * - stale: ledger rows with stale freshness
 */
export function deriveAttentionCounts(rows: LoaderSummaryRow[]): AttentionCounts {
  let invalid = 0;
  let unreachable = 0;
  let stale = 0;

  for (const row of rows) {
    if (row.kind === "degraded-source") {
      if (UNREACHABLE_REASONS.has(row.reason)) {
        unreachable++;
      } else {
        invalid++;
      }
    } else {
      if (!row.validationResult.valid) invalid++;
      if (row.validationResult.freshnessInfo.level === "stale") stale++;
    }
  }

  return { invalid, unreachable, stale };
}

// ─── Effective health / freshness code for a row ─────────────────────────────

/** Returns the primary health/reason code for any row type (for filtering). */
export function rowHealthCode(row: LoaderSummaryRow): string {
  if (row.kind === "degraded-source") return row.reason;
  return row.validationResult.healthCode;
}

/** Returns the freshness level for any row type (for filtering). */
export function rowFreshness(row: LoaderSummaryRow): Freshness {
  if (row.kind === "degraded-source") return "unknown";
  return row.validationResult.freshnessInfo.level;
}

// ─── Filter state + predicate ─────────────────────────────────────────────────

export interface LLFilterState {
  text?: string;
  repo?: string[];
  severity?: string[];
  safety?: string[];
  health?: string[];
  freshness?: string[];
}

function rowMatchesSeverity(row: LedgerRow, severities: string[]): boolean {
  const s = row.validationResult.ledger?.summary;
  if (!s) return false;
  return severities.some((sev) => (s.by_severity?.[sev as Severity] ?? 0) > 0);
}

function rowMatchesSafety(row: LedgerRow, classes: string[]): boolean {
  const s = row.validationResult.ledger?.summary;
  if (!s) return false;
  return classes.some((cls) => (s.by_safety_class?.[cls as SafetyClass] ?? 0) > 0);
}

/**
 * Text search predicate: matches repoDisplayName, ref.path (route), ledger.module,
 * artifact titles, and artifact next_action values.
 */
export function matchesSearchText(row: LoaderSummaryRow, text: string): boolean {
  const q = text.toLowerCase();
  if (row.repoDisplayName.toLowerCase().includes(q)) return true;
  if (row.kind === "degraded-source") {
    return row.note.toLowerCase().includes(q) || row.reason.toLowerCase().includes(q);
  }
  if (row.ref.path.toLowerCase().includes(q)) return true;
  const ledgerModule = row.validationResult.ledger?.module ?? "";
  if (ledgerModule.toLowerCase().includes(q)) return true;
  const artifacts = row.validationResult.ledger?.artifacts ?? [];
  for (const a of artifacts) {
    if (a.title.toLowerCase().includes(q)) return true;
    if (a.next_action?.toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Apply all filter facets to a row list, preserving the input order (scariest-first).
 * Degraded-source rows pass severity/safety filters only when those facets are unset
 * (since they carry no ledger data to match against).
 */
export function applyFilters(
  rows: LoaderSummaryRow[],
  filter: LLFilterState
): LoaderSummaryRow[] {
  return rows.filter((row) => {
    if (filter.text?.trim()) {
      if (!matchesSearchText(row, filter.text.trim())) return false;
    }
    if (filter.repo?.length) {
      if (!filter.repo.includes(row.repo)) return false;
    }
    if (filter.health?.length) {
      if (!filter.health.includes(rowHealthCode(row))) return false;
    }
    if (filter.freshness?.length) {
      if (!filter.freshness.includes(rowFreshness(row))) return false;
    }
    if (filter.severity?.length) {
      if (row.kind !== "ledger") return false;
      if (!rowMatchesSeverity(row, filter.severity)) return false;
    }
    if (filter.safety?.length) {
      if (row.kind !== "ledger") return false;
      if (!rowMatchesSafety(row, filter.safety)) return false;
    }
    return true;
  });
}

// NOTE: scariest-first ordering is applied server-side by the loader
// (src/lib/loop-ledgers/loader.ts, including the confidence/generated_at
// tiebreak). The UI renders that order verbatim, so no client-side sort is kept
// here — a second copy would only risk drifting from the server's ranking.

// ─── Label helpers ────────────────────────────────────────────────────────────

export function healthLabel(code: string): string {
  const labels: Record<string, string> = {
    valid: "Valid",
    invalid_json: "Invalid JSON",
    schema_mismatch: "Schema mismatch",
    count_mismatch: "Count mismatch",
    missing_summary: "Missing summary",
    enum_violation: "Enum violation",
    confidence_range: "Confidence range",
    duplicate_id: "Duplicate ID",
    verified_no_evidence: "Verified, no evidence",
    partial: "Partial",
    not_found: "Not found",
    permission_denied: "Permission denied",
    token_missing: "Token missing",
    rate_limit: "Rate limited",
    no_ledgers: "No ledgers",
    network_error: "Network error",
    disabled: "Disabled",
    truncated: "Tree truncated",
  };
  return labels[code] ?? code;
}

export function freshnessLabel(level: string): string {
  const labels: Record<string, string> = {
    fresh: "Fresh",
    warn: "Aging",
    stale: "Stale",
    unknown: "Unknown",
  };
  return labels[level] ?? level;
}

/** Return the CSS tone class for a health code: "valid" | "warn" | "hot" | "muted". */
export function healthTone(code: string): "valid" | "warn" | "hot" | "muted" {
  if (code === "valid") return "valid";
  if (code === "partial" || code === "verified_no_evidence") return "warn";
  if (code === "no_ledgers" || code === "disabled") return "muted";
  return "hot";
}

/** Return the CSS tone class for a freshness level. */
export function freshnessTone(level: string): "valid" | "warn" | "hot" | "muted" {
  if (level === "fresh") return "valid";
  if (level === "warn") return "warn";
  if (level === "stale") return "hot";
  return "muted";
}

// ─── Gallery observed-set builder ────────────────────────────────────────────

/**
 * Build the set of health/error codes that are "live" in the current data,
 * used by DegradedGallery to highlight active failure modes.
 *
 * For degraded-source rows: the source reason code.
 * For ledger rows: the top-level healthCode PLUS each individual error.code
 * (since the validator collapses multiple error codes into healthCode="partial").
 */
export function buildGalleryObservedSet(rows: LoaderSummaryRow[]): Set<string> {
  const observed = new Set<string>();
  for (const r of rows) {
    if (r.kind === "degraded-source") {
      observed.add(r.reason);
    } else {
      observed.add(r.validationResult.healthCode);
      for (const e of r.validationResult.errors) {
        observed.add(e.code);
      }
    }
  }
  return observed;
}

// ─── Ref encoding (browser-safe base64url) ────────────────────────────────────

/**
 * Encode a LedgerRef as a URL-safe base64url string for the API route.
 * Uses btoa (available in both browser and Node 16+).
 */
export function encodeRef(ref: LedgerRef): string {
  return btoa(JSON.stringify(ref))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Derive filter option universes from data ─────────────────────────────────

export interface LLFilterOptions {
  repos: string[];
  health: string[];
  freshness: string[];
  severity: string[];
  safety: string[];
}

export function deriveFilterOptions(rows: LoaderSummaryRow[]): LLFilterOptions {
  const repos = [...new Set(rows.map((r) => r.repo))];
  const health = [...new Set(rows.map(rowHealthCode))];
  const freshness = [...new Set(rows.map(rowFreshness))];
  const sevSet = new Set<string>();
  const safeSet = new Set<string>();
  for (const row of rows) {
    if (row.kind === "ledger") {
      const s = row.validationResult.ledger?.summary;
      if (s) {
        for (const k of Object.keys(s.by_severity ?? {}) as Severity[]) {
          if ((s.by_severity?.[k] ?? 0) > 0) sevSet.add(k);
        }
        for (const k of Object.keys(s.by_safety_class ?? {}) as SafetyClass[]) {
          if ((s.by_safety_class?.[k] ?? 0) > 0) safeSet.add(k);
        }
      }
    }
  }
  return {
    repos,
    health,
    freshness,
    severity: [...sevSet],
    safety: [...safeSet],
  };
}
