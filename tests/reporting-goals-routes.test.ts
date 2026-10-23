// Goals & Production routes and access: Viewers read, Editors refresh, the cron
// fires only at 06:00 Toronto on weekdays, and every write is checked on the
// server. The refresh itself is covered against Postgres in
// tests/reporting-goals-postgres.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  oidc: true,
  basic: false,
  session: null as null | { user: { email: string; roles?: string[] } },
  cronSecret: "cron-test-secret" as string | null,
  reporting: true,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => h.session),
  oidcEnabled: () => h.oidc,
}));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseConfigured: () => true,
  basicAuthConfigured: () => h.basic,
  reportingDatabaseConfigured: () => h.reporting,
  cronConfigured: () => h.cronSecret !== null,
  cronSecret: () => h.cronSecret ?? "",
}));
vi.mock("@/lib/db", () => ({ assertSchemaReady: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/compliance/repo", () => ({ appendEvent: vi.fn(), appendEventTx: vi.fn() }));
vi.mock("@/lib/reporting/goals/loader", () => ({ loadGoalsView: vi.fn(async () => ({ state: "ready" })) }));
vi.mock("@/lib/reporting/goals/refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reporting/goals/refresh")>()),
  startRefresh: vi.fn(),
  runRefresh: vi.fn(async (run: { id: number }) => ({ ...run, status: "succeeded" })),
}));
vi.mock("@/lib/reporting/goals/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reporting/goals/store")>()),
  getRun: vi.fn(async (id: number) => (id === 7 ? { id: 7, status: "running", step: "reading-sources" } : null)),
  // Run 41 has its lines; run 40 couldn't read them; any other run has none (it failed, or predates them).
  loadShipmentLines: vi.fn(async (id: number) =>
    id === 41
      ? { access: "read", missing: [], lines: [{ invoice: "IN1000180398", lineNo: 128, kind: "charge", code: "FRT", amount: "1250.000" }] }
      : id === 40
        ? { access: "missing", missing: ["sage.oe_invoice_detail.invdisc"], lines: [] }
        : null
  ),
}));

import { GET as cronGet } from "@/app/api/cron/reporting-goals/route";
import { POST as refreshPost } from "@/app/api/reporting/goals/refresh/route";
import { GET as viewGet } from "@/app/api/reporting/goals/route";
import { GET as runGet } from "@/app/api/reporting/goals/runs/[id]/route";
import { GET as linesGet } from "@/app/api/reporting/goals/runs/[id]/shipment-lines/route";
import { appendEvent } from "@/lib/compliance/repo";
import { goalsRolesFromClaims, resolveGoalsActor } from "@/lib/reporting/goals";
import { loadGoalsView } from "@/lib/reporting/goals/loader";
import { runRefresh, startRefresh } from "@/lib/reporting/goals/refresh";

const ctx = { params: Promise.resolve({}) };
const claimed = { kind: "claimed", run: { id: 41, status: "running", trigger: "user", today: "2026-10-14" } };

function signedIn(roles: string[] | undefined) {
  h.session = { user: { email: "Stephen@PetraSoap.com", roles } };
}

function post(body: string | undefined = "{}") {
  return refreshPost(new Request("http://localhost/api/reporting/goals/refresh", { method: "POST", body }), ctx);
}

function cron(at: string, authorization: string | null = "Bearer cron-test-secret") {
  vi.setSystemTime(new Date(at));
  const headers = authorization ? { authorization } : undefined;
  return cronGet(new Request("http://localhost/api/cron/reporting-goals", { headers }), ctx);
}

