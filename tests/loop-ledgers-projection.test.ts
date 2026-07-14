// Unit tests for the ledger→initiative-board projection (finance-ledger-projection P1):
// projectMilestones, projectTrace, and the plx-bucket-ledger-map/v1 config parser.
// Style mirrors tests/loop-ledgers-validator.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bindingsForBucket,
  parseBucketLedgerMapJson,
  projectMilestones,
  projectTrace,
} from "@/lib/loop-ledgers";
import type { Artifact, ArtifactStatus, QualityLedger } from "@/lib/loop-ledgers";
import type { TraceStatus } from "@/lib/mc-data";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const makeArtifact = (overrides: Partial<Artifact>): Artifact => ({
  artifact_id: "FN-001",
  module: "finance-business-central",
  artifact_type: "defect",
  title: "test artifact",
  status: "broken",
  severity: "medium",
  safety_class: "yellow",
  confidence: 0.5,
  ...overrides,
});

const makeLedger = (artifacts: Artifact[]): QualityLedger => ({
  schema_version: "vmc-quality-ledger/v1",
  module: "finance-business-central",
  generated_at: "2026-07-01",
  branch: "staging",
  summary: {
    total_artifacts: artifacts.length,
    by_type: {},
    by_status: {},
    by_severity: {},
    by_safety_class: {},
  },
  artifacts,
});

const ALL_STATUSES: ArtifactStatus[] = [
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
];

// ─── projectTrace — status mapping matrix ─────────────────────────────────────

