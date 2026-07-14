// P3: deterministic shadow routing engine contracts.
// Shadow only — no Task/Bucket/Project/decision/link mutation surface.

import { describe, expect, it } from "vitest";

import {
  FUZZY_AUTOLINK_ENABLED,
  loadRoutingPolicy,
} from "@/lib/routing/config";
import {
  runShadowRouting,
  type ShadowRoutingInput,
} from "@/lib/routing/engine";
import { normalizeRoutingEvidence } from "@/lib/routing/evidence";
import * as engineExports from "@/lib/routing/engine";
import type { AuthorizationTrust } from "@/lib/routing/types";
import { SYNC_FRESHNESS_MAX_AGE_MS } from "@/lib/sync/freshness";

const NOW = new Date("2026-07-14T18:00:00.000Z");
const FRESH = new Date(NOW.getTime() - 60_000);
const STALE = new Date(NOW.getTime() - SYNC_FRESHNESS_MAX_AGE_MS - 1);

const TRACKED = [
  {
    repo: "petralabx/PLX_MC",
    status: "active",
    default_bucket: "BKT-INFRA",
    tier: "hub",
  },
  {
    repo: "petralabx/plx-customer-portal",
    status: "active",
    default_bucket: "BKT-PROD",
    tier: "product_app",
  },
];

const OPERATIONAL = {
  "plx-mc": { id: "plx-mc", name: "PLX_MC" },
  "portal-web": { id: "portal-web", name: "plx-customer-portal" },
};

const BUCKETS = [
  {
    id: "BKT-INFRA",
    repos: ["plx-mc"],
    project: "PRJ-PORTAL-GOLIVE",
  },
  {
    id: "BKT-PROD",
    repos: ["portal-web"],
    project: null,
  },
  {
    id: "BKT-ORPHAN",
    repos: ["plx-mc"],
    project: undefined,
  },
];

const TASKS = [
  {
    id: "TASK-10",
    title: "Wire petralabx GitHub token",
    description: "Hydrate PAT for fleet quality ledgers",
    bucket: "BKT-INFRA",
    stage: "progress",
    repos: ["plx-mc"],
    labels: ["infra", "github"],
    prs: [],
    due: "2026-07-20",
  },
  {
    id: "TASK-20",
    title: "Shadow routing engine",
    description: "Deterministic candidates for commit/PR routing",
    bucket: "BKT-INFRA",
    stage: "planned",
    repos: ["plx-mc"],
    labels: ["routing"],
    prs: [{ repo: "PLX_MC", num: 120, status: "open", title: "routing" }],
    due: "2026-07-18",
  },
  {
    id: "TASK-30",
    title: "Portal UAT batch",
    description: "Customer portal staging fixes",
    bucket: "BKT-PROD",
    stage: "qa",
    repos: ["portal-web"],
    labels: ["uat"],
    prs: [],
    due: "2026-07-22",
  },
  {
    id: "TASK-40",
    title: "Merged infra cleanup",
    description: "Already delivered",
    bucket: "BKT-INFRA",
    stage: "merged",
    repos: ["plx-mc"],
    labels: ["infra"],
    prs: [],
    due: "2026-06-01",
  },
  {
    id: "TASK-50",
    title: "Verified routing spike",
    description: "Closed verified work",
    bucket: "BKT-INFRA",
    stage: "verified",
    repos: ["plx-mc"],
    labels: ["routing"],
    prs: [],
    due: "2026-05-01",
  },
  {
    id: "TASK-60",
    title: "Orphan bucket task",
    description: "Bucket without project",
    bucket: "BKT-ORPHAN",
    stage: "backlog",
    repos: ["plx-mc"],
    labels: [],
    prs: [],
    due: "2026-08-01",
  },
];

function freshLoader() {
  return async () => ({
    projects: FRESH,
    roadmap: FRESH,
    todos: FRESH,
  });
}

function staleLoader() {
  return async () => ({
    projects: STALE,
    roadmap: FRESH,
    todos: FRESH,
  });
}

function evidenceFor(opts: {
  body?: string;
  title?: string;
  paths?: string[];
  labels?: string[];
  branch?: string;
  repoFullName?: string;
}) {
  return normalizeRoutingEvidence({
    repoId: "99",
    repoFullName: opts.repoFullName ?? "petralabx/PLX_MC",
    changeId: "175",
    headSha: "deadbeef",
    baseBranch: "main",
    sourceBranch: opts.branch ?? "feat/shadow-engine",
    title: opts.title ?? "Add shadow routing engine",
    body: opts.body ?? "Implements deterministic suggestions.",
    changedPaths: opts.paths ?? ["src/lib/routing/engine.ts", "tests/routing-engine.test.ts"],
    labels: opts.labels ?? ["routing"],
    actorId: "oid-1",
    actorKind: "human",
    eventSource: "pull_request",
    eventAction: "opened",
    eventAt: NOW.toISOString(),
  });
}

