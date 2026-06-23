// Unit tests for the Loop Ledgers domain core (P1): validator, freshness,
// scariest-first sort, and registry config. Style mirrors tests/api-route.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeFreshness,
  parseRegistryConfig,
  parseRegistryJson,
  riskRank,
  sortByScariest,
  validateLedgerJson,
  validateLedgerRaw,
} from "@/lib/loop-ledgers";
import type { LedgerValidationResult, QualityLedger } from "@/lib/loop-ledgers";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** Minimal valid vmc-quality-ledger/v1 ledger (derived from dogfood JSON shape). */
const VALID_LEDGER: QualityLedger = {
  schema_version: "vmc-quality-ledger/v1",
  module: "loop-ledgers",
  generated_at: "2026-06-23",
  branch: "staging",
  summary: {
    total_artifacts: 3,
    by_type: { user_story: 2, ticket: 1 },
    by_status: { verified: 2, works_observed: 1 },
    by_severity: { medium: 2, low: 1 },
    by_safety_class: { green: 3 },
  },
  artifacts: [
    {
      artifact_id: "LL-001",
      module: "loop-ledgers",
      artifact_type: "user_story",
      title: "Operator sees ledgers",
      status: "verified",
      severity: "medium",
      safety_class: "green",
      confidence: 0.9,
      evidence: ["docs/evidence/ll-index.txt"],
    },
    {
      artifact_id: "LL-002",
      module: "loop-ledgers",
      artifact_type: "ticket",
      title: "Degraded sources stay visible",
      status: "verified",
      severity: "medium",
      safety_class: "green",
      confidence: 0.75,
      evidence: ["docs/evidence/ll-degraded.txt"],
    },
    {
      artifact_id: "LL-003",
      module: "loop-ledgers",
      artifact_type: "user_story",
      title: "No mutation affordance",
      status: "works_observed",
      severity: "low",
      safety_class: "green",
      confidence: 0.7,
    },
  ],
};

// ─── Valid ledger ─────────────────────────────────────────────────────────────

describe("validateLedgerRaw — valid ledger", () => {
  it("passes a fully valid dogfood-shaped ledger", () => {
    const result = validateLedgerRaw(VALID_LEDGER);
    expect(result.valid).toBe(true);
    expect(result.healthCode).toBe("valid");
    expect(result.errors).toHaveLength(0);
    if (result.valid) {
      expect(result.ledger.module).toBe("loop-ledgers");
      expect(result.ledger.artifacts).toHaveLength(3);
    }
  });

  it("result exposes freshnessInfo", () => {
    const result = validateLedgerRaw(VALID_LEDGER, new Date("2026-06-25"));
    expect(result.freshnessInfo.level).toBe("fresh");
    expect(result.freshnessInfo.ageDays).toBe(2);
  });
});

// ─── Invalid JSON ─────────────────────────────────────────────────────────────

describe("validateLedgerJson — invalid JSON input", () => {
  it("returns degraded 'invalid_json' and never throws", () => {
    const result = validateLedgerJson("{ not json }");
    expect(result.valid).toBe(false);
    expect(result.healthCode).toBe("invalid_json");
    expect(result.errors[0]?.code).toBe("invalid_json");
    expect(result.ledger).toBeNull();
  });

  it("handles empty string without throwing", () => {
    expect(() => validateLedgerJson("")).not.toThrow();
    const result = validateLedgerJson("");
    expect(result.healthCode).toBe("invalid_json");
  });
});

// ─── Schema mismatch ──────────────────────────────────────────────────────────

