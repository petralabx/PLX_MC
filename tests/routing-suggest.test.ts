// P5: mc_suggest_work — authorize routing.suggest, return session + candidates,
// never create/link Tasks or mutate SharePoint.

import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  PLX_MC_MCP_ENABLED: "1",
  PLX_MC_MCP_API_KEY: "test-mcp-key",
  PLX_MC_ALLOWED_USERS: "vince@petrasoap.com",
  PLX_MC_PUBLIC_URL: "https://mc.plxcustomer.io",
  PLX_MC_ROUTING_SUGGEST_ENABLED: "1",
}));

vi.stubEnv("PLX_MC_MCP_ENABLED", env.PLX_MC_MCP_ENABLED);
vi.stubEnv("PLX_MC_MCP_API_KEY", env.PLX_MC_MCP_API_KEY);
vi.stubEnv("PLX_MC_ALLOWED_USERS", env.PLX_MC_ALLOWED_USERS);
vi.stubEnv("PLX_MC_PUBLIC_URL", env.PLX_MC_PUBLIC_URL);
vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", env.PLX_MC_ROUTING_SUGGEST_ENABLED);

const upsertRoutingSession = vi.hoisted(() =>
  vi.fn(async (input: { id: string }) => ({
    id: input.id,
    repoId: "petralabx/PLX_MC",
    actorId: "sp_mcp_cursor",
    actorKind: "service" as const,
    baseBranch: "main",
    sourceBranch: "HEAD",
    headSha: null,
    status: "active" as const,
    absoluteExpiresAt: new Date().toISOString(),
    idleExpiresAt: new Date().toISOString(),
  }))
);

const createTask = vi.hoisted(() => vi.fn());
const appendWorkLink = vi.hoisted(() => vi.fn());
const runShadowRouting = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true,
    failureReason: null,
    policyVersion: "routing.v1",
    scoringVersion: "routing.score.v1",
    candidates: [
      {
        rank: 1,
        taskId: "TASK-439",
        bucketId: "BKT-INFRA",
        projectId: "PRJ-PORTAL-GOLIVE",
        matchScore: 100,
        authorizationTrust: "author_declaration" as const,
        reasons: ["exact:task_marker", "scoring_version:routing.score.v1"],
      },
      {
        rank: 2,
        taskId: "TASK-100",
        bucketId: "BKT-INFRA",
        projectId: "PRJ-PORTAL-GOLIVE",
        matchScore: 42,
        authorizationTrust: "fuzzy" as const,
        reasons: ["title_overlap", "scoring_version:routing.score.v1"],
      },
    ],
    derivedProjectId: "PRJ-PORTAL-GOLIVE",
    eligibility: {
      repoKey: "plx-mc",
      fleetTracked: true,
      operationallyOnboarded: true,
      defaultBucketId: "BKT-INFRA",
    },
    freshness: { ok: true, reasons: [], staleRegisters: [], maxAgeMs: 360000 },
    metrics: {
      suggestionsGenerated: 1,
      candidatesScored: 2,
      exactReferenceHits: 1,
      fuzzyCandidates: 1,
      syncStaleBlocks: 0,
      eligibilityBlocks: 0,
      completedTaskReferences: 0,
    },
    fuzzyAutoLinkEnabled: false as const,
    reasons: ["exact:task_marker", "title_overlap"],
  }))
);

vi.mock("@/lib/routing/repo", () => ({
  upsertRoutingSession,
  appendWorkLink,
}));

vi.mock("@/lib/sync", () => ({
  snapshot: vi.fn(async () => ({
    tasks: [
      {
        id: "TASK-439",
        title: "MCP suggest work",
        description: "routing suggestions",
        bucket: "BKT-INFRA",
        stage: "progress",
        repos: ["plx-mc"],
        labels: ["routing"],
      },
    ],
    buckets: [{ id: "BKT-INFRA", repos: ["plx-mc"], project: "PRJ-PORTAL-GOLIVE" }],
    repos: [{ id: "plx-mc", name: "PLX_MC" }],
    risks: [],
    files: [],
    conflicts: [],
    errors: [],
    audit: [],
    counts: {},
    repoRequests: [],
    bucketComments: {},
    projects: [],
    lastSweep: new Date().toISOString(),
  })),
  createTask,
}));

