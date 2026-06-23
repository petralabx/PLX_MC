// Pure-helper unit tests for the Loop Ledgers UI screen.
// No React rendering — vitest.config.ts has no DOM environment.
// Tests guard: deriveIndexStats, deriveAttentionCounts, applyFilters,
// matchesSearchText, sortScariest, encodeRef, and label helpers.
import { describe, expect, it } from "vitest";

import type { DegradedSourceRow, LedgerRow, LoaderSummaryRow } from "@/lib/loop-ledgers";

import {
  applyFilters,
  buildGalleryObservedSet,
  deriveAttentionCounts,
  deriveIndexStats,
  encodeRef,
  freshnessLabel,
  freshnessTone,
  healthLabel,
  healthTone,
  matchesSearchText,
  rowFreshness,
  rowHealthCode,
} from "@/components/mc/loop-ledgers/helpers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeLedgerRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    kind: "ledger",
    ref: { repo: "org/repo-a", branch: "main", path: "docs/quality-ledger/test.artifacts.json" },
    repo: "org/repo-a",
    repoDisplayName: "Repo A",
    validationResult: {
      valid: true,
      healthCode: "valid",
      ledger: {
        schema_version: "vmc-quality-ledger/v1",
        module: "auth",
        generated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        branch: "main",
        summary: {
          total_artifacts: 2,
          by_type: { defect: 2 },
          by_status: { broken: 1, covered: 1 },
          by_severity: { high: 1, medium: 1 },
          by_safety_class: { green: 2 },
        },
        artifacts: [
          {
            artifact_id: "A-001",
            module: "auth",
            artifact_type: "defect",
            title: "Login fails on timeout",
            status: "broken",
            severity: "high",
            safety_class: "green",
            confidence: 0.7,
            next_action: "Add retry logic",
          },
          {
            artifact_id: "A-002",
            module: "auth",
            artifact_type: "defect",
            title: "Token refresh bug",
            status: "covered",
            severity: "medium",
            safety_class: "green",
            confidence: 0.9,
          },
        ],
      },
      errors: [],
      freshnessInfo: { level: "fresh", ageDays: 2, reason: "2d old" },
    },
    ...overrides,
  };
}

function makeInvalidLedgerRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    kind: "ledger",
    ref: { repo: "org/repo-b", branch: "main", path: "docs/quality-ledger/schema.artifacts.json" },
    repo: "org/repo-b",
    repoDisplayName: "Repo B",
    validationResult: {
      valid: false,
      healthCode: "schema_mismatch",
      ledger: null,
      errors: [{ code: "schema_mismatch", message: "schema_version mismatch" }],
      freshnessInfo: { level: "unknown", ageDays: null, reason: "source unreadable" },
    },
    ...overrides,
  };
}

function makeStaleLedgerRow(): LedgerRow {
  return {
    kind: "ledger",
    ref: { repo: "org/repo-c", branch: "main", path: "docs/quality-ledger/stale.artifacts.json" },
    repo: "org/repo-c",
    repoDisplayName: "Repo C",
    validationResult: {
      valid: true,
      healthCode: "valid",
      ledger: {
        schema_version: "vmc-quality-ledger/v1",
        module: "checkout",
        generated_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
        branch: "main",
        summary: {
          total_artifacts: 1,
          by_type: { risk: 1 },
          by_status: { unknown: 1 },
          by_severity: { critical: 1 },
          by_safety_class: { red: 1 },
        },
        artifacts: [
          {
            artifact_id: "C-001",
            module: "checkout",
            artifact_type: "risk",
            title: "Payment data exposure",
            status: "unknown",
            severity: "critical",
            safety_class: "red",
            confidence: 0.3,
            next_action: "Investigate immediately",
          },
        ],
      },
      errors: [],
      freshnessInfo: { level: "stale", ageDays: 40, reason: "40d > 30d" },
    },
  };
}

