// Rollout modes, metric thresholds, cohort evaluation, and rolling-breach demotion.
// Fuzzy auto-link remains disabled for every pilot; breach demotes to suggestion-only.

import rolloutJson from "../../../config/mc-routing-rollout.json";
import plxMcPilot from "../../../config/routing-pilots/plx-mc.json";
import portalPilot from "../../../config/routing-pilots/plx-customer-portal.json";
import swarmPilot from "../../../config/routing-pilots/agentic-swarm.json";
import skillsPilot from "../../../config/routing-pilots/skills.json";
import localInferencePilot from "../../../config/routing-pilots/local-inference.json";
import { FUZZY_AUTOLINK_ENABLED } from "./config";

export type RolloutMode = "shadow" | "suggestion" | "confirmation";

export interface RolloutThresholds {
  minReviewedProposals: number;
  minWindowDays: number;
  minRepos: number;
  minPerCohort: number;
  minTop1Precision: number;
  minPrecisionCiLowerBound: number;
  ciConfidence: number;
  maxDuplicateRate: number;
  maxBucketCorrectionRate: number;
  maxAuthIncidents: number;
  rollingWindowSize: number;
}

export interface RolloutSla {
  alertUnresolvedHours: number;
  expireUnresolvedUiDays: number;
  maxUnresolvedRateAfter24h: number;
  maxUnresolvedRateAfter7d: number;
}

export interface RolloutRetentionConfig {
  proposalDetailDaysAfterResolution: number;
  finalLinkYearsAfterTaskLifetime: number;
  neverDeleteFinalLinks: boolean;
  neverDeleteAuditEvents: boolean;
  neverPersistRawPrBodies: boolean;
}

export interface RolloutConfig {
  schemaVersion: string;
  policyVersion: string;
  fuzzyAutoLinkEnabled: boolean;
  fuzzyAutoLinkPromotionForbidden: boolean;
  modes: RolloutMode[];
  defaultMode: RolloutMode;
  breachDemotionMode: RolloutMode;
  thresholds: RolloutThresholds;
  sla: RolloutSla;
  retention: RolloutRetentionConfig;
  killSwitches: Record<string, string>;
  maintenance: {
    servicePrincipalId: string;
    capability: string;
    cronPath: string;
    preserveFinalLinks: boolean;
    preserveAudit: boolean;
  };
  deferred: Record<string, string>;
}

export interface PilotDescriptor {
  cohortId: string;
  repo: string;
  displayName: string;
  tier: string;
  enabled: boolean;
  mode: RolloutMode;
  policyVersion: string;
  fuzzyAutoLinkEnabled: boolean;
  activation: {
    status: "central_ready" | "pending_downstream_pr";
    localManifest: string;
    workflowManifest: string;
    notes: string;
  };
  defaultBucket: string;
  owner: string;
}

export interface CohortMetrics {
  cohortId: string;
  reviewedProposals: number;
  windowDays: number;
  reposCovered: number;
  top1Correct: number;
  duplicates: number;
  bucketCorrections: number;
  authIncidents: number;
  unresolvedAfter24h: number;
  unresolvedAfter7d: number;
  totalOpen: number;
}

export interface RollingDecision {
  top1Correct: boolean;
  duplicate: boolean;
  bucketCorrected: boolean;
  authIncident: boolean;
}

export interface ThresholdEvaluation {
  ok: boolean;
  eligibleForPromotionReview: boolean;
  breaches: string[];
  precision: number;
  precisionCiLowerBound: number;
  duplicateRate: number;
  bucketCorrectionRate: number;
}

export interface CohortRuntimeState {
  cohortId: string;
  configuredMode: RolloutMode;
  effectiveMode: RolloutMode;
  demoted: boolean;
  demotionReasons: string[];
  fuzzyAutoLinkEnabled: false;
}

const PILOT_FILES: PilotDescriptor[] = [
  plxMcPilot as PilotDescriptor,
  portalPilot as PilotDescriptor,
  swarmPilot as PilotDescriptor,
  skillsPilot as PilotDescriptor,
  localInferencePilot as PilotDescriptor,
];