beforeEach(() => {
  h.oidc = true;
  h.basic = false;
  h.session = null;
  h.cronSecret = "cron-test-secret";
  h.reporting = true;
  vi.mocked(startRefresh).mockReset().mockResolvedValue(claimed as never);
  vi.mocked(runRefresh).mockClear();
  vi.mocked(appendEvent).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("roles", () => {
  it("maps Entra app roles; Editor implies Viewer", () => {
    expect(goalsRolesFromClaims(["Goals.Editor"])).toEqual(["viewer", "editor"]);
    expect(goalsRolesFromClaims(["Goals.Viewer", "Other"])).toEqual(["viewer"]);
    expect(goalsRolesFromClaims(["goals.viewer"])).toEqual([]);
    expect(goalsRolesFromClaims(undefined)).toEqual([]);
  });

  it("gives break-glass sessions read-only access and open local dev both roles", async () => {
    h.oidc = false;
    h.basic = true;
    expect(await resolveGoalsActor()).toMatchObject({ roles: ["viewer"], mode: "break-glass" });
    h.basic = false;
    expect(await resolveGoalsActor()).toMatchObject({ roles: ["viewer", "editor"], mode: "local" });
  });
});

describe("GET /api/reporting/goals", () => {
  it("is 401 without a session and 403 without a role", async () => {
    expect((await viewGet(new Request("http://localhost/api/reporting/goals"), ctx)).status).toBe(401);
    signedIn([]);
    const resp = await viewGet(new Request("http://localhost/api/reporting/goals"), ctx);
    expect(resp.status).toBe(403);
    expect(await resp.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("serves the page model and says whether the viewer may refresh", async () => {
    signedIn(["Goals.Viewer"]);
    const resp = await viewGet(new Request("http://localhost/api/reporting/goals"), ctx);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ data: { state: "ready", viewer: { editor: false } } });
    signedIn(["Goals.Editor"]);
    const editor = await viewGet(new Request("http://localhost/api/reporting/goals"), ctx);
    expect(await editor.json()).toEqual({ data: { state: "ready", viewer: { editor: true } } });
  });

  it("reads ?fx=: absent or boc is the Bank of Canada rate, sage the fixed Sage rate, anything else 400 (TASK-3780)", async () => {
    signedIn(["Goals.Viewer"]);
    vi.mocked(loadGoalsView).mockClear();
    for (const [query, basis] of [["", "boc"], ["?fx=boc", "boc"], ["?fx=sage", "sage"]] as const) {
      expect((await viewGet(new Request(`http://localhost/api/reporting/goals${query}`), ctx)).status).toBe(200);
      expect(vi.mocked(loadGoalsView)).toHaveBeenLastCalledWith(basis);
    }
    const bad = await viewGet(new Request("http://localhost/api/reporting/goals?fx=usd"), ctx);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_request", message: "fx must be boc or sage." } });
    // The role check comes first: no session is still 401, whatever the query.
    h.session = null;
    expect((await viewGet(new Request("http://localhost/api/reporting/goals?fx=usd"), ctx)).status).toBe(401);
  });
});

describe("POST /api/reporting/goals/refresh", () => {
  it("refuses Viewers with 403, records the refusal, and starts nothing", async () => {
    signedIn(["Goals.Viewer"]);
    const resp = await post();
    expect(resp.status).toBe(403);
    expect(startRefresh).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reporting.goals.denied", actor: "human:stephen@petrasoap.com" })
    );
  });

  it("refuses break-glass sessions (read-only)", async () => {
    h.oidc = false;
    h.basic = true;
    expect((await post()).status).toBe(403);
  });

  it("lets an Editor start a refresh: 202 with the claimed run, finished after the response", async () => {
    signedIn(["Goals.Editor"]);
    const resp = await post();
    expect(resp.status).toBe(202);
    expect(await resp.json()).toEqual({ data: { run: claimed.run } });
    expect(startRefresh).toHaveBeenCalledWith("user", "stephen@petrasoap.com");
    await new Promise((resolve) => setImmediate(resolve));
    expect(runRefresh).toHaveBeenCalledWith(claimed.run);
  });

  it("answers 409 while a refresh runs and 429 within 5 minutes of the last", async () => {
    signedIn(["Goals.Editor"]);
    vi.mocked(startRefresh).mockResolvedValueOnce({ kind: "running", run: claimed.run } as never);
    expect((await post()).status).toBe(409);
    vi.mocked(startRefresh).mockResolvedValueOnce({ kind: "rate_limited", run: claimed.run, retryAfterSeconds: 130 } as never);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited", message: expect.stringContaining("3 minutes") } });
    expect(runRefresh).not.toHaveBeenCalled();
  });

  it("validates the body and needs the reporting database", async () => {
    signedIn(["Goals.Editor"]);
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ trigger: "cron" }))).status).toBe(400);
    h.reporting = false;
    const resp = await post();
    expect(resp.status).toBe(503);
    expect(await resp.json()).toMatchObject({ error: { code: "not_configured" } });
  });
});

