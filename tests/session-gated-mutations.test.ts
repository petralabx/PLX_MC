// TASK-3011: mutating routes that relied on the middleware session alone now
// gate on requireSessionActor(<capability>) and take the author / actor from the
// signed-in session, never the body (LESSONS 2026-10-14 vendor-spend rule).
// The real requireSessionActor → authorize path and the real project ACL guard
// run; only the session, the identity row, the decision log and the stores are
// seams (same pattern as tests/vendor-spend-routes.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Comment, Project, RepoRequest } from "@/lib/mc-data/types";

const authState = vi.hoisted(() => ({
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
  role: "member" as "owner" | "admin" | "member",
}));

const m = vi.hoisted(() => ({
  buckets: [] as unknown[],
  projects: [] as unknown[],
  threads: {} as Record<string, unknown[]>,
  repoRequests: [] as unknown[],
  replaceBucketComments: vi.fn(async (_id: string, comments: unknown[]) => comments),
  upsertRepoRequest: vi.fn(async () => undefined),
  validateRepoInOrg: vi.fn(async () => ({ ok: true })),
  reconcileSweep: vi.fn(async () => ({ processed: 0, resolved: 0, failed: 0 })),
  createSkillSubmission: vi.fn(async (input: Record<string, unknown>) => ({ id: "SUB-1", ...input })),
  fetchManifest: vi.fn(async () => ({ ok: false, note: "offline" })),
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => authState.session,
  oidcEnabled: () => true,
}));

vi.mock("@/lib/permissions/repository", () => ({
  findMcUserByEntraOid: async (oid: string) => ({
    id: "u1",
    entraOid: oid,
    email: authState.session?.user?.email ?? "",
    accessRole: authState.role,
    status: "active",
  }),
  findServicePrincipalById: async () => null,
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

vi.mock("@/lib/permissions/shadow-mismatch", () => ({
  recordShadowMismatch: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getBuckets: async () => m.buckets,
  getProjects: async () => m.projects,
  bucketCommentsByBucket: async () => m.threads,
  replaceBucketComments: m.replaceBucketComments,
  getRepoRequests: async () => m.repoRequests,
  upsertRepoRequest: m.upsertRepoRequest,
}));

vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  validateRepoInOrg: m.validateRepoInOrg,
}));

vi.mock("@/lib/compliance/service", () => ({ reconcileSweep: m.reconcileSweep }));

vi.mock("@/lib/skills-directory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/skills-directory")>()),
  createSkillSubmission: m.createSkillSubmission,
  readCompanySkillsAllowlist: () => ({}),
  pointerFromAllowlist: () => ({}),
  createSkillsSource: () => ({ fetchManifest: m.fetchManifest }),
}));

import * as bucketCommentsRoute from "@/app/api/buckets/[id]/comments/route";
import * as reconcileRoute from "@/app/api/compliance/reconcile/route";
import * as repoRequestsRoute from "@/app/api/repos/requests/route";
import * as repoValidateRoute from "@/app/api/repos/validate/route";
import * as skillsInstallRoute from "@/app/api/skills-directory/install/route";
import * as skillsSubmitRoute from "@/app/api/skills-directory/submit/route";
import * as skillsSyncCheckRoute from "@/app/api/skills-directory/sync-check/route";

// greg (member) and vince (owner) are directory humans: their author id is the
// directory id, the same id GET /api/viewer gives the client.
const GREG = { user: { oid: "oid-greg", email: "greg.m@petrasoap.com" } };
const VINCE = { user: { oid: "oid-vince", email: "vince@petrasoap.com" } };

const ctx = (id?: string) => ({ params: Promise.resolve((id ? { id } : {}) as Record<string, string>) });
const jsonReq = (method: string, body: unknown) =>
  new Request("http://test/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const comment = (over: Partial<Comment>): Comment => ({
  id: "CMT-1",
  author: "vince",
  body: "original",
  ts: "2026.10.15 · 09:00",
  mentions: [],
  ...over,
});

