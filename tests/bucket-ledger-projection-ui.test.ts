// Tests for the bucket-projection endpoint logic (finance-ledger-projection P2):
// binding resolution + merge + degraded handling (projectBucketFromRows fed by
// listLedgerSummaries over a stub source — no network), plus the pure UI
// milestone-merge helper. Stub pattern mirrors tests/loop-ledgers-adapters.test.ts.

import { describe, expect, it } from "vitest";

import {
  bindingsForBucket,
  listLedgerSummaries,
  projectBucketFromRows,
} from "@/lib/loop-ledgers";
import type {
  Artifact,
  BucketLedgerBinding,
  BucketLedgerMapConfig,
  LedgerSource,
  LedgerSourceResult,
  QualityLedger,
  RegistryConfig,
} from "@/lib/loop-ledgers";
import { mergeMilestones } from "@/components/mc/bucket-detail";
import type { Milestone } from "@/lib/mc-data";

// ─── Fixture factories ────────────────────────────────────────────────────────

const PORTAL = "petralabx/plx-customer-portal";

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

function tallyBy(artifacts: Artifact[], pick: (a: Artifact) => string) {
  const out: Record<string, number> = {};
  for (const a of artifacts) out[pick(a)] = (out[pick(a)] ?? 0) + 1;
  return out;
}

/** A ledger that passes validateLedgerRaw (summary reconciles, fresh date). */
const makeLedger = (module: string, artifacts: Artifact[]): QualityLedger => ({
  schema_version: "vmc-quality-ledger/v1",
  module,
  generated_at: new Date().toISOString(),
  branch: "staging",
  summary: {
    total_artifacts: artifacts.length,
    by_type: tallyBy(artifacts, (a) => a.artifact_type),
    by_status: tallyBy(artifacts, (a) => a.status),
    by_severity: tallyBy(artifacts, (a) => a.severity),
    by_safety_class: tallyBy(artifacts, (a) => a.safety_class),
  },
  artifacts,
});

function makeRegistry(repos?: RegistryConfig["repos"]): RegistryConfig {
  return {
    schema_version: "plx-loop-ledger-registry/v1",
    freshness: { warn_after_days: 7, stale_after_days: 30 },
    repos: repos ?? [
      {
        repo: PORTAL,
        display_name: "PLX Customer Portal",
        default_branch: "staging",
        ledger_glob: "docs/portal/quality-ledger/*.artifacts.json",
      },
    ],
  };
}

const binding = (
  bucket: string,
  module: string,
  repo = PORTAL
): BucketLedgerBinding => ({ bucket, repo, module });

// ─── Stub source (no network — see tests/loop-ledgers-adapters.test.ts) ───────

function stubSource(resultsByRepo: Record<string, LedgerSourceResult>): LedgerSource {
  return {
    async listLedgers(registry) {
      return registry.repos.map(
        (e) =>
          resultsByRepo[e.repo] ?? {
            ok: false as const,
            repo: e.repo,
            reason: "not_found" as const,
            note: "stub: no result configured",
          }
      );
    },
    async getLedger(ref) {
      return { ok: false, ref, reason: "not_found", note: "stub" };
    },
  };
}

function okResult(repo: string, ledgers: QualityLedger[]): LedgerSourceResult {
  return {
    ok: true,
    repo,
    ledgers: ledgers.map((l) => ({
      ref: {
        repo,
        branch: "staging",
        path: `docs/portal/quality-ledger/${l.module}.artifacts.json`,
      },
      raw: JSON.stringify(l),
    })),
  };
}

/** Endpoint pipeline minus the fs reads: load rows for bound repos, project. */
async function projectViaLoader(
  bucketId: string,
  bindings: BucketLedgerBinding[],
  registry: RegistryConfig,
  source: LedgerSource
) {
  const boundRepos = new Set(bindings.map((b) => b.repo));
  const scoped = { ...registry, repos: registry.repos.filter((r) => boundRepos.has(r.repo)) };
  const rows = await listLedgerSummaries(scoped, source);
  return projectBucketFromRows(bucketId, bindings, rows);
}

// ─── Bound bucket — happy path ────────────────────────────────────────────────