describe("validateLedgerRaw — schema_mismatch", () => {
  it("returns schema_mismatch for risk-engine/v2", () => {
    const result = validateLedgerRaw({
      schema_version: "risk-engine/v2",
      module: "risk-engine",
      generated_at: "2026-06-20",
      artifacts: [],
    });
    expect(result.valid).toBe(false);
    expect(result.healthCode).toBe("schema_mismatch");
    expect(result.errors[0]?.code).toBe("schema_mismatch");
  });

  it("returns schema_mismatch for vmc-quality-ledger/v2 and never throws", () => {
    expect(() =>
      validateLedgerRaw({ schema_version: "vmc-quality-ledger/v2", artifacts: [] })
    ).not.toThrow();
    const result = validateLedgerRaw({ schema_version: "vmc-quality-ledger/v2", artifacts: [] });
    expect(result.healthCode).toBe("schema_mismatch");
  });

  it("returns schema_mismatch for null schema_version", () => {
    const result = validateLedgerRaw({ schema_version: null });
    expect(result.healthCode).toBe("schema_mismatch");
  });

  it("returns schema_mismatch for missing schema_version", () => {
    const result = validateLedgerRaw({ module: "x", artifacts: [] });
    expect(result.healthCode).toBe("schema_mismatch");
  });
});

// ─── Missing / malformed fields ───────────────────────────────────────────────

describe("validateLedgerRaw — missing or null summary", () => {
  it("degrades with missing_summary when summary is absent", () => {
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "x",
      generated_at: "2026-06-23",
      artifacts: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_summary")).toBe(true);
  });

  it("degrades when input is not an object", () => {
    expect(validateLedgerRaw("string").healthCode).toBe("invalid_json");
    expect(validateLedgerRaw(null).healthCode).toBe("invalid_json");
    expect(validateLedgerRaw(42).healthCode).toBe("invalid_json");
    expect(validateLedgerRaw([]).healthCode).toBe("invalid_json");
  });
});

// ─── Bad enum values ──────────────────────────────────────────────────────────

describe("validateLedgerRaw — enum violations", () => {
  const makeArtifact = (overrides: Record<string, unknown>) => ({
    artifact_id: "X-001",
    module: "x",
    artifact_type: "defect",
    title: "test",
    status: "broken",
    severity: "high",
    safety_class: "green",
    confidence: 0.5,
    ...overrides,
  });

  const ledgerWith = (artifact: Record<string, unknown>) => ({
    schema_version: "vmc-quality-ledger/v1",
    module: "x",
    generated_at: "2026-06-23",
    summary: {
      total_artifacts: 1,
      by_type: { defect: 1 },
      by_status: { broken: 1 },
      by_severity: { high: 1 },
      by_safety_class: { green: 1 },
    },
    artifacts: [artifact],
  });

  it("flags an unknown status value", () => {
    const result = validateLedgerRaw(ledgerWith(makeArtifact({ status: "wip" })));
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "enum_violation");
    expect(err?.message).toMatch(/status.*wip/);
  });

  it("flags an unknown severity value", () => {
    const result = validateLedgerRaw(ledgerWith(makeArtifact({ severity: "ultra" })));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "enum_violation" && e.message.includes("severity"))).toBe(true);
  });

  it("flags an unknown safety_class value", () => {
    const result = validateLedgerRaw(ledgerWith(makeArtifact({ safety_class: "blue" })));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "enum_violation" && e.message.includes("safety_class"))).toBe(true);
  });

  it("flags an unknown artifact_type value", () => {
    const result = validateLedgerRaw(ledgerWith(makeArtifact({ artifact_type: "wish_list" })));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "enum_violation" && e.message.includes("artifact_type"))).toBe(true);
  });
});

// ─── Confidence out of range ──────────────────────────────────────────────────

describe("validateLedgerRaw — confidence range", () => {
  const makeWith = (confidence: unknown) => ({
    schema_version: "vmc-quality-ledger/v1",
    module: "x",
    generated_at: "2026-06-23",
    summary: {
      total_artifacts: 1,
      by_type: { defect: 1 },
      by_status: { broken: 1 },
      by_severity: { high: 1 },
      by_safety_class: { green: 1 },
    },
    artifacts: [
      {
        artifact_id: "X-001",
        module: "x",
        artifact_type: "defect",
        title: "t",
        status: "broken",
        severity: "high",
        safety_class: "green",
        confidence,
      },
    ],
  });

  it("passes confidence at 0 and 1", () => {
    expect(validateLedgerRaw(makeWith(0)).errors.some((e) => e.code === "confidence_range")).toBe(false);
    expect(validateLedgerRaw(makeWith(1)).errors.some((e) => e.code === "confidence_range")).toBe(false);
  });

  it("flags confidence 1.4 (billing fixture style)", () => {
    const result = validateLedgerRaw(makeWith(1.4));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "confidence_range")).toBe(true);
  });

  it("flags negative confidence", () => {
    const result = validateLedgerRaw(makeWith(-0.1));
    expect(result.errors.some((e) => e.code === "confidence_range")).toBe(true);
  });

  it("flags non-number confidence", () => {
    const result = validateLedgerRaw(makeWith("high"));
    expect(result.errors.some((e) => e.code === "confidence_range")).toBe(true);
  });
});

