// Pure validator for vmc-quality-ledger/v1 ledgers.
// Never throws — invalid or missing input always returns a degraded result.
// Port of the prototype logic class (Loop Ledgers.dc.html, VALIDATOR section).
// Consumers must import through the barrel (src/lib/loop-ledgers/index.ts).

import type {
  Artifact,
  ArtifactStatus,
  ArtifactType,
  FreshnessConfig,
  FreshnessInfo,
  Freshness,
  HealthCode,
  LedgerValidationResult,
  QualityLedger,
  SafetyClass,
  Severity,
  ValidationError,
  ValidatorReasonCode,
} from "./types";

// ─── Allowed enum values (mirrors prototype ALLOWED object) ───────────────────

const ALLOWED_STATUS: ReadonlySet<ArtifactStatus> = new Set([
  "unknown",
  "works_observed",
  "broken",
  "partially_broken",
  "missing_test",
  "covered",
  "fixed_pending_regression",
  "verified",
  "deferred",
  "waived",
  "blocked",
]);

const ALLOWED_SEVERITY: ReadonlySet<Severity> = new Set([
  "critical",
  "high",
  "medium",
  "low",
]);

const ALLOWED_SAFETY: ReadonlySet<SafetyClass> = new Set([
  "green",
  "yellow",
  "red",
]);

const ALLOWED_ARTIFACT_TYPE: ReadonlySet<ArtifactType> = new Set([
  "user_story",
  "defect",
  "risk",
  "test_gap",
  "ticket",
  "blocker",
]);

// ─── Default freshness thresholds (mirrors prototype freshnessCfg) ─────────────

export const DEFAULT_FRESHNESS: FreshnessConfig = {
  warn_after_days: 7,
  stale_after_days: 30,
};

// ─── Freshness ─────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Compute ledger freshness from `generated_at` ISO string.
 * Uses `now` for testing; defaults to current system time.
 * Returns 'unknown' for missing or unparseable dates.
 */
