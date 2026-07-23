// Autonomy-level dial per bucket/repo (TASK-635). Operator config
// (config/autonomy-dial.json) can only LOWER effective routing autonomy below
// the pilot cohort's rollout mode — never raise it past the thresholds
// (monotonic safety, same direction as rolling-breach demotion). Enforced at
// suggest availability and again at confirm-time (defense in depth).

import autonomyDialConfig from "../../../config/autonomy-dial.json";
import { ApiError } from "@/lib/api/route";
import type { RolloutMode } from "./rollout";

export interface AutonomyDialConfig {
  repos?: Record<string, string>;
  buckets?: Record<string, string>;
}

const MODE_ORDER: Record<RolloutMode, number> = {
  shadow: 0,
  suggestion: 1,
  confirmation: 2,
};

export function parseDialMode(value: unknown): RolloutMode | null {
  return value === "shadow" || value === "suggestion" || value === "confirmation"
    ? value
    : null;
}

export function loadAutonomyDial(): AutonomyDialConfig {
  return autonomyDialConfig as AutonomyDialConfig;
}

export interface ResolvedAutonomy {
  mode: RolloutMode;
  /** Which dial lowered the cohort mode, when one did. */
  loweredBy: "repo" | "bucket" | null;
}

/**
 * Effective autonomy = min(cohort mode, repo dial, bucket dial). Invalid or
 * absent dial entries leave the cohort mode untouched.
 */
export function resolveAutonomyLevel(input: {
  cohortMode: RolloutMode;
  repoId?: string | null;
  bucketId?: string | null;
  dial?: AutonomyDialConfig;
}): ResolvedAutonomy {
  const dial = input.dial ?? loadAutonomyDial();
  let mode = input.cohortMode;
  let loweredBy: ResolvedAutonomy["loweredBy"] = null;

  const repoDial = input.repoId ? parseDialMode(dial.repos?.[input.repoId]) : null;
  if (repoDial && MODE_ORDER[repoDial] < MODE_ORDER[mode]) {
    mode = repoDial;
    loweredBy = "repo";
  }
  const bucketDial = input.bucketId ? parseDialMode(dial.buckets?.[input.bucketId]) : null;
  if (bucketDial && MODE_ORDER[bucketDial] < MODE_ORDER[mode]) {
    mode = bucketDial;
    loweredBy = "bucket";
  }
  return { mode, loweredBy };
}

/**
 * Confirm-time guard: a routed mutation (confirm/create) requires effective
 * "confirmation" autonomy for the repo AND the target bucket.
 */
export function assertAutonomyAllowsConfirmation(input: {
  cohortMode: RolloutMode;
  repoId?: string | null;
  bucketId?: string | null;
  dial?: AutonomyDialConfig;
}): void {
  const resolved = resolveAutonomyLevel(input);
  if (resolved.mode !== "confirmation") {
    throw new ApiError(
      "autonomy_restricted",
      `Routing confirmation is dialed down to ${resolved.mode}${
        resolved.loweredBy ? ` by the ${resolved.loweredBy} autonomy dial` : ""
      } — resolve manually or raise the dial (config/autonomy-dial.json).`,
      403
    );
  }
}
