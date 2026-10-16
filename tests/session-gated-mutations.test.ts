// TASK-3011: mutating routes that relied on the middleware session alone now
// gate on requireSessionActor(<capability>) and take the author / actor from the
// signed-in session, never the body (LESSONS 2026-10-14 vendor-spend rule).
// The real requireSessionActor → authorize path and the real project ACL guard
// run; only the session, the identity row, the decision log and the stores are
// seams (same pattern as tests/vendor-spend-routes.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bucket, Project, RepoRequest, Task } from "@/lib/mc-data/types";

const authState = vi.hoisted(() => ({
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
  role: "member" as "owner" | "admin" | "member",
}));

const m = vi.hoisted(() => ({
  buckets: [] as unknown[],
  projects: [] as unknown[],
  repoRequests: [] as unknown[],
  tasks: [] as unknown[],
  applyBucketCommentOp: vi.fn(async () => [] as unknown[]),
  applyTaskCommentOp: vi.fn(async () => [] as unknown[] | null),
  upsertRepoRequest: vi.fn(async () => true),
  recordRepoRequestVerification: vi.fn(async () => true),
  decideRepoRequest: vi.fn(async () => true),
  validateRepoInOrg: vi.fn(async () => ({ ok: true, visibility: "private", def: "main", lang: "Go" }) as Record<string, unknown>),
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
  getEntity: async (type: string, id: string) => {
    const task = type === "task" ? (m.tasks as Task[]).find((t) => t.id === id) : undefined;
    return task ? { data: task } : null;
  },
  applyBucketCommentOp: m.applyBucketCommentOp,
  getRepoRequest: async (id: string) => (m.repoRequests as RepoRequest[]).find((r) => r.id === id) ?? null,
  upsertRepoRequest: m.upsertRepoRequest,
  recordRepoRequestVerification: m.recordRepoRequestVerification,
  decideRepoRequest: m.decideRepoRequest,
}));

// The GitHub probe, where verifyRepoRequest (sync/repo-requests) calls it.
vi.mock("@/lib/sync/github", () => ({ validateRepoInOrg: m.validateRepoInOrg }));

vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  applyTaskCommentOp: m.applyTaskCommentOp,
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
import * as taskCommentsRoute from "@/app/api/tasks/[id]/comments/route";

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
  m.repoRequests = [];
  m.tasks = [{ id: "TASK-OPEN", bucket: "BKT-OPEN" } as Task, { id: "TASK-SECRET", bucket: "BKT-SECRET" } as Task];
  m.applyTaskCommentOp.mockResolvedValue([]);
  m.upsertRepoRequest.mockResolvedValue(true);
  m.recordRepoRequestVerification.mockResolvedValue(true);
  m.decideRepoRequest.mockResolvedValue(true);
  m.validateRepoInOrg.mockResolvedValue({ ok: true, visibility: "private", def: "main", lang: "Go" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function errorCode(resp: Response): Promise<string> {
  return ((await resp.json()) as { error: { code: string } }).error.code;
}

// ─── PATCH /api/buckets/{id}/comments ────────────────────────────────────────

describe("PATCH /api/buckets/{id}/comments", () => {
  it("applies one add under the session author, never the body's (member under enforce)", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { op: "add", body: "hi", mentions: [], author: "vince", actor: "vince" }),
      ctx("BKT-OPEN")
    );
    expect(resp.status).toBe(200);
    expect(m.applyBucketCommentOp).toHaveBeenCalledWith("BKT-OPEN", { op: "add", body: "hi", mentions: [] }, "greg");
  });

  it("passes edit and delete through with the session author for the ownership check", async () => {
    await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { op: "edit", id: "CMT-1", body: "edited", mentions: [] }),
      ctx("BKT-OPEN")
    );
    await bucketCommentsRoute.PATCH(jsonReq("PATCH", { op: "delete", id: "CMT-1" }), ctx("BKT-OPEN"));
    expect(m.applyBucketCommentOp).toHaveBeenNthCalledWith(
      1,
      "BKT-OPEN",
      { op: "edit", id: "CMT-1", body: "edited", mentions: [] },
      "greg"
    );
    expect(m.applyBucketCommentOp).toHaveBeenNthCalledWith(2, "BKT-OPEN", { op: "delete", id: "CMT-1" }, "greg");
  });

  it("rejects the old whole-thread body (400)", async () => {
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { comments: [{ id: "CMT-1", author: "vince", body: "x", ts: "t", mentions: [] }] }),
      ctx("BKT-OPEN")
    );
    expect(resp.status).toBe(400);
    expect(m.applyBucketCommentOp).not.toHaveBeenCalled();
  });

  it("refuses a comment write on a restricted bucket without the project ACL", async () => {
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { op: "add", body: "hi", mentions: [] }),
      ctx("BKT-SECRET")
    );
    expect(resp.status).toBe(403);
    expect(m.applyBucketCommentOp).not.toHaveBeenCalled();
  });

  it("admits a project member on the restricted bucket", async () => {
    authState.session = VINCE;
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { op: "add", body: "hi", mentions: [] }),
      ctx("BKT-SECRET")
    );
    expect(resp.status).toBe(200);
    expect(m.applyBucketCommentOp).toHaveBeenCalledWith("BKT-SECRET", { op: "add", body: "hi", mentions: [] }, "vince");
  });

  it("404s an unknown bucket", async () => {
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { op: "add", body: "hi", mentions: [] }),
      ctx("BKT-NOPE")
    );
    expect(resp.status).toBe(404);
    expect(m.applyBucketCommentOp).not.toHaveBeenCalled();
  });

  it("403s with no session", async () => {
    authState.session = null;
    const resp = await bucketCommentsRoute.PATCH(
      jsonReq("PATCH", { op: "add", body: "hi", mentions: [] }),
      ctx("BKT-OPEN")
    );
    expect(resp.status).toBe(403);
    expect(m.applyBucketCommentOp).not.toHaveBeenCalled();
  });
});

