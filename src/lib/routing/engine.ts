// Deterministic shadow routing engine.
// Suggests explainable top-N candidates only — no Task/Bucket/Project/decision/
// link/SharePoint mutation methods. Fuzzy auto-link remains disabled.

import {
  FUZZY_AUTOLINK_ENABLED,
  loadRoutingPolicy,
  type RoutingPolicy,
} from "./config";
import type {
  AuthorizationTrust,
  ParseRoutingMarkersResult,
  RoutingCandidateRecord,
  RoutingEvidenceMeta,
  RoutingFailureReason,
} from "./types";
import {
  ROUTING_REQUIRED_REGISTERS,
  assertFreshOrThrow,
  evaluateSyncFreshness,
  type RegisterTimestampLoader,
  type SyncFreshnessResult,
} from "@/lib/sync/freshness";

export interface RoutingTaskView {
  id: string;
  title: string;
  description?: string;
  bucket: string;
  stage: string;
  repos: string[];
  labels: string[];
  prs?: { repo: string; num: number; status: string; title: string }[];
  due?: string;
}

export interface RoutingBucketView {
  id: string;
  repos: string[];
  project?: string | null;
}

export interface TrackedRepoView {
  repo: string;
  status?: string;
  default_bucket?: string;
  tier?: string;
}

export interface OperationalRepoView {
  id: string;
  name?: string;
}

export interface ShadowMetrics {
  suggestionsGenerated: number;
  candidatesScored: number;
  exactReferenceHits: number;
  fuzzyCandidates: number;
  syncStaleBlocks: number;
  eligibilityBlocks: number;
  completedTaskReferences: number;
}

export interface RoutingEligibility {
  repoKey: string;
  fleetTracked: boolean;
  operationallyOnboarded: boolean;
  defaultBucketId: string | null;
}

export interface ShadowRoutingInput {
  evidence: RoutingEvidenceMeta;
  markers?: ParseRoutingMarkersResult;
  branchTaskIds?: string[];
  tasks: RoutingTaskView[];
  buckets: RoutingBucketView[];
  trackedRepos: TrackedRepoView[];
  operationalRepos: Record<string, OperationalRepoView> | OperationalRepoView[];
  credentialedCheckoutTaskIds?: string[];
  persistedDecisionTaskIds?: string[];
  loadRegisterTimestamps: RegisterTimestampLoader;
  now?: Date;
  policy?: RoutingPolicy;
}

export interface ShadowRoutingResult {
  ok: boolean;
  failureReason: RoutingFailureReason;
  policyVersion: string;
  scoringVersion: string;
  candidates: RoutingCandidateRecord[];
  /** Project derived from the top candidate's Bucket (nullable). */
  derivedProjectId: string | null;
  eligibility: RoutingEligibility;
  freshness: SyncFreshnessResult | null;
  metrics: ShadowMetrics;
  fuzzyAutoLinkEnabled: false;
  reasons: string[];
}

interface ScoredCandidate {
  task: RoutingTaskView;
  bucketId: string;
  projectId: string | null;
  matchScore: number;
  authorizationTrust: AuthorizationTrust;
  reasons: string[];
  exact: boolean;
  completed: boolean;
}

function emptyMetrics(): ShadowMetrics {
  return {
    suggestionsGenerated: 0,
    candidatesScored: 0,
    exactReferenceHits: 0,
    fuzzyCandidates: 0,
    syncStaleBlocks: 0,
    eligibilityBlocks: 0,
    completedTaskReferences: 0,
  };
}

/** Normalize GitHub full name or bare name to MC-style kebab repo id. */
export function normalizeRepoKey(repo: string | undefined | null): string {
  if (!repo) return "";
  const bare = repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo;
  return bare
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function operationalList(
  repos: ShadowRoutingInput["operationalRepos"]
): OperationalRepoView[] {
  return Array.isArray(repos) ? repos : Object.values(repos);
}

function tokenize(text: string | undefined | null): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3)
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const token of a) {
    if (b.has(token)) hits += 1;
  }
  return hits / Math.max(a.size, b.size);
}

function pathOverlapRatio(changedPaths: string[], taskText: string): number {
  if (!changedPaths.length) return 0;
  const hay = taskText.toLowerCase();
  let hits = 0;
  for (const path of changedPaths) {
    const parts = path.toLowerCase().split("/").filter(Boolean);
    const leaf = parts[parts.length - 1] ?? "";
    const stem = leaf.replace(/\.[^.]+$/, "");
    if (
      (stem.length >= 3 && hay.includes(stem)) ||
      parts.some((p) => p.length >= 4 && hay.includes(p))
    ) {
      hits += 1;
    }
  }
  return hits / changedPaths.length;
}