const pendingRequest = (over: Partial<RepoRequest> = {}): RepoRequest => ({
  id: "RR-1",
  name: "new-repo",
  owner: "petralabx",
  requestedBy: "greg",
  requestedTs: "2026.10.15 · 09:00",
  status: "pending",
  verified: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.session = GREG;
  authState.role = "member";
  m.buckets = [{ id: "BKT-OPEN", project: "PRJ-OPEN" } as Bucket, { id: "BKT-SECRET", project: "PRJ-SECRET" } as Bucket];
  m.projects = [
    { id: "PRJ-OPEN" } as Project,
    { id: "PRJ-SECRET", visibility: "restricted", members: ["vince@petrasoap.com"] } as Project,
  ];
  m.threads = {};
  m.repoRequests = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function errorCode(resp: Response): Promise<string> {
  return ((await resp.json()) as { error: { code: string } }).error.code;
}

// ─── PATCH /api/buckets/{id}/comments ────────────────────────────────────────

describe("PATCH /api/buckets/{id}/comments", () => {
  it("stores a new comment under the session author, never the body's", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { actor: "vince", comments: [comment({ id: "CMT-2", author: "vince", body: "hi" })] }),
      ctx("BKT-OPEN")
    );
    expect(resp.status).toBe(200);
    expect(m.replaceBucketComments).toHaveBeenCalledWith("BKT-OPEN", [
      expect.objectContaining({ id: "CMT-2", author: "greg", body: "hi" }),
    ]);
  });

  it("keeps other people's comments unchanged when the client edits or drops them", async () => {
    m.threads = { "BKT-OPEN": [comment({ id: "CMT-1", author: "vince", body: "original" })] };
    await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { comments: [comment({ id: "CMT-1", author: "vince", body: "rewritten" })] }),
      ctx("BKT-OPEN")
    );
    expect(m.replaceBucketComments).toHaveBeenLastCalledWith("BKT-OPEN", [
      comment({ id: "CMT-1", author: "vince", body: "original" }),
    ]);

    await bucketCommentsRoute.PATCH(jsonReq("PATCH", { comments: [] }), ctx("BKT-OPEN"));
    expect(m.replaceBucketComments).toHaveBeenLastCalledWith("BKT-OPEN", [
      comment({ id: "CMT-1", author: "vince", body: "original" }),
    ]);
  });

  it("lets the author edit and delete their own comment", async () => {
    m.threads = {
      "BKT-OPEN": [comment({ id: "CMT-1", author: "greg" }), comment({ id: "CMT-3", author: "greg" })],
    };
    await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", {
        comments: [comment({ id: "CMT-1", author: "greg", body: "edited", editedTs: "2026.10.15 · 10:00" })],
      }),
      ctx("BKT-OPEN")
    );
    expect(m.replaceBucketComments).toHaveBeenCalledWith("BKT-OPEN", [
      comment({ id: "CMT-1", author: "greg", body: "edited", editedTs: "2026.10.15 · 10:00" }),
    ]);
  });

  it("refuses a comment write on a restricted bucket without the project ACL", async () => {
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { comments: [comment({ id: "CMT-9", author: "greg" })] }),
      ctx("BKT-SECRET")
    );
    expect(resp.status).toBe(403);
    expect(m.replaceBucketComments).not.toHaveBeenCalled();
  });

  it("admits a project member on the restricted bucket", async () => {
    authState.session = VINCE;
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { comments: [comment({ id: "CMT-9", author: "greg" })] }),
      ctx("BKT-SECRET")
    );
    expect(resp.status).toBe(200);
    expect(m.replaceBucketComments).toHaveBeenCalledWith("BKT-SECRET", [
      expect.objectContaining({ id: "CMT-9", author: "vince" }),
    ]);
  });

  it("403s with no session", async () => {
    authState.session = null;
    const resp = await bucketCommentsRoute.PATCH(jsonReq("PATCH", { comments: [] }), ctx("BKT-OPEN"));
    expect(resp.status).toBe(403);
    expect(m.replaceBucketComments).not.toHaveBeenCalled();
  });
});

// ─── POST /api/repos/requests ────────────────────────────────────────────────