// ─── PATCH /api/tasks/{id}/comments (TASK-3043) ──────────────────────────────

describe("PATCH /api/tasks/{id}/comments", () => {
  it("applies one add under the session author, never the body's (member under enforce)", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    const resp = await taskCommentsRoute.PATCH(
      jsonReq("PATCH", { op: "add", body: "hi", mentions: [], author: "vince", id: "CMT-forged", ts: "x" }),
      ctx("TASK-OPEN")
    );
    expect(resp.status).toBe(200);
    expect(m.applyTaskCommentOp).toHaveBeenCalledWith("TASK-OPEN", { op: "add", body: "hi", mentions: [] }, "greg");
  });

  it("passes edit and delete through with the session as the author to check", async () => {
    await taskCommentsRoute.PATCH(jsonReq("PATCH", { op: "delete", id: "CMT-1", author: "vince" }), ctx("TASK-OPEN"));
    expect(m.applyTaskCommentOp).toHaveBeenCalledWith("TASK-OPEN", { op: "delete", id: "CMT-1" }, "greg");
  });

  it("refuses a whole-thread body", async () => {
    const resp = await taskCommentsRoute.PATCH(
      jsonReq("PATCH", { comments: [{ id: "CMT-1", author: "vince", body: "x", ts: "t", mentions: [] }] }),
      ctx("TASK-OPEN")
    );
    expect(resp.status).toBe(400);
    expect(m.applyTaskCommentOp).not.toHaveBeenCalled();
  });

  it("refuses a task in a restricted project the session is not a member of", async () => {
    const resp = await taskCommentsRoute.PATCH(jsonReq("PATCH", { op: "add", body: "x", mentions: [] }), ctx("TASK-SECRET"));
    expect(resp.status).toBe(403);
    expect(m.applyTaskCommentOp).not.toHaveBeenCalled();
  });

  it("404s an unknown task", async () => {
    const resp = await taskCommentsRoute.PATCH(jsonReq("PATCH", { op: "add", body: "x", mentions: [] }), ctx("TASK-404"));
    expect(resp.status).toBe(404);
    expect(m.applyTaskCommentOp).not.toHaveBeenCalled();
  });

  it("403s with no session and writes nothing", async () => {
    authState.session = null;
    const resp = await taskCommentsRoute.PATCH(jsonReq("PATCH", { op: "add", body: "x", mentions: [] }), ctx("TASK-OPEN"));
    expect(resp.status).toBe(403);
    expect(m.applyTaskCommentOp).not.toHaveBeenCalled();
  });
});

// ─── POST /api/repos/validate (TASK-3043) ────────────────────────────────────