function makeDegradedRow(
  reason: DegradedSourceRow["reason"] = "permission_denied",
  repo = "org/repo-d",
  displayName = "Repo D"
): DegradedSourceRow {
  return {
    kind: "degraded-source",
    repo,
    repoDisplayName: displayName,
    reason,
    note: `HTTP 403 — access denied for ${repo}`,
  };
}

// ─── deriveIndexStats ─────────────────────────────────────────────────────────

describe("deriveIndexStats", () => {
  it("returns all zeros for an empty list", () => {
    expect(deriveIndexStats([])).toEqual({
      repos: 0,
      ledgers: 0,
      degraded: 0,
      stale: 0,
      critical: 0,
      redSafety: 0,
    });
  });

  it("counts unique repos, not rows", () => {
    const rows: LoaderSummaryRow[] = [
      makeLedgerRow(),
      makeLedgerRow({ repo: "org/repo-a", repoDisplayName: "Repo A" }), // same repo
      makeLedgerRow({ repo: "org/repo-b", repoDisplayName: "Repo B",
        ref: { repo: "org/repo-b", branch: "main", path: "other.json" } }),
    ];
    expect(deriveIndexStats(rows).repos).toBe(2);
  });

  it("counts ledger rows (not degraded-source) as ledgers", () => {
    const rows: LoaderSummaryRow[] = [
      makeLedgerRow(),
      makeLedgerRow(),
      makeDegradedRow(),
    ];
    const stats = deriveIndexStats(rows);
    expect(stats.ledgers).toBe(2);
  });

  it("counts degraded-source rows as degraded", () => {
    const rows: LoaderSummaryRow[] = [
      makeDegradedRow("permission_denied"),
      makeDegradedRow("no_ledgers"),
    ];
    const stats = deriveIndexStats(rows);
    expect(stats.degraded).toBe(2);
    expect(stats.ledgers).toBe(0);
  });

  it("counts invalid ledger rows as degraded too", () => {
    const rows: LoaderSummaryRow[] = [
      makeLedgerRow(),       // valid
      makeInvalidLedgerRow(), // invalid
    ];
    const stats = deriveIndexStats(rows);
    expect(stats.ledgers).toBe(2); // both are ledger rows
    expect(stats.degraded).toBe(1); // only the invalid one
  });

  it("counts stale ledger rows", () => {
    const rows: LoaderSummaryRow[] = [makeLedgerRow(), makeStaleLedgerRow()];
    expect(deriveIndexStats(rows).stale).toBe(1);
  });

  it("counts rows with critical severity artifacts", () => {
    const rows: LoaderSummaryRow[] = [makeLedgerRow(), makeStaleLedgerRow()];
    expect(deriveIndexStats(rows).critical).toBe(1);
  });

  it("counts rows with red safety-class artifacts", () => {
    const rows: LoaderSummaryRow[] = [makeLedgerRow(), makeStaleLedgerRow()];
    expect(deriveIndexStats(rows).redSafety).toBe(1);
  });

  it("handles a mixed set correctly", () => {
    const rows: LoaderSummaryRow[] = [
      makeDegradedRow("permission_denied"), // degraded-source → degraded++
      makeInvalidLedgerRow(),              // ledger, invalid → ledger++, degraded++
      makeLedgerRow(),                      // valid ledger → ledger++
      makeStaleLedgerRow(),                 // stale, critical, red → ledger++, stale++, critical++, redSafety++
    ];
    const stats = deriveIndexStats(rows);
    expect(stats.repos).toBe(4);
    expect(stats.ledgers).toBe(3);
    expect(stats.degraded).toBe(2); // degraded-source + invalid ledger
    expect(stats.stale).toBe(1);
    expect(stats.critical).toBe(1);
    expect(stats.redSafety).toBe(1);
  });
});

// ─── deriveAttentionCounts ────────────────────────────────────────────────────

