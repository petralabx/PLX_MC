// TASK-4196 — the UAT scorecard's server side. Hermetic: secrets, the event
// log, the drift check, the session gate and fetch are stubs; without a
// database the store's process-local fallback stands in for mc_events.
// Invariants: the scorecard read is off by default and never fetches; every
// portal failure is a visible error, never an empty read; a clean final read
// is stored once, an open or partial read once per hour, and no partial
// re-read after the week's clean final read; the daily pull reads last week,
// then this week, each on its own, records a week that fails, and never fails
// the drift check, and a failed drift check still lets it run;
// GET /api/uat-scorecard checks the session before reading, bounds ?weeks and
// names the newest failed pull of a week the daily pull still reads that no
// later read of its own week answers, reading back 15 days of failures only,
// and none while the portal read or the daily check is off.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/route";
import type { EventRow } from "@/lib/compliance/repo";

const h = vi.hoisted(() => ({
  portalReadEnabled: vi.fn(() => false),
  portalReadToken: vi.fn(() => "portal-token"),
  cronConfigured: vi.fn(() => true),
  cronSecret: vi.fn(() => "topsecret"),
  driftCronEnabled: vi.fn(() => true),
  databaseConfigured: vi.fn(() => false),
  append: vi.fn(),
  events: vi.fn(),
  eventByKey: vi.fn(),
  loadUatTickets: vi.fn(),
  recordDrift: vi.fn(),
  requireSessionActor: vi.fn(),
  schemaReady: vi.fn(),
}));

vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  uatPortalReadEnabled: h.portalReadEnabled,
  portalReadToken: h.portalReadToken,
  cronConfigured: h.cronConfigured,
  cronSecret: h.cronSecret,
  uatDriftCronEnabled: h.driftCronEnabled,
  databaseConfigured: h.databaseConfigured,
}));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  appendEvent: h.append,
  eventsByKinds: h.events,
  eventByDedupKey: h.eventByKey,
}));
vi.mock("@/lib/compliance/uat-tickets", () => ({
  loadUatTickets: h.loadUatTickets,
  recordUatDriftCheck: h.recordDrift,
}));
vi.mock("@/lib/routing/mutations/actors", () => ({ requireSessionActor: h.requireSessionActor }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  assertSchemaReady: h.schemaReady,
}));

import { GET as cronGet } from "@/app/api/cron/uat-drift/route";
import { GET } from "@/app/api/uat-scorecard/route";
import { UatScorecardBody } from "@/components/mc/uat-scorecard";
import { PORTAL_SCORECARD_PATH, readPortalScorecard } from "@/lib/compliance/uat-portal-read";
import { SNAPSHOT_EVENT_KIND, buildScorecard, snapshotDedupKey, type ScorecardResponse } from "@/lib/uat-scorecard";
import { snapshotSchema } from "@/lib/uat-scorecard/schema";
import {
  MAX_PULL_FAILURES,
  MAX_SNAPSHOTS,
  PULL_ACTOR,
  PULL_FAILED_EVENT_KIND,
  listPullFailures,
  listSnapshots,
  pullScorecardWeeks,
  recordSnapshot,
  resetMemorySnapshots,
} from "@/lib/uat-scorecard/store";

