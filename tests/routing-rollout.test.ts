// P10 — Rollout thresholds, pilots, fuzzy kill switch, rolling-breach demotion.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  loadRolloutConfig,
  listPilotDescriptors,
  getPilotByRepo,
  evaluateCohortMetrics,
  evaluateRollingWindow,
  resolveCohortRuntimeState,
  resolveRepoCohortRuntimeState,
  demoteBreachedCohorts,
  isFuzzyAutoLinkAllowedForRollout,
  wilsonLowerBound,
  killSwitchSnapshot,
  rolloutHealth,
  type CohortMetrics,
  type RollingDecision,
  type PilotDescriptor,
  type TrackedRepoEntry,
} from "@/lib/routing/rollout";
import { FUZZY_AUTOLINK_ENABLED } from "@/lib/routing/config";

function metrics(partial: Partial<CohortMetrics>): CohortMetrics {
  return {
    cohortId: "plx-mc",
    reviewedProposals: 300,
    windowDays: 30,
    reposCovered: 5,
    top1Correct: 295,
    duplicates: 0,
    bucketCorrections: 0,
    authIncidents: 0,
    unresolvedAfter24h: 0,
    unresolvedAfter7d: 0,
    totalOpen: 0,
    ...partial,
  };
}

describe("rollout config invariants", () => {
  it("loads research thresholds and forces fuzzy auto-link off", () => {
    const config = loadRolloutConfig();
    expect(config.thresholds.minReviewedProposals).toBe(300);
    expect(config.thresholds.minWindowDays).toBe(30);
    expect(config.thresholds.minRepos).toBe(5);
    expect(config.thresholds.minPerCohort).toBe(20);
    expect(config.thresholds.minTop1Precision).toBe(0.98);
    expect(config.thresholds.minPrecisionCiLowerBound).toBe(0.95);
    expect(config.thresholds.maxDuplicateRate).toBe(0.005);
    expect(config.thresholds.maxBucketCorrectionRate).toBe(0.01);
    expect(config.thresholds.maxAuthIncidents).toBe(0);
    expect(config.thresholds.rollingWindowSize).toBe(100);
    expect(config.fuzzyAutoLinkEnabled).toBe(false);
    expect(config.fuzzyAutoLinkPromotionForbidden).toBe(true);
    expect(config.breachDemotionMode).toBe("suggestion");
    expect(config.maintenance.servicePrincipalId).toBe("sp_routing_maintenance");
    expect(FUZZY_AUTOLINK_ENABLED).toBe(false);
    expect(isFuzzyAutoLinkAllowedForRollout()).toBe(false);
  });

  it("ignores env attempts to enable fuzzy auto-link", () => {
    const prev = process.env.PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED;
    process.env.PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED = "1";
    try {
      expect(isFuzzyAutoLinkAllowedForRollout()).toBe(false);
      expect(killSwitchSnapshot().fuzzyAutoLink.enabled).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED;
      else process.env.PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED = prev;
    }
  });
});