// ─── Count mismatch ───────────────────────────────────────────────────────────

describe("validateLedgerRaw — total_artifacts / bucket count mismatch", () => {
  it("flags total_artifacts mismatch (summary says 4, but 2 artifacts)", () => {
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "x",
      generated_at: "2026-06-23",
      summary: {
        total_artifacts: 4,
        by_type: { defect: 1, risk: 1 },
        by_status: { broken: 1, unknown: 1 },
        by_severity: { critical: 1, high: 1 },
        by_safety_class: { red: 1, green: 1 },
      },
      artifacts: [
        { artifact_id: "X-001", module: "x", artifact_type: "defect", title: "t", status: "broken", severity: "critical", safety_class: "red", confidence: 0.9 },
        { artifact_id: "X-002", module: "x", artifact_type: "risk", title: "r", status: "unknown", severity: "high", safety_class: "green", confidence: 0.5 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "count_mismatch")).toBe(true);
  });

  it("flags by_severity bucket mismatch", () => {
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "x",
      generated_at: "2026-06-23",
      summary: {
        total_artifacts: 1,
        by_type: { defect: 1 },
        by_status: { broken: 1 },
        by_severity: { critical: 99 }, // wrong — actual is 1
        by_safety_class: { red: 1 },
      },
      artifacts: [
        { artifact_id: "X-001", module: "x", artifact_type: "defect", title: "t", status: "broken", severity: "critical", safety_class: "red", confidence: 0.9 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "count_mismatch" && e.message.includes("by_severity"))).toBe(true);
  });
});

// ─── Duplicate artifact_id ────────────────────────────────────────────────────

describe("validateLedgerRaw — duplicate artifact_id", () => {
  it("flags duplicate ids (billing fixture style — BL-001 twice)", () => {
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "billing",
      generated_at: "2026-06-23",
      summary: {
        total_artifacts: 2,
        by_type: { defect: 1, risk: 1 },
        by_status: { verified: 1, unknown: 1 },
        by_severity: { high: 1, low: 1 },
        by_safety_class: { yellow: 1, green: 1 },
      },
      artifacts: [
        { artifact_id: "BL-001", module: "billing", artifact_type: "defect", title: "a", status: "verified", severity: "high", safety_class: "yellow", confidence: 0.9, evidence: ["e.txt"] },
        { artifact_id: "BL-001", module: "billing", artifact_type: "risk", title: "b", status: "unknown", severity: "low", safety_class: "green", confidence: 0.3 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "duplicate_id")).toBe(true);
  });
});

// ─── Verified without evidence ────────────────────────────────────────────────

describe("validateLedgerRaw — verified requires evidence", () => {
  it("flags verified status with empty evidence array", () => {
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "billing",
      generated_at: "2026-06-23",
      summary: {
        total_artifacts: 1,
        by_type: { defect: 1 },
        by_status: { verified: 1 },
        by_severity: { high: 1 },
        by_safety_class: { yellow: 1 },
      },
      artifacts: [
        { artifact_id: "BL-001", module: "billing", artifact_type: "defect", title: "refund", status: "verified", severity: "high", safety_class: "yellow", confidence: 0.9, evidence: [] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "verified_no_evidence")).toBe(true);
  });

  it("flags verified status with missing evidence field", () => {
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "x",
      generated_at: "2026-06-23",
      summary: {
        total_artifacts: 1,
        by_type: { ticket: 1 },
        by_status: { verified: 1 },
        by_severity: { medium: 1 },
        by_safety_class: { green: 1 },
      },
      artifacts: [
        { artifact_id: "X-001", module: "x", artifact_type: "ticket", title: "t", status: "verified", severity: "medium", safety_class: "green", confidence: 0.8 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "verified_no_evidence")).toBe(true);
  });

  it("accepts verified status when evidence is non-empty", () => {
    const result = validateLedgerRaw(VALID_LEDGER, new Date("2026-06-24"));
    expect(result.valid).toBe(true);
  });
});

