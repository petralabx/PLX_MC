// P6 — proposeRoutingFromPr: action_required proposals, no raw body persistence,
// GitHub Actions SP authorize, rtx_* reconcile, replay-safe revisions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";
import { GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID } from "@/lib/permissions";

const db = vi.hoisted(() => ({
  events: [] as { kind: string; payload?: Record<string, unknown>; dedupKey?: string | null }[],
  proposals: new Map<string, Record<string, unknown>>(),
  revisions: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  authorizeAllowed: true,
  authorizeReason: "allowed",
  authorizeCalls: [] as string[],
}));

vi.mock("@/lib/auth", () => ({
  permissionsEnforcementEnabled: () => false,
}));

vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    authorize: (input: { capability: string; actor: { id: string } }) => {
      db.authorizeCalls.push(input.capability);
      return {
        allowed: db.authorizeAllowed,
        reasonCode: db.authorizeAllowed ? "allowed" : db.authorizeReason,
        policyVersion: "permissions.v1",
      };
    },
  };
});

vi.mock("@/lib/permissions/repository", () => ({
  findServicePrincipalById: async (id: string) =>
    id === GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID
      ? { id, name: "GA Routing", status: "active" as const }
      : null,
}));

vi.mock("@/lib/compliance/repo", () => ({
  async appendEvent(e: { kind: string; payload?: Record<string, unknown>; dedupKey?: string | null }) {
    db.events.push(e);
  },
  async getDispatch() {
    return null;
  },
}));

vi.mock("@/lib/routing/repo", () => ({
  async upsertRoutingSession(input: Record<string, unknown>) {
    db.sessions.set(String(input.id), input);
    return input;
  },
  async upsertRoutingProposal(input: Record<string, unknown>) {
    const key = `${input.repoId}:${input.changeId}`;
    db.proposals.set(key, input);
    return { ...input, selectedTaskId: null, selectedBucketId: null };
  },
  async upsertProposalRevision(input: Record<string, unknown>) {
    const key = `${input.proposalId}:${input.headSha}`;
    if (db.revisions.has(key)) {
      return db.revisions.get(key)!;
    }
    db.revisions.set(key, input);
    return input;
  },
}));

vi.mock("@/lib/routing/engine", () => ({
  runShadowRouting: async () => ({
    ok: true,
    failureReason: null,
    policyVersion: "routing.v1",
    scoringVersion: "score.v1",
    candidates: [
      {
        rank: 1,
        taskId: "TASK-1",
        bucketId: "BKT-INFRA",
        projectId: null,
        matchScore: 80,
        authorizationTrust: "none",
        reasons: ["title overlap"],
      },
    ],
    derivedProjectId: null,
    eligibility: {
      repoKey: "plx-mc",
      fleetTracked: true,
      operationallyOnboarded: true,
      defaultBucketId: "BKT-INFRA",
    },
    freshness: null,
    metrics: {
      suggestionsGenerated: 1,
      candidatesScored: 1,
      exactReferenceHits: 0,
      fuzzyCandidates: 0,
      syncStaleBlocks: 0,
      eligibilityBlocks: 0,
      completedTaskReferences: 0,
    },
    fuzzyAutoLinkEnabled: false,
    reasons: [],
  }),
}));

vi.mock("@/lib/sync", () => ({
  snapshot: async () => ({
    tasks: [],
    buckets: [],
    repos: [{ id: "plx-mc", name: "PLX_MC" }],
    projects: [],
  }),
}));

vi.mock("@/lib/sync/repo", () => ({
  getEntity: async () => null,
  getRegisterInboundCompletions: async () => ({}),
}));

vi.mock("@/lib/compliance/projection", () => ({
  projectionEnabled: () => false,
  projectPullRequest: vi.fn(async () => {}),
}));

import { proposeRoutingFromPr, requireGithubActionsProposeAuthorized } from "@/lib/compliance/service";

beforeEach(() => {
  db.events.length = 0;
  db.proposals.clear();
  db.revisions.clear();
  db.sessions.clear();
  db.authorizeAllowed = true;
  db.authorizeReason = "allowed";
  db.authorizeCalls.length = 0;
  delete process.env.PLX_MC_ROUTING_PROPOSALS_ENABLED;
});

describe("requireGithubActionsProposeAuthorized", () => {
  it("allows routing.propose for the GitHub Actions SP", async () => {
    const actor = await requireGithubActionsProposeAuthorized("petralabx/PLX_MC");
    expect(actor.id).toBe(GITHUB_ACTIONS_ROUTING_SERVICE_PRINCIPAL_ID);
    expect(db.authorizeCalls).toContain("routing.propose");
  });

  it("denies when authorize rejects", async () => {
    db.authorizeAllowed = false;
    db.authorizeReason = "capability_not_granted";
    await expect(requireGithubActionsProposeAuthorized("petralabx/PLX_MC")).rejects.toBeInstanceOf(
      ApiError
    );
  });
});

describe("proposeRoutingFromPr", () => {
  it("creates an action_required proposal with deep link and no raw body in persistence", async () => {
    const result = await proposeRoutingFromPr({
      repository: "petralabx/PLX_MC",
      repositoryId: "999",
      prNumber: 42,
      action: "opened",
      headSha: "abc123",
      title: "Fix routing",
      body: "Hello\n\nMC-Routing: rtx_abc123def456\nSecret: should-not-persist",
      labels: ["go-live"],
      changedPaths: ["src/lib/compliance/service.ts"],
      actorKind: "operator",
      eventSource: "oidc.propose",
    });

    expect(result.state).toBe("action_required");
    expect(result.deepLink).toMatch(/\/routing\?proposal=/);
    expect(result.sessionId).toBe("rtx_abc123def456");
    expect(result.bodyContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.candidates[0]?.taskId).toBe("TASK-1");

    const proposal = [...db.proposals.values()][0]!;
    expect(proposal.state).toBe("action_required");
    expect(JSON.stringify(proposal)).not.toMatch(/should-not-persist/);
    expect(JSON.stringify(proposal)).not.toMatch(/Hello/);
    expect(proposal.bodyContentHash).toBe(result.bodyContentHash);

    const revision = [...db.revisions.values()][0]!;
    expect(JSON.stringify(revision.evidenceMeta ?? {})).not.toMatch(/should-not-persist/);
    expect(db.sessions.has("rtx_abc123def456")).toBe(true);
  });

  it("is replay-safe for the same proposalId + headSha revision", async () => {
    const input = {
      repository: "petralabx/PLX_MC",
      repositoryId: "999",
      prNumber: 7,
      action: "synchronize" as const,
      headSha: "same-sha",
      title: "sync",
      body: "",
      actorKind: "operator" as const,
    };
    const first = await proposeRoutingFromPr(input);
    const second = await proposeRoutingFromPr(input);
    expect(second.proposalId).toBe(first.proposalId);
    expect(second.revisionId).toBe(first.revisionId);
    expect(db.revisions.size).toBe(1);
  });

  it("fails closed when proposals kill switch is off", async () => {
    process.env.PLX_MC_ROUTING_PROPOSALS_ENABLED = "0";
    await expect(
      proposeRoutingFromPr({
        repository: "petralabx/PLX_MC",
        repositoryId: "1",
        prNumber: 1,
        action: "opened",
        headSha: "x",
      })
    ).rejects.toMatchObject({ code: "routing_proposals_disabled", status: 503 });
  });
});
