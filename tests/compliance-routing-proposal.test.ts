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
  sessionUpsertFails: false,
  shadowCandidates: [
    {
      rank: 1,
      taskId: "TASK-1",
      bucketId: "BKT-INFRA",
      projectId: null,
      matchScore: 80,
      authorizationTrust: "none",
      reasons: ["title overlap"],
    },
  ] as Array<Record<string, unknown>>,
}));

const runShadowRouting = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true,
    failureReason: null,
    policyVersion: "routing.v1",
    scoringVersion: "score.v1",
    candidates: db.shadowCandidates,
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
      candidatesScored: db.shadowCandidates.length,
      exactReferenceHits: 0,
      fuzzyCandidates: 0,
      syncStaleBlocks: 0,
      eligibilityBlocks: 0,
      completedTaskReferences: 0,
    },
    fuzzyAutoLinkEnabled: false,
    reasons: [],
  }))
);

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
    if (db.sessionUpsertFails) throw new Error("session binding mismatch");
    db.sessions.set(String(input.id), input);
    return input;
  },
  async upsertRoutingProposal(input: Record<string, unknown>) {
    const key = `${input.repoId}:${input.changeId}`;
    const existing = db.proposals.get(key);
    const terminal =
      existing?.state === "resolved" || existing?.state === "rejected";
    const persisted = {
      ...input,
      id: existing?.id ?? input.id,
      state: terminal ? existing.state : input.state,
    };
    db.proposals.set(key, persisted);
    return { ...persisted, selectedTaskId: null, selectedBucketId: null };
  },
  async upsertProposalRevision(input: Record<string, unknown>) {
    const key = `${input.proposalId}:${input.headSha}`;
    if (db.revisions.has(key)) {
      const existing = db.revisions.get(key)!;
      const existingCandidates = Array.isArray(existing.candidates)
        ? existing.candidates as Array<Record<string, unknown>>
        : [];
      const replayCandidates = Array.isArray(input.candidates)
        ? input.candidates as Array<Record<string, unknown>>
        : [];
      const ranks = new Set(existingCandidates.map((candidate) => candidate.rank));
      const persisted = {
        ...existing,
        candidates: [
          ...existingCandidates,
          ...replayCandidates.filter((candidate) => !ranks.has(candidate.rank)),
        ],
      };
      db.revisions.set(key, persisted);
      return persisted;
    }
    db.revisions.set(key, input);
    return input;
  },
  async getProposalByIdentity(input: { repoId: string; changeId: string }) {
    return db.proposals.get(`${input.repoId}:${input.changeId}`) ?? null;
  },
  async getProposalRevision(proposalId: string, headSha: string) {
    return db.revisions.get(`${proposalId}:${headSha}`) ?? null;
  },
}));