const DEFAULT_THRESHOLDS: RolloutThresholds = {
  minReviewedProposals: 300,
  minWindowDays: 30,
  minRepos: 5,
  minPerCohort: 20,
  minTop1Precision: 0.98,
  minPrecisionCiLowerBound: 0.95,
  ciConfidence: 0.95,
  maxDuplicateRate: 0.005,
  maxBucketCorrectionRate: 0.01,
  maxAuthIncidents: 0,
  rollingWindowSize: 100,
};

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asMode(value: unknown, fallback: RolloutMode): RolloutMode {
  if (value === "shadow" || value === "suggestion" || value === "confirmation") {
    return value;
  }
  return fallback;
}

/**
 * Wilson score lower bound for a binomial proportion at the given confidence.
 * Used for the ≥95% CI lower-bound gate on top-1 precision.
 */
export function wilsonLowerBound(
  successes: number,
  trials: number,
  confidence = 0.95
): number {
  if (trials <= 0) return 0;
  const n = trials;
  const p = Math.max(0, Math.min(1, successes / n));
  // z for one-sided lower bound at confidence (approx two-tailed z for (1+c)/2)
  const z =
    confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : confidence >= 0.9 ? 1.645 : 1.96;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom);
}

export function loadRolloutConfig(
  override: Partial<RolloutConfig> | null = null
): RolloutConfig {
  const raw = (rolloutJson ?? {}) as Partial<RolloutConfig>;
  const thr = (raw.thresholds ?? {}) as Partial<RolloutThresholds>;
  const sla = (raw.sla ?? {}) as Partial<RolloutSla>;
  const retention = (raw.retention ?? {}) as Partial<RolloutRetentionConfig>;
  const maintenance = (raw.maintenance ?? {}) as Partial<RolloutConfig["maintenance"]>;

  const config: RolloutConfig = {
    schemaVersion:
      typeof raw.schemaVersion === "string" ? raw.schemaVersion : "mc-routing-rollout/v1",
    policyVersion:
      typeof raw.policyVersion === "string" ? raw.policyVersion : "routing.rollout.v1",
    fuzzyAutoLinkEnabled: false,
    fuzzyAutoLinkPromotionForbidden: true,
    modes: ["shadow", "suggestion", "confirmation"],
    defaultMode: asMode(raw.defaultMode, "shadow"),
    breachDemotionMode: asMode(raw.breachDemotionMode, "suggestion"),
    thresholds: {
      minReviewedProposals: asNumber(
        thr.minReviewedProposals,
        DEFAULT_THRESHOLDS.minReviewedProposals
      ),
      minWindowDays: asNumber(thr.minWindowDays, DEFAULT_THRESHOLDS.minWindowDays),
      minRepos: asNumber(thr.minRepos, DEFAULT_THRESHOLDS.minRepos),
      minPerCohort: asNumber(thr.minPerCohort, DEFAULT_THRESHOLDS.minPerCohort),
      minTop1Precision: asNumber(
        thr.minTop1Precision,
        DEFAULT_THRESHOLDS.minTop1Precision
      ),
      minPrecisionCiLowerBound: asNumber(
        thr.minPrecisionCiLowerBound,
        DEFAULT_THRESHOLDS.minPrecisionCiLowerBound
      ),
      ciConfidence: asNumber(thr.ciConfidence, DEFAULT_THRESHOLDS.ciConfidence),
      maxDuplicateRate: asNumber(
        thr.maxDuplicateRate,
        DEFAULT_THRESHOLDS.maxDuplicateRate
      ),
      maxBucketCorrectionRate: asNumber(
        thr.maxBucketCorrectionRate,
        DEFAULT_THRESHOLDS.maxBucketCorrectionRate
      ),
      maxAuthIncidents: asNumber(
        thr.maxAuthIncidents,
        DEFAULT_THRESHOLDS.maxAuthIncidents
      ),
      rollingWindowSize: asNumber(
        thr.rollingWindowSize,
        DEFAULT_THRESHOLDS.rollingWindowSize
      ),
    },
    sla: {
      alertUnresolvedHours: asNumber(sla.alertUnresolvedHours, 24),
      expireUnresolvedUiDays: asNumber(sla.expireUnresolvedUiDays, 7),
      maxUnresolvedRateAfter24h: asNumber(sla.maxUnresolvedRateAfter24h, 0.1),
      maxUnresolvedRateAfter7d: asNumber(sla.maxUnresolvedRateAfter7d, 0.02),
    },
    retention: {
      proposalDetailDaysAfterResolution: asNumber(
        retention.proposalDetailDaysAfterResolution,
        90
      ),
      finalLinkYearsAfterTaskLifetime: asNumber(
        retention.finalLinkYearsAfterTaskLifetime,
        1
      ),
      neverDeleteFinalLinks: retention.neverDeleteFinalLinks !== false,
      neverDeleteAuditEvents: retention.neverDeleteAuditEvents !== false,
      neverPersistRawPrBodies: retention.neverPersistRawPrBodies !== false,
    },
    killSwitches: {
      ...(typeof raw.killSwitches === "object" && raw.killSwitches
        ? raw.killSwitches
        : {}),
    },
    maintenance: {
      servicePrincipalId:
        typeof maintenance.servicePrincipalId === "string"
          ? maintenance.servicePrincipalId
          : "sp_routing_maintenance",
      capability:
        typeof maintenance.capability === "string"
          ? maintenance.capability
          : "routing.maintain",
      cronPath:
        typeof maintenance.cronPath === "string"
          ? maintenance.cronPath
          : "/api/cron/routing-maintenance",
      preserveFinalLinks: maintenance.preserveFinalLinks !== false,
      preserveAudit: maintenance.preserveAudit !== false,
    },
    deferred: {
      ...(typeof raw.deferred === "object" && raw.deferred ? raw.deferred : {}),
    },
  };

  if (!override) return config;
  return {
    ...config,
    ...override,
    fuzzyAutoLinkEnabled: false,
    fuzzyAutoLinkPromotionForbidden: true,
    thresholds: { ...config.thresholds, ...(override.thresholds ?? {}) },
    sla: { ...config.sla, ...(override.sla ?? {}) },
    retention: { ...config.retention, ...(override.retention ?? {}) },
    maintenance: { ...config.maintenance, ...(override.maintenance ?? {}) },
  };
}