vi.mock("@/lib/sync/repo", () => ({
  getRegisterInboundCompletions: vi.fn(async () => ({
    projects: new Date(),
    buckets: new Date(),
    tasks: new Date(),
  })),
  getEntity: vi.fn(),
}));

vi.mock("@/lib/routing/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/routing/engine")>();
  return {
    ...actual,
    runShadowRouting,
  };
});

import { ApiError } from "@/lib/api/route";
import {
  MCP_SERVICE_PRINCIPAL_ID,
  type McpIdentity,
} from "@/lib/mcp/auth";
import {
  actionSuggestWork,
  routingSuggestEnabled,
} from "@/lib/mcp/routing-suggest-actions";
import { authorize } from "@/lib/permissions";

function mcpIdentity(overrides: Partial<McpIdentity> = {}): McpIdentity {
  return {
    operatorEmail: "vince@petrasoap.com",
    runtime: "cursor",
    workerId: "w1",
    repo: "petralabx/PLX_MC",
    servicePrincipalId: MCP_SERVICE_PRINCIPAL_ID,
    actor: {
      kind: "service",
      id: MCP_SERVICE_PRINCIPAL_ID,
      status: "active",
    },
    ...overrides,
  };
}

describe("routing suggest (P5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "1");
  });

  it("exposes the suggest kill switch", () => {
    expect(routingSuggestEnabled()).toBe(true);
    vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "0");
    expect(routingSuggestEnabled()).toBe(false);
  });

  it("authorizes routing.suggest for the durable MCP service principal", () => {
    const identity = mcpIdentity();
    expect(
      authorize({
        actor: identity.actor,
        capability: "routing.suggest",
      }).allowed
    ).toBe(true);
  });

  it("returns routingSessionId, candidates, reasons, and deep links without Task mutation", async () => {
    const result = await actionSuggestWork(mcpIdentity(), {
      title: "MCP suggest work",
      body: "MC-Task: TASK-439",
    });

    expect(result.routingSessionId).toMatch(/^rtx_[a-f0-9]+$/i);
    expect(result.ok).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.taskId).toBe("TASK-439");
    expect(result.candidates[0]?.link).toContain("/tasks/TASK-439");
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.deepLinks.session).toContain(result.routingSessionId);
    expect(result.mcRoutingMarker).toBe(`MC-Routing: ${result.routingSessionId}`);
    expect(result.operatorContext).toBe("vince@petrasoap.com");

    expect(upsertRoutingSession).toHaveBeenCalledTimes(1);
    expect(createTask).not.toHaveBeenCalled();
    expect(appendWorkLink).not.toHaveBeenCalled();
    expect(runShadowRouting).toHaveBeenCalledTimes(1);
  });

  it("treats operator email as audit context — spoofed email cannot grant human capabilities", async () => {
    const identity = mcpIdentity({
      operatorEmail: "outsider@example.com",
    });
    // Shared API key still authenticates the service principal; suggest uses actor grants.
    const result = await actionSuggestWork(identity, { title: "x" });
    expect(result.operatorContext).toBe("outsider@example.com");
    expect(result.routingSessionId).toMatch(/^rtx_/);
    // Authorization used the service principal, not the operator email.
    expect(
      authorize({
        actor: identity.actor,
        capability: "routing.suggest",
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: {
          kind: "human",
          id: "outsider@example.com",
          role: "member",
          status: "active",
        },
        capability: "permissions.manage",
      }).allowed
    ).toBe(false);
  });

  it("fails closed when suggestions are disabled", async () => {
    vi.stubEnv("PLX_MC_ROUTING_SUGGEST_ENABLED", "0");
    await expect(actionSuggestWork(mcpIdentity(), { title: "x" })).rejects.toBeInstanceOf(
      ApiError
    );
    expect(createTask).not.toHaveBeenCalled();
  });

  it("reuses a provided routingSessionId", async () => {
    const result = await actionSuggestWork(mcpIdentity(), {
      title: "reuse",
      routingSessionId: "rtx_existing123",
    });
    expect(result.routingSessionId).toBe("rtx_existing123");
    expect(upsertRoutingSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rtx_existing123" })
    );
  });
});
