// P9 — session Routing Inbox APIs: kill switch, CSRF, Entra oid, authorize.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionActor: vi.fn(),
  confirmExistingTask: vi.fn(),
  createConfirmedTask: vi.fn(),
  listInboxProposals: vi.fn(),
  getInboxProposalDetail: vi.fn(),
}));

vi.mock("@/lib/routing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/routing")>("@/lib/routing");
  return {
    ...actual,
    requireSessionActor: mocks.requireSessionActor,
    confirmExistingTask: mocks.confirmExistingTask,
    createConfirmedTask: mocks.createConfirmedTask,
  };
});

vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: mocks.requireSessionActor,
}));

vi.mock("@/app/api/routing/inbox/_lib/queries", () => ({
  listInboxProposals: mocks.listInboxProposals,
  getInboxProposalDetail: mocks.getInboxProposalDetail,
}));

vi.mock("@/lib/api/route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/route")>("@/lib/api/route");
  return {
    ...actual,
    route: (handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>) =>
      handler,
  };
});

import {
  resetRoutingInboxFlag,
  setRoutingInboxEnabled,
  tripRoutingInboxKillSwitch,
} from "@/components/mc/routing-inbox/flag";
import { assertSameOriginMutation } from "@/app/api/routing/inbox/_lib/guard";
import { ApiError } from "@/lib/api/route";

describe("routing inbox CSRF guard", () => {
  it("allows GET without origin headers", () => {
    expect(() =>
      assertSameOriginMutation(new Request("http://localhost/api/routing/inbox", { method: "GET" }))
    ).not.toThrow();
  });

  it("allows Sec-Fetch-Site same-origin mutations", () => {
    expect(() =>
      assertSameOriginMutation(
        new Request("http://localhost/api/routing/decide/accept", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin", host: "localhost" },
        })
      )
    ).not.toThrow();
  });

  it("rejects cross-site mutations", () => {
    expect(() =>
      assertSameOriginMutation(
        new Request("http://localhost/api/routing/decide/accept", {
          method: "POST",
          headers: { "sec-fetch-site": "cross-site", host: "localhost" },
        })
      )
    ).toThrow(ApiError);
  });

  it("allows Origin matching Host", () => {
    expect(() =>
      assertSameOriginMutation(
        new Request("http://localhost/api/routing/transfer", {
          method: "POST",
          headers: { origin: "http://localhost", host: "localhost" },
        })
      )
    ).not.toThrow();
  });
});