async function shadow(
  opts: Partial<ShadowRoutingInput> &
    Pick<ShadowRoutingInput, "evidence"> & {
      markers?: ShadowRoutingInput["markers"];
      branchTaskIds?: string[];
    }
) {
  const input: ShadowRoutingInput = {
    now: NOW,
    trackedRepos: TRACKED,
    operationalRepos: OPERATIONAL,
    buckets: BUCKETS,
    tasks: TASKS,
    loadRegisterTimestamps: freshLoader(),
    ...opts,
  };
  return runShadowRouting(input);
}

describe("routing policy + fuzzy kill switch", () => {
  it("loads versioned policy and keeps fuzzy auto-link disabled", () => {
    const policy = loadRoutingPolicy();
    expect(policy.policyVersion).toMatch(/^routing\./);
    expect(policy.fuzzyAutoLinkEnabled).toBe(false);
    expect(FUZZY_AUTOLINK_ENABLED).toBe(false);
    expect(policy.suggestionLimit).toBe(3);
  });
});

describe("shadow engine — no mutation surface", () => {
  it("exports no Task/Bucket/Project/decision/link mutation methods", () => {
    const names = Object.keys(engineExports);
    const forbidden = names.filter((name) =>
      /create|mutate|update|patch|delete|link|confirm|decide|persist|write|attach|reopen/i.test(
        name
      )
    );
    expect(forbidden).toEqual([]);
    expect(names).toContain("runShadowRouting");
    expect(typeof runShadowRouting).toBe("function");
  });
});