function trustRank(trust: AuthorizationTrust): number {
  switch (trust) {
    case "credentialed_checkout":
      return 5;
    case "persisted_decision":
      return 4;
    case "author_declaration":
      return 3;
    case "routing_correlation":
      return 2;
    case "fuzzy":
      return 1;
    default:
      return 0;
  }
}

function preferTrust(a: AuthorizationTrust, b: AuthorizationTrust): AuthorizationTrust {
  return trustRank(a) >= trustRank(b) ? a : b;
}

function resolveEligibility(
  evidence: RoutingEvidenceMeta,
  trackedRepos: TrackedRepoView[],
  operationalRepos: ShadowRoutingInput["operationalRepos"]
): RoutingEligibility {
  const fullName = evidence.repoFullName ?? "";
  const repoKey =
    normalizeRepoKey(fullName) ||
    normalizeRepoKey(evidence.repoId) ||
    normalizeRepoKey(evidence.repoFullName);

  const fleetEntry = trackedRepos.find((entry) => {
    if (entry.status && entry.status !== "active") return false;
    const key = normalizeRepoKey(entry.repo);
    return key === repoKey || entry.repo === fullName;
  });

  const ops = operationalList(operationalRepos);
  const operationallyOnboarded = ops.some((repo) => {
    const idKey = normalizeRepoKey(repo.id);
    const nameKey = normalizeRepoKey(repo.name);
    return idKey === repoKey || nameKey === repoKey || repo.id === repoKey;
  });

  // Special-case common MC id aliases (PLX_MC → plx-mc, portal → portal-web).
  const aliasHit =
    operationallyOnboarded ||
    ops.some((repo) => {
      if (repoKey === "plx-mc" && repo.id === "plx-mc") return true;
      if (repoKey === "plx-customer-portal" && (repo.id === "portal-web" || repo.name === "plx-customer-portal"))
        return true;
      return false;
    });

  return {
    repoKey,
    fleetTracked: Boolean(fleetEntry),
    operationallyOnboarded: aliasHit,
    defaultBucketId: fleetEntry?.default_bucket ?? null,
  };
}

function repoMatchesTask(
  task: RoutingTaskView,
  bucket: RoutingBucketView | undefined,
  repoKey: string
): boolean {
  const keys = new Set<string>();
  for (const r of task.repos ?? []) keys.add(normalizeRepoKey(r));
  for (const r of bucket?.repos ?? []) keys.add(normalizeRepoKey(r));
  if (keys.has(repoKey)) return true;
  if (repoKey === "plx-customer-portal" && keys.has("portal-web")) return true;
  if (repoKey === "portal-web" && keys.has("plx-customer-portal")) return true;
  return false;
}

