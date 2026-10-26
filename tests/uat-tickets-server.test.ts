// TASK-3706 — server side of the BKT-UAT tickets view and its drift check.
// Hermetic: the DB repos, secrets, session gate, store and fetch are stubs.
// Invariants: the portal read is off by default and never fetches; every
// portal failure comes back as a visible error, never an empty snapshot; the
// loader sends lease facts without checkout ids and never reads the whole task
// table; GET /api/uat-tickets runs the session and project gates before any
// read; the cron is CRON_SECRET-gated and kill-switched, and records one
// uat.drift.checked event when on; each fix runs through the store's writes.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import type { DispatchListRow, EventRow } from "@/lib/compliance/repo";
import type { Task } from "@/lib/mc-data";
import { TASKS } from "@/lib/mc-data";

const h = vi.hoisted(() => ({
  portalReadEnabled: vi.fn(() => false),
  portalReadToken: vi.fn(() => "portal-token"),
  cronConfigured: vi.fn(() => true),
  cronSecret: vi.fn(() => "topsecret"),
  driftCronEnabled: vi.fn(() => true),
  bucketTasks: vi.fn(),
  dispatches: vi.fn(),
  lastEvents: vi.fn(),
  append: vi.fn(),
  cancel: vi.fn(),
  setStage: vi.fn(),
  refresh: vi.fn(),
  notice: vi.fn(),
  api: vi.fn(),
  requireSessionActor: vi.fn(),
  assertBucketProjectAccess: vi.fn(),
}));

vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  uatPortalReadEnabled: h.portalReadEnabled,
  portalReadToken: h.portalReadToken,
  cronConfigured: h.cronConfigured,
  cronSecret: h.cronSecret,
  uatDriftCronEnabled: h.driftCronEnabled,
}));
vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getBucketTasks: h.bucketTasks,
  getEntities: async () => {
    throw new Error("the view must not read the whole task table");
  },
}));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  listDispatches: h.dispatches,
  eventsByKinds: h.lastEvents,
  appendEvent: h.append,
}));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: h.requireSessionActor,
  aclPrincipalFromAuthorized: () => ({ tokens: ["vince"] }),
}));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: h.assertBucketProjectAccess,
}));

vi.mock("@/lib/mc-data/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mc-data/store")>()),
  cancelTaskWithReason: h.cancel,
  setTaskStage: h.setStage,
  refreshState: h.refresh,
  pushNotice: h.notice,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: h.api,
}));

import { GET as cronGet } from "@/app/api/cron/uat-drift/route";
import { GET } from "@/app/api/uat-tickets/route";
import { runUatFix } from "@/components/mc/uat-tickets";
import { UAT_DRIFT_EVENT_KIND, loadUatTickets, pickLease } from "@/lib/compliance/uat-tickets";
import { PORTAL_SNAPSHOT_PATH, readPortalTickets } from "@/lib/compliance/uat-portal-read";
import { UAT_TICKET_BUCKET, type PortalTicket } from "@/lib/tasks/uat-tickets";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const FB = "cmfa00000000000000aaaaaa1";

const ticketTask = (id: string, over: Partial<Task> = {}): Task =>
  ({ ...TASKS[0], id, bucket: UAT_TICKET_BUCKET, stage: "progress", labels: ["kind:code", `uat:${FB}`], prs: [], ...over }) as Task;

function dispatch(taskId: string, over: Partial<DispatchListRow> = {}): DispatchListRow {
  return {
    id: `dsp_secret_${taskId}_${Math.random().toString(36).slice(2, 6)}`,
    actorKind: "agent",
    runtime: "claude-code",
    taskId,
    accountableHuman: "vince@petrasoap.com",
    repo: "petralabx/plx-customer-portal",
    revoked: false,
    issuedAt: at(10),
    expiresAt: at(4),
    releasedAt: null,
    releasedReason: null,
    ...over,
  };
}