describe("POST /api/repos/validate — records the result on the filed request", () => {
  const validate = (body: Record<string, unknown>) => repoValidateRoute.POST(jsonReq("POST", body), ctx());

  it("validates the stored request and records the server's result, ignoring any client verdict", async () => {
    m.repoRequests = [pendingRequest({ verified: false })];
    const resp = await validate({ requestId: "RR-1", owner: "petralabx", name: "new-repo", verified: false, ok: false });
    expect(resp.status).toBe(200);
    expect((await resp.json()).data).toMatchObject({ ok: true, visibility: "private" });
    expect(m.validateRepoInOrg).toHaveBeenCalledWith("petralabx", "new-repo");
    expect(m.recordRepoRequestVerification).toHaveBeenCalledWith({
      id: "RR-1",
      name: "new-repo",
      owner: "petralabx",
      verified: true,
      note: "Validated against petralabx on GitHub.",
      visibility: "private",
      def: "main",
      lang: "Go",
    });
  });

  it("records a failed validation as unverified", async () => {
    m.repoRequests = [pendingRequest({ verified: true })];
    m.validateRepoInOrg.mockResolvedValue({ ok: false, note: "not found" });
    await validate({ requestId: "RR-1", owner: "petralabx", name: "new-repo" });
    const recorded = (m.recordRepoRequestVerification.mock.calls[0] as unknown[])[0] as RepoRequest;
    expect(recorded).toMatchObject({ id: "RR-1", verified: false, note: "not found" });
    expect(recorded.visibility).toBeUndefined(); // a stale lookup is not kept
  });

  it("lets only the requester validate their request", async () => {
    m.repoRequests = [pendingRequest({ requestedBy: "greg" })];
    authState.session = VINCE;
    const resp = await validate({ requestId: "RR-1", owner: "petralabx", name: "new-repo" });
    expect(resp.status).toBe(403);
    expect(m.recordRepoRequestVerification).not.toHaveBeenCalled();
  });

  it("refuses an unknown, decided or renamed request and records nothing", async () => {
    expect((await validate({ requestId: "RR-9", name: "new-repo" })).status).toBe(404);
    m.repoRequests = [pendingRequest({ status: "rejected", decidedBy: "vince" })];
    expect((await validate({ requestId: "RR-1", name: "new-repo" })).status).toBe(409);
    m.repoRequests = [pendingRequest()];
    expect((await validate({ requestId: "RR-1", name: "other-repo" })).status).toBe(409);
    expect(m.validateRepoInOrg).not.toHaveBeenCalled();
    expect(m.recordRepoRequestVerification).not.toHaveBeenCalled();
  });

  it("409s when the request changed before the conditional record landed", async () => {
    m.repoRequests = [pendingRequest()];
    m.recordRepoRequestVerification.mockResolvedValue(false);
    expect((await validate({ requestId: "RR-1", name: "new-repo" })).status).toBe(409);
  });

  it("without a requestId is a bare probe that records nothing", async () => {
    const resp = await validate({ name: "new-repo" });
    expect(resp.status).toBe(200);
    expect(m.recordRepoRequestVerification).not.toHaveBeenCalled();
  });
});

// ─── POST /api/repos/requests ────────────────────────────────────────────────

const stored = (mock: { mock: { calls: unknown[][] } }, call = 0) => mock.mock.calls[call][0] as RepoRequest;

describe("POST /api/repos/requests — filing and updating", () => {
  it("files as the session requester; decision and verification fields in the body are ignored", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    m.validateRepoInOrg.mockResolvedValue({ ok: false, note: "not found in the org" });
    const resp = await repoRequestsRoute.POST(
      jsonReq(
        "POST",
        pendingRequest({
          requestedBy: "vince",
          decidedBy: "vince",
          decidedTs: "x",
          verified: true,
          note: "trust me",
          visibility: "public",
          def: "main",
          lang: "Rust",
        })
      ),
      ctx()
    );
    expect(resp.status).toBe(200);
    expect(m.validateRepoInOrg).toHaveBeenCalledWith("petralabx", "new-repo");
    const row = stored(m.upsertRepoRequest);
    expect(row).toMatchObject({ id: "RR-1", requestedBy: "greg", status: "pending", verified: false, note: "not found in the org" });
    expect(row.decidedBy).toBeUndefined();
    expect(row.decidedTs).toBeUndefined();
    expect(row.visibility).toBeUndefined();
    expect(row.lang).toBeUndefined();
  });

  it("records the server's GitHub verification on a new request", async () => {
    await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ verified: false })), ctx());
    expect(stored(m.upsertRepoRequest)).toMatchObject({ verified: true, visibility: "private", def: "main", lang: "Go" });
  });

  it("never verifies a request in a disallowed org", async () => {
    await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ owner: "evil-corp", verified: true })), ctx());
    expect(m.validateRepoInOrg).not.toHaveBeenCalled();
    expect(stored(m.upsertRepoRequest)).toMatchObject({ verified: false });
  });

  it("refuses to create a request that is already approved", async () => {
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ status: "approved", decidedBy: "vince" })),
      ctx()
    );
    expect(resp.status).toBe(400);
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });

  it("an unchanged re-send keeps the stored verification and writes nothing", async () => {
    m.repoRequests = [pendingRequest({ verified: false, note: "not found" })];
    const resp = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ verified: true, note: "ok" })), ctx());
    expect(resp.status).toBe(200);
    expect((await resp.json()).data).toMatchObject({ verified: false, note: "not found" });
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
    expect(m.validateRepoInOrg).not.toHaveBeenCalled();
  });

  it("re-verifies when the requester changes the name or owner", async () => {
    m.repoRequests = [pendingRequest({ verified: true })];
    m.validateRepoInOrg.mockResolvedValue({ ok: false, note: "not found" });
    await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ name: "other-repo", verified: true })), ctx());
    expect(m.validateRepoInOrg).toHaveBeenCalledWith("petralabx", "other-repo");
    expect(stored(m.upsertRepoRequest)).toMatchObject({ name: "other-repo", verified: false });
  });

  it("409s when the request was decided before the conditional update landed", async () => {
    m.repoRequests = [pendingRequest()];
    m.upsertRepoRequest.mockResolvedValue(false);
    const resp = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ name: "renamed" })), ctx());
    expect(resp.status).toBe(409);
  });

  it("lets only the requester update their pending request", async () => {
    m.repoRequests = [pendingRequest({ requestedBy: "greg" })];
    authState.session = { user: { oid: "oid-ross", email: "ross@petrasoap.com" } };
    const other = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ name: "mine-now" })), ctx());
    expect(other.status).toBe(403);
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });

  it("refuses to rewrite a decided request", async () => {
    authState.session = VINCE;
    m.repoRequests = [pendingRequest({ status: "rejected", decidedBy: "stephen" })];
    const resp = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest()), ctx());
    expect(resp.status).toBe(409);
    expect(m.upsertRepoRequest).not.toHaveBeenCalled();
  });
});

