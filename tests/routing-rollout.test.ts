// P10 — Rollout thresholds, pilots, fuzzy kill switch, rolling-breach demotion.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  loadRolloutConfig,
  listPilotDescriptors,
  getPilotByRepo,
  evaluateCohortMetrics,
  evaluateRollingWindow,
  resolveCohortRuntimeState,
  demoteBreachedCohorts,
  isFuzzyAutoLinkAllowedForRollout,
  wilsonLowerBound,
  killSwitchSnapshot,
  rolloutHealth,
  type CohortMetrics,
  type RollingDecision,
  type PilotDescriptor,
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
  it("enrolls exactly the five intended pilots with fuzzy off", () => {
    const pilots = listPilotDescriptors();
    expect(pilots).toHaveLength(5);
    expect(pilots.map((p) => p.cohortId).sort()).toEqual(
      [
        "agentic-swarm",
        "local-inference",
        "plx-customer-portal",
        "plx-mc",
        "skills",
      ].sort()
    );
    for (const pilot of pilots) {
      expect(pilot.fuzzyAutoLinkEnabled).toBe(false);
      expect(pilot.enabled).toBe(true);
      expect(pilot.mode).toBe("shadow");
    }
    expect(getPilotByRepo("petralabx/PLX_MC")?.activation.status).toBe("central_ready");
    expect(getPilotByRepo("petralabx/skills")?.activation.status).toBe(
      "pending_downstream_pr"
    );
    expect(rolloutHealth().ok).toBe(true);
    expect(rolloutHealth().deferredChecksApi).toBe(true);
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

  beforeEach(() => {
    process.env.PLX_MC_ROUTING_CONFIRM_ENABLED = "1";
    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "1";
  });

  afterEach(() => {
    if (prevConfirm === undefined) delete process.env.PLX_MC_ROUTING_CONFIRM_ENABLED;
    else process.env.PLX_MC_ROUTING_CONFIRM_ENABLED = prevConfirm;
    if (prevSuggest === undefined) delete process.env.PLX_MC_ROUTING_SUGGEST_ENABLED;
    else process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = prevSuggest;
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
    "PLX_MC_ROUTING_CONFIRM_ENABLED",
  ] as const;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      prev[key] = process.env[key];
      delete process.env[key];
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
    process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "1";
    const state = resolveCohortRuntimeState(pilot);
    expect(state.effectiveMode).toBe("suggestion");
    expect(state.demotionReasons).toContain("confirm_kill_switch");
  });
});