// Friday 30 Oct, 06:00 in Toronto: last week began Monday 19 Oct, this week Monday 26 Oct.
const NOW = new Date("2026-10-30T10:00:00.000Z");
const LAST_WEEK = "2026-10-19";
const THIS_WEEK = "2026-10-26";
const WINDOWS: Record<string, [string, string]> = {
  [LAST_WEEK]: ["2026-10-19T04:00:00.000Z", "2026-10-26T04:00:00.000Z"],
  [THIS_WEEK]: ["2026-10-26T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
};

function payload(week: string, complete = week !== THIS_WEEK, generatedAt = NOW.toISOString(), readErrors: string[] = []) {
  const [start, end] = WINDOWS[week];
  return {
    schema: "plx-uat-scorecard/v1",
    window: { start, end, timeZone: "America/Toronto", complete },
    generatedAt,
    outcomes: { verdicts: 10, pass: 8, fail: 1, stale: 1, legacyStallExpiries: 0, passWithin5bdOfFiling: 6, firstAttemptPass: 6, reopened: 0, closedPollable: 8 },
    speed: {
      filedToPass: { p50: 4, p90: 9, n: 8 },
      holders: { plx: { p50: 0.5, n: 8 }, agent: { p50: 1, n: 8 }, pipeline: { p50: 0.25, n: 8 }, submitter: { p50: 2, n: 8 } },
    },
    flow: complete
      ? null
      : { filed: 9, open: 14, overClock: 0, waitingOnPlx: 3, stuck: 2, duplicatesClosed: null },
    users: { closingPoll: { responses: 4, average: 4.5, low: 0, lowWithFollowUp: 0 }, pulse: [] },
    reliability: { outboxFailedTerminal: 0, watchdogPages: 4, deadOutboxOpen: complete ? null : 0 },
    readErrors,
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A portal that answers each week's read from `answers`, keyed by the `week` it was asked for. */
function portal(answers: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const week = new URL(String(input)).searchParams.get("week") ?? "";
    const answer = answers[week];
    if (!answer) throw new Error(`unexpected read of week ${week}`);
    return answer();
  });
}

/** mc_events as the store uses it: a unique dedup_key, ts set at insert, seq in insert order, eventsByKinds' ts >= since, and eventByDedupKey. */
function eventLog() {
  const rows: (EventRow & { dedupKey?: string })[] = [];
  h.databaseConfigured.mockReturnValue(true);
  h.append.mockImplementation(async (e: { kind: string; actor: string; payload: Record<string, unknown>; dedupKey?: string }) => {
    if (e.dedupKey && rows.some((r) => r.dedupKey === e.dedupKey)) return undefined;
    const seq = String(rows.length + 1);
    rows.push({ seq, ts: new Date().toISOString(), kind: e.kind, actor: e.actor, repo: null, taskId: null, pr: null, payload: structuredClone(e.payload), dedupKey: e.dedupKey });
    return seq;
  });
  h.events.mockImplementation(async (kinds: string[], limit: number, since?: string) =>
    rows
      .filter((r) => kinds.includes(r.kind) && (since === undefined || Date.parse(r.ts) >= Date.parse(since)))
      .reverse()
      .slice(0, limit)
  );
  h.eventByKey.mockImplementation(async (key: string) => rows.find((r) => r.dedupKey === key) ?? null);
}

const ctx = { params: Promise.resolve({}) };
const cron = () => cronGet(new Request("http://test/api/cron/uat-drift", { headers: { authorization: "Bearer topsecret" } }), ctx);
const read = (qs = "") => GET(new Request(`http://test/api/uat-scorecard${qs}`), ctx);
const scorecard = async (qs = "") => ((await (await read(qs)).json()) as { data: ScorecardResponse }).data;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.stubEnv("PLX_MC_PORTAL_BASE_URL", "");
  resetMemorySnapshots();
  h.portalReadEnabled.mockReset().mockReturnValue(false);
  h.portalReadToken.mockReset().mockReturnValue("portal-token");
  h.cronConfigured.mockReset().mockReturnValue(true);
  h.cronSecret.mockReset().mockReturnValue("topsecret");
  h.driftCronEnabled.mockReset().mockReturnValue(true);
  h.databaseConfigured.mockReset().mockReturnValue(false);
  h.append.mockReset().mockResolvedValue("41");
  h.events.mockReset().mockResolvedValue([]);
  h.eventByKey.mockReset().mockResolvedValue(null);
  h.loadUatTickets.mockReset().mockResolvedValue({ facts: { "TASK-11": {} }, drift: [{}], portal: { status: "off" } });
  h.recordDrift.mockReset().mockResolvedValue(undefined);
  h.requireSessionActor.mockReset().mockResolvedValue({ actorId: "vince" });
  h.schemaReady.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("readPortalScorecard", () => {
  it("is off by default and never fetches", async () => {
    const fetchImpl = vi.fn();
    expect(await readPortalScorecard(LAST_WEEK, NOW, fetchImpl)).toEqual({ status: "off" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads one week with a GET and the bearer token when on", async () => {
    h.portalReadEnabled.mockReturnValue(true);
    const fetchImpl = vi.fn(async () => jsonResponse(payload(LAST_WEEK)));
    const result = await readPortalScorecard(LAST_WEEK, NOW, fetchImpl);
    expect(result).toEqual({ status: "ok", at: NOW.toISOString(), snapshot: snapshotSchema.parse(payload(LAST_WEEK)) });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://staging.plxcustomer.io${PORTAL_SCORECARD_PATH}?week=2026-10-19`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer portal-token");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("turns every failure into a visible error, never an empty read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    const at = (fetchImpl: typeof fetch) => readPortalScorecard(LAST_WEEK, NOW, fetchImpl);
    expect(await at(vi.fn(async () => jsonResponse({ error: "snapshot_unavailable" }, 503)))).toEqual({
      status: "error",
      at: NOW.toISOString(),
      message: "The portal answered HTTP 503.",
    });
    expect(await at(vi.fn(async () => jsonResponse({ error: "Not found" }, 404)))).toMatchObject({
      message: "The portal answered HTTP 404.",
    });
    expect(await at(vi.fn(async () => jsonResponse({ schema: "plx-uat-scorecard/v1", window: {} })))).toMatchObject({
      status: "error",
      message: "The portal's scorecard is not in the expected shape.",
    });
    expect(await at(vi.fn(async () => jsonResponse(payload(THIS_WEEK))))).toMatchObject({
      status: "error",
      message: "The portal answered for the week of 2026-10-26, not 2026-10-19.",
    });
    expect(await at(vi.fn(async () => Promise.reject(new Error("ECONNRESET"))))).toMatchObject({
      status: "error",
      message: "Couldn't reach the portal: ECONNRESET.",
    });
    h.portalReadToken.mockImplementation(() => {
      throw new Error("missing secret");
    });
    const noToken = vi.fn();
    expect(await at(noToken)).toMatchObject({ status: "error", message: "PLX_MC_PORTAL_READ_TOKEN is not set." });
    expect(noToken).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith("[uat-scorecard] portal read of week %s failed: %s", LAST_WEEK, "The portal answered HTTP 503.");
  });
});

describe("the store", () => {
  const closed = () => snapshotSchema.parse(payload(LAST_WEEK));
  const open = (at: string) => snapshotSchema.parse(payload(THIS_WEEK, false, at));

  it("keeps a closed week once, and an open week once per hour read, newest first (no database)", async () => {
    expect(await recordSnapshot(closed())).toMatchObject({ recorded: true });
    expect(await recordSnapshot(closed())).toEqual({ recorded: false, seq: null });
    expect(await recordSnapshot(open("2026-10-29T10:00:05.000Z"))).toMatchObject({ recorded: true });
    expect(await recordSnapshot(open("2026-10-29T10:40:00.000Z"))).toEqual({ recorded: false, seq: null });
    expect(await recordSnapshot(open("2026-10-30T10:00:05.000Z"))).toMatchObject({ recorded: true });
    const rows = await listSnapshots();
    expect(rows.map((r) => [r.seq, r.snapshot.generatedAt])).toEqual([
      ["3", "2026-10-30T10:00:05.000Z"],
      ["2", "2026-10-29T10:00:05.000Z"],
      ["1", NOW.toISOString()],
    ]);
    expect((await listSnapshots(1)).map((r) => r.seq)).toEqual(["3"]);
    expect(h.append).not.toHaveBeenCalled();
  });

  it("keeps a partial final read and the clean final read after it; a clean replay is a no-op", async () => {
    const final = (at: string, readErrors: string[] = []) => snapshotSchema.parse(payload(LAST_WEEK, true, at, readErrors));
    expect(await recordSnapshot(final("2026-10-26T10:00:05.000Z", ["reliability: could not be read."]))).toMatchObject({ recorded: true });
    expect(await recordSnapshot(final("2026-10-27T10:00:05.000Z"))).toMatchObject({ recorded: true });
    expect(await recordSnapshot(final("2026-10-28T10:00:05.000Z"))).toEqual({ recorded: false, seq: null });
    expect(await listSnapshots()).toHaveLength(2);
  });

  it.each(["memory", "mc_events"] as const)("stores no partial re-read of a week once its clean final read is stored (%s)", async (store) => {
    if (store === "mc_events") eventLog();
    const unread = ["reliability: could not be read."];
    const final = (at: string, readErrors: string[] = []) => snapshotSchema.parse(payload(LAST_WEEK, true, at, readErrors));
    // A partial read before the clean one is kept: the clean one still beats it.
    expect(await recordSnapshot(final("2026-10-26T10:00:05.000Z", unread))).toMatchObject({ recorded: true });
    expect(await recordSnapshot(final("2026-10-27T10:00:05.000Z"))).toMatchObject({ recorded: true });
    // After it, a partial re-read could never be shown: the pull leaves the week unchanged.
    h.portalReadEnabled.mockReturnValue(true);
    vi.setSystemTime(new Date("2026-10-28T10:00:00.000Z"));
    portal({
      [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK, true, "2026-10-28T10:00:05.000Z", unread)),
      [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK, false, "2026-10-28T10:00:05.000Z")),
    });
    expect((await pullScorecardWeeks()).weeks).toEqual([
      { week: LAST_WEEK, status: "unchanged" },
      { week: THIS_WEEK, status: "recorded" },
    ]);
    const finals = (await listSnapshots()).filter((r) => r.snapshot.window.complete);
    expect(finals.map((r) => r.snapshot.generatedAt)).toEqual(["2026-10-27T10:00:05.000Z", "2026-10-26T10:00:05.000Z"]);
  });

  it.each([
    ["summer time", LAST_WEEK, "2026-10-26T00:20:00.000-04:00", "2026-10-26T10:00:00.000Z"],
    ["winter time", THIS_WEEK, "2026-11-02T00:20:00.000-05:00", "2026-11-02T10:00:00.000Z"],
  ])("records and grades the clean final read after a partial one from 00:20 Toronto (%s)", async (_time, week, partialAt, cleanAt) => {
    const unread = { outboxFailedTerminal: null, watchdogPages: null, deadOutboxOpen: null };
    const partial = { ...payload(week, true, partialAt, ["reliability: could not be read."]), reliability: unread };
    expect(await recordSnapshot(snapshotSchema.parse(partial))).toMatchObject({ recorded: true });
    expect(await recordSnapshot(snapshotSchema.parse(payload(week, true, cleanAt)))).toMatchObject({ recorded: true });
    const graded = buildScorecard(await listSnapshots(), new Date("2026-11-03T12:00:00.000Z")).history.find((w) => w.week === week);
    expect(graded).toMatchObject({ state: "final", generatedAt: cleanAt, readErrors: [], areas: { reliability: 100 } });
  });

  it("reads back the 52 weeks ?weeks=52 shows, at the worst case", () => {
    // With the daily pull a week stores up to 7 open reads, one a day, and up to 7 final reads, one a day
    // the week after it closes, none after its clean final read. The oldest week shown is compared with the
    // week before it.
    expect(MAX_SNAPSHOTS).toBeGreaterThanOrEqual((52 + 1) * (7 + 7));
  });

  it("appends one keyed mc_events row with the database, and reads back only rows that still parse", async () => {
    h.databaseConfigured.mockReturnValue(true);
    expect(await recordSnapshot(closed())).toEqual({ recorded: true, seq: "41" });
    expect(h.append).toHaveBeenCalledWith({
      kind: SNAPSHOT_EVENT_KIND,
      actor: PULL_ACTOR,
      payload: { snapshot: closed() },
      dedupKey: snapshotDedupKey(closed()),
    });
    h.append.mockResolvedValue(undefined);
    expect(await recordSnapshot(closed())).toEqual({ recorded: false, seq: null });

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const row = (seq: string, snapshot: unknown): EventRow => ({
      seq,
      ts: "2026-10-30T10:00:01.000Z",
      kind: SNAPSHOT_EVENT_KIND,
      actor: PULL_ACTOR,
      repo: null,
      taskId: null,
      pr: null,
      payload: { snapshot },
    });
    h.events.mockResolvedValue([row("9", payload(THIS_WEEK)), row("8", { schema: "plx-uat-scorecard/v0" })]);
    const rows = await listSnapshots();
    expect(h.events).toHaveBeenCalledWith([SNAPSHOT_EVENT_KIND], MAX_SNAPSHOTS);
    expect(rows).toEqual([{ seq: "9", recordedAt: "2026-10-30T10:00:01.000Z", snapshot: snapshotSchema.parse(payload(THIS_WEEK)) }]);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe("pullScorecardWeeks", () => {
  it("reads last week before this week, one after the other", async () => {
    h.portalReadEnabled.mockReturnValue(true);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetched = portal({
      [LAST_WEEK]: async () => {
        await gate;
        return jsonResponse(payload(LAST_WEEK));
      },
      [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK)),
    });
    const pull = pullScorecardWeeks(NOW);
    await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
    expect(String(fetched.mock.calls[0][0])).toContain(`week=${LAST_WEEK}`);
    release();
    expect((await pull).status).toBe("ok");
    expect(fetched.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("week"))).toEqual([LAST_WEEK, THIS_WEEK]);
  });

  it("records a week that fails, once per week and hour, and nothing for a week that worked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    portal({ [LAST_WEEK]: () => jsonResponse({ error: "snapshot_unavailable" }, 503), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK)) });
    await pullScorecardWeeks(NOW);
    await pullScorecardWeeks(new Date(NOW.getTime() + 60_000));
    expect(await listPullFailures()).toEqual([{ week: LAST_WEEK, message: "The portal answered HTTP 503.", at: NOW.toISOString() }]);

    h.databaseConfigured.mockReturnValue(true);
    await pullScorecardWeeks(NOW);
    const failures = h.append.mock.calls.map(([e]) => e).filter((e: { kind: string }) => e.kind === PULL_FAILED_EVENT_KIND);
    expect(failures).toEqual([
      {
        kind: PULL_FAILED_EVENT_KIND,
        actor: PULL_ACTOR,
        payload: { week: LAST_WEEK, message: "The portal answered HTTP 503.", at: NOW.toISOString() },
        dedupKey: `uat-scorecard-pull-failed:${LAST_WEEK}|2026-10-30T10:00:00.000Z`,
      },
    ]);
    h.events.mockResolvedValue([
      {
        seq: "12",
        ts: "2026-10-30T10:00:01.000Z",
        kind: PULL_FAILED_EVENT_KIND,
        actor: PULL_ACTOR,
        repo: null,
        taskId: null,
        pr: null,
        payload: { week: LAST_WEEK, message: "The portal answered HTTP 503.", at: NOW.toISOString() },
      } satisfies EventRow,
    ]);
    expect(await listPullFailures()).toEqual([{ week: LAST_WEEK, message: "The portal answered HTTP 503.", at: "2026-10-30T10:00:01.000Z" }]);
    expect(h.events).toHaveBeenLastCalledWith([PULL_FAILED_EVENT_KIND], MAX_PULL_FAILURES, "2026-10-15T10:00:00.000Z");
  });

  it.each(["memory", "mc_events"] as const)("reads back only the failed pulls of the last 15 days (%s)", async (store) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    if (store === "mc_events") eventLog();
    h.portalReadEnabled.mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}, 503));
    for (const at of ["2026-10-15T09:59:59.999Z", "2026-10-15T10:00:00.000Z", "2026-10-29T10:00:00.000Z"]) {
      vi.setSystemTime(new Date(at));
      await pullScorecardWeeks();
    }
    // 15 days before Friday 30 Oct, 10:00 UTC is 15 Oct, 10:00 UTC.
    expect((await listPullFailures(NOW)).map((f) => [f.week, f.at])).toEqual([
      [THIS_WEEK, "2026-10-29T10:00:00.000Z"],
      [LAST_WEEK, "2026-10-29T10:00:00.000Z"],
      ["2026-10-12", "2026-10-15T10:00:00.000Z"],
      ["2026-10-05", "2026-10-15T10:00:00.000Z"],
    ]);
  });

  it("caps the failed pulls read at no less than 15 days of the dedup key can hold", () => {
    // One row per week and UTC hour of the run's start, two weeks a run. A row is stored up to a run's
    // length after its key hour, so the 15 days hold rows of 362 key hours.
    expect(MAX_PULL_FAILURES).toBeGreaterThanOrEqual(2 * (15 * 24 + 2));
  });

  it("still answers when the failure cannot be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    h.databaseConfigured.mockReturnValue(true);
    h.append.mockRejectedValue(new Error("connection terminated"));
    portal({ [LAST_WEEK]: () => jsonResponse({}, 503), [THIS_WEEK]: () => jsonResponse({}, 503) });
    expect((await pullScorecardWeeks(NOW)).weeks.map((w) => w.status)).toEqual(["error", "error"]);
  });

  it("reads nothing while the portal read is off", async () => {
    const fetched = portal({});
    expect(await pullScorecardWeeks(NOW)).toEqual({
      status: "off",
      weeks: [
        { week: LAST_WEEK, status: "off" },
        { week: THIS_WEEK, status: "off" },
      ],
    });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("stores last week and this week so far, and a replay changes nothing", async () => {
    h.portalReadEnabled.mockReturnValue(true);
    portal({ [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK)), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK)) });
    expect(await pullScorecardWeeks(NOW)).toEqual({
      status: "ok",
      weeks: [
        { week: LAST_WEEK, status: "recorded" },
        { week: THIS_WEEK, status: "recorded" },
      ],
    });
    expect((await pullScorecardWeeks(NOW)).weeks.map((w) => w.status)).toEqual(["unchanged", "unchanged"]);
    expect(await listSnapshots()).toHaveLength(2);
  });

  it("stores one week when the other fails, to read or to store", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    portal({ [LAST_WEEK]: () => jsonResponse({ error: "snapshot_unavailable" }, 503), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK)) });
    expect(await pullScorecardWeeks(NOW)).toEqual({
      status: "error",
      weeks: [
        { week: LAST_WEEK, status: "error", message: "The portal answered HTTP 503." },
        { week: THIS_WEEK, status: "recorded" },
      ],
    });
    h.databaseConfigured.mockReturnValue(true);
    h.append.mockImplementation(async ({ payload: { snapshot } }: { payload: { snapshot?: { window: { complete: boolean } } } }) => {
      if (snapshot?.window.complete) throw new Error("connection terminated");
      return "42";
    });
    portal({ [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK)), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK)) });
    expect((await pullScorecardWeeks(NOW)).weeks).toEqual([
      { week: LAST_WEEK, status: "error", message: "connection terminated" },
      { week: THIS_WEEK, status: "recorded" },
    ]);
  });
});

