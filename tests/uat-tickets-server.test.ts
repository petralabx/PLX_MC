// TASK-3706 — server side of the BKT-UAT tickets view. Hermetic: the DB repos,
// secrets, session gate and fetch are stubs. Invariants: the portal read is off
// by default and never fetches; every portal failure comes back as a visible
// error, never an empty snapshot; the loader sends lease facts without
// checkout ids and never reads the whole task table; GET /api/uat-tickets runs
// the session and project gates before any read.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import type { DispatchListRow } from "@/lib/compliance/repo";
import type { Task } from "@/lib/mc-data";
import { TASKS } from "@/lib/mc-data";

const h = vi.hoisted(() => ({
  portalReadEnabled: vi.fn(() => false),
  portalReadToken: vi.fn(() => "portal-token"),
  bucketTasks: vi.fn(),
  dispatches: vi.fn(),
  requireSessionActor: vi.fn(),
  assertBucketProjectAccess: vi.fn(),
}));

vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  uatPortalReadEnabled: h.portalReadEnabled,
  portalReadToken: h.portalReadToken,
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
}));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireSessionActor: h.requireSessionActor,
  aclPrincipalFromAuthorized: () => ({ tokens: ["vince"] }),
}));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertBucketProjectAccess: h.assertBucketProjectAccess,
}));

import { GET } from "@/app/api/uat-tickets/route";
import { loadUatTickets, pickLease } from "@/lib/compliance/uat-tickets";
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
    const report = await loadUatTickets(NOW);
    expect(h.bucketTasks).toHaveBeenCalledWith(UAT_TICKET_BUCKET);
    expect(h.dispatches).toHaveBeenCalledWith({ taskIds: ["TASK-11"], limit: 2000 });
    expect(report).toMatchObject({ generatedAt: NOW.toISOString(), bucketId: UAT_TICKET_BUCKET, portal: { status: "off" } });
    expect(Object.keys(report.facts)).toEqual(["TASK-11"]);
    expect(report.facts["TASK-11"]).toMatchObject({ createdAt: at(30), lease: { agent: "Claude Code", expiresAt: at(4) } });
    expect(JSON.stringify(report)).not.toContain("dsp_");
  });

  it("skips the checkout read with no ticket tasks", async () => {
    expect(await loadUatTickets(NOW)).toMatchObject({ facts: {} });
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