const portalTicket: PortalTicket = {
  id: FB,
  status: "IN_PROGRESS",
  step: "Agent fixing",
  attempt: 1,
  expectsTask: true,
  staging: null,
  title: "Pricing: export drops the last row",
  updatedAt: at(1),
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.restoreAllMocks();
  h.portalReadEnabled.mockReset().mockReturnValue(false);
  h.portalReadToken.mockReset().mockReturnValue("portal-token");
  h.bucketTasks.mockReset().mockResolvedValue([]);
  h.dispatches.mockReset().mockResolvedValue([]);
  h.cronConfigured.mockReset().mockReturnValue(true);
  h.cronSecret.mockReset().mockReturnValue("topsecret");
  h.driftCronEnabled.mockReset().mockReturnValue(true);
  h.lastEvents.mockReset().mockResolvedValue([]);
  h.append.mockReset().mockResolvedValue("1");
  h.cancel.mockReset().mockResolvedValue(true);
  h.setStage.mockReset().mockResolvedValue(undefined);
  h.refresh.mockReset().mockResolvedValue(undefined);
  h.notice.mockReset();
  h.api.mockReset().mockResolvedValue({});
  h.requireSessionActor.mockReset().mockResolvedValue({ actorId: "vince", auditLabel: "vince@petrasoap.com", actor: { id: "vince" } });
  h.assertBucketProjectAccess.mockReset().mockResolvedValue(undefined);
});

