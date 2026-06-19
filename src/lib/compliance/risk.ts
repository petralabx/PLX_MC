// Risk-tier classification (EN-007 decision 12). Pure: a change's tier is a
// function of the paths it touches plus any explicit labels. High-risk paths
// track the governance contract's Database Safety / External Integrations
// concerns (migrations, auth/permissions, infra/deploy).

import type { BundleRequirement, RiskTier } from "./types";

const HIGH_PATH: RegExp[] = [
  /(^|\/)db\/migrations\//i,
  /(^|\/)auth(\/|\.)/i,
  /permission/i,
  /(^|\/)infra\//i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)terraform\//i,
  /(^|\/)Dockerfile$/i,
  /(^|\/)deploy/i,
];

const LOW_PATH: RegExp[] = [
  /(^|\/)docs\//i,
  /\.md$/i,
  /(^|\/)tests?\//i,
  /\.(test|spec)\.[tj]sx?$/i,
];

const hasLabel = (labels: string[], name: string): boolean =>
  labels.some((l) => l.trim().toLowerCase() === name);

// Precedence: explicit label override > any high-risk path > docs/test-only
// (low) > standard. An empty change set is treated as low (nothing to gate).
export function classifyRiskTier(changedPaths: string[], labels: string[] = []): RiskTier {
  if (hasLabel(labels, "risk:high")) return "high";
  if (hasLabel(labels, "risk:low")) return "low";
  if (changedPaths.some((p) => HIGH_PATH.some((re) => re.test(p)))) return "high";
  if (changedPaths.length === 0) return "low";
  if (changedPaths.every((p) => LOW_PATH.some((re) => re.test(p)))) return "low";
  return "standard";
}

export function bundleRequirementsFor(tier: RiskTier): BundleRequirement {
  switch (tier) {
    case "high":
      return { evidence: "full", rollback: true, prd: true };
    case "standard":
      return { evidence: "note", rollback: true, prd: false };
    case "low":
      return { evidence: "minimal", rollback: false, prd: false };
  }
}