describe("deriveAttentionCounts", () => {
  it("returns zeros for empty", () => {
    expect(deriveAttentionCounts([])).toEqual({ invalid: 0, unreachable: 0, stale: 0 });
  });

  it("classifies permission_denied as unreachable", () => {
    const counts = deriveAttentionCounts([makeDegradedRow("permission_denied")]);
    expect(counts.unreachable).toBe(1);
    expect(counts.invalid).toBe(0);
  });

  it("classifies schema_mismatch as invalid", () => {
    const counts = deriveAttentionCounts([makeDegradedRow("schema_mismatch")]);
    expect(counts.invalid).toBe(1);
    expect(counts.unreachable).toBe(0);
  });

  it("classifies stale ledger rows as stale", () => {
    const counts = deriveAttentionCounts([makeStaleLedgerRow()]);
    expect(counts.stale).toBe(1);
    expect(counts.invalid).toBe(0);
  });

  it("does not double-count valid fresh ledgers", () => {
    const counts = deriveAttentionCounts([makeLedgerRow()]);
    expect(counts).toEqual({ invalid: 0, unreachable: 0, stale: 0 });
  });
});

// ─── applyFilters ─────────────────────────────────────────────────────────────

describe("applyFilters", () => {
  const allRows: LoaderSummaryRow[] = [
    makeLedgerRow(),
    makeInvalidLedgerRow(),
    makeStaleLedgerRow(),
    makeDegradedRow("permission_denied"),
    makeDegradedRow("no_ledgers", "org/repo-e", "Repo E"),
  ];

  it("returns all rows when filter is empty", () => {
    expect(applyFilters(allRows, {})).toHaveLength(allRows.length);
  });

  it("filters by repo slug", () => {
    const result = applyFilters(allRows, { repo: ["org/repo-a"] });
    expect(result).toHaveLength(1);
    expect(result[0].repo).toBe("org/repo-a");
  });

  it("filters by multiple repos (OR)", () => {
    const result = applyFilters(allRows, { repo: ["org/repo-a", "org/repo-b"] });
    expect(result).toHaveLength(2);
  });

  it("filters by health code (valid)", () => {
    const result = applyFilters(allRows, { health: ["valid"] });
    // Only rows with healthCode "valid"
    expect(result.every((r) => rowHealthCode(r) === "valid")).toBe(true);
  });

  it("filters by health code (permission_denied)", () => {
    const result = applyFilters(allRows, { health: ["permission_denied"] });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("degraded-source");
  });

  it("filters by freshness (stale)", () => {
    const result = applyFilters(allRows, { freshness: ["stale"] });
    expect(result).toHaveLength(1);
    expect(rowFreshness(result[0])).toBe("stale");
  });

  it("filters by severity (critical) — excludes degraded-source rows", () => {
    const result = applyFilters(allRows, { severity: ["critical"] });
    expect(result.every((r) => r.kind === "ledger")).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].repo).toBe("org/repo-c");
  });

  it("filters by safety class (red) — excludes degraded-source rows", () => {
    const result = applyFilters(allRows, { safety: ["red"] });
    expect(result).toHaveLength(1);
    expect(result[0].repo).toBe("org/repo-c");
  });

  it("combines multiple facets (AND logic)", () => {
    const result = applyFilters(allRows, {
      freshness: ["stale"],
      safety: ["red"],
    });
    expect(result).toHaveLength(1);
    expect(result[0].repo).toBe("org/repo-c");
  });

  it("preserves input order (scariest-first from API)", () => {
    const result = applyFilters(allRows, {});
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(allRows[i]);
    }
  });

  it("returns empty when no rows match", () => {
    const result = applyFilters(allRows, { repo: ["org/nonexistent"] });
    expect(result).toHaveLength(0);
  });
});

// ─── Search predicate (via applyFilters text) ─────────────────────────────────