function scoreTask(opts: {
  task: RoutingTaskView;
  bucket: RoutingBucketView | undefined;
  evidence: RoutingEvidenceMeta;
  policy: RoutingPolicy;
  repoKey: string;
  defaultBucketId: string | null;
  exactTaskIds: Map<string, AuthorizationTrust>;
  now: Date;
}): ScoredCandidate | null {
  const { task, bucket, evidence, policy, repoKey, defaultBucketId, exactTaskIds, now } =
    opts;
  const completed = policy.completedStages.includes(task.stage);
  const exactTrust = exactTaskIds.get(task.id);
  const exact = Boolean(exactTrust);

  if (completed && !exact) return null;
  if (!repoMatchesTask(task, bucket, repoKey) && !exact) return null;

  const reasons: string[] = [];
  let matchScore = 0;
  let authorizationTrust: AuthorizationTrust = exactTrust ?? "fuzzy";

  if (exact && exactTrust) {
    matchScore = policy.weights.exactReference;
    reasons.push(`exact_reference:${task.id} (+${policy.weights.exactReference})`);
    if (exactTrust === "author_declaration") {
      reasons.push(`exact_task_marker:${task.id}`);
    } else if (exactTrust === "credentialed_checkout") {
      reasons.push(`credentialed_checkout:${task.id}`);
    } else if (exactTrust === "persisted_decision") {
      reasons.push(`persisted_decision:${task.id}`);
    }
  }

  if (repoMatchesTask(task, bucket, repoKey)) {
    matchScore += policy.weights.repoMatch;
    reasons.push(`repo_match:${repoKey} (+${policy.weights.repoMatch})`);
  }

  const titleTokens = tokenize(evidence.title);
  const taskTitleTokens = tokenize(task.title);
  const titleRatio = overlapScore(titleTokens, taskTitleTokens);
  if (titleRatio > 0) {
    const pts = Math.round(policy.weights.titleOverlap * titleRatio);
    if (pts > 0) {
      matchScore += pts;
      reasons.push(`title_overlap:${titleRatio.toFixed(2)} (+${pts})`);
    }
  }

  const descTokens = tokenize(task.description);
  const descRatio = overlapScore(titleTokens, descTokens);
  if (descRatio > 0) {
    const pts = Math.round(policy.weights.descriptionOverlap * descRatio);
    if (pts > 0) {
      matchScore += pts;
      reasons.push(`description_overlap:${descRatio.toFixed(2)} (+${pts})`);
    }
  }

  const evidenceLabels = new Set(evidence.labels ?? []);
  const taskLabels = new Set((task.labels ?? []).map((l) => l.toLowerCase()));
  let labelHits = 0;
  for (const label of evidenceLabels) {
    if (taskLabels.has(label)) labelHits += 1;
  }
  if (labelHits > 0 && evidenceLabels.size > 0) {
    const ratio = labelHits / evidenceLabels.size;
    const pts = Math.round(policy.weights.labelOverlap * ratio);
    if (pts > 0) {
      matchScore += pts;
      reasons.push(`label_overlap:${labelHits} (+${pts})`);
    }
  }

  const pathHay = `${task.title} ${task.description ?? ""} ${(task.labels ?? []).join(" ")}`;
  const pathRatio = pathOverlapRatio(evidence.changedPaths ?? [], pathHay);
  if (pathRatio > 0) {
    const pts = Math.round(policy.weights.pathOverlap * pathRatio);
    if (pts > 0) {
      matchScore += pts;
      reasons.push(`path_overlap:${pathRatio.toFixed(2)} (+${pts})`);
    }
  }

  const related = (task.prs ?? []).some((pr) => {
    const prRepo = normalizeRepoKey(pr.repo);
    return (
      prRepo === repoKey ||
      prRepo === "plx-mc" ||
      (evidence.changeId && String(pr.num) === String(evidence.changeId))
    );
  });
  if (related) {
    matchScore += policy.weights.relatedPr;
    reasons.push(`related_pr (+${policy.weights.relatedPr})`);
  }

  if (!completed && !["backlog"].includes(task.stage)) {
    matchScore += policy.weights.activeStage;
    reasons.push(`active_stage:${task.stage} (+${policy.weights.activeStage})`);
  }

  if (defaultBucketId && task.bucket === defaultBucketId) {
    matchScore += policy.weights.defaultBucketPrior;
    reasons.push(`default_bucket_prior:${defaultBucketId} (+${policy.weights.defaultBucketPrior})`);
  }

  if (task.due) {
    const due = new Date(task.due);
    if (!Number.isNaN(due.getTime())) {
      const days = Math.abs(now.getTime() - due.getTime()) / 86_400_000;
      if (days <= 30) {
        const pts = Math.max(1, Math.round(policy.weights.recency * (1 - days / 30)));
        matchScore += pts;
        reasons.push(`recency:${days.toFixed(0)}d (+${pts})`);
      }
    }
  }

  if (!exact && matchScore <= 0) return null;
  if (!exact) {
    authorizationTrust = "fuzzy";
    reasons.push("trust:fuzzy_advisory_only");
  } else {
    reasons.push(`trust:${authorizationTrust}`);
  }

  if (exact) {
    matchScore = Math.max(matchScore, policy.weights.exactReference);
  }

  return {
    task,
    bucketId: task.bucket,
    projectId: bucket?.project ?? null,
    matchScore,
    authorizationTrust,
    reasons,
    exact,
    completed,
  };
}

function collectExactTaskIds(input: ShadowRoutingInput): Map<string, AuthorizationTrust> {
  const map = new Map<string, AuthorizationTrust>();

  const setTrust = (taskId: string, trust: AuthorizationTrust) => {
    const prev = map.get(taskId);
    map.set(taskId, prev ? preferTrust(prev, trust) : trust);
  };

  for (const id of input.credentialedCheckoutTaskIds ?? []) {
    setTrust(id, "credentialed_checkout");
  }
  for (const id of input.persistedDecisionTaskIds ?? []) {
    setTrust(id, "persisted_decision");
  }

  const markerTaskIds = input.markers?.taskIds ?? [];
  for (const id of markerTaskIds) {
    setTrust(id, "author_declaration");
  }
  for (const id of input.branchTaskIds ?? []) {
    setTrust(id, "author_declaration");
  }

  return map;
}