describe("bucket projection — bound bucket happy path", () => {
  const artifacts = [
    makeArtifact({ artifact_id: "FN-001", status: "broken", next_action: "fix mapping" }),
    makeArtifact({ artifact_id: "FN-002", status: "verified", evidence: ["e.txt"] }),
    makeArtifact({ artifact_id: "FN-003", status: "missing_test" }),
  ];
  const ledger = makeLedger("finance-business-central", artifacts);

  it("projects milestones + merged trace from a valid ledger", async () => {
    const result = await projectViaLoader(
      "BKT-FIN",
      [binding("BKT-FIN", "finance-business-central")],
      makeRegistry(),
      stubSource({ [PORTAL]: okResult(PORTAL, [ledger]) })
    );

    expect(result.bound).toBe(true);
    if (!result.bound) return;

    // Only FN-001 has a next_action and a non-terminal status.
    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].id).toBe("LM-finance-business-central-FN-001");
    expect(result.milestones[0].bucket).toBe("BKT-FIN");
    expect(result.milestones[0].sp).toBe("Quality Ledger · finance-business-central");
    expect(result.milestones[0].col).toBe(0);

    // Trace carries one row per artifact.
    expect(result.trace).not.toBeNull();
    expect(result.trace?.bucket).toBe("BKT-FIN");
    expect(result.trace?.rows).toHaveLength(3);
    expect(result.trace?.rows.map((r) => r.status).sort()).toEqual([
      "gap",
      "in-progress",
      "satisfied",
    ]);

    // Source provenance: valid, no degraded marker.
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].repo).toBe(PORTAL);
    expect(result.sources[0].module).toBe("finance-business-central");
    expect(result.sources[0].generatedAt).toBe(ledger.generated_at);
    expect(result.sources[0].degraded).toBeUndefined();
  });
});

// ─── Multi-binding merge ──────────────────────────────────────────────────────

describe("bucket projection — multi-binding merge", () => {
  it("merges milestones and trace rows across bindings", async () => {
    const finLedger = makeLedger("finance-business-central", [
      makeArtifact({ artifact_id: "FN-001", next_action: "fix fin" }),
    ]);
    const wmsLedger = makeLedger("mrp-wms", [
      makeArtifact({ artifact_id: "WM-001", module: "mrp-wms", next_action: "fix wms" }),
      makeArtifact({ artifact_id: "WM-002", module: "mrp-wms", status: "covered" }),
    ]);

    const result = await projectViaLoader(
      "BKT-OPS",
      [
        binding("BKT-OPS", "finance-business-central"),
        binding("BKT-OPS", "mrp-wms"),
      ],
      makeRegistry(),
      stubSource({ [PORTAL]: okResult(PORTAL, [finLedger, wmsLedger]) })
    );

    expect(result.bound).toBe(true);
    if (!result.bound) return;

    expect(result.milestones.map((m) => m.id).sort()).toEqual([
      "LM-finance-business-central-FN-001",
      "LM-mrp-wms-WM-001",
    ]);
    expect(result.trace?.rows).toHaveLength(3);
    expect(result.trace?.rows.map((r) => r.req).sort()).toEqual([
      "FN-001",
      "WM-001",
      "WM-002",
    ]);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((s) => s.degraded === undefined)).toBe(true);
  });
});

// ─── Unbound bucket ───────────────────────────────────────────────────────────

describe("bucket projection — unbound bucket", () => {
  const config: BucketLedgerMapConfig = {
    schema_version: "plx-bucket-ledger-map/v1",
    bindings: [binding("BKT-FIN", "finance-business-central")],
  };

  it("returns bound:false when the bucket has no bindings", async () => {
    const bindings = bindingsForBucket(config, "BKT-NOPE");
    const result = await projectViaLoader(
      "BKT-NOPE",
      bindings,
      makeRegistry(),
      stubSource({})
    );
    expect(result).toEqual({ bound: false });
  });
});

// ─── Degraded handling ────────────────────────────────────────────────────────