describe("GET /api/cron/uat-drift with the scorecard pull", () => {
  it("returns the drift result and each week's pull", async () => {
    h.portalReadEnabled.mockReturnValue(true);
    portal({ [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK)), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK)) });
    const resp = await cron();
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({
      data: {
        enabled: true,
        findings: 1,
        portal: "off",
        scorecard: {
          status: "ok",
          weeks: [
            { week: LAST_WEEK, status: "recorded" },
            { week: THIS_WEEK, status: "recorded" },
          ],
        },
      },
    });
    expect(h.recordDrift).toHaveBeenCalledTimes(1);
  });

  it("keeps the drift check whole when both pulls fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    portal({ [LAST_WEEK]: () => Promise.reject(new Error("ETIMEDOUT")), [THIS_WEEK]: () => jsonResponse({}, 401) });
    const resp = await cron();
    expect(resp.status).toBe(200);
    expect(((await resp.json()) as { data: unknown }).data).toMatchObject({
      enabled: true,
      findings: 1,
      scorecard: {
        status: "error",
        weeks: [
          { week: LAST_WEEK, status: "error", message: "Couldn't reach the portal: ETIMEDOUT." },
          { week: THIS_WEEK, status: "error", message: "The portal answered HTTP 401." },
        ],
      },
    });
    expect(h.recordDrift).toHaveBeenCalledTimes(1);
  });

  it("still pulls when the drift check fails, and the run still fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    h.loadUatTickets.mockRejectedValue(new Error("connection terminated"));
    const fetched = portal({ [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK)), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK)) });
    const resp = await cron();
    expect(resp.status).toBe(500);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("internal");
    expect(fetched).toHaveBeenCalledTimes(2);
    expect(await listSnapshots()).toHaveLength(2);
  });

  it("pulls nothing with the kill switch off or without the cron secret", async () => {
    h.portalReadEnabled.mockReturnValue(true);
    const fetched = portal({});
    h.driftCronEnabled.mockReturnValue(false);
    expect(await (await cron()).json()).toEqual({ data: { enabled: false } });
    h.driftCronEnabled.mockReturnValue(true);
    h.cronConfigured.mockReturnValue(false);
    expect((await cron()).status).toBe(503);
    expect(fetched).not.toHaveBeenCalled();
    expect(h.loadUatTickets).not.toHaveBeenCalled();
  });
});