describe("projectTrace — full status→TraceStatus mapping matrix", () => {
  const expected: Record<ArtifactStatus, TraceStatus> = {
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

  it("covers all 11 ArtifactStatus values", () => {
    expect(Object.keys(expected).sort()).toEqual([...ALL_STATUSES].sort());
  });

  for (const status of ALL_STATUSES) {
    it(`maps ${status} → ${expected[status]}`, () => {
      const ledger = makeLedger([makeArtifact({ status })]);
      const trace = projectTrace(ledger, "BKT-FIN");
      expect(trace.rows).toHaveLength(1);
      expect(trace.rows[0].status).toBe(expected[status]);
    });
  }
});

// ─── projectTrace — row fields ────────────────────────────────────────────────

describe("projectTrace — row fields", () => {
  it("sets req to artifact_id, bucket on the trace, empty tasks/prs, merge dash", () => {
    const ledger = makeLedger([makeArtifact({ artifact_id: "FN-007" })]);
    const trace = projectTrace(ledger, "BKT-FIN");
    expect(trace.bucket).toBe("BKT-FIN");
    expect(trace.rows[0].req).toBe("FN-007");
    expect(trace.rows[0].tasks).toEqual([]);
    expect(trace.rows[0].prs).toEqual([]);
    expect(trace.rows[0].merge).toBe("—");
  });

  it("evidence is complete when the artifact has evidence entries", () => {
    const ledger = makeLedger([makeArtifact({ evidence: ["docs/evidence/fn.txt"] })]);
    expect(projectTrace(ledger, "BKT-FIN").rows[0].evidence).toBe("complete");
  });

  it("evidence is incomplete when evidence is empty or missing", () => {
    const empty = makeLedger([makeArtifact({ evidence: [] })]);
    expect(projectTrace(empty, "BKT-FIN").rows[0].evidence).toBe("incomplete");
    const missing = makeLedger([makeArtifact({ evidence: undefined })]);
    expect(projectTrace(missing, "BKT-FIN").rows[0].evidence).toBe("incomplete");
  });

  it("test uses the first tests_existing entry", () => {
    const ledger = makeLedger([
      makeArtifact({ tests_existing: ["tests/fn-a.test.ts", "tests/fn-b.test.ts"] }),
    ]);
    expect(projectTrace(ledger, "BKT-FIN").rows[0].test).toBe("tests/fn-a.test.ts");
  });

  it("test falls back to — when tests_existing is empty or missing", () => {
    const empty = makeLedger([makeArtifact({ tests_existing: [] })]);
    expect(projectTrace(empty, "BKT-FIN").rows[0].test).toBe("—");
    const missing = makeLedger([makeArtifact({ tests_existing: undefined })]);
    expect(projectTrace(missing, "BKT-FIN").rows[0].test).toBe("—");
  });

  it("empty artifacts array → empty rows", () => {
    const trace = projectTrace(makeLedger([]), "BKT-FIN");
    expect(trace.bucket).toBe("BKT-FIN");
    expect(trace.rows).toEqual([]);
  });
});

// ─── projectMilestones — derivation rules ─────────────────────────────────────

describe("projectMilestones — derivation", () => {
  it("includes only artifacts with a non-empty next_action", () => {
    const ledger = makeLedger([
      makeArtifact({ artifact_id: "FN-001", next_action: "fix the mapping" }),
      makeArtifact({ artifact_id: "FN-002", next_action: undefined }),
      makeArtifact({ artifact_id: "FN-003", next_action: "" }),
    ]);
    const milestones = projectMilestones(ledger, "BKT-FIN");
    expect(milestones).toHaveLength(1);
    expect(milestones[0].id).toBe("LM-finance-business-central-FN-001");
  });

  it("excludes terminal statuses (verified/covered/waived) even with a next_action", () => {
    const terminal: ArtifactStatus[] = ["verified", "covered", "waived"];
    const ledger = makeLedger(
      terminal.map((status, i) =>
        makeArtifact({
          artifact_id: `FN-00${i + 1}`,
          status,
          next_action: "leftover note",
          evidence: ["e.txt"],
        })
      )
    );
    expect(projectMilestones(ledger, "BKT-FIN")).toEqual([]);
  });

  it("includes every non-terminal status when next_action is present", () => {
    const nonTerminal = ALL_STATUSES.filter(
      (s) => !["verified", "covered", "waived"].includes(s)
    );
    const ledger = makeLedger(
      nonTerminal.map((status, i) =>
        makeArtifact({ artifact_id: `FN-${100 + i}`, status, next_action: "do it" })
      )
    );
    expect(projectMilestones(ledger, "BKT-FIN")).toHaveLength(nonTerminal.length);
  });

  it("sets id, bucket, name, col=0, and sp provenance", () => {
    const ledger = makeLedger([
      makeArtifact({ artifact_id: "FN-009", next_action: "wire the ledger feed" }),
    ]);
    const [m] = projectMilestones(ledger, "BKT-FIN");
    expect(m.id).toBe("LM-finance-business-central-FN-009");
    expect(m.bucket).toBe("BKT-FIN");
    expect(m.name).toBe("FN-009 — wire the ledger feed");
    expect(m.col).toBe(0);
    expect(m.sp).toBe("Quality Ledger · finance-business-central");
  });

  it("empty artifacts array → empty milestones", () => {
    expect(projectMilestones(makeLedger([]), "BKT-FIN")).toEqual([]);
  });
});

// ─── projectMilestones — risk state ───────────────────────────────────────────

describe("projectMilestones — risk state rules", () => {
  it("red safety_class → risk regardless of status", () => {
    const ledger = makeLedger([
      makeArtifact({ status: "missing_test", safety_class: "red", next_action: "n" }),
    ]);
    expect(projectMilestones(ledger, "BKT-FIN")[0].state).toBe("risk");
  });

  for (const status of ["broken", "partially_broken", "blocked"] as ArtifactStatus[]) {
    it(`${status} → risk even with green safety_class`, () => {
      const ledger = makeLedger([
        makeArtifact({ status, safety_class: "green", next_action: "n" }),
      ]);
      expect(projectMilestones(ledger, "BKT-FIN")[0].state).toBe("risk");
    });
  }

  it("non-risk status with green/yellow safety_class → now", () => {
    const ledger = makeLedger([
      makeArtifact({ status: "missing_test", safety_class: "green", next_action: "n" }),
      makeArtifact({ artifact_id: "FN-002", status: "unknown", safety_class: "yellow", next_action: "n" }),
    ]);
    const states = projectMilestones(ledger, "BKT-FIN").map((m) => m.state);
    expect(states).toEqual(["now", "now"]);
  });
});

// ─── projectMilestones — scariest-first ordering ──────────────────────────────

describe("projectMilestones — scariest-first ordering", () => {
  it("red/critical artifacts sort before healthy ones (riskRank 3 before 6)", () => {
    const ledger = makeLedger([
      makeArtifact({
        artifact_id: "FN-CALM",
        status: "missing_test",
        severity: "low",
        safety_class: "green",
        confidence: 0.9,
        next_action: "add a test",
      }),
      makeArtifact({
        artifact_id: "FN-SCARY",
        status: "broken",
        severity: "critical",
        safety_class: "red",
        confidence: 0.9,
        next_action: "fix now",
      }),
    ]);
    const ids = projectMilestones(ledger, "BKT-FIN").map((m) => m.id);
    expect(ids).toEqual([
      "LM-finance-business-central-FN-SCARY",
      "LM-finance-business-central-FN-CALM",
    ]);
  });

  it("within the same rank, lower confidence sorts first", () => {
    const ledger = makeLedger([
      makeArtifact({
        artifact_id: "FN-SURE",
        status: "missing_test",
        safety_class: "green",
        confidence: 0.9,
        next_action: "n",
      }),
      makeArtifact({
        artifact_id: "FN-SHAKY",
        status: "missing_test",
        safety_class: "green",
        confidence: 0.2,
        next_action: "n",
      }),
    ]);
    const ids = projectMilestones(ledger, "BKT-FIN").map((m) => m.id);
    expect(ids).toEqual([
      "LM-finance-business-central-FN-SHAKY",
      "LM-finance-business-central-FN-SURE",
    ]);
  });
});

// ─── parseBucketLedgerMapJson ─────────────────────────────────────────────────

describe("parseBucketLedgerMapJson", () => {
  const validRaw = JSON.stringify({
    schema_version: "plx-bucket-ledger-map/v1",
    bindings: [
      { bucket: "BKT-FIN", repo: "petralabx/plx-customer-portal", module: "finance-business-central" },
    ],
  });

  it("accepts a valid map", () => {
    const result = parseBucketLedgerMapJson(validRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.bindings).toHaveLength(1);
      expect(result.config.bindings[0].bucket).toBe("BKT-FIN");
    }
  });

  it("rejects invalid JSON and never throws", () => {
    expect(() => parseBucketLedgerMapJson("{ bad json }")).not.toThrow();
    const result = parseBucketLedgerMapJson("{ bad json }");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not parseable/);
  });

  it("rejects wrong schema_version", () => {
    const result = parseBucketLedgerMapJson(
      JSON.stringify({ schema_version: "plx-bucket-ledger-map/v2", bindings: [] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/schema_version/);
  });

  it("rejects missing bindings array", () => {
    const result = parseBucketLedgerMapJson(
      JSON.stringify({ schema_version: "plx-bucket-ledger-map/v1" })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a binding with missing required fields", () => {
    const result = parseBucketLedgerMapJson(
      JSON.stringify({
        schema_version: "plx-bucket-ledger-map/v1",
        bindings: [{ bucket: "BKT-FIN", repo: "petralabx/plx-customer-portal" }],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/module/);
  });

  it("rejects empty-string fields", () => {
    const result = parseBucketLedgerMapJson(
      JSON.stringify({
        schema_version: "plx-bucket-ledger-map/v1",
        bindings: [{ bucket: "", repo: "r", module: "m" }],
      })
    );
    expect(result.ok).toBe(false);
  });
});

// ─── bindingsForBucket ────────────────────────────────────────────────────────

describe("bindingsForBucket", () => {
  const config = {
    schema_version: "plx-bucket-ledger-map/v1" as const,
    bindings: [
      { bucket: "BKT-FIN", repo: "petralabx/plx-customer-portal", module: "finance-business-central" },
      { bucket: "BKT-WMS", repo: "petralabx/plx-customer-portal", module: "mrp-wms" },
    ],
  };

  it("returns the bindings for a known bucket", () => {
    const hits = bindingsForBucket(config, "BKT-FIN");
    expect(hits).toHaveLength(1);
    expect(hits[0].module).toBe("finance-business-central");
  });

  it("returns an empty array for an unknown bucket", () => {
    expect(bindingsForBucket(config, "BKT-NOPE")).toEqual([]);
  });
});

// ─── Seeded config/bucket-ledger-map.json ─────────────────────────────────────

describe("config/bucket-ledger-map.json — seeded map", () => {
  const raw = readFileSync(join(process.cwd(), "config/bucket-ledger-map.json"), "utf-8");

  it("parses and validates successfully", () => {
    const result = parseBucketLedgerMapJson(raw);
    expect(result.ok).toBe(true);
  });

  it("binds BKT-FIN and BKT-WMS to the confirmed portal modules", () => {
    const result = parseBucketLedgerMapJson(raw);
    if (!result.ok) throw new Error(result.error);
    const fin = bindingsForBucket(result.config, "BKT-FIN");
    expect(fin).toEqual([
      { bucket: "BKT-FIN", repo: "petralabx/plx-customer-portal", module: "finance-business-central" },
    ]);
    const wms = bindingsForBucket(result.config, "BKT-WMS");
    expect(wms).toEqual([
      { bucket: "BKT-WMS", repo: "petralabx/plx-customer-portal", module: "mrp-wms" },
    ]);
  });
});
