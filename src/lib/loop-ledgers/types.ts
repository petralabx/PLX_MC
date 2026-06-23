// Types for the Loop Ledgers domain module.
// Consumers must import through the barrel (src/lib/loop-ledgers/index.ts).

// ─── Enum unions (sourced from dogfood ledger + prototype ALLOWED sets) ───────

export type ArtifactType =
  | "user_story"
  | "defect"
  | "risk"
  | "test_gap"
  | "ticket"
  | "blocker";

export type ArtifactStatus =
  | "unknown"
  | "works_observed"
  | "broken"
  | "partially_broken"
  | "missing_test"
  | "covered"
  | "fixed_pending_regression"
  | "verified"
  | "deferred"
  | "waived"
  | "blocked";

export type Severity = "critical" | "high" | "medium" | "low";

export type SafetyClass = "green" | "yellow" | "red";

export type Freshness = "fresh" | "warn" | "stale" | "unknown";

// ─── Artifact ─────────────────────────────────────────────────────────────────

export interface Artifact {
  artifact_id: string;
  module: string;
  artifact_type: ArtifactType;
  title: string;
  status: ArtifactStatus;
  severity: Severity;
  safety_class: SafetyClass;
  confidence: number;
  blast_radius?: string;
  owner?: string;
  source?: string;
  linked_routes?: string[];
  linked_files?: string[];
  tests_existing?: string[];
  tests_needed?: string[];
  evidence?: string[];
  next_action?: string;
  blocked_reason?: string;
}

// ─── Ledger summary ───────────────────────────────────────────────────────────

export interface LedgerSummary {
  total_artifacts: number;
  by_type: Partial<Record<ArtifactType, number>>;
  by_status: Partial<Record<ArtifactStatus, number>>;
  by_severity: Partial<Record<Severity, number>>;
  by_safety_class: Partial<Record<SafetyClass, number>>;
}

// ─── Quality ledger (vmc-quality-ledger/v1) ───────────────────────────────────

export interface QualityLedger {
  schema_version: "vmc-quality-ledger/v1";
  module: string;
  generated_at: string;
  branch: string;
  evidence_scope?: string;
  summary: LedgerSummary;
  artifacts: Artifact[];
}

// ─── Registry config (plx-loop-ledger-registry/v1) ───────────────────────────

export interface FreshnessConfig {
  warn_after_days: number;
  stale_after_days: number;
}

export interface RepoEntry {
  repo: string;
  display_name: string;
  default_branch: string;
  ledger_glob: string;
  human_ledger_glob?: string;
  route_inventory_glob?: string;
  evidence_dir?: string;
  /** Per-repo freshness override; falls back to top-level RegistryConfig.freshness. */
  freshness?: FreshnessConfig;
}

export interface RegistryConfig {
  schema_version: "plx-loop-ledger-registry/v1";
  freshness: FreshnessConfig;
  repos: RepoEntry[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Reason codes produced by the validator. Source adapters (P2) add network codes. */
export type ValidatorReasonCode =
  | "invalid_json"
  | "schema_mismatch"
  | "count_mismatch"
  | "missing_summary"
  | "enum_violation"
  | "confidence_range"
  | "duplicate_id"
  | "verified_no_evidence"
  | "partial";

/** Health codes: 'valid' is the only passing code; all others are degraded. */
export type HealthCode = "valid" | ValidatorReasonCode;

export interface ValidationError {
  code: ValidatorReasonCode;
  message: string;
}

export interface FreshnessInfo {
  level: Freshness;
  ageDays: number | null;
  reason: string;
}

/**
 * Discriminated result returned by the validator — never throws.
 * `valid: true` → ledger passed all invariants.
 * `valid: false` → ledger is degraded; `healthCode` carries the primary reason.
 */
export type LedgerValidationResult =
  | {
      valid: true;
      healthCode: "valid";
      ledger: QualityLedger;
      errors: [];
      freshnessInfo: FreshnessInfo;
    }
  | {
      valid: false;
      healthCode: HealthCode;
      ledger: QualityLedger | null;
      errors: ValidationError[];
      freshnessInfo: FreshnessInfo;
    };

// ─── Ledger reference ─────────────────────────────────────────────────────────

/** Stable identifier for a ledger within a repo tree. Used by loaders (P2). */
export interface LedgerRef {
  repo: string;
  branch: string;
  path: string;
}