describe("GET /api/uat-scorecard", () => {
  async function seed() {
    await recordSnapshot(snapshotSchema.parse(payload(LAST_WEEK)));
    await recordSnapshot(snapshotSchema.parse(payload(THIS_WEEK)));
  }

  it("checks the session before it reads anything", async () => {
    h.databaseConfigured.mockReturnValue(true);
    h.requireSessionActor.mockRejectedValue(new ApiError("unauthorized", "Sign in first.", 401));
    const resp = await read();
    expect(resp.status).toBe(401);
    expect(h.requireSessionActor).toHaveBeenCalledWith("task.read");
    expect(h.events).not.toHaveBeenCalled();
  });

  it("returns the headline week, the history, the rubric and where the numbers come from", async () => {
    await seed();
    h.portalReadEnabled.mockReturnValue(true);
    const resp = await read();
    expect(resp.status).toBe(200);
    const { data } = (await resp.json()) as {
      data: {
        latest: { week: string; state: string; cards: { id: string }[] };
        history: { week: string; state: string }[];
        rubric: { id: string }[];
        source: Record<string, unknown>;
      };
    };
    expect(data.latest).toMatchObject({ week: LAST_WEEK, state: "final" });
    expect(data.latest.cards.map((c) => c.id)).toEqual(["outcomes", "speed", "flow", "users", "reliability"]);
    expect(data.history.map((w) => [w.week, w.state])).toEqual([
      [LAST_WEEK, "final"],
      [THIS_WEEK, "open"],
    ]);
    expect(data.rubric.length).toBeGreaterThan(0);
    expect(data.source).toEqual({ portalRead: true, dailyCheck: true, portalOrigin: "https://staging.plxcustomer.io", lastPullFailure: null });
  });

  it("names the newest failed pull until a later read of its own week answers it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    await recordSnapshot(snapshotSchema.parse(payload(LAST_WEEK)));
    vi.setSystemTime(new Date("2026-10-31T10:00:00.000Z"));
    portal({ [LAST_WEEK]: () => jsonResponse({}, 503), [THIS_WEEK]: () => jsonResponse({}, 404) });
    await pullScorecardWeeks(new Date());
    expect((await scorecard()).source.lastPullFailure).toEqual({ week: THIS_WEEK, message: "The portal answered HTTP 404.", at: "2026-10-31T10:00:00.000Z" });

    // This week's read answers its failure. Last week's clean final read was already stored, so its failed re-read lost nothing.
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    portal({ [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK)), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK, false, "2026-11-01T10:00:00.000Z")) });
    await pullScorecardWeeks(new Date());
    expect((await scorecard()).source.lastPullFailure).toBeNull();
  });

  it.each(["memory", "mc_events"] as const)(
    "names last week's failed pull though this week's read is stored after it, and the screen shows it (%s)",
    async (store) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      if (store === "mc_events") eventLog();
      h.portalReadEnabled.mockReturnValue(true);
      // Each read takes 0.7 s, and last week's final read times out.
      const wait = () => vi.setSystemTime(Date.now() + 700);
      portal({
        [LAST_WEEK]: () => {
          wait();
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        },
        [THIS_WEEK]: () => {
          wait();
          return jsonResponse(payload(THIS_WEEK));
        },
      });
      expect((await pullScorecardWeeks()).weeks.map((w) => w.status)).toEqual(["error", "recorded"]);
      const data = await scorecard();
      expect(data.source.lastPullFailure).toEqual({
        week: LAST_WEEK,
        message: "Couldn't reach the portal: The operation was aborted due to timeout.",
        at: "2026-10-30T10:00:00.700Z",
      });
      const screen = renderToStaticMarkup(createElement(UatScorecardBody, { state: { status: "ready", data }, nav: () => {} }));
      expect(screen.replace(/\s/g, " ").replace(/&#x27;/g, "'")).toContain(
        "The last daily pull failed: Couldn't reach the portal: The operation was aborted due to timeout. (Oct 30, 6:00 AM EDT, week of Oct 19)"
      );

      // The next day's read of last week answers it.
      vi.setSystemTime(new Date("2026-10-31T10:00:00.000Z"));
      portal({ [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK)), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK, false, "2026-10-31T10:00:00.000Z")) });
      expect((await pullScorecardWeeks()).weeks.map((w) => w.status)).toEqual(["recorded", "recorded"]);
      expect((await scorecard()).source.lastPullFailure).toBeNull();
    }
  );

  it.each(["memory", "mc_events"] as const)(
    "names a week's failed final reads while the daily pull still reads it, then drops them for its no-final-read state (%s)",
    async (store) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      if (store === "mc_events") eventLog();
      h.portalReadEnabled.mockReturnValue(true);
      vi.setSystemTime(new Date("2026-10-25T10:00:00.000Z"));
      await recordSnapshot(snapshotSchema.parse(payload(LAST_WEEK, false, "2026-10-25T10:00:00.000Z")));
      // All 7 pulls of last week after it closed fail, while this week's read is stored each day.
      for (const day of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]) {
        const at = `${day}T10:00:00.000Z`;
        vi.setSystemTime(new Date(at));
        portal({ [LAST_WEEK]: () => jsonResponse({}, 503), [THIS_WEEK]: () => jsonResponse(payload(THIS_WEEK, false, at)) });
        expect((await pullScorecardWeeks()).weeks.map((w) => w.status), day).toEqual(["error", "recorded"]);
        expect((await scorecard()).source.lastPullFailure, day).toEqual({ week: LAST_WEEK, message: "The portal answered HTTP 503.", at });
      }
      const lastWeek = (data: ScorecardResponse) => data.history.find((w) => w.week === LAST_WEEK);
      // Sunday 23:30 EST: still last week.
      vi.setSystemTime(new Date("2026-11-02T04:30:00.000Z"));
      const sunday = await scorecard();
      expect(sunday.source.lastPullFailure).toMatchObject({ week: LAST_WEEK, at: "2026-11-01T10:00:00.000Z" });
      expect(lastWeek(sunday)).toMatchObject({ state: "no-final-read" });
      // Monday 00:00 EST, 05:00 UTC now that summer time has ended: the daily pull no longer reads it.
      vi.setSystemTime(new Date("2026-11-02T05:00:00.000Z"));
      const monday = await scorecard();
      expect(monday.source.lastPullFailure).toBeNull();
      expect(lastWeek(monday)).toMatchObject({ state: "no-final-read" });
    }
  );

  it("names no failed pull while the portal read or the daily check is off: no pull can answer it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.portalReadEnabled.mockReturnValue(true);
    portal({ [LAST_WEEK]: () => jsonResponse(payload(LAST_WEEK)), [THIS_WEEK]: () => jsonResponse({}, 503) });
    await pullScorecardWeeks();
    expect((await scorecard()).source.lastPullFailure).toMatchObject({ week: THIS_WEEK });
    h.portalReadEnabled.mockReturnValue(false);
    const off = await scorecard();
    expect(off.source).toMatchObject({ portalRead: false, lastPullFailure: null });
    const screen = renderToStaticMarkup(createElement(UatScorecardBody, { state: { status: "ready", data: off }, nav: () => {} }));
    expect(screen).toContain("Portal read is off.");
    expect(screen).not.toContain("The last daily pull failed");
    h.portalReadEnabled.mockReturnValue(true);
    h.driftCronEnabled.mockReturnValue(false);
    expect((await scorecard()).source).toMatchObject({ dailyCheck: false, lastPullFailure: null });
  });

  it("says when the daily check cannot run", async () => {
    h.cronConfigured.mockReturnValue(false);
    const { data } = (await (await read()).json()) as { data: { latest: unknown; source: Record<string, unknown> } };
    expect(data).toMatchObject({ latest: null, source: { portalRead: false, dailyCheck: false } });
  });

  it("bounds the history with ?weeks", async () => {
    await seed();
    const { data } = (await (await read("?weeks=1")).json()) as { data: { history: { week: string }[]; latest: { week: string } } };
    expect(data.history.map((w) => w.week)).toEqual([THIS_WEEK]);
    expect(data.latest.week).toBe(LAST_WEEK);
  });

  it.each(["0", "53", "-1", "abc", "1.5"])("rejects weeks=%s with 400", async (v) => {
    const resp = await read(`?weeks=${v}`);
    expect(resp.status).toBe(400);
    expect(((await resp.json()) as { error: { code: string } }).error.code).toBe("invalid_query");
  });
});