/** Hard invariant — never promote fuzzy auto-link in this project. */
export function isFuzzyAutoLinkAllowedForRollout(): boolean {
  const envOn = (process.env.PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED ?? "0").trim() === "1";
  // Even if env is flipped, project hard-kill + config force off.
  return false && envOn && FUZZY_AUTOLINK_ENABLED && loadRolloutConfig().fuzzyAutoLinkEnabled;
}

export function listPilotDescriptors(): PilotDescriptor[] {
  return PILOT_FILES.map((p) => ({
    ...p,
    fuzzyAutoLinkEnabled: false,
    mode: asMode(p.mode, "shadow"),
  }));
}

export function getPilotByCohortId(cohortId: string): PilotDescriptor | null {
  return listPilotDescriptors().find((p) => p.cohortId === cohortId) ?? null;
}

export function getPilotByRepo(repo: string): PilotDescriptor | null {
  const needle = repo.trim().toLowerCase();
  return (
    listPilotDescriptors().find((p) => p.repo.toLowerCase() === needle) ?? null
  );
}

export function evaluateCohortMetrics(
  metrics: CohortMetrics,
  config: RolloutConfig = loadRolloutConfig()
): ThresholdEvaluation {
  const t = config.thresholds;
  const breaches: string[] = [];
  const precision =
    metrics.reviewedProposals > 0
      ? metrics.top1Correct / metrics.reviewedProposals
      : 0;
  const precisionCiLowerBound = wilsonLowerBound(
    metrics.top1Correct,
    metrics.reviewedProposals,
    t.ciConfidence
  );
  const duplicateRate =
    metrics.reviewedProposals > 0
      ? metrics.duplicates / metrics.reviewedProposals
      : 0;
  const bucketCorrectionRate =
    metrics.reviewedProposals > 0
      ? metrics.bucketCorrections / metrics.reviewedProposals
      : 0;

  if (metrics.reviewedProposals < t.minPerCohort) {
    breaches.push(`sample_size_below_${t.minPerCohort}`);
  }
  if (precision < t.minTop1Precision) {
    breaches.push("top1_precision_below_98pct");
  }
  if (precisionCiLowerBound < t.minPrecisionCiLowerBound) {
    breaches.push("precision_ci_lower_bound_below_95pct");
  }
  if (duplicateRate > t.maxDuplicateRate) {
    breaches.push("duplicate_rate_above_0_5pct");
  }
  if (bucketCorrectionRate > t.maxBucketCorrectionRate) {
    breaches.push("bucket_correction_rate_above_1pct");
  }
  if (metrics.authIncidents > t.maxAuthIncidents) {
    breaches.push("auth_or_cross_repo_incident");
  }

  const sla = config.sla;
  if (metrics.totalOpen > 0) {
    const rate24 = metrics.unresolvedAfter24h / metrics.totalOpen;
    const rate7 = metrics.unresolvedAfter7d / metrics.totalOpen;
    if (rate24 > sla.maxUnresolvedRateAfter24h) {
      breaches.push("sla_unresolved_24h_breach");
    }
    if (rate7 > sla.maxUnresolvedRateAfter7d) {
      breaches.push("sla_unresolved_7d_breach");
    }
  }

  const fleetReady =
    metrics.reviewedProposals >= t.minReviewedProposals &&
    metrics.windowDays >= t.minWindowDays &&
    metrics.reposCovered >= t.minRepos &&
    metrics.reviewedProposals >= t.minPerCohort &&
    precision >= t.minTop1Precision &&
    precisionCiLowerBound >= t.minPrecisionCiLowerBound &&
    duplicateRate <= t.maxDuplicateRate &&
    bucketCorrectionRate <= t.maxBucketCorrectionRate &&
    metrics.authIncidents <= t.maxAuthIncidents;

  return {
    ok: breaches.length === 0,
    eligibleForPromotionReview: fleetReady && !config.fuzzyAutoLinkPromotionForbidden
      ? false // promotion forbidden by this project even when metrics pass
      : false,
    breaches,
    precision,
    precisionCiLowerBound,
    duplicateRate,
    bucketCorrectionRate,
  };
}