describe("pilot enrollment", () => {
  it("enrolls exactly eight enabled cohorts with the intended modes and fuzzy off", () => {
    const pilots = listPilotDescriptors();
    expect(pilots).toHaveLength(8);
    expect(
      Object.fromEntries(pilots.map((p) => [p.repo, p.mode]))
    ).toEqual({
      "petralabx/PLX_MC": "suggestion",
      "petralabx/plx-customer-portal": "suggestion",
      "petralabx/agentic-swarm": "suggestion",
      "petralabx/skills": "shadow",
      "petralabx/local-inference": "shadow",
      "petralabx/1hr-after": "shadow",
      "petralabx/furgenics": "shadow",
      "petralabx/for-and-against": "shadow",
    });
    for (const pilot of pilots) {
      expect(pilot.fuzzyAutoLinkEnabled).toBe(false);
      expect(pilot.enabled).toBe(true);
    }
    expect(getPilotByRepo("petralabx/PLX_MC")?.activation.status).toBe("central_ready");
    expect(getPilotByRepo("petralabx/plx-customer-portal")?.activation.status).toBe(
      "active"
    );
    expect(getPilotByRepo("petralabx/skills")?.activation.status).toBe(
      "pending_downstream_pr"
    );
    expect(rolloutHealth().ok).toBe(true);
    expect(rolloutHealth().pilots).toBe(8);
    expect(rolloutHealth().reasons).toEqual([]);
    expect(rolloutHealth().configuredModes).toEqual({
      suggestion: 3,
      shadow: 5,
      confirmation: 0,
    });
    expect(rolloutHealth().scope).toBe("descriptor_config");
    expect(loadRolloutConfig().thresholds.minRepos).toBe(5);
    expect(rolloutHealth().deferredChecksApi).toBe(true);
  });

  it("fails closed for unknown and disabled repo cohorts", () => {
    expect(resolveRepoCohortRuntimeState("petralabx/unknown")).toBeNull();

    const plx = getPilotByRepo("petralabx/PLX_MC")!;
    expect(
      resolveRepoCohortRuntimeState(
        plx.repo,
        {},
        [{ ...plx, enabled: false }]
      )
    ).toBeNull();
  });

  it("requires active non-sandbox tracked registry membership", () => {
    const previousShadow = process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
    process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "1";
    const pilot = getPilotByRepo("petralabx/PLX_MC")!;
    const active: TrackedRepoEntry[] = [
      { repo: pilot.repo, status: "active", tier: "hub" },
    ];
    expect(
      resolveRepoCohortRuntimeState(pilot.repo, {}, [pilot], active)
    ).not.toBeNull();
    expect(
      resolveRepoCohortRuntimeState(
        pilot.repo,
        {},
        [pilot],
        [{ ...active[0], status: "inactive" }]
      )
    ).toBeNull();
    expect(
      resolveRepoCohortRuntimeState(pilot.repo, {}, [pilot], [])
    ).toBeNull();
    expect(
      resolveRepoCohortRuntimeState(
        pilot.repo,
        {},
        [pilot],
        [{ ...active[0], tier: "sandbox" }]
      )
    ).toBeNull();
    if (previousShadow === undefined) delete process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
    else process.env.PLX_MC_ROUTING_SHADOW_ENABLED = previousShadow;
  });
});

describe("rollout descriptor health reasons", () => {
  const registryFor = (pilots: PilotDescriptor[]): TrackedRepoEntry[] =>
    pilots.map((pilot) => ({
      repo: pilot.repo,
      status: "active",
      tier: pilot.tier,
      default_bucket: pilot.defaultBucket,
    }));

  it("reports duplicate/count, registry, modes, tier, bucket, and fuzzy failures", () => {
    const pilots = listPilotDescriptors();
    const duplicate = [...pilots, { ...pilots[0], cohortId: "duplicate" }];
    const duplicateHealth = rolloutHealth(duplicate, registryFor(pilots));
    expect(duplicateHealth.reasons).toContain("enabled_pilot_count_not_8");
    expect(duplicateHealth.reasons).toContain("duplicate_enabled_pilot_repo");

    const registryMismatch = registryFor(pilots).slice(1);
    expect(rolloutHealth(pilots, registryMismatch).reasons).toContain(
      "active_registry_intersection_mismatch"
    );

    const wrongMode = [{ ...pilots[0], mode: "shadow" as const }, ...pilots.slice(1)];
    expect(rolloutHealth(wrongMode, registryFor(wrongMode)).reasons).toContain(
      "configured_mode_distribution_mismatch"
    );

    const wrongTier = [{ ...pilots[0], tier: "wrong" }, ...pilots.slice(1)];
    expect(rolloutHealth(wrongTier, registryFor(pilots)).reasons).toContain(
      `tier_mismatch:${pilots[0].repo}`
    );

    const wrongBucket = [
      { ...pilots[0], defaultBucket: "BKT-WRONG" },
      ...pilots.slice(1),
    ];
    expect(rolloutHealth(wrongBucket, registryFor(pilots)).reasons).toContain(
      `default_bucket_mismatch:${pilots[0].repo}`
    );

    const fuzzy = [
      { ...pilots[0], fuzzyAutoLinkEnabled: true },
      ...pilots.slice(1),
    ];
    expect(rolloutHealth(fuzzy, registryFor(fuzzy)).reasons).toContain(
      `fuzzy_enabled:${pilots[0].repo}`
    );
  });
});

