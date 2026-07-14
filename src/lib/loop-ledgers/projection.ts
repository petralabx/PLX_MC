// Projection of quality-ledger artifacts onto MC initiative-board shapes
// (Milestone / Trace) plus the bucket→ledger binding config
// (plx-bucket-ledger-map/v1). Pure — no filesystem or network access here.
// Consumers must import through the barrel (src/lib/loop-ledgers/index.ts).

import { z } from "zod";
import type { Milestone, Trace, TraceRow, TraceStatus } from "@/lib/mc-data";
import type { LedgerRow, LoaderSummaryRow } from "./loader";
import type {
  Artifact,
  ArtifactStatus,
  LedgerValidationResult,
  QualityLedger,
} from "./types";
import { sortByScariest } from "./validator";

// ─── Bucket→ledger map config (plx-bucket-ledger-map/v1) ─────────────────────

export interface BucketLedgerBinding {
  bucket: string;
  repo: string;
  module: string;
}

export interface BucketLedgerMapConfig {
  schema_version: "plx-bucket-ledger-map/v1";
  bindings: BucketLedgerBinding[];
}

const bucketLedgerBindingSchema = z.object({
  bucket: z.string().min(1),
  repo: z.string().min(1),
  module: z.string().min(1),
});

const bucketLedgerMapSchema = z.object({
  schema_version: z.literal("plx-bucket-ledger-map/v1"),
  bindings: z.array(bucketLedgerBindingSchema),
});

export type BucketLedgerMapParseResult =
  | { ok: true; config: BucketLedgerMapConfig }
  | { ok: false; error: string };

/**
 * Parse and validate a bucket→ledger map from a JSON string.
 * Returns a typed result — never throws.
 */
export function parseBucketLedgerMapJson(raw: string): BucketLedgerMapParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "bucket-ledger map JSON is not parseable" };
  }
  const result = bucketLedgerMapSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: msg };
  }
  return { ok: true, config: result.data as BucketLedgerMapConfig };
}

/** All bindings declared for a bucket (pure filter — no dedupe). */
export function bindingsForBucket(
  config: BucketLedgerMapConfig,
  bucketId: string
): BucketLedgerBinding[] {
  return config.bindings.filter((b) => b.bucket === bucketId);
}

// ─── Milestone projection ─────────────────────────────────────────────────────

/** Terminal statuses carry no remaining work — never projected as milestones. */
const TERMINAL_STATUS: ReadonlySet<ArtifactStatus> = new Set([
  "verified",
  "covered",
  "waived",
]);

/** Statuses that (with red safety_class) put a projected milestone at risk. */
const RISK_STATUS: ReadonlySet<ArtifactStatus> = new Set([
  "broken",
  "partially_broken",
  "blocked",
]);

/**
 * Wrap one artifact in a synthetic single-artifact valid result so the
 * canonical riskRank/sortByScariest ranking applies per-artifact without
 * duplicating its logic. Freshness is pinned so only safety/severity and the
 * confidence tiebreak influence order (all artifacts share one generated_at).
 */
function singleArtifactResult(
  ledger: QualityLedger,
  artifact: Artifact
): LedgerValidationResult {
  return {
    valid: true,
    healthCode: "valid",
    ledger: {
      ...ledger,
      summary: {
        total_artifacts: 1,
        by_type: { [artifact.artifact_type]: 1 },
        by_status: { [artifact.status]: 1 },
        by_severity: { [artifact.severity]: 1 },
        by_safety_class: { [artifact.safety_class]: 1 },
      },
      artifacts: [artifact],
    },
    errors: [],
    freshnessInfo: { level: "fresh", ageDays: 0, reason: "projection rank" },
  };
}

/**
 * Project a ledger's open work onto Milestone rows for a bucket: one entry per
 * artifact with a non-empty next_action whose status is not terminal
 * (verified/covered/waived). Sorted scariest-first via the validator ranking.
 */
export function projectMilestones(
  ledger: QualityLedger,
  bucketId: string
): Milestone[] {
  const candidates = ledger.artifacts.filter(
    (a) => Boolean(a.next_action?.trim()) && !TERMINAL_STATUS.has(a.status)
  );
  const sorted = sortByScariest(candidates.map((a) => singleArtifactResult(ledger, a)));
  return sorted.map((result) => {
    // Each synthetic result holds exactly one artifact (see singleArtifactResult).
    const a = (result.ledger as QualityLedger).artifacts[0];
    return {
      id: `LM-${ledger.module}-${a.artifact_id}`,
      bucket: bucketId,
      name: `${a.artifact_id} — ${a.next_action}`,
      // Ledger milestones are list-only, not timeline-positioned.
      col: 0,
      state: a.safety_class === "red" || RISK_STATUS.has(a.status) ? "risk" : "now",
      sp: `Quality Ledger · ${ledger.module}`,
    };
  });
}