export function evaluateRollingWindow(
  decisions: RollingDecision[],
  config: RolloutConfig = loadRolloutConfig()
): ThresholdEvaluation {
  const window = decisions.slice(-config.thresholds.rollingWindowSize);
  const metrics: CohortMetrics = {
    cohortId: "rolling",
    reviewedProposals: window.length,
    windowDays: config.thresholds.minWindowDays,
    reposCovered: config.thresholds.minRepos,
    top1Correct: window.filter((d) => d.top1Correct).length,
    duplicates: window.filter((d) => d.duplicate).length,
    bucketCorrections: window.filter((d) => d.bucketCorrected).length,
    authIncidents: window.filter((d) => d.authIncident).length,
    unresolvedAfter24h: 0,
    unresolvedAfter7d: 0,
    totalOpen: 0,
  };
  return evaluateCohortMetrics(metrics, config);
}

/**
 * Effective mode for a cohort. Rolling-window breach demotes confirmation →
 * suggestion-only. Fuzzy auto-link stays false always.
 */
export function resolveCohortRuntimeState(
  pilot: PilotDescriptor,
  options: {
    rollingDecisions?: RollingDecision[];
    metrics?: CohortMetrics | null;
    config?: RolloutConfig;
  } = {}
): CohortRuntimeState {
  const config = options.config ?? loadRolloutConfig();
  const configuredMode = asMode(pilot.mode, config.defaultMode);
  const demotionReasons: string[] = [];

  if (pilot.fuzzyAutoLinkEnabled || isFuzzyAutoLinkAllowedForRollout()) {
    demotionReasons.push("fuzzy_autolink_forced_off");
  }

  let demoted = false;
  if (options.rollingDecisions && options.rollingDecisions.length > 0) {
    const rolling = evaluateRollingWindow(options.rollingDecisions, config);
    if (!rolling.ok) {
      demoted = true;
      demotionReasons.push(...rolling.breaches.map((b) => `rolling:${b}`));
    }
  }
  if (options.metrics) {
    const evalResult = evaluateCohortMetrics(options.metrics, config);
    const hardBreaches = evalResult.breaches.filter(
      (b) =>
        b.startsWith("duplicate_") ||
        b.startsWith("bucket_") ||
        b.startsWith("auth_") ||
        b.startsWith("sla_")
    );
    if (hardBreaches.length > 0 && configuredMode === "confirmation") {
      demoted = true;
      demotionReasons.push(...hardBreaches.map((b) => `cohort:${b}`));
    }
  }

  let effectiveMode: RolloutMode = configuredMode;
  if (demoted && configuredMode === "confirmation") {
    effectiveMode = config.breachDemotionMode;
  }

  // Shadow/suggestion kill switches can further clamp visibility, but demotion
  // never elevates above configured mode.
  if (!shadowEnabled() && effectiveMode === "shadow") {
    // shadow off = no scoring surface; keep declared mode for audit
  }
  if (!suggestEnabled() && effectiveMode === "suggestion") {
    effectiveMode = "shadow";
    demotionReasons.push("suggest_kill_switch");
  }
  if (!confirmEnabled() && effectiveMode === "confirmation") {
    effectiveMode = "suggestion";
    demotionReasons.push("confirm_kill_switch");
  }

  return {
    cohortId: pilot.cohortId,
    configuredMode,
    effectiveMode,
    demoted: demoted || demotionReasons.some((r) => r.startsWith("rolling:")),
    demotionReasons,
    fuzzyAutoLinkEnabled: false,
  };
}