describe("matchesSearchText", () => {
  it("matches on repoDisplayName (case-insensitive)", () => {
    const row = makeLedgerRow();
    expect(matchesSearchText(row, "repo a")).toBe(true);
    expect(matchesSearchText(row, "REPO A")).toBe(true);
  });

  it("matches on ref.path", () => {
    const row = makeLedgerRow();
    expect(matchesSearchText(row, "quality-ledger")).toBe(true);
  });

  it("matches on ledger.module", () => {
    const row = makeLedgerRow();
    expect(matchesSearchText(row, "auth")).toBe(true);
  });

  it("matches on artifact title", () => {
    const row = makeLedgerRow();
    expect(matchesSearchText(row, "timeout")).toBe(true);
  });

  it("matches on artifact next_action", () => {
    const row = makeLedgerRow();
    expect(matchesSearchText(row, "retry logic")).toBe(true);
  });

  it("matches degraded-source rows on note and reason", () => {
    const row = makeDegradedRow("permission_denied");
    expect(matchesSearchText(row, "403")).toBe(true);
    expect(matchesSearchText(row, "permission_denied")).toBe(true);
  });

  it("returns false for no match", () => {
    const row = makeLedgerRow();
    expect(matchesSearchText(row, "completely-unrelated-xyz")).toBe(false);
  });
});

// Scariest-first ordering (incl. the confidence/generated_at tiebreak) is applied
// server-side by the loader and covered by tests/loop-ledgers-adapters.test.ts. The
// legacy client-side sortScariest helper was pruned (it was unused by the views and
// risked drifting from the server ranking), so its unit tests were removed with it.

// ─── encodeRef ────────────────────────────────────────────────────────────────

describe("encodeRef", () => {
  it("produces URL-safe base64url (no +, /, or trailing =)", () => {
    const encoded = encodeRef({ repo: "org/repo", branch: "main", path: "docs/ledger.json" });
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toMatch(/=$/);
  });

  it("round-trips through JSON parse", () => {
    const ref = { repo: "taylorvalton/plx-mc", branch: "main", path: "docs/plx-mc/quality-ledger/ll.json" };
    const encoded = encodeRef(ref);
    const decoded = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
    expect(decoded).toEqual(ref);
  });

  it("is stable (same input → same output)", () => {
    const ref = { repo: "a/b", branch: "c", path: "d/e.json" };
    expect(encodeRef(ref)).toBe(encodeRef(ref));
  });
});

// ─── Label helpers ─────────────────────────────────────────────────────────────

describe("healthLabel", () => {
  it("returns human-readable labels for known codes", () => {
    expect(healthLabel("valid")).toBe("Valid");
    expect(healthLabel("permission_denied")).toBe("Permission denied");
    expect(healthLabel("schema_mismatch")).toBe("Schema mismatch");
    expect(healthLabel("no_ledgers")).toBe("No ledgers");
  });

  it("falls back to the code for unknown values", () => {
    expect(healthLabel("some_unknown_code")).toBe("some_unknown_code");
  });
});

describe("freshnessLabel", () => {
  it("returns human-readable labels", () => {
    expect(freshnessLabel("fresh")).toBe("Fresh");
    expect(freshnessLabel("warn")).toBe("Aging");
    expect(freshnessLabel("stale")).toBe("Stale");
    expect(freshnessLabel("unknown")).toBe("Unknown");
  });
});

describe("healthTone", () => {
  it("returns 'valid' for valid", () => {
    expect(healthTone("valid")).toBe("valid");
  });
  it("returns 'hot' for structural errors", () => {
    expect(healthTone("permission_denied")).toBe("hot");
    expect(healthTone("schema_mismatch")).toBe("hot");
    expect(healthTone("invalid_json")).toBe("hot");
  });
  it("returns 'warn' for partial", () => {
    expect(healthTone("partial")).toBe("warn");
  });
  it("returns 'muted' for no_ledgers", () => {
    expect(healthTone("no_ledgers")).toBe("muted");
  });
});

describe("freshnessTone", () => {
  it("maps levels to CSS tones", () => {
    expect(freshnessTone("fresh")).toBe("valid");
    expect(freshnessTone("warn")).toBe("warn");
    expect(freshnessTone("stale")).toBe("hot");
    expect(freshnessTone("unknown")).toBe("muted");
  });
});

// ─── N6 regression — buildGalleryObservedSet ──────────────────────────────────
// Gallery must highlight cards for individual error codes (e.g. count_mismatch),
// not only for the collapsed healthCode="partial".