// ─── Trace projection ─────────────────────────────────────────────────────────

const STATUS_TO_TRACE: Record<ArtifactStatus, TraceStatus> = {
  verified: "satisfied",
  covered: "satisfied",
  waived: "satisfied",
  fixed_pending_regression: "in-review",
  works_observed: "in-review",
  missing_test: "in-progress",
  deferred: "in-progress",
  broken: "gap",
  partially_broken: "gap",
  blocked: "gap",
  unknown: "gap",
};

/**
 * Project a ledger onto a traceability matrix for a bucket: one TraceRow per
 * artifact. tasks/prs/merge stay empty — the ledger carries no MC linkage.
 */
export function projectTrace(ledger: QualityLedger, bucketId: string): Trace {
  const rows: TraceRow[] = ledger.artifacts.map((a) => ({
    req: a.artifact_id,
    tasks: [],
    prs: [],
    evidence: a.evidence?.length ? "complete" : "incomplete",
    test: a.tests_existing?.[0] ?? "—",
    merge: "—",
    status: STATUS_TO_TRACE[a.status],
  }));
  return { bucket: bucketId, rows };
}

// ─── Bucket projection (GET /api/loop-ledgers/bucket/[bucketId] shape) ────────

/** One binding's provenance in a BucketProjection — valid xor degraded. */
export interface BucketProjectionSource {
  repo: string;
  module: string;
  generatedAt?: string;
  /** Human-readable reason this binding produced no rows. Never fabricated rows. */
  degraded?: string;
}

/** Response data for the bucket projection endpoint. */
export type BucketProjection =
  | { bound: false }
  | {
      bound: true;
      milestones: Milestone[];
      trace: Trace | null;
      sources: BucketProjectionSource[];
    };

/**
 * Resolve a bucket's bindings against already-loaded loader rows and merge the
 * per-binding projections into one BucketProjection. Pure — the caller loads
 * rows (listLedgerSummaries) and reads configs; this only matches and merges.
 *
 * Per binding: the first VALID ledger row whose repo+module match contributes
 * milestones + trace rows; otherwise a degraded source entry explains why
 * (degraded source, degraded ledger, or module not found). Never throws.
 */
export function projectBucketFromRows(
  bucketId: string,
  bindings: BucketLedgerBinding[],
  rows: LoaderSummaryRow[]
): BucketProjection {
  if (bindings.length === 0) return { bound: false };

  const milestones: Milestone[] = [];
  const traceRows: TraceRow[] = [];
  const sources: BucketProjectionSource[] = [];
  let hasValidLedger = false;

  for (const binding of bindings) {
    const ledgerRow = rows.find(
      (r): r is LedgerRow =>
        r.kind === "ledger" &&
        r.repo === binding.repo &&
        r.validationResult.valid &&
        r.validationResult.ledger.module === binding.module
    );
    if (ledgerRow?.validationResult.valid) {
      const ledger = ledgerRow.validationResult.ledger;
      hasValidLedger = true;
      milestones.push(...projectMilestones(ledger, bucketId));
      traceRows.push(...projectTrace(ledger, bucketId).rows);
      sources.push({
        repo: binding.repo,
        module: binding.module,
        generatedAt: ledger.generated_at,
      });
      continue;
    }

    const degradedSource = rows.find(
      (r) => r.kind === "degraded-source" && r.repo === binding.repo
    );
    if (degradedSource && degradedSource.kind === "degraded-source") {
      sources.push({
        repo: binding.repo,
        module: binding.module,
        degraded: `${degradedSource.reason}: ${degradedSource.note}`,
      });
      continue;
    }

    // Invalid ledgers carry ledger: null, so they cannot be attributed to a
    // module — report the repo has degraded ledgers rather than "not found".
    const degradedLedger = rows.find(
      (r): r is LedgerRow =>
        r.kind === "ledger" && r.repo === binding.repo && !r.validationResult.valid
    );
    if (degradedLedger) {
      sources.push({
        repo: binding.repo,
        module: binding.module,
        degraded: `no valid ledger for module "${binding.module}" — repo has a degraded ledger (${degradedLedger.validationResult.healthCode})`,
      });
      continue;
    }

    sources.push({
      repo: binding.repo,
      module: binding.module,
      degraded: `no ledger found for module "${binding.module}"`,
    });
  }

  return {
    bound: true,
    milestones,
    trace: hasValidLedger ? { bucket: bucketId, rows: traceRows } : null,
    sources,
  };
}
