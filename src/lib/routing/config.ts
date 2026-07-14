// Versioned routing policy for the shadow scoring engine.
// Fuzzy auto-link remains permanently disabled for this project/pilot phase.

import policyJson from "../../../config/mc-routing-policy.json";

export interface RoutingScoreWeights {
  exactReference: number;
  repoMatch: number;
  pathOverlap: number;
  titleOverlap: number;
  labelOverlap: number;
  descriptionOverlap: number;
  relatedPr: number;
  activeStage: number;
  defaultBucketPrior: number;
  recency: number;
}

export interface RoutingPolicy {
  policyVersion: string;
  scoringVersion: string;
  suggestionLimit: number;
  detailLimit: number;
  fuzzyAutoLinkEnabled: boolean;
  completedStages: string[];
  weights: RoutingScoreWeights;
}

/** Hard kill switch — never promote fuzzy evidence to auto-link authority. */
export const FUZZY_AUTOLINK_ENABLED = false;

const DEFAULT_POLICY: RoutingPolicy = {
  policyVersion: "routing.v1",
  scoringVersion: "routing.score.v1",
  suggestionLimit: 3,
  detailLimit: 10,
  fuzzyAutoLinkEnabled: false,
  completedStages: ["merged", "verified"],
  weights: {
    exactReference: 100,
    repoMatch: 25,
    pathOverlap: 20,
    titleOverlap: 15,
    labelOverlap: 10,
    descriptionOverlap: 8,
    relatedPr: 12,
    activeStage: 6,
    defaultBucketPrior: 4,
    recency: 5,
  },
};

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Load the committed routing policy. Always forces fuzzyAutoLinkEnabled=false
 * regardless of JSON content so a mis-edited config cannot enable auto-link.
 */
export function loadRoutingPolicy(
  override: Partial<RoutingPolicy> | null = null
): RoutingPolicy {
  const raw = (policyJson ?? {}) as Partial<RoutingPolicy>;
  const weightsRaw = (raw.weights ?? {}) as Partial<RoutingScoreWeights>;
  const baseWeights = DEFAULT_POLICY.weights;

  const policy: RoutingPolicy = {
    policyVersion:
      typeof raw.policyVersion === "string" && raw.policyVersion
        ? raw.policyVersion
        : DEFAULT_POLICY.policyVersion,
    scoringVersion:
      typeof raw.scoringVersion === "string" && raw.scoringVersion
        ? raw.scoringVersion
        : DEFAULT_POLICY.scoringVersion,
    suggestionLimit: Math.max(
      1,
      Math.floor(asNumber(raw.suggestionLimit, DEFAULT_POLICY.suggestionLimit))
    ),
    detailLimit: Math.max(
      1,
      Math.floor(asNumber(raw.detailLimit, DEFAULT_POLICY.detailLimit))
    ),
    fuzzyAutoLinkEnabled: false,
    completedStages: asStringArray(raw.completedStages, DEFAULT_POLICY.completedStages),
    weights: {
      exactReference: asNumber(weightsRaw.exactReference, baseWeights.exactReference),
      repoMatch: asNumber(weightsRaw.repoMatch, baseWeights.repoMatch),
      pathOverlap: asNumber(weightsRaw.pathOverlap, baseWeights.pathOverlap),
      titleOverlap: asNumber(weightsRaw.titleOverlap, baseWeights.titleOverlap),
      labelOverlap: asNumber(weightsRaw.labelOverlap, baseWeights.labelOverlap),
      descriptionOverlap: asNumber(
        weightsRaw.descriptionOverlap,
        baseWeights.descriptionOverlap
      ),
      relatedPr: asNumber(weightsRaw.relatedPr, baseWeights.relatedPr),
      activeStage: asNumber(weightsRaw.activeStage, baseWeights.activeStage),
      defaultBucketPrior: asNumber(
        weightsRaw.defaultBucketPrior,
        baseWeights.defaultBucketPrior
      ),
      recency: asNumber(weightsRaw.recency, baseWeights.recency),
    },
  };

  if (!override) return policy;

  return {
    ...policy,
    ...override,
    fuzzyAutoLinkEnabled: false,
    weights: { ...policy.weights, ...(override.weights ?? {}) },
    completedStages: override.completedStages ?? policy.completedStages,
  };
}

export function isFuzzyAutoLinkEnabled(): boolean {
  return FUZZY_AUTOLINK_ENABLED && loadRoutingPolicy().fuzzyAutoLinkEnabled;
}