describe("buildGalleryObservedSet — N6 regression: error codes propagated into observed set", () => {
  it("includes the healthCode for a degraded-source row", () => {
    const observed = buildGalleryObservedSet([makeDegradedRow("permission_denied")]);
    expect(observed.has("permission_denied")).toBe(true);
  });

  it("includes healthCode='partial' for an invalid ledger row", () => {
    const row = makeLedgerRow({
      validationResult: {
        valid: false,
        healthCode: "partial",
        ledger: null,
        errors: [{ code: "count_mismatch", message: "mismatch" }],
        freshnessInfo: { level: "fresh", ageDays: 1, reason: "" },
      },
    });
    const observed = buildGalleryObservedSet([row]);
    expect(observed.has("partial")).toBe(true);
  });

  it("also includes individual error codes from partial ledger (BEFORE fix: only 'partial' was included)", () => {
    // BEFORE fix: observed = new Set(rows.map(r => r.validationResult.healthCode)) → only "partial"
    // AFTER fix: folds errors[].code → "count_mismatch" appears too
    const row = makeLedgerRow({
      validationResult: {
        valid: false,
        healthCode: "partial",
        ledger: null,
        errors: [
          { code: "count_mismatch", message: "mismatch" },
          { code: "enum_violation", message: "bad enum" },
        ],
        freshnessInfo: { level: "fresh", ageDays: 1, reason: "" },
      },
    });
    const observed = buildGalleryObservedSet([row]);
    expect(observed.has("count_mismatch")).toBe(true);
    expect(observed.has("enum_violation")).toBe(true);
  });

  it("includes 'verified_no_evidence' error code from a partial ledger", () => {
    const row = makeLedgerRow({
      validationResult: {
        valid: false,
        healthCode: "partial",
        ledger: null,
        errors: [{ code: "verified_no_evidence", message: "no evidence" }],
        freshnessInfo: { level: "fresh", ageDays: 1, reason: "" },
      },
    });
    const observed = buildGalleryObservedSet([row]);
    expect(observed.has("verified_no_evidence")).toBe(true);
  });

  it("a valid ledger row with no errors adds only the healthCode", () => {
    const observed = buildGalleryObservedSet([makeLedgerRow()]);
    expect(observed.has("valid")).toBe(true);
    expect(observed.size).toBe(1);
  });

  it("mixed rows: degraded-source + partial-with-errors accumulates all codes", () => {
    const partialRow = makeLedgerRow({
      validationResult: {
        valid: false,
        healthCode: "partial",
        ledger: null,
        errors: [{ code: "duplicate_id", message: "dup" }],
        freshnessInfo: { level: "fresh", ageDays: 1, reason: "" },
      },
    });
    const observed = buildGalleryObservedSet([makeDegradedRow("no_ledgers"), partialRow]);
    expect(observed.has("no_ledgers")).toBe(true);
    expect(observed.has("partial")).toBe(true);
    expect(observed.has("duplicate_id")).toBe(true);
  });
});

// ─── rowHealthCode / rowFreshness ─────────────────────────────────────────────

describe("rowHealthCode", () => {
  it("returns the validator healthCode for ledger rows", () => {
    expect(rowHealthCode(makeLedgerRow())).toBe("valid");
    expect(rowHealthCode(makeInvalidLedgerRow())).toBe("schema_mismatch");
  });

  it("returns the reason for degraded-source rows", () => {
    expect(rowHealthCode(makeDegradedRow("permission_denied"))).toBe("permission_denied");
    expect(rowHealthCode(makeDegradedRow("no_ledgers"))).toBe("no_ledgers");
  });
});

describe("rowFreshness", () => {
  it("returns the freshnessInfo level for ledger rows", () => {
    expect(rowFreshness(makeLedgerRow())).toBe("fresh");
    expect(rowFreshness(makeStaleLedgerRow())).toBe("stale");
  });

  it("returns 'unknown' for degraded-source rows", () => {
    expect(rowFreshness(makeDegradedRow())).toBe("unknown");
  });
});