describe("routing inbox session APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoutingInboxFlag();
    setRoutingInboxEnabled(true);
    mocks.requireSessionActor.mockResolvedValue({
      actor: { kind: "human", id: "oid-1", role: "member", status: "active" },
      actorId: "oid-1",
      actorKind: "human",
      auditLabel: "vince@example.com",
    });
    mocks.confirmExistingTask.mockResolvedValue({
      taskId: "TASK-1",
      proposalId: "rp_1",
      decisionKind: "accept_existing",
      linkType: "related",
      created: false,
      replayed: false,
    });
    mocks.createConfirmedTask.mockResolvedValue({
      taskId: "TASK-9",
      proposalId: "rp_1",
      decisionKind: "create_task",
      linkType: "related",
      created: true,
      replayed: false,
    });
    mocks.listInboxProposals.mockResolvedValue({
      proposals: [],
      counts: { personal: 0, project: 0, bucket: 0, unrouted: 0 },
    });
    mocks.getInboxProposalDetail.mockResolvedValue({
      id: "rp_1",
      repoId: "petralabx/PLX_MC",
      changeId: "pr:1",
      title: "Fix",
      state: "action_required",
      failureReason: null,
      derivedProjectId: "PRJ-1",
      selectedBucketId: "BKT-1",
      selectedTaskId: null,
      sessionId: "rtx_1",
      accountableActorId: "oid-1",
      accountableActorKind: "human",
      topCandidate: null,
      slaAgeHours: 2,
      slaBreach: "none",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      markers: [],
      hierarchy: { projectId: "PRJ-1", bucketId: "BKT-1", taskId: null },
      candidates: [],
      revisionId: "rr_1",
      headSha: "abc",
      policyVersion: "v1",
      overrideAvailable: true,
    });
  });

  it("GET /api/routing/inbox refuses when kill switch trips", async () => {
    tripRoutingInboxKillSwitch();
    const { GET } = await import("@/app/api/routing/inbox/route");
    await expect(
      GET(new Request("http://localhost/api/routing/inbox?scope=personal"), {
        params: Promise.resolve({}),
      })
    ).rejects.toMatchObject({ code: "routing_inbox_disabled", status: 503 });
  });

  it("GET /api/routing/inbox authorizes routing.resolve with session actor", async () => {
    const { GET } = await import("@/app/api/routing/inbox/route");
    await GET(new Request("http://localhost/api/routing/inbox?scope=personal"), {
      params: Promise.resolve({}),
    });
    expect(mocks.requireSessionActor).toHaveBeenCalledWith(
      "routing.resolve",
      undefined,
      undefined
    );
    expect(mocks.listInboxProposals).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "personal", actorId: "oid-1" })
    );
  });

  it("GET /api/routing/inbox/[id] returns detail", async () => {
    const { GET } = await import("@/app/api/routing/inbox/[id]/route");
    const data = await GET(new Request("http://localhost/api/routing/inbox/rp_1"), {
      params: Promise.resolve({ id: "rp_1" }),
    });
    expect(data).toMatchObject({ id: "rp_1", hierarchy: expect.any(Object) });
  });

  it("POST accept derives actor server-side and ignores body.actorId", async () => {
    const { POST } = await import("@/app/api/routing/decide/accept/route");
    await POST(
      new Request("http://localhost/api/routing/decide/accept", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          host: "localhost",
        },
        body: JSON.stringify({
          proposalId: "rp_1",
          taskId: "TASK-1",
          actorId: "spoofed",
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(mocks.requireSessionActor).toHaveBeenCalledWith(
      "routing.resolve",
      expect.objectContaining({ type: "routing", id: "rp_1" }),
      undefined
    );
    expect(mocks.confirmExistingTask).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "oid-1" }),
      expect.objectContaining({ proposalId: "rp_1", taskId: "TASK-1" })
    );
  });

  it("POST change requires overrideReason and records override path", async () => {
    const { POST } = await import("@/app/api/routing/decide/change/route");
    await POST(
      new Request("http://localhost/api/routing/decide/change", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          host: "localhost",
        },
        body: JSON.stringify({
          proposalId: "rp_1",
          taskId: "TASK-2",
          overrideReason: "Better match",
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(mocks.confirmExistingTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskId: "TASK-2",
        overrideReason: "Better match",
      })
    );
  });

  it("POST create-intent defaults accountableOwnerId to session oid", async () => {
    const { POST } = await import("@/app/api/routing/decide/create-intent/route");
    await POST(
      new Request("http://localhost/api/routing/decide/create-intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          host: "localhost",
        },
        body: JSON.stringify({
          proposalId: "rp_1",
          bucketId: "BKT-1",
          title: "New task",
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(mocks.createConfirmedTask).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "oid-1" }),
      expect.objectContaining({
        accountableOwnerId: "oid-1",
        bucketId: "BKT-1",
      })
    );
  });

  it("POST accept rejects CSRF without same-origin signals", async () => {
    const { POST } = await import("@/app/api/routing/decide/accept/route");
    await expect(
      POST(
        new Request("http://localhost/api/routing/decide/accept", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "localhost",
            "sec-fetch-site": "cross-site",
          },
          body: JSON.stringify({ proposalId: "rp_1", taskId: "TASK-1" }),
        }),
        { params: Promise.resolve({}) }
      )
    ).rejects.toMatchObject({ code: "csrf_rejected" });
    expect(mocks.confirmExistingTask).not.toHaveBeenCalled();
  });
});