/**
 * Run the shadow recommendation pipeline.
 * Fail-closed on sync freshness and dual-registry eligibility.
 * Never mutates Tasks, Buckets, Projects, decisions, links, or SharePoint.
 */
export async function runShadowRouting(
  input: ShadowRoutingInput
): Promise<ShadowRoutingResult> {
  const policy = input.policy ?? loadRoutingPolicy();
  const metrics = emptyMetrics();
  const eligibility = resolveEligibility(
    input.evidence,
    input.trackedRepos,
    input.operationalRepos
  );

  const base: Omit<ShadowRoutingResult, "ok" | "failureReason" | "candidates" | "derivedProjectId" | "freshness" | "reasons"> =
    {
      policyVersion: policy.policyVersion,
      scoringVersion: policy.scoringVersion,
      eligibility,
      metrics,
      fuzzyAutoLinkEnabled: false,
    };

  if (FUZZY_AUTOLINK_ENABLED || policy.fuzzyAutoLinkEnabled) {
    throw new Error("fuzzy auto-link must remain disabled for shadow routing");
  }

  if (!eligibility.fleetTracked || !eligibility.operationallyOnboarded) {
    metrics.eligibilityBlocks = 1;
    return {
      ...base,
      ok: false,
      failureReason: "repo_not_operationally_onboarded",
      candidates: [],
      derivedProjectId: null,
      freshness: null,
      reasons: [
        !eligibility.fleetTracked
          ? "eligibility:not_fleet_tracked"
          : "eligibility:repo_not_operationally_onboarded",
      ],
    };
  }

  const freshness = await evaluateSyncFreshness({
    now: input.now,
    requiredRegisters: ROUTING_REQUIRED_REGISTERS,
    loadRegisterTimestamps: input.loadRegisterTimestamps,
  });

  if (!freshness.ok) {
    metrics.syncStaleBlocks = 1;
    try {
      assertFreshOrThrow(freshness);
    } catch {
      // Convert throw-shaped guard into fail-closed result for shadow mode.
    }
    return {
      ...base,
      ok: false,
      failureReason: "sync_stale",
      candidates: [],
      derivedProjectId: null,
      freshness,
      reasons: freshness.reasons.map((r) => `freshness:${r}`),
    };
  }

  const bucketById = new Map(input.buckets.map((b) => [b.id, b]));
  const exactTaskIds = collectExactTaskIds(input);
  const now = input.now ?? new Date();
  const scored: ScoredCandidate[] = [];

  for (const task of input.tasks) {
    const candidate = scoreTask({
      task,
      bucket: bucketById.get(task.bucket),
      evidence: input.evidence,
      policy,
      repoKey: eligibility.repoKey,
      defaultBucketId: eligibility.defaultBucketId,
      exactTaskIds,
      now,
    });
    if (!candidate) continue;
    scored.push(candidate);
  }

  metrics.candidatesScored = scored.length;
  metrics.exactReferenceHits = scored.filter((c) => c.exact).length;
  metrics.fuzzyCandidates = scored.filter((c) => !c.exact).length;
  metrics.completedTaskReferences = scored.filter((c) => c.completed && c.exact).length;
  metrics.suggestionsGenerated = 1;

  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (trustRank(b.authorizationTrust) !== trustRank(a.authorizationTrust)) {
      return trustRank(b.authorizationTrust) - trustRank(a.authorizationTrust);
    }
    return a.task.id.localeCompare(b.task.id);
  });

  const limit = policy.suggestionLimit;
  const top = scored.slice(0, limit);
  // Exact references report the versioned exactReference weight (typically 100).
  // Fuzzy/advisory scores stay strictly below that ceiling so textual certainty
  // never looks like an exact match, while authorizationTrust stays separate.
  const exactCeiling = policy.weights.exactReference;
  const candidates: RoutingCandidateRecord[] = top.map((c, index) => {
    const matchScore =
      c.authorizationTrust !== "fuzzy"
        ? exactCeiling
        : Math.min(c.matchScore, Math.max(0, exactCeiling - 1));
    return {
      rank: index + 1,
      taskId: c.task.id,
      bucketId: c.bucketId,
      projectId: c.projectId,
      matchScore,
      authorizationTrust: c.authorizationTrust,
      reasons: [...c.reasons, `scoring_version:${policy.scoringVersion}`],
    };
  });

  return {
    ...base,
    ok: true,
    failureReason: null,
    candidates,
    derivedProjectId: candidates[0]?.projectId ?? null,
    freshness,
    reasons: candidates.flatMap((c) => c.reasons.slice(0, 2)),
  };
}