// ─── Freshness thresholds ─────────────────────────────────────────────────────

describe("computeFreshness — threshold boundaries", () => {
  const cfg = { warn_after_days: 7, stale_after_days: 30 };
  const now = new Date("2026-06-23");

  it("fresh: age 0 days", () => {
    const r = computeFreshness("2026-06-23", cfg, now);
    expect(r.level).toBe("fresh");
    expect(r.ageDays).toBe(0);
  });

  it("fresh: age exactly 7 days", () => {
    const r = computeFreshness("2026-06-16", cfg, now);
    expect(r.level).toBe("fresh");
    expect(r.ageDays).toBe(7);
  });

  it("warn: age 8 days (just past warn threshold)", () => {
    const r = computeFreshness("2026-06-15", cfg, now);
    expect(r.level).toBe("warn");
    expect(r.ageDays).toBe(8);
  });

  it("warn: age exactly 30 days (at stale threshold boundary)", () => {
    const r = computeFreshness("2026-05-24", cfg, now);
    expect(r.level).toBe("warn");
    expect(r.ageDays).toBe(30);
  });

  it("stale: age 31 days (one past stale threshold)", () => {
    const r = computeFreshness("2026-05-23", cfg, now);
    expect(r.level).toBe("stale");
    expect(r.ageDays).toBe(31);
  });

  it("unknown: missing generated_at", () => {
    expect(computeFreshness(null, cfg, now).level).toBe("unknown");
    expect(computeFreshness(undefined, cfg, now).level).toBe("unknown");
    expect(computeFreshness("", cfg, now).level).toBe("unknown");
  });

  it("unknown: invalid date string", () => {
    const r = computeFreshness("not-a-date", cfg, now);
    expect(r.level).toBe("unknown");
    expect(r.ageDays).toBeNull();
  });
});

// ─── Scariest-first sort ──────────────────────────────────────────────────────

describe("sortByScariest — ordering", () => {
  const makeResult = (
    overrides: Partial<LedgerValidationResult>
  ): LedgerValidationResult => ({
    valid: false,
    healthCode: "partial",
    ledger: null,
    errors: [],
    freshnessInfo: { level: "fresh", ageDays: 1, reason: "1d old" },
    ...overrides,
  } as LedgerValidationResult);

  const invalidJsonResult = makeResult({ healthCode: "invalid_json", errors: [{ code: "invalid_json", message: "bad" }] });
  const schemaMismatch = makeResult({ healthCode: "schema_mismatch", errors: [{ code: "schema_mismatch", message: "v2" }] });
  const partial = makeResult({ healthCode: "partial", errors: [{ code: "count_mismatch", message: "x" }] });
  // stale result must NOT have a rank-0 or rank-1 healthCode, otherwise staleness check is never reached
  const staleResult = makeResult({
    healthCode: "valid",
    freshnessInfo: { level: "stale", ageDays: 45, reason: "45d > 30d" },
  } as Partial<LedgerValidationResult>);
  const validHealthy: LedgerValidationResult = {
    valid: true,
    healthCode: "valid",
    ledger: { ...VALID_LEDGER, generated_at: "2026-06-22" },
    errors: [],
    freshnessInfo: { level: "fresh", ageDays: 1, reason: "1d old" },
  };
  const validCritical: LedgerValidationResult = {
    valid: true,
    healthCode: "valid",
    ledger: {
      ...VALID_LEDGER,
      summary: { ...VALID_LEDGER.summary, by_severity: { critical: 1, medium: 2 }, by_safety_class: { red: 1, green: 2 } },
    },
    errors: [],
    freshnessInfo: { level: "fresh", ageDays: 1, reason: "1d old" },
  };

  it("invalid_json and schema_mismatch sort before partial", () => {
    const sorted = sortByScariest([partial, invalidJsonResult, schemaMismatch]);
    expect(sorted[0].healthCode).toMatch(/invalid_json|schema_mismatch/);
    expect(sorted[1].healthCode).toMatch(/invalid_json|schema_mismatch/);
    expect(sorted[2].healthCode).toBe("partial");
  });

  it("stale sorts before critical/valid", () => {
    const sorted = sortByScariest([validCritical, staleResult, validHealthy]);
    expect(sorted[0].freshnessInfo.level).toBe("stale");
  });

  it("critical/red before healthy/valid", () => {
    const sorted = sortByScariest([validHealthy, validCritical]);
    expect(sorted[0]).toBe(validCritical);
    expect(sorted[1]).toBe(validHealthy);
  });

  it("riskRank is 0 for invalid_json and schema_mismatch", () => {
    expect(riskRank(invalidJsonResult)).toBe(0);
    expect(riskRank(schemaMismatch)).toBe(0);
  });

  it("riskRank is 6 for healthy valid ledger", () => {
    expect(riskRank(validHealthy)).toBe(6);
  });

  it("riskRank is 2 for stale ledger", () => {
    expect(riskRank(staleResult)).toBe(2);
  });
});