describe("metric gates", () => {
  it("wilson lower bound is below raw precision for imperfect samples", () => {
    const lower = wilsonLowerBound(98, 100, 0.95);
    expect(lower).toBeLessThan(0.98);
    expect(lower).toBeGreaterThan(0.9);
  });

  it("passes a strong calibration sample without enabling fuzzy promotion", () => {
    const result = evaluateCohortMetrics(metrics({ top1Correct: 297 }));
    expect(result.ok).toBe(true);
    expect(result.precision).toBeGreaterThanOrEqual(0.98);
    expect(result.precisionCiLowerBound).toBeGreaterThanOrEqual(0.95);
    expect(result.eligibleForPromotionReview).toBe(false);
  });

  it("fails when top-1 precision drops below 98%", () => {
    const result = evaluateCohortMetrics(
      metrics({ reviewedProposals: 100, top1Correct: 96 })
    );
    expect(result.ok).toBe(false);
    expect(result.breaches).toContain("top1_precision_below_98pct");
  });

  it("fails duplicate rate above 0.5% and auth incidents", () => {
    const dup = evaluateCohortMetrics(
      metrics({ reviewedProposals: 200, top1Correct: 200, duplicates: 2 })
    );
    expect(dup.breaches).toContain("duplicate_rate_above_0_5pct");

    const auth = evaluateCohortMetrics(metrics({ authIncidents: 1 }));
    expect(auth.breaches).toContain("auth_or_cross_repo_incident");
  });

  it("fails bucket correction above 1%", () => {
    const result = evaluateCohortMetrics(
      metrics({ reviewedProposals: 100, top1Correct: 100, bucketCorrections: 2 })
    );
    expect(result.breaches).toContain("bucket_correction_rate_above_1pct");
  });
});

describe("rolling-window breach demotion", () => {
  const prevConfirm = process.env.PLX_MC_ROUTING_CONFIRM_ENABLED;
  const prevSuggest = process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
  const prevShadow = process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
  const prevInbox = process.env.PLX_MC_ROUTING_INBOX_ENABLED;

  beforeEach(() => {
    process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "1";
    process.env.PLX_MC_ROUTING_CONFIRM_ENABLED = "1";
    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "1";
    process.env.PLX_MC_ROUTING_INBOX_ENABLED = "1";
  });

  afterEach(() => {
    if (prevConfirm === undefined) delete process.env.PLX_MC_ROUTING_CONFIRM_ENABLED;
    else process.env.PLX_MC_ROUTING_CONFIRM_ENABLED = prevConfirm;
    if (prevSuggest === undefined) delete process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
    else process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = prevSuggest;
    if (prevShadow === undefined) delete process.env.PLX_MC_ROUTING_SHADOW_ENABLED;
    else process.env.PLX_MC_ROUTING_SHADOW_ENABLED = prevShadow;
    if (prevInbox === undefined) delete process.env.PLX_MC_ROUTING_INBOX_ENABLED;
    else process.env.PLX_MC_ROUTING_INBOX_ENABLED = prevInbox;
  });

  it("demotes confirmation cohorts to suggestion-only on rolling breach", () => {
    const pilot: PilotDescriptor = {
      ...getPilotByRepo("petralabx/PLX_MC")!,
      mode: "confirmation",
    };
    const good: RollingDecision[] = Array.from({ length: 100 }, () => ({
      top1Correct: true,
      duplicate: false,
      bucketCorrected: false,
      authIncident: false,
    }));
    const okState = resolveCohortRuntimeState(pilot, { rollingDecisions: good });
    expect(okState.effectiveMode).toBe("confirmation");
    expect(okState.demoted).toBe(false);
    expect(okState.fuzzyAutoLinkEnabled).toBe(false);

    const breached = good.map((d, i) =>
      i < 10 ? { ...d, top1Correct: false, duplicate: true } : d
    );
    const badState = resolveCohortRuntimeState(pilot, { rollingDecisions: breached });
    expect(badState.effectiveMode).toBe("suggestion");
    expect(badState.demoted).toBe(true);
    expect(badState.demotionReasons.some((r) => r.startsWith("rolling:"))).toBe(true);

    const rolling = evaluateRollingWindow(breached);
    expect(rolling.ok).toBe(false);
  });

  it("demoteBreachedCohorts never enables fuzzy auto-link", () => {
    const pilots = listPilotDescriptors().map((p) => ({
      ...p,
      mode: "confirmation" as const,
    }));
    const rolling: Record<string, RollingDecision[]> = {
      "plx-mc": Array.from({ length: 100 }, (_, i) => ({
        top1Correct: i > 5,
        duplicate: i < 3,
        bucketCorrected: false,
        authIncident: false,
      })),
    };
    const states = demoteBreachedCohorts(pilots, rolling);
    expect(states.every((s) => s.fuzzyAutoLinkEnabled === false)).toBe(true);
    const plx = states.find((s) => s.cohortId === "plx-mc")!;
    expect(plx.effectiveMode).toBe("suggestion");
  });
});