describe("GET /api/reporting/goals/runs/[id]", () => {
  const get = (id: string) => runGet(new Request(`http://localhost/api/reporting/goals/runs/${id}`), { params: Promise.resolve({ id }) });

  it("returns a run to Viewers, 404 for an unknown one, 400 for a bad id", async () => {
    signedIn(["Goals.Viewer"]);
    const ok = await get("7");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ data: { id: 7, status: "running", step: "reading-sources" } });
    expect((await get("8")).status).toBe(404);
    expect((await get("7.5")).status).toBe(400);
    expect((await get("-1")).status).toBe(400);
    signedIn([]);
    expect((await get("7")).status).toBe(403);
  });
});

describe("GET /api/reporting/goals/runs/[id]/shipment-lines", () => {
  const get = (id: string) =>
    linesGet(new Request(`http://localhost/api/reporting/goals/runs/${id}/shipment-lines`), { params: Promise.resolve({ id }) });

  it("returns one run's Sage invoice lines to Viewers, as stored", async () => {
    expect((await get("41")).status).toBe(401);
    signedIn(["Goals.Viewer"]);
    const ok = await get("41");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      data: { access: "read", missing: [], lines: [{ invoice: "IN1000180398", lineNo: 128, kind: "charge", code: "FRT", amount: "1250.000" }] },
    });
    expect(await (await get("40")).json()).toEqual({ data: { access: "missing", missing: ["sage.oe_invoice_detail.invdisc"], lines: [] } });
  });

  it("is 404 for a run without lines, 400 for a bad id and 403 without a Goals role", async () => {
    signedIn(["Goals.Editor"]);
    const none = await get("39");
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: { code: "not_found", message: "Refresh run 39 has no invoice lines." } });
    for (const bad of ["0", "-1", "4.1", "abc", "9007199254740993"]) expect((await get(bad)).status, bad).toBe(400);
    signedIn([]);
    expect((await get("41")).status).toBe(403);
  });
});

describe("GET /api/cron/reporting-goals", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));

  it("is 503 until CRON_SECRET is set and 401 with a wrong bearer", async () => {
    h.cronSecret = null;
    expect((await cron("2026-10-14T10:00:00Z")).status).toBe(503);
    h.cronSecret = "cron-test-secret";
    expect((await cron("2026-10-14T10:00:00Z", "Bearer wrong")).status).toBe(401);
    expect((await cron("2026-10-14T10:00:00Z", null)).status).toBe(401);
    expect(startRefresh).not.toHaveBeenCalled();
  });

  it("refreshes only at 06:00 Toronto, in summer and winter time", async () => {
    vi.mocked(startRefresh).mockResolvedValue({ kind: "claimed", run: { id: 50 } } as never);
    // 11:00 UTC is 07:00 EDT: skipped. 10:00 UTC is 06:00 EDT: runs.
    expect(await (await cron("2026-10-14T11:00:00Z")).json()).toMatchObject({ data: { ran: false, reason: "outside_window", torontoHour: 7 } });
    const summer = await (await cron("2026-10-14T10:00:00Z")).json();
    expect(summer).toMatchObject({ data: { ran: true, today: "2026-10-14", run: { id: 50, status: "succeeded" } } });
    // In December 10:00 UTC is 05:00 EST (skipped) and 11:00 UTC is 06:00 (runs).
    expect(await (await cron("2026-12-14T10:00:00Z")).json()).toMatchObject({ data: { ran: false, torontoHour: 5 } });
    expect(await (await cron("2026-12-14T11:00:00Z")).json()).toMatchObject({ data: { ran: true, today: "2026-12-14" } });
    expect(startRefresh).toHaveBeenCalledTimes(2);
    expect(vi.mocked(startRefresh).mock.calls[0].slice(0, 2)).toEqual(["cron", "cron"]);
  });

  it("skips weekends, an unconnected reporting database, and an already-running refresh", async () => {
    // Saturday 2026-10-17 at 06:00 EDT.
    expect(await (await cron("2026-10-17T10:00:00Z")).json()).toMatchObject({ data: { ran: false, reason: "outside_window" } });
    h.reporting = false;
    expect(await (await cron("2026-10-14T10:00:00Z")).json()).toMatchObject({ data: { ran: false, reason: "not_configured" } });
    h.reporting = true;
    vi.mocked(startRefresh).mockResolvedValueOnce({ kind: "running", run: { id: 9 } } as never);
    expect(await (await cron("2026-10-14T10:00:00Z")).json()).toMatchObject({ data: { ran: false, reason: "already_running", runId: 9 } });
    expect(runRefresh).not.toHaveBeenCalled();
  });
});