export function computeFreshness(
  generatedAt: string | null | undefined,
  config: FreshnessConfig = DEFAULT_FRESHNESS,
  now: Date = new Date()
): FreshnessInfo {
  if (!generatedAt) {
    return { level: "unknown", ageDays: null, reason: "missing generated_at" };
  }
  const d = new Date(generatedAt);
  if (isNaN(d.getTime())) {
    return { level: "unknown", ageDays: null, reason: "invalid generated_at" };
  }
  const age = daysBetween(d, now);
  if (age > config.stale_after_days) {
    return { level: "stale", ageDays: age, reason: `${age}d > ${config.stale_after_days}d` };
  }
  if (age > config.warn_after_days) {
    return { level: "warn", ageDays: age, reason: `${age}d > ${config.warn_after_days}d` };
  }
  return { level: "fresh", ageDays: age, reason: `${age}d old` };
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate a raw (already-parsed) unknown value as a vmc-quality-ledger/v1 ledger.
 * Never throws — any structural problem yields a degraded result.
 */
export function validateLedgerRaw(
  raw: unknown,
  now: Date = new Date()
): LedgerValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return makeDegraded("invalid_json", [
      { code: "invalid_json", message: "ledger is not a JSON object" },
    ]);
  }

  const obj = raw as Record<string, unknown>;
  const schemaVersion = obj["schema_version"] ?? null;
  const generatedAt = typeof obj["generated_at"] === "string" ? obj["generated_at"] : null;
  const freshnessInfo = computeFreshness(generatedAt, DEFAULT_FRESHNESS, now);

  // schema_version mismatch — visible, degraded, never crash
  if (schemaVersion !== "vmc-quality-ledger/v1") {
    return {
      valid: false,
      healthCode: "schema_mismatch",
      ledger: null,
      errors: [
        {
          code: "schema_mismatch",
          message: `schema_version "${String(schemaVersion)}" ≠ expected vmc-quality-ledger/v1`,
        },
      ],
      freshnessInfo,
    };
  }

  const errors: ValidationError[] = [];
  const artifacts: unknown[] = Array.isArray(obj["artifacts"]) ? obj["artifacts"] : [];
  const summary = (obj["summary"] !== null && typeof obj["summary"] === "object" && !Array.isArray(obj["summary"]))
    ? (obj["summary"] as Record<string, unknown>)
    : null;

  // ── Summary reconciliation ───────────────────────────────────────────────────
  if (summary) {
    const n = artifacts.length;
    const declared = typeof summary["total_artifacts"] === "number" ? summary["total_artifacts"] : null;
    if (declared !== n) {
      errors.push({
        code: "count_mismatch",
        message: `summary.total_artifacts=${declared} but artifacts.length=${n}`,
      });
    }

    // Generic tally checker: for each key in the summary bucket, compare to actual count
    const tallyCheck = (
      bucketKey: string,
      pick: (a: Record<string, unknown>) => string | undefined
    ) => {
      const bucket =
        typeof summary[bucketKey] === "object" && summary[bucketKey] !== null
          ? (summary[bucketKey] as Record<string, number>)
          : {};
      const tally: Record<string, number> = {};
      for (const a of artifacts) {
        if (typeof a !== "object" || a === null) continue;
        const k = pick(a as Record<string, unknown>);
        if (k !== undefined) tally[k] = (tally[k] ?? 0) + 1;
      }
      const allKeys = new Set([...Object.keys(bucket), ...Object.keys(tally)]);
      for (const k of allKeys) {
        const declared = bucket[k] ?? 0;
        const actual = tally[k] ?? 0;
        if (declared !== actual) {
          errors.push({
            code: "count_mismatch",
            message: `summary.${bucketKey}.${k}=${declared} but tally=${actual}`,
          });
        }
      }
    };

    tallyCheck("by_type", (a) => typeof a["artifact_type"] === "string" ? a["artifact_type"] : undefined);
    tallyCheck("by_status", (a) => typeof a["status"] === "string" ? a["status"] : undefined);
    tallyCheck("by_severity", (a) => typeof a["severity"] === "string" ? a["severity"] : undefined);
    tallyCheck("by_safety_class", (a) => typeof a["safety_class"] === "string" ? a["safety_class"] : undefined);
  } else {
    errors.push({
      code: "missing_summary",
      message: "no summary block present",
    });
  }

  // ── Per-artifact validation ──────────────────────────────────────────────────
  const seenIds = new Set<string>();
  for (const a of artifacts) {
    if (typeof a !== "object" || a === null) continue;
    const art = a as Record<string, unknown>;
    const id = typeof art["artifact_id"] === "string" ? art["artifact_id"] : "(unknown)";

    if (seenIds.has(id)) {
      errors.push({ code: "duplicate_id", message: `duplicate artifact_id ${id}` });
    } else {
      seenIds.add(id);
    }

    const status = art["status"];
    if (typeof status !== "string" || !ALLOWED_STATUS.has(status as ArtifactStatus)) {
      errors.push({ code: "enum_violation", message: `${id}: status "${String(status)}" not allowed` });
    }

    const severity = art["severity"];
    if (typeof severity !== "string" || !ALLOWED_SEVERITY.has(severity as Severity)) {
      errors.push({ code: "enum_violation", message: `${id}: severity "${String(severity)}" not allowed` });
    }

    const safetyClass = art["safety_class"];
    if (typeof safetyClass !== "string" || !ALLOWED_SAFETY.has(safetyClass as SafetyClass)) {
      errors.push({ code: "enum_violation", message: `${id}: safety_class "${String(safetyClass)}" not allowed` });
    }

    const artifactType = art["artifact_type"];
    if (typeof artifactType !== "string" || !ALLOWED_ARTIFACT_TYPE.has(artifactType as ArtifactType)) {
      errors.push({ code: "enum_violation", message: `${id}: artifact_type "${String(artifactType)}" not allowed` });
    }

    const confidence = art["confidence"];
    if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
      errors.push({ code: "confidence_range", message: `${id}: confidence ${String(confidence)} out of [0,1]` });
    }

    const evidence = art["evidence"];
    if (status === "verified" && (!Array.isArray(evidence) || evidence.length === 0)) {
      errors.push({ code: "verified_no_evidence", message: `${id}: status verified but evidence is empty` });
    }
  }

  // ── Determine final healthCode ────────────────────────────────────────────────
  if (errors.length > 0) {
    return {
      valid: false,
      healthCode: "partial",
      ledger: null,
      errors,
      freshnessInfo,
    };
  }

  // All checks passed — cast to QualityLedger (invariants proved above)
  const ledger = obj as unknown as QualityLedger;
  return {
    valid: true,
    healthCode: "valid",
    ledger,
    errors: [],
    freshnessInfo,
  };
}