// ─── N5 regression — tallyCheck union reconciliation ─────────────────────────
// tallyCheck must flag keys present in artifacts but ABSENT from the summary bucket.

describe("validateLedgerRaw — N5 regression: omitted-key bucket mismatch", () => {
  it("flags count_mismatch when by_severity omits 'critical' but an artifact has severity=critical", () => {
    // BEFORE fix: tallyCheck only iterated Object.keys(bucket) = ['high'], so 'critical' was never checked.
    // AFTER fix: union of bucket keys + tally keys catches the discrepancy.
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "x",
      generated_at: "2026-06-23",
      summary: {
        total_artifacts: 2,
        by_type: { defect: 2 },
        by_status: { broken: 2 },
        by_severity: { high: 2 }, // omits critical — but one artifact IS critical
        by_safety_class: { green: 2 },
      },
      artifacts: [
        { artifact_id: "X-001", module: "x", artifact_type: "defect", title: "a", status: "broken", severity: "high", safety_class: "green", confidence: 0.5 },
        { artifact_id: "X-002", module: "x", artifact_type: "defect", title: "b", status: "broken", severity: "critical", safety_class: "green", confidence: 0.8 },
      ],
    });
    expect(result.valid).toBe(false);
    const mismatch = result.errors.find(
      (e) => e.code === "count_mismatch" && e.message.includes("by_severity.critical")
    );
    expect(mismatch).toBeDefined();
  });

  it("flags count_mismatch when by_safety_class omits 'red' but an artifact has safety_class=red", () => {
    const result = validateLedgerRaw({
      schema_version: "vmc-quality-ledger/v1",
      module: "x",
      generated_at: "2026-06-23",
      summary: {
        total_artifacts: 1,
        by_type: { risk: 1 },
        by_status: { unknown: 1 },
        by_severity: { high: 1 },
        by_safety_class: { green: 1 }, // omits red — but artifact IS red
      },
      artifacts: [
        { artifact_id: "X-001", module: "x", artifact_type: "risk", title: "t", status: "unknown", severity: "high", safety_class: "red", confidence: 0.5 },
      ],
    });
    expect(result.valid).toBe(false);
    const mismatch = result.errors.find(
      (e) => e.code === "count_mismatch" && e.message.includes("by_safety_class.red")
    );
    expect(mismatch).toBeDefined();
  });
});

// ─── N7 regression — riskRank dead-code removal ────────────────────────────────
// The cleaned riskRank must still correctly rank the real validator codes.