describe("kill switches", () => {
  const keys = [
    "PLX_MC_ROUTING_SHADOW_ENABLED",
    "PLX_MC_ROUTING_SUGGEST_ENABLED",
    "PLX_MC_ROUTING_INBOX_ENABLED",
    "PLX_MC_ROUTING_CONFIRM_ENABLED",
  ] as const;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      prev[key] = process.env[key];
      process.env[key] = "1";
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  it("clamps confirmation to suggestion when confirm kill switch is off", () => {
    const pilot: PilotDescriptor = {
      ...getPilotByRepo("petralabx/PLX_MC")!,
      mode: "confirmation",
    };
    process.env.PLX_MC_ROUTING_CONFIRM_ENABLED = "0";
    const state = resolveCohortRuntimeState(pilot);
    expect(state.effectiveMode).toBe("suggestion");
    expect(state.demotionReasons).toContain("confirm_kill_switch");
  });

  it("clamps configured suggestion cohorts to shadow when suggest is off", () => {
    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "0";
    const runtime = resolveRepoCohortRuntimeState("petralabx/PLX_MC");
    expect(runtime?.state.configuredMode).toBe("suggestion");
    expect(runtime?.state.effectiveMode).toBe("shadow");
    expect(runtime?.state.demotionReasons).toContain("suggest_kill_switch");
  });

  it("makes every repo cohort unavailable when shadow is off", () => {
    process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "0";
    for (const pilot of listPilotDescriptors()) {
      expect(resolveRepoCohortRuntimeState(pilot.repo)).toBeNull();
    }
  });

  it("clamps suggestion to shadow when Inbox is off", () => {
    process.env.PLX_MC_ROUTING_INBOX_ENABLED = "0";
    const runtime = resolveRepoCohortRuntimeState("petralabx/PLX_MC");
    expect(runtime?.state.configuredMode).toBe("suggestion");
    expect(runtime?.state.effectiveMode).toBe("shadow");
    expect(runtime?.state.demotionReasons).toContain("inbox_kill_switch");
  });

  it("keeps confirmation visible only when every capability flag is on", () => {
    const pilot: PilotDescriptor = {
      ...getPilotByRepo("petralabx/PLX_MC")!,
      mode: "confirmation",
    };
    expect(resolveCohortRuntimeState(pilot).effectiveMode).toBe("confirmation");

    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "0";
    const clamped = resolveCohortRuntimeState(pilot);
    expect(clamped.configuredMode).toBe("confirmation");
    expect(clamped.effectiveMode).toBe("shadow");
    expect(clamped.demotionReasons).toContain("suggest_kill_switch");
  });
});