/** Apply automatic demotion when a confirmation cohort breaches the rolling window. */
export function demoteBreachedCohorts(
  pilots: PilotDescriptor[] = listPilotDescriptors(),
  rollingByCohort: Record<string, RollingDecision[]> = {},
  config: RolloutConfig = loadRolloutConfig()
): CohortRuntimeState[] {
  return pilots.map((pilot) =>
    resolveCohortRuntimeState(pilot, {
      rollingDecisions: rollingByCohort[pilot.cohortId] ?? [],
      config,
    })
  );
}

export function shadowEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_SHADOW_ENABLED ?? "0").trim() === "1";
}

export function suggestEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_SUGGEST_ENABLED ?? "0").trim() === "1";
}

export function confirmEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_CONFIRM_ENABLED ?? "0").trim() === "1";
}

export function proposalsEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_PROPOSALS_ENABLED ?? "1").trim() !== "0";
}

export function metadataEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_METADATA_ENABLED ?? "1").trim() !== "0";
}

export function inboxEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_INBOX_ENABLED ?? "0").trim() === "1";
}

export function maintenanceEnabled(): boolean {
  return (process.env.PLX_MC_ROUTING_MAINTENANCE_ENABLED ?? "1").trim() !== "0";
}

export function killSwitchSnapshot(): Record<string, { env: string; enabled: boolean }> {
  const config = loadRolloutConfig();
  return {
    shadow: { env: config.killSwitches.shadow ?? "PLX_MC_ROUTING_SHADOW_ENABLED", enabled: shadowEnabled() },
    suggest: { env: config.killSwitches.suggest ?? "PLX_MC_ROUTING_SUGGEST_ENABLED", enabled: suggestEnabled() },
    confirm: { env: config.killSwitches.confirm ?? "PLX_MC_ROUTING_CONFIRM_ENABLED", enabled: confirmEnabled() },
    fuzzyAutoLink: {
      env: config.killSwitches.fuzzyAutoLink ?? "PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED",
      enabled: isFuzzyAutoLinkAllowedForRollout(),
    },
    proposals: {
      env: config.killSwitches.proposals ?? "PLX_MC_ROUTING_PROPOSALS_ENABLED",
      enabled: proposalsEnabled(),
    },
    metadata: {
      env: config.killSwitches.metadata ?? "PLX_MC_ROUTING_METADATA_ENABLED",
      enabled: metadataEnabled(),
    },
    inbox: { env: config.killSwitches.inbox ?? "PLX_MC_ROUTING_INBOX_ENABLED", enabled: inboxEnabled() },
    maintenance: {
      env: config.killSwitches.maintenance ?? "PLX_MC_ROUTING_MAINTENANCE_ENABLED",
      enabled: maintenanceEnabled(),
    },
  };
}

export function rolloutHealth(): {
  ok: boolean;
  pilots: number;
  fuzzyAutoLinkEnabled: false;
  killSwitches: ReturnType<typeof killSwitchSnapshot>;
  deferredChecksApi: true;
} {
  const pilots = listPilotDescriptors();
  const allFuzzyOff = pilots.every((p) => p.fuzzyAutoLinkEnabled === false);
  return {
    ok: allFuzzyOff && !isFuzzyAutoLinkAllowedForRollout() && pilots.length === 5,
    pilots: pilots.length,
    fuzzyAutoLinkEnabled: false,
    killSwitches: killSwitchSnapshot(),
    deferredChecksApi: true,
  };
}