describe("POST /api/repos/requests", () => {
  it("files a new request as the session requester and ignores a body decision", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ requestedBy: "vince", decidedBy: "vince", decidedTs: "x" })),
      ctx()
    );
    expect(resp.status).toBe(200);
    const stored = (m.upsertRepoRequest.mock.calls[0] as unknown[])[0] as RepoRequest;
    expect(stored).toMatchObject({ id: "RR-1", requestedBy: "greg", status: "pending" });
    expect(stored.decidedBy).toBeUndefined();
    expect(stored.decidedTs).toBeUndefined();
  });

  it("refuses to create a request that is already approved", async () => {
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ status: "approved", decidedBy: "vince" })),
      ctx()
    );
    expect(resp.status).toBe(400);
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });

  it("refuses an approval from a member under enforce", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    m.repoRequests = [pendingRequest({ requestedBy: "stephen" })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ requestedBy: "stephen", status: "approved", decidedBy: "vince" })),
      ctx()
    );
    expect(resp.status).toBe(403);
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });

  it("refuses self-approval, even by an approver", async () => {
    authState.session = VINCE;
    authState.role = "owner";
    m.repoRequests = [pendingRequest({ requestedBy: "vince" })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ requestedBy: "vince", status: "approved", decidedBy: "vince" })),
      ctx()
    );
    expect(resp.status).toBe(403);
    expect(await errorCode(resp)).toBe("self_approval");
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });

  it("records an approver's decision under the session, keeping the stored requester", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    authState.session = VINCE;
    authState.role = "owner";
    m.repoRequests = [pendingRequest({ requestedBy: "greg" })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ requestedBy: "stephen", status: "approved", decidedBy: "greg" })),
      ctx()
    );
    expect(resp.status).toBe(200);
    const stored = (m.upsertRepoRequest.mock.calls[0] as unknown[])[0] as RepoRequest;
    expect(stored).toMatchObject({ status: "approved", requestedBy: "greg", decidedBy: "vince" });
    expect(stored.decidedTs).toBeTruthy();
  });

  it("refuses to approve an unverified request", async () => {
    authState.session = VINCE;
    m.repoRequests = [pendingRequest({ verified: false })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ verified: true, status: "approved" })),
      ctx()
    );
    expect(resp.status).toBe(409);
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });

  it("refuses to rewrite a decided request", async () => {
    authState.session = VINCE;
    m.repoRequests = [pendingRequest({ status: "rejected", decidedBy: "stephen" })];
    const resp = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest()), ctx());
    expect(resp.status).toBe(409);
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });

  it("lets only the requester update their pending request", async () => {
    m.repoRequests = [pendingRequest({ requestedBy: "greg", verified: false })];
    const own = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ verified: true })), ctx());
    expect(own.status).toBe(200);

    authState.session = { user: { oid: "oid-ross", email: "ross@petrasoap.com" } };
    const other = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ note: "mine now" })), ctx());
    expect(other.status).toBe(403);
    expect(m.upsertRepoRequest).toHaveBeenCalledTimes(1);
  });
});

// ─── Other session-gated mutations ───────────────────────────────────────────

describe("POST /api/compliance/reconcile", () => {
  it("403s a member under enforce and runs nothing", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await reconcileRoute.POST(jsonReq("POST", {}), ctx());
    expect(resp.status).toBe(403);
    expect(m.reconcileSweep).not.toHaveBeenCalled();
  });

  it("runs the sweep for an admin under enforce", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    authState.role = "admin";
    const resp = await reconcileRoute.POST(jsonReq("POST", {}), ctx());
    expect(resp.status).toBe(200);
    expect(m.reconcileSweep).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/skills-directory/submit", () => {
  const submission = {
    skillId: "my-skill",
    title: "Skill review: my-skill",
    submitterEmail: "vince@petrasoap.com",
    skillMd: "# skill",
  };

  it("records the session email as the submitter, never the body's (member under enforce)", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await skillsSubmitRoute.POST(jsonReq("POST", submission), ctx());
    expect(resp.status).toBe(200);
    expect(m.createSkillSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: "my-skill", submitterEmail: "greg.m@petrasoap.com" })
    );
  });

  it("403s with no session", async () => {
    authState.session = null;
    const resp = await skillsSubmitRoute.POST(jsonReq("POST", submission), ctx());
    expect(resp.status).toBe(403);
    expect(m.createSkillSubmission).not.toHaveBeenCalled();
  });
});

describe("session gate on the skills install / sync-check and repo validate probes", () => {
  const probes = [
    { name: "skills install", call: () => skillsInstallRoute.POST(jsonReq("POST", {}), ctx()), seam: m.fetchManifest },
    { name: "skills sync-check", call: () => skillsSyncCheckRoute.POST(jsonReq("POST", {}), ctx()), seam: m.fetchManifest },
    {
      name: "repos validate",
      call: () => repoValidateRoute.POST(jsonReq("POST", { name: "new-repo" }), ctx()),
      seam: m.validateRepoInOrg,
    },
  ];

  for (const probe of probes) {
    it(`${probe.name} 403s with no session and calls nothing`, async () => {
      authState.session = null;
      const resp = await probe.call();
      expect(resp.status).toBe(403);
      expect(probe.seam).not.toHaveBeenCalled();
    });

    it(`${probe.name} admits a member under enforce`, async () => {
      vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
      await probe.call();
      expect(probe.seam).toHaveBeenCalledTimes(1);
    });
  }
});