describe("eligibility — dual registry", () => {
  it("fails with repo_not_operationally_onboarded when fleet-tracked but not in MC registry", async () => {
    const normalized = evidenceFor({
      repoFullName: "petralabx/skills",
      body: "MC-Task: TASK-10",
    });
    const result = await shadow({
      evidence: normalized.evidence,
      markers: normalized.markers,
      branchTaskIds: normalized.branchTaskIds,
      trackedRepos: [
        ...TRACKED,
        { repo: "petralabx/skills", status: "active", default_bucket: "BKT-INFRA", tier: "skills" },
      ],
      operationalRepos: OPERATIONAL,
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("repo_not_operationally_onboarded");
    expect(result.candidates).toEqual([]);
    expect(result.eligibility.fleetTracked).toBe(true);
    expect(result.eligibility.operationallyOnboarded).toBe(false);
    expect(result.metrics.eligibilityBlocks).toBe(1);
  });

  it("fails closed when repository is not fleet-tracked", async () => {
    const normalized = evidenceFor({ repoFullName: "petralabx/unknown-repo" });
    const result = await shadow({
      evidence: normalized.evidence,
      markers: normalized.markers,
      branchTaskIds: normalized.branchTaskIds,
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("repo_not_operationally_onboarded");
    expect(result.eligibility.fleetTracked).toBe(false);
  });
});

describe("freshness fail-closed", () => {
  it("returns sync_stale and scores nothing when required registers are stale", async () => {
    const normalized = evidenceFor({ body: "MC-Task: TASK-20" });
    const result = await shadow({
      evidence: normalized.evidence,
      markers: normalized.markers,
      branchTaskIds: normalized.branchTaskIds,
      loadRegisterTimestamps: staleLoader(),
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toBe("sync_stale");
    expect(result.candidates).toEqual([]);
    expect(result.metrics.syncStaleBlocks).toBe(1);
  });
});

describe("exact-reference trust vs path/title scores", () => {
  it("ranks exact MC-Task as score 100 with author_declaration trust, separate from fuzzy", async () => {
    const normalized = evidenceFor({
      body: "MC-Task: TASK-40\n\nAlso touches routing.",
      title: "Shadow routing engine",
      paths: ["src/lib/routing/engine.ts"],
      labels: ["routing"],
    });
    const result = await shadow({
      evidence: normalized.evidence,
      markers: normalized.markers,
      branchTaskIds: normalized.branchTaskIds,
    });
    expect(result.ok).toBe(true);
    expect(result.failureReason).toBeNull();
    const top = result.candidates[0];
    expect(top?.taskId).toBe("TASK-40");
    expect(top?.matchScore).toBe(100);
    expect(top?.authorizationTrust).toBe("author_declaration" satisfies AuthorizationTrust);
    expect(top?.reasons.some((r) => /exact_task_marker/i.test(r))).toBe(true);

    const fuzzy = result.candidates.find((c) => c.taskId === "TASK-20");
    expect(fuzzy).toBeTruthy();
    expect(fuzzy!.matchScore).toBeLessThan(100);
    expect(fuzzy!.authorizationTrust).toBe("fuzzy");
  });

  it("treats credentialed checkout and persisted decisions as high trust without merging into matchScore", async () => {
    const normalized = evidenceFor({ body: "no markers", title: "misc" });
    const result = await shadow({
      evidence: normalized.evidence,
      markers: normalized.markers,
      branchTaskIds: normalized.branchTaskIds,
      credentialedCheckoutTaskIds: ["TASK-10"],
      persistedDecisionTaskIds: ["TASK-20"],
    });
    const byId = Object.fromEntries(result.candidates.map((c) => [c.taskId, c]));
    expect(byId["TASK-10"]?.authorizationTrust).toBe("credentialed_checkout");
    expect(byId["TASK-10"]?.matchScore).toBe(100);
    expect(byId["TASK-20"]?.authorizationTrust).toBe("persisted_decision");
    expect(byId["TASK-20"]?.matchScore).toBe(100);
    expect(byId["TASK-10"]?.matchScore).not.toBe(byId["TASK-10"]?.authorizationTrust);
  });
});

describe("top-three + explainable versioned scoring", () => {
  it("returns at most three candidates with ranks, policy version, and reasons", async () => {
    const normalized = evidenceFor({
      title: "Shadow routing engine",
      paths: ["src/lib/routing/engine.ts"],
      labels: ["routing", "infra"],
      body: "Deterministic candidates",
    });
    const result = await shadow({
      evidence: normalized.evidence,
      markers: normalized.markers,
      branchTaskIds: normalized.branchTaskIds,
    });
    expect(result.ok).toBe(true);
    expect(result.policyVersion).toBe(loadRoutingPolicy().policyVersion);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(result.candidates.map((c) => c.rank)).toEqual(
      result.candidates.map((_, i) => i + 1)
    );
    for (const c of result.candidates) {
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(typeof c.matchScore).toBe("number");
      expect(c.authorizationTrust).toBeTruthy();
    }
    expect(result.metrics.suggestionsGenerated).toBe(1);
    expect(result.metrics.candidatesScored).toBeGreaterThanOrEqual(result.candidates.length);
  });
});

describe("Project derived from Bucket", () => {
  it("derives nullable projectId exclusively from the candidate bucket", async () => {
    const withProject = evidenceFor({ body: "MC-Task: TASK-10" });
    const a = await shadow({
      evidence: withProject.evidence,
      markers: withProject.markers,
      branchTaskIds: withProject.branchTaskIds,
    });
    expect(a.candidates[0]?.taskId).toBe("TASK-10");
    expect(a.candidates[0]?.projectId).toBe("PRJ-PORTAL-GOLIVE");
    expect(a.candidates[0]?.bucketId).toBe("BKT-INFRA");
    expect(a.derivedProjectId).toBe("PRJ-PORTAL-GOLIVE");

    const orphan = evidenceFor({ body: "MC-Task: TASK-60" });
    const b = await shadow({
      evidence: orphan.evidence,
      markers: orphan.markers,
      branchTaskIds: orphan.branchTaskIds,
    });
    expect(b.candidates[0]?.taskId).toBe("TASK-60");
    expect(b.candidates[0]?.projectId).toBeNull();
    expect(b.derivedProjectId).toBeNull();
  });
});

describe("completed Task linkability", () => {
  it("excludes merged/verified from fuzzy pool but keeps them when exactly referenced", async () => {
    const fuzzyOnly = evidenceFor({
      title: "infra cleanup",
      labels: ["infra"],
      paths: ["scripts/cleanup.sh"],
      body: "no exact refs",
    });
    const fuzzyResult = await shadow({
      evidence: fuzzyOnly.evidence,
      markers: fuzzyOnly.markers,
      branchTaskIds: fuzzyOnly.branchTaskIds,
    });
    expect(fuzzyResult.candidates.every((c) => c.taskId !== "TASK-40")).toBe(true);
    expect(fuzzyResult.candidates.every((c) => c.taskId !== "TASK-50")).toBe(true);

    const exactMerged = evidenceFor({ body: "MC-Task: TASK-40" });
    const merged = await shadow({
      evidence: exactMerged.evidence,
      markers: exactMerged.markers,
      branchTaskIds: exactMerged.branchTaskIds,
    });
    expect(merged.candidates.some((c) => c.taskId === "TASK-40")).toBe(true);
    expect(merged.metrics.completedTaskReferences).toBeGreaterThanOrEqual(1);

    const exactVerified = evidenceFor({ body: "MC-Task: TASK-50" });
    const verified = await shadow({
      evidence: exactVerified.evidence,
      markers: exactVerified.markers,
      branchTaskIds: exactVerified.branchTaskIds,
    });
    expect(verified.candidates.some((c) => c.taskId === "TASK-50")).toBe(true);
  });
});

describe("shadow metrics", () => {
  it("increments counters for exact hits and fuzzy candidates", async () => {
    const normalized = evidenceFor({
      body: "MC-Task: TASK-20",
      title: "Shadow routing engine",
      labels: ["routing"],
    });
    const result = await shadow({
      evidence: normalized.evidence,
      markers: normalized.markers,
      branchTaskIds: normalized.branchTaskIds,
    });
    expect(result.metrics.exactReferenceHits).toBeGreaterThanOrEqual(1);
    expect(result.metrics.fuzzyCandidates).toBeGreaterThanOrEqual(0);
    expect(result.metrics.suggestionsGenerated).toBe(1);
    expect(FUZZY_AUTOLINK_ENABLED).toBe(false);
    expect(result.fuzzyAutoLinkEnabled).toBe(false);
  });
});