describe("POST /api/repos/requests — decisions", () => {
  it("refuses an approval from a member under enforce", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    m.repoRequests = [pendingRequest({ requestedBy: "stephen" })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ requestedBy: "stephen", status: "approved" })),
      ctx()
    );
    expect(resp.status).toBe(403);
    expect(m.decideRepoRequest).not.toHaveBeenCalled();
  });

  it("refuses approve and reject from a directory member in the default mode", async () => {
    m.repoRequests = [pendingRequest({ requestedBy: "stephen" })];
    for (const status of ["approved", "rejected"] as const) {
      const resp = await repoRequestsRoute.POST(
        jsonReq("POST", pendingRequest({ requestedBy: "stephen", status })),
        ctx()
      );
      expect(resp.status).toBe(403);
      expect(await errorCode(resp)).toBe("not_approver");
    }
    expect(m.decideRepoRequest).not.toHaveBeenCalled();
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
    expect(m.decideRepoRequest).not.toHaveBeenCalled();
  });

  it("approves under the session and adds the stored request's repo in the same write", async () => {
    vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_MODE", "enforce");
    authState.session = VINCE;
    authState.role = "owner";
    m.repoRequests = [pendingRequest({ requestedBy: "greg", visibility: "private", def: "main", lang: "Go" })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ name: "swapped", requestedBy: "stephen", status: "approved", decidedBy: "greg" })),
      ctx()
    );
    expect(resp.status).toBe(200);
    const [decided, repo] = m.decideRepoRequest.mock.calls[0] as unknown as [RepoRequest, { id: string; name: string }];
    expect(decided).toMatchObject({ status: "approved", name: "new-repo", requestedBy: "greg", decidedBy: "vince" });
    expect(decided.decidedTs).toBeTruthy();
    expect(repo).toMatchObject({ id: "new-repo", name: "new-repo", owner: "petralabx" });
  });

  it("rejects without adding a repo", async () => {
    authState.session = VINCE;
    authState.role = "owner";
    m.repoRequests = [pendingRequest()];
    const resp = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ status: "rejected" })), ctx());
    expect(resp.status).toBe(200);
    expect(m.decideRepoRequest).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", decidedBy: "vince" }), undefined);
  });

  it("refuses to approve an unverified request", async () => {
    authState.session = VINCE;
    authState.role = "owner";
    m.repoRequests = [pendingRequest({ verified: false })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ verified: true, status: "approved" })),
      ctx()
    );
    expect(resp.status).toBe(409);
    expect(m.decideRepoRequest).not.toHaveBeenCalled();
  });

  it("refuses to approve a request in a disallowed org", async () => {
    authState.session = VINCE;
    authState.role = "owner";
    m.repoRequests = [pendingRequest({ owner: "evil-corp", verified: true })];
    const resp = await repoRequestsRoute.POST(
      jsonReq("POST", pendingRequest({ owner: "evil-corp", status: "approved" })),
      ctx()
    );
    expect(resp.status).toBe(409);
    expect(m.decideRepoRequest).not.toHaveBeenCalled();
  });

  it("409s when another decision or update won the race", async () => {
    authState.session = VINCE;
    authState.role = "owner";
    m.repoRequests = [pendingRequest()];
    m.decideRepoRequest.mockResolvedValue(false);
    const resp = await repoRequestsRoute.POST(jsonReq("POST", pendingRequest({ status: "approved" })), ctx());
    expect(resp.status).toBe(409);
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