/**
 * Validate a raw JSON string as a vmc-quality-ledger/v1 ledger.
 * Returns degraded with reason 'invalid_json' if JSON.parse fails.
 * Never throws.
 */
export function validateLedgerJson(
  json: string,
  now: Date = new Date()
): LedgerValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return makeDegraded("invalid_json", [
      { code: "invalid_json", message: "ledger file is not parseable JSON" },
    ]);
  }
  return validateLedgerRaw(parsed, now);
}

// ─── Risk rank (scariest-first sort) ──────────────────────────────────────────

/**
 * Numeric risk rank for a validated result — lower = scarier, matches prototype riskRank().
 *
 * 0: invalid_json / schema_mismatch / unreachable / permission_denied / token_missing
 * 1: count_mismatch / partial / rate_limited
 * 2: stale freshness
 * 3: has red safety_class or critical severity artifacts
 * 4: no_ledgers
 * 6: healthy / recent (lowest risk)
 */
export function riskRank(result: LedgerValidationResult): number {
  const hc = result.healthCode as HealthCode | string;

  if (hc === "invalid_json" || hc === "schema_mismatch") return 0;

  if (hc === "partial") return 1;

  if (result.freshnessInfo.level === "stale") return 2;

  if (result.valid) {
    const sum = result.ledger.summary;
    const red = (sum.by_safety_class["red"] ?? 0);
    const crit = (sum.by_severity["critical"] ?? 0);
    if (red > 0 || crit > 0) return 3;
  }

  if (hc === "no_ledgers") return 4;

  return 6;
}

/**
 * Comparator for Array.sort — sorts results scariest-first.
 * Secondary sort: lower confidence average first; tertiary: newer generated_at first.
 */
export function scariestFirst(
  a: LedgerValidationResult,
  b: LedgerValidationResult
): number {
  const ra = riskRank(a);
  const rb = riskRank(b);
  if (ra !== rb) return ra - rb;

  const ca = avgConfidence(a);
  const cb = avgConfidence(b);
  // null confidence sorts later (after low-confidence, before healthy)
  const normA = ca === null ? 2 : ca;
  const normB = cb === null ? 2 : cb;
  if (normA !== normB) return normA - normB;

  // newer generated_at first (descending)
  const ga = a.valid ? a.ledger.generated_at : "";
  const gb = b.valid ? b.ledger.generated_at : "";
  return gb.localeCompare(ga);
}

/** Sort a result array scariest-first (pure — returns a new array). */
export function sortByScariest(
  results: LedgerValidationResult[]
): LedgerValidationResult[] {
  return [...results].sort(scariestFirst);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeDegraded(
  healthCode: ValidatorReasonCode,
  errors: ValidationError[]
): LedgerValidationResult {
  return {
    valid: false,
    healthCode,
    ledger: null,
    errors,
    freshnessInfo: { level: "unknown" as Freshness, ageDays: null, reason: "source unreadable" },
  };
}

function avgConfidence(result: LedgerValidationResult): number | null {
  const arts: Artifact[] = result.valid ? result.ledger.artifacts : [];
  const valid = arts
    .map((a) => a.confidence)
    .filter((c): c is number => typeof c === "number" && c >= 0 && c <= 1);
  if (!valid.length) return null;
  return valid.reduce((s, x) => s + x, 0) / valid.length;
}