describe("readPortalTickets", () => {
  it("is off by default and never fetches", async () => {
    const fetchImpl = vi.fn();
    expect(await readPortalTickets(NOW, fetchImpl)).toEqual({ status: "off" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads the snapshot with a GET and the bearer token when on", async () => {
    h.portalReadEnabled.mockReturnValue(true);
    const fetchImpl = vi.fn(async () => jsonResponse({ tickets: [portalTicket] }));
    expect(await readPortalTickets(NOW, fetchImpl)).toEqual({ status: "ok", at: NOW.toISOString(), tickets: [portalTicket] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://staging.plxcustomer.io${PORTAL_SNAPSHOT_PATH}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer portal-token");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("turns every failure into a visible error, never an empty snapshot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    const read = (fetchImpl: typeof fetch) => readPortalTickets(NOW, fetchImpl);
    expect(await read(vi.fn(async () => jsonResponse({ error: "nope" }, 404)))).toMatchObject({
      status: "error",
      message: "The portal answered HTTP 404.",
    });
    expect(await read(vi.fn(async () => jsonResponse({ tickets: [{ id: FB }] })))).toMatchObject({
      status: "error",
      message: expect.stringContaining("expected shape"),
    });
    expect(await read(vi.fn(async () => Promise.reject(new Error("ECONNRESET"))))).toMatchObject({
      status: "error",
      message: "Couldn't reach the portal: ECONNRESET.",
    });
    h.portalReadToken.mockImplementation(() => {
      throw new Error("missing secret");
    });
    expect(await read(vi.fn())).toMatchObject({ status: "error", message: "PLX_MC_PORTAL_READ_TOKEN is not set." });
  });
});

describe("pickLease", () => {
  it("prefers the live checkout, skips revoked ones, and drops the checkout id", () => {
    const nowMs = NOW.getTime();
    const live = dispatch("TASK-1", { issuedAt: at(2), expiresAt: at(-3) });
    const newerExpired = dispatch("TASK-1", { issuedAt: at(1), expiresAt: at(0.5) });
    const revoked = dispatch("TASK-1", { issuedAt: at(0.2), expiresAt: at(-5), revoked: true });
    expect(pickLease([revoked, newerExpired, live], nowMs)).toEqual({
      agent: "Claude Code",
      issuedAt: live.issuedAt,
      expiresAt: live.expiresAt,
      releasedAt: null,
      releasedReason: null,
    });
    expect(pickLease([revoked, newerExpired], nowMs)?.expiresAt).toBe(newerExpired.expiresAt);
    expect(pickLease([], nowMs)).toBeNull();
  });
});

describe("loadUatTickets", () => {
  it("folds facts for UAT ticket tasks only, without checkout ids", async () => {
    h.bucketTasks.mockResolvedValue([
      { task: ticketTask("TASK-11"), createdAt: at(30) },
      { task: ticketTask("TASK-12", { labels: ["kind:code"] }), createdAt: at(3) },
    ]);
    h.dispatches.mockResolvedValue([dispatch("TASK-11")]);
    h.lastEvents.mockResolvedValue([
      { seq: "9", ts: at(6), kind: UAT_DRIFT_EVENT_KIND, actor: "mc-uat-drift", repo: null, taskId: null, pr: null, payload: { portal: "off", findings: [{}, {}] } } satisfies EventRow,
    ]);
    const report = await loadUatTickets(NOW);
    expect(h.bucketTasks).toHaveBeenCalledWith(UAT_TICKET_BUCKET);
    expect(h.dispatches).toHaveBeenCalledWith({ taskIds: ["TASK-11"], limit: 2000 });
    expect(report).toMatchObject({ generatedAt: NOW.toISOString(), bucketId: UAT_TICKET_BUCKET, portal: { status: "off" } });
    expect(Object.keys(report.facts)).toEqual(["TASK-11"]);
    expect(report.facts["TASK-11"]).toMatchObject({ createdAt: at(30), lease: { agent: "Claude Code", expiresAt: at(4) } });
    expect(JSON.stringify(report)).not.toContain("dsp_");
    expect(report.drift.map((f) => [f.case, f.taskId])).toEqual([["expired_lease_no_pr", "TASK-11"]]);
    expect(report.lastDailyCheck).toEqual({ at: at(6), findings: 2, portal: "off" });
  });

  // TASK-3975: one setting, PLX_MC_PORTAL_BASE_URL, for the read and the ticket links.
  it("names the portal origin the read calls, so ticket links follow PLX_MC_PORTAL_BASE_URL", async () => {
    expect((await loadUatTickets(NOW)).portalOrigin).toBe("https://staging.plxcustomer.io");
    vi.stubEnv("PLX_MC_PORTAL_BASE_URL", "https://uat.portal.test/");
    try {
      h.portalReadEnabled.mockReturnValue(true);
      const fetchImpl = vi.fn(async () => jsonResponse({ tickets: [] }));
      await readPortalTickets(NOW, fetchImpl);
      const [url] = fetchImpl.mock.calls[0] as unknown as [string];
      expect(url).toBe(`https://uat.portal.test${PORTAL_SNAPSHOT_PATH}`);
      h.portalReadEnabled.mockReturnValue(false);
      expect((await loadUatTickets(NOW)).portalOrigin).toBe("https://uat.portal.test");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("skips the checkout read with no ticket tasks", async () => {
    expect(await loadUatTickets(NOW)).toMatchObject({ facts: {}, drift: [], lastDailyCheck: null });
    expect(h.dispatches).not.toHaveBeenCalled();
  });
});

describe("GET /api/uat-tickets", () => {
  const ctx = { params: Promise.resolve({}) };

  it("checks the session and the bucket's project before reading", async () => {
    const resp = await GET(new Request("http://test/api/uat-tickets"), ctx);
    expect(resp.status).toBe(200);
    expect(h.requireSessionActor).toHaveBeenCalledWith("task.read", { type: "bucket", id: UAT_TICKET_BUCKET });
    expect(h.assertBucketProjectAccess).toHaveBeenCalledWith(UAT_TICKET_BUCKET, expect.anything());
    expect((await resp.json()).data).toMatchObject({ bucketId: UAT_TICKET_BUCKET, facts: {} });
  });

  it("reads nothing when the viewer can't see the project", async () => {
    h.assertBucketProjectAccess.mockRejectedValue(new ApiError("not_found", "unknown bucket", 404));
    const resp = await GET(new Request("http://test/api/uat-tickets"), ctx);
    expect(resp.status).toBe(404);
    expect(h.bucketTasks).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/uat-drift", () => {
  const ctx = { params: Promise.resolve({}) };
  const call = (auth?: string) =>
    cronGet(new Request("http://test/api/cron/uat-drift", auth ? { headers: { authorization: auth } } : {}), ctx);

  it("is default-off: 503 when CRON_SECRET is unset, 401 on a missing or wrong bearer", async () => {
    h.cronConfigured.mockReturnValue(false);
    expect((await call("Bearer topsecret")).status).toBe(503);
    h.cronConfigured.mockReturnValue(true);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(h.bucketTasks).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });

  it("kill switch off: enabled false, no reads, no writes", async () => {
    h.driftCronEnabled.mockReturnValue(false);
    expect(await (await call("Bearer topsecret")).json()).toEqual({ data: { enabled: false } });
    expect(h.bucketTasks).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });

  it("records one uat.drift.checked event with each finding's case and task, and fixes nothing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.bucketTasks.mockResolvedValue([{ task: ticketTask("TASK-11"), createdAt: at(30) }]);
    h.dispatches.mockResolvedValue([dispatch("TASK-11")]);
    expect(await (await call("Bearer topsecret")).json()).toEqual({ data: { enabled: true, findings: 1, portal: "off" } });
    expect(h.append).toHaveBeenCalledTimes(1);
    expect(h.append.mock.calls[0][0]).toEqual({
      kind: UAT_DRIFT_EVENT_KIND,
      actor: "mc-uat-drift",
      payload: {
        bucketId: UAT_TICKET_BUCKET,
        tasks: 1,
        portal: "off",
        portalMessage: null,
        findings: [{ case: "expired_lease_no_pr", taskId: "TASK-11", feedbackId: FB }],
      },
    });
    expect(h.cancel).not.toHaveBeenCalled();
    expect(h.setStage).not.toHaveBeenCalled();
  });
});

describe("runUatFix", () => {
  it("cancels through the cancel route with the finding's reason", async () => {
    await runUatFix({ kind: "cancel", taskId: "TASK-11", reason: "superseded", replacedBy: "TASK-12", note: "newer" });
    expect(h.cancel).toHaveBeenCalledWith("TASK-11", { reason: "superseded", replacedBy: "TASK-12", note: "newer" });
  });

  it("reopens and requeues by moving the task to backlog", async () => {
    await runUatFix({ kind: "reopen", taskId: "TASK-11" });
    await runUatFix({ kind: "requeue", taskId: "TASK-12" });
    expect(h.setStage.mock.calls).toEqual([
      ["TASK-11", "backlog"],
      ["TASK-12", "backlog"],
    ]);
  });

  it("creates the ticket task and reloads the snapshot, and says so when the create fails", async () => {
    await runUatFix({ kind: "create", feedbackId: FB, title: "Export", attempt: 1 });
    const [path, init] = h.api.mock.calls[0] as [string, RequestInit];
    expect([path, init.method]).toEqual(["/tasks", "POST"]);
    expect(JSON.parse(init.body as string).labels).toContain(`uat:${FB}`);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.api.mockRejectedValue(new Error("forbidden"));
    await runUatFix({ kind: "create", feedbackId: FB, title: "Export", attempt: 1 });
    expect(h.notice).toHaveBeenCalledWith(expect.stringContaining("forbidden"));
  });

  it("links the created task to the report's portal origin (TASK-3975)", async () => {
    await runUatFix({ kind: "create", feedbackId: FB, title: "Export", attempt: 1 }, "https://uat.portal.test");
    const [, init] = h.api.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).description).toContain(`https://uat.portal.test/uat?ticket=${FB}`);
  });
});