describe("bucket projection — degraded handling", () => {
  it("degraded source → degraded entry, no fabricated rows", async () => {
    const result = await projectViaLoader(
      "BKT-FIN",
      [binding("BKT-FIN", "finance-business-central")],
      makeRegistry(),
      stubSource({
        [PORTAL]: {
          ok: false,
          repo: PORTAL,
          reason: "token_missing",
          note: "GITHUB_TOKEN is not set",
        },
      })
    );

    expect(result.bound).toBe(true);
    if (!result.bound) return;
    expect(result.milestones).toEqual([]);
    expect(result.trace).toBeNull();
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].degraded).toContain("token_missing");
  });

  it("degraded (invalid) ledger → degraded entry, no fabricated rows", async () => {
    // Summary count mismatch → validator marks the ledger partial (invalid).
    const broken = {
      ...makeLedger("finance-business-central", [
        makeArtifact({ artifact_id: "FN-001", next_action: "n" }),
      ]),
      summary: {
        total_artifacts: 99,
        by_type: {},
        by_status: {},
        by_severity: {},
        by_safety_class: {},
      },
    };

    const result = await projectViaLoader(
      "BKT-FIN",
      [binding("BKT-FIN", "finance-business-central")],
      makeRegistry(),
      stubSource({ [PORTAL]: okResult(PORTAL, [broken as QualityLedger]) })
    );

    expect(result.bound).toBe(true);
    if (!result.bound) return;
    expect(result.milestones).toEqual([]);
    expect(result.trace).toBeNull();
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].degraded).toContain("degraded ledger (partial)");
  });

  it("module not found in an otherwise valid repo → degraded entry", async () => {
    const otherModule = makeLedger("mrp-wms", [
      makeArtifact({ artifact_id: "WM-001", module: "mrp-wms" }),
    ]);

    const result = await projectViaLoader(
      "BKT-FIN",
      [binding("BKT-FIN", "finance-business-central")],
      makeRegistry(),
      stubSource({ [PORTAL]: okResult(PORTAL, [otherModule]) })
    );

    expect(result.bound).toBe(true);
    if (!result.bound) return;
    expect(result.milestones).toEqual([]);
    expect(result.trace).toBeNull();
    expect(result.sources[0].degraded).toBe(
      'no ledger found for module "finance-business-central"'
    );
  });

  it("bound repo absent from the registry → degraded entry (no rows)", async () => {
    const result = await projectViaLoader(
      "BKT-FIN",
      [binding("BKT-FIN", "finance-business-central", "petralabx/not-registered")],
      makeRegistry(),
      stubSource({})
    );

    expect(result.bound).toBe(true);
    if (!result.bound) return;
    expect(result.milestones).toEqual([]);
    expect(result.trace).toBeNull();
    expect(result.sources[0].degraded).toContain("no ledger found");
  });

  it("mixed valid + degraded bindings → valid rows kept, degraded surfaced", async () => {
    const finLedger = makeLedger("finance-business-central", [
      makeArtifact({ artifact_id: "FN-001", next_action: "fix fin" }),
    ]);

    const result = await projectViaLoader(
      "BKT-OPS",
      [
        binding("BKT-OPS", "finance-business-central"),
        binding("BKT-OPS", "mrp-wms"),
      ],
      makeRegistry(),
      stubSource({ [PORTAL]: okResult(PORTAL, [finLedger]) })
    );

    expect(result.bound).toBe(true);
    if (!result.bound) return;
    expect(result.milestones).toHaveLength(1);
    expect(result.trace?.rows).toHaveLength(1);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].degraded).toBeUndefined();
    expect(result.sources[1].degraded).toBe('no ledger found for module "mrp-wms"');
  });
});

// ─── mergeMilestones (UI helper) ──────────────────────────────────────────────

describe("mergeMilestones — fixture + ledger merge", () => {
  const fixture: Milestone = {
    id: "M-1",
    bucket: "BKT-FIN",
    name: "Fixture milestone",
    col: 2,
    state: "now",
    sp: "Milestone Register",
  };
  const ledgerDerived: Milestone = {
    id: "LM-finance-business-central-FN-001",
    bucket: "BKT-FIN",
    name: "FN-001 — fix mapping",
    col: 0,
    state: "risk",
    sp: "Quality Ledger · finance-business-central",
  };

  it("keeps fixture rows first, ledger rows after", () => {
    expect(mergeMilestones([fixture], [ledgerDerived])).toEqual([fixture, ledgerDerived]);
  });

  it("handles empty sides without fabricating rows", () => {
    expect(mergeMilestones([], [])).toEqual([]);
    expect(mergeMilestones([fixture], [])).toEqual([fixture]);
    expect(mergeMilestones([], [ledgerDerived])).toEqual([ledgerDerived]);
  });
});