vi.mock("@/lib/routing/engine", () => ({
  runShadowRouting,
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
  db.sessionUpsertFails = false;
  db.shadowCandidates = [
    {
      rank: 1,
      taskId: "TASK-1",
      bucketId: "BKT-INFRA",
      projectId: null,
      matchScore: 80,
      authorizationTrust: "none",
      reasons: ["title overlap"],
    },
  ];
  runShadowRouting.mockClear();
  delete process.env.PLX_MC_ROUTING_PROPOSALS_ENABLED;
  process.env.PLX_MC_ROUTING_METADATA_ENABLED = "1";
  process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "1";
  process.env.PLX_MC_ROUTING_SUGGEST_ENABLED = "1";
  process.env.PLX_MC_ROUTING_INBOX_ENABLED = "1";
  delete process.env.PLX_MC_ROUTING_CONFIRM_ENABLED;
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
    expect(result.configuredMode).toBe("suggestion");
    expect(result.effectiveMode).toBe("suggestion");

    const proposal = [...db.proposals.values()][0]!;
    expect(proposal.state).toBe("action_required");
    expect(JSON.stringify(proposal)).not.toMatch(/should-not-persist/);
    expect(JSON.stringify(proposal)).not.toMatch(/Hello/);
    expect(proposal.bodyContentHash).toBe(result.bodyContentHash);

    const revision = [...db.revisions.values()][0]!;
    expect(JSON.stringify(revision.evidenceMeta ?? {})).not.toMatch(/should-not-persist/);
    expect(db.sessions.has("rtx_abc123def456")).toBe(true);
    expect(db.events[0]?.payload).toMatchObject({ merged: false });
    expect(db.events[0]?.payload).not.toHaveProperty("mergeSha");
  });

  it("records merged closed metadata only in the private audit payload", async () => {
    await proposeRoutingFromPr({
      repository: "petralabx/PLX_MC",
      repositoryId: "999",
      prNumber: 43,
      action: "closed",
      headSha: "actual-pr-head-sha",
      mergeSha: "github-event-sha",
      merged: true,
      title: "Merged routing change",
      body: "",
      actorKind: "operator",
      eventSource: "oidc.propose",
    });

    const proposal = [...db.proposals.values()][0]!;
    const revision = [...db.revisions.values()][0]!;
    const audit = db.events[0]!;
    expect(proposal).not.toHaveProperty("merged");
    expect(revision).not.toHaveProperty("merged");
    expect(audit.payload).toMatchObject({
      action: "closed",
      headSha: "actual-pr-head-sha",
      merged: true,
    });
    expect(audit.payload).not.toHaveProperty("mergeSha");
    expect(JSON.stringify({ proposal, revision, audit })).not.toContain(
      "github-event-sha"
    );
  });

  it("drops an unchecked foreign session marker when session validation fails", async () => {
    db.sessionUpsertFails = true;
    const result = await proposeRoutingFromPr({
      repository: "petralabx/PLX_MC",
      repositoryId: "999",
      prNumber: 44,
      action: "opened",
      headSha: "session-mismatch",
      body: "MC-Routing: rtx_foreignsession123",
      actorKind: "operator",
    });

    expect(result.sessionId).toBeNull();
    expect([...db.proposals.values()][0]?.sessionId).toBeNull();
    expect(db.sessions.size).toBe(0);
  });

  it("persists shadow candidates for audit but returns no candidates or deep link", async () => {
    const result = await proposeRoutingFromPr({
      repository: "petralabx/skills",
      repositoryId: "1001",
      prNumber: 9,
      action: "opened",
      headSha: "shadow-sha",
      title: "Shadow routing",
      body: "",
      actorKind: "operator",
    });

    expect(result.configuredMode).toBe("shadow");
    expect(result.effectiveMode).toBe("shadow");
    expect(result.candidates).toEqual([]);
    expect(result.deepLink).toBeNull();
    const revision = [...db.revisions.values()][0]!;
    expect(revision.candidates).toEqual([
      expect.objectContaining({ taskId: "TASK-1" }),
    ]);
    expect(db.events[0]?.payload).toMatchObject({
      configuredMode: "shadow",
      effectiveMode: "shadow",
    });
  });

  it("clamps proposal visibility to shadow when Inbox is disabled", async () => {
    process.env.PLX_MC_ROUTING_INBOX_ENABLED = "0";
    const result = await proposeRoutingFromPr({
      repository: "petralabx/PLX_MC",
      repositoryId: "1004",
      prNumber: 12,
      action: "opened",
      headSha: "inbox-off",
    });
    expect(result.configuredMode).toBe("suggestion");
    expect(result.effectiveMode).toBe("shadow");
    expect(result.candidates).toEqual([]);
    expect(result.deepLink).toBeNull();
    expect([...db.revisions.values()][0]?.candidates).toHaveLength(1);
  });

  it("fails closed before persistence when shadow processing is disabled", async () => {
    process.env.PLX_MC_ROUTING_SHADOW_ENABLED = "0";
    await expect(
      proposeRoutingFromPr({
        repository: "petralabx/PLX_MC",
        repositoryId: "1005",
        prNumber: 13,
        action: "opened",
        headSha: "shadow-off",
      })
    ).rejects.toMatchObject({ code: "routing_cohort_disabled", status: 503 });
    expect(db.proposals.size).toBe(0);
    expect(db.revisions.size).toBe(0);
  });

  it("fails closed for unknown cohorts without persisting proposals", async () => {
    await expect(
      proposeRoutingFromPr({
        repository: "petralabx/unknown",
        repositoryId: "1002",
        prNumber: 10,
        action: "opened",
        headSha: "unknown-sha",
      })
    ).rejects.toMatchObject({ code: "routing_cohort_disabled", status: 503 });
    expect(db.proposals.size).toBe(0);
    expect(db.revisions.size).toBe(0);
  });

  it("fails closed when metadata routing is globally disabled", async () => {
    process.env.PLX_MC_ROUTING_METADATA_ENABLED = "0";
    await expect(
      proposeRoutingFromPr({
        repository: "petralabx/PLX_MC",
        repositoryId: "1003",
        prNumber: 11,
        action: "opened",
        headSha: "metadata-off",
      })
    ).rejects.toMatchObject({ code: "routing_metadata_disabled", status: 503 });
    expect(db.proposals.size).toBe(0);
  });

  it("returns persisted same-head evidence/candidates and preserves resolved state on replay", async () => {
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
    const proposalKey = `${input.repository}:${input.prNumber}`;
    const storedProposal = db.proposals.get(proposalKey)!;
    db.proposals.set(proposalKey, { ...storedProposal, state: "resolved" });
    const revisionKey = `${first.proposalId}:${input.headSha}`;
    const storedRevision = db.revisions.get(revisionKey)!;
    db.revisions.set(revisionKey, {
      ...storedRevision,
      policyVersion: "routing.persisted.v0",
    });
    db.shadowCandidates = [
      {
        rank: 1,
        taskId: "TASK-2",
        bucketId: "BKT-OTHER",
        projectId: null,
        matchScore: 99,
        authorizationTrust: "fuzzy",
        reasons: ["new stale score"],
      },
    ];

    const second = await proposeRoutingFromPr({
      ...input,
      body: "changed body on duplicate delivery",
      title: "changed title",
    });
    expect(second.proposalId).toBe(first.proposalId);
    expect(second.revisionId).toBe(first.revisionId);
    expect(second.state).toBe("resolved");
    expect(second.candidates[0]?.taskId).toBe("TASK-1");
    expect(second.bodyContentHash).toBe(first.bodyContentHash);
    expect(second.policyVersion).toBe("routing.persisted.v0");
    expect(db.revisions.size).toBe(1);
    expect(runShadowRouting).toHaveBeenCalledTimes(2);
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