describe("riskRank — N7 regression: real codes rank correctly after dead-code removal", () => {
  it("returns 0 for invalid_json", () => {
    expect(riskRank({ valid: false, healthCode: "invalid_json", ledger: null, errors: [{ code: "invalid_json", message: "" }], freshnessInfo: { level: "unknown", ageDays: null, reason: "" } })).toBe(0);
  });

  it("returns 0 for schema_mismatch", () => {
    expect(riskRank({ valid: false, healthCode: "schema_mismatch", ledger: null, errors: [{ code: "schema_mismatch", message: "" }], freshnessInfo: { level: "unknown", ageDays: null, reason: "" } })).toBe(0);
  });

  it("returns 1 for partial", () => {
    expect(riskRank({ valid: false, healthCode: "partial", ledger: null, errors: [{ code: "count_mismatch", message: "" }], freshnessInfo: { level: "fresh", ageDays: 1, reason: "" } })).toBe(1);
  });

  it("returns 6 for valid fresh ledger with no critical/red artifacts", () => {
    expect(riskRank(validateLedgerRaw(VALID_LEDGER, new Date("2026-06-24")))).toBe(6);
  });
});

// ─── Registry config ──────────────────────────────────────────────────────────

describe("parseRegistryConfig", () => {
  it("accepts a valid registry config", () => {
    const result = parseRegistryConfig({
      schema_version: "plx-loop-ledger-registry/v1",
      freshness: { warn_after_days: 7, stale_after_days: 30 },
      repos: [
        { repo: "org/repo", display_name: "Repo", default_branch: "main", ledger_glob: "docs/*.json" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.repos).toHaveLength(1);
      expect(result.config.freshness.warn_after_days).toBe(7);
    }
  });

  it("rejects wrong schema_version", () => {
    const result = parseRegistryConfig({ schema_version: "wrong/v1", freshness: { warn_after_days: 7, stale_after_days: 30 }, repos: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects empty repos array", () => {
    const result = parseRegistryConfig({
      schema_version: "plx-loop-ledger-registry/v1",
      freshness: { warn_after_days: 7, stale_after_days: 30 },
      repos: [],
    });
    expect(result.ok).toBe(false);
  });

  it("parseRegistryJson rejects invalid JSON", () => {
    const result = parseRegistryJson("{ bad json }");
    expect(result.ok).toBe(false);
  });
});

// ─── Seeded config/loop-ledgers-registry.json ─────────────────────────────────

describe("config/loop-ledgers-registry.json — seeded registry", () => {
  const raw = readFileSync(
    join(process.cwd(), "config/loop-ledgers-registry.json"),
    "utf-8"
  );

  it("parses and validates successfully", () => {
    const result = parseRegistryJson(raw);
    expect(result.ok).toBe(true);
  });

  it("contains exactly 3 repos", () => {
    const result = parseRegistryJson(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.config.repos).toHaveLength(3);
  });

  it("contains all three expected repos", () => {
    const result = parseRegistryJson(raw);
    if (!result.ok) throw new Error(result.error);
    const slugs = result.config.repos.map((r) => r.repo);
    expect(slugs).toContain("taylorvalton/agentic-swarm");
    // The PLX_MC repo slug uses an underscore; the hyphenated "plx-mc" 404s on
    // the GitHub API (hyphen != underscore), so the row would be permanently
    // not_found instead of resolving. Guard against reverting to the hyphen.
    expect(slugs).toContain("taylorvalton/PLX_MC");
    expect(slugs).not.toContain("taylorvalton/plx-mc");
    expect(slugs).toContain("taylorvalton/plx-customer-portal");
  });

  it("uses the correct default branches", () => {
    const result = parseRegistryJson(raw);
    if (!result.ok) throw new Error(result.error);
    const byRepo = Object.fromEntries(result.config.repos.map((r) => [r.repo, r]));
    expect(byRepo["taylorvalton/agentic-swarm"]?.default_branch).toBe("main");
    expect(byRepo["taylorvalton/PLX_MC"]?.default_branch).toBe("main");
    expect(byRepo["taylorvalton/plx-customer-portal"]?.default_branch).toBe("master");
  });

  it("has correct top-level freshness defaults", () => {
    const result = parseRegistryJson(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.config.freshness.warn_after_days).toBe(7);
    expect(result.config.freshness.stale_after_days).toBe(30);
  });
});
