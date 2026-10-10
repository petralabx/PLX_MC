// TASK-2592 — the Dashboard's live section in the browser: the poll loop
// (cadence, hidden tabs, one load at a time, failures, the throttled snapshot
// reload), which rows count as new, the wording helpers, and the two cards
// rendered for loading, failure, a report and a focused project.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LivePanels,
  POLL_MS,
  SNAPSHOT_GAP_MS,
  agentsText,
  ago,
  createInFlightPoller,
  duration,
  flightSummary,
  freshKeys,
  until,
  type LiveView,
} from "@/components/mc/dashboard-live";
import type { InFlightCheckout, InFlightReport, InFlightTask, LiveEvent } from "@/lib/compliance";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-10T17:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const report = (over: Partial<InFlightReport> = {}): InFlightReport => ({
  generatedAt: iso(NOW),
  tasks: [],
  events: [],
  tasksUpdatedAt: null,
  ...over,
});

const checkout = (agent: string, issuedAt = NOW - 3 * HOUR): InFlightCheckout => ({
  agent,
  runtime: agent.toLowerCase().replace(" ", "-"),
  actorKind: "agent",
  accountableHuman: "cos@petrasoap.com",
  repo: "petralabx/plx-customer-portal",
  issuedAt: iso(issuedAt),
  expiresAt: iso(issuedAt + 8 * HOUR),
});

const event = (seq: number, over: Partial<LiveEvent> = {}): LiveEvent => ({
  seq: String(seq),
  ts: iso(NOW - 5 * MIN),
  kind: "checkout",
  by: "Claude Code",
  taskId: "TASK-221",
  repo: "plx-customer-portal",
  pr: null,
  text: "Checked out",
  ...over,
});

const flight = (taskId: string, over: Partial<InFlightTask> = {}): InFlightTask => ({
  taskId,
  title: "WMS integration",
  stage: "progress",
  bucketId: "BKT-WMS",
  checkouts: [checkout("Claude Code")],
  since: iso(NOW - 3 * HOUR),
  expiresAt: iso(NOW + 5 * HOUR),
  lastActivity: event(1, { taskId }),
  multiple: false,
  quiet: false,
  expiringSoon: false,
  ...over,
});

describe("createInFlightPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  function harness(load: () => Promise<InFlightReport> = async () => report()) {
    const state = { visible: true, reports: [] as InFlightReport[], errors: [] as string[] };
    const deps = {
      load: vi.fn(load),
      refresh: vi.fn(),
      onReport: (r: InFlightReport) => void state.reports.push(r),
      onError: (m: string) => void state.errors.push(m),
      visible: () => state.visible,
    };
    return { state, deps, poller: createInFlightPoller(deps) };
  }

  it("loads at once, then every 20 s after the last load finished", async () => {
    const { deps, poller } = harness();
    poller.poll();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(deps.load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.load).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("schedules nothing while the tab is hidden, and polls at once when it is shown", async () => {
    const { state, deps, poller } = harness();
    poller.poll();
    await vi.advanceTimersByTimeAsync(0);
    state.visible = false;
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(deps.load).toHaveBeenCalledTimes(1);
    state.visible = true;
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(deps.load).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("schedules nothing after a load that finishes while the tab is hidden", async () => {
    let release: (r: InFlightReport) => void = () => {};
    const { state, deps, poller } = harness(() => new Promise((resolve) => (release = resolve)));
    poller.poll();
    state.visible = false;
    poller.visibilityChanged();
    release(report());
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(deps.load).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("runs one load at a time", async () => {
    let release: (r: InFlightReport) => void = () => {};
    const { deps, poller } = harness(() => new Promise((resolve) => (release = resolve)));
    poller.poll();
    poller.poll();
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(deps.load).toHaveBeenCalledTimes(1);
    release(report());
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(deps.load).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("reports a failure and keeps polling", async () => {
    const { state, deps, poller } = harness(async () => {
      throw new Error("Authenticated session with Entra oid required.");
    });
    poller.poll();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.errors).toEqual(["Authenticated session with Entra oid required."]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(deps.load).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("reloads the snapshot when a task was written after the first look, at most every two minutes", async () => {
    const markers = ["10:00", "10:00", "10:01"];
    const { deps, poller } = harness(async () => report({ tasksUpdatedAt: `2026-10-10T${markers.shift() ?? "10:02"}:00.000Z` }));
    poller.poll();
    await vi.advanceTimersByTimeAsync(0); // 10:00 — the baseline: the snapshot on screen
    await vi.advanceTimersByTimeAsync(POLL_MS); // 10:00 again — nothing new
    expect(deps.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POLL_MS); // 10:01 — newer: reload
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_GAP_MS - POLL_MS); // 10:02 seen, but inside the gap
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS); // the gap has passed: reload
    expect(deps.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SNAPSHOT_GAP_MS * 2); // 10:02 stays put: no more reloads
    expect(deps.refresh).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("stops for good", async () => {
    const { deps, poller } = harness();
    poller.poll();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    poller.poll();
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(deps.load).toHaveBeenCalledTimes(1);
  });
});

describe("freshKeys", () => {
  it("marks nothing on the first report, so a page load doesn't flash", () => {
    expect(freshKeys(null, report({ events: [event(1)], tasks: [flight("TASK-221")] })).size).toBe(0);
  });

  it("marks new events and tasks with new activity", () => {
    const before = report({ events: [event(1)], tasks: [flight("TASK-221"), flight("TASK-222")] });
    const after = report({
      events: [event(2), event(1)],
      tasks: [flight("TASK-221", { lastActivity: event(2) }), flight("TASK-222")],
    });
    expect([...freshKeys(before, after)].sort()).toEqual(["e:2", "t:TASK-221:2"]);
  });
});

describe("wording", () => {
  it.each([
    [0, "1 min"],
    [59 * MIN, "59 min"],
    [2 * HOUR + 5 * MIN, "2 hr"],
    [25 * HOUR, "1 day"],
    [49 * HOUR, "2 days"],
  ])("duration(%i) → %s", (ms, text) => {
    expect(duration(ms)).toBe(text);
  });

  it("says how long ago and how long until", () => {
    expect(ago(NOW - 5_000, NOW)).toBe("just now");
    expect(ago(NOW - 25_000, NOW)).toBe("25 s ago");
    expect(ago(iso(NOW - 4 * MIN), NOW)).toBe("4 min ago");
    expect(ago(iso(NOW - 3 * HOUR), NOW)).toBe("3 hr ago");
    expect(until(iso(NOW + 45 * MIN), NOW)).toBe("in 45 min");
    expect(until(iso(NOW + 5 * HOUR), NOW)).toBe("in 5 hr");
    expect(until(iso(NOW - MIN), NOW)).toBe("now");
  });

  it("counts agents per task and across tasks", () => {
    const busy = { checkouts: [checkout("Cursor"), checkout("Claude Code"), checkout("Cursor")] };
    expect(agentsText(busy)).toBe("Cursor ×2 · Claude Code");
    expect(flightSummary([busy, { checkouts: [checkout("Claude Code")] }])).toBe(
      "4 open checkouts on 2 tasks: 2 Claude Code, 2 Cursor."
    );
    expect(flightSummary([{ checkouts: [checkout("Claude Code")] }])).toBe("1 open checkout on 1 task: 1 Claude Code.");
  });
});

describe("LivePanels", () => {
  const view = (over: Partial<LiveView> = {}): LiveView => ({
    report: null,
    at: null,
    error: null,
    fresh: new Set(),
    retry: () => {},
    ...over,
  });
  const render = (live: LiveView, projectId: string | null = null) =>
    renderToStaticMarkup(createElement(LivePanels, { live, now: NOW, projectId, nav: () => {} }));
  // Visible text only: React separates adjacent text nodes with comments.
  const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const busy = report({
    tasks: [
      flight("TASK-221", {
        checkouts: [checkout("Cursor", NOW - 2 * HOUR), checkout("Cursor", NOW - 4 * HOUR)],
        lastActivity: event(7, { text: "PR #312 opened", ts: iso(NOW - 3 * HOUR) }),
        multiple: true,
        quiet: true,
        expiringSoon: true,
        expiresAt: iso(NOW + 45 * MIN),
      }),
      flight("TASK-404", { title: null, stage: null, bucketId: "BKT-ELSEWHERE" }),
    ],
    events: [event(9), event(8, { kind: "pr.merged", taskId: null, text: "PR #5 merged", by: "Mission Control" })],
  });

  it("says it is connecting before the first poll lands", () => {
    const out = text(render(view()));
    expect(out).toContain("In flight");
    expect(out).toContain("Connecting…");
    expect(out).toContain("Live activity");
  });

  it("shows why live activity failed, with a Retry", () => {
    const out = text(render(view({ error: "Authenticated session with Entra oid required." })));
    expect(out).toContain("Not connected");
    expect(out).toContain("Couldn’t load live activity: Authenticated session with Entra oid required. Retry");
  });

  it("lists each task with its agents, place, latest activity and flags", () => {
    const html = render(view({ report: busy, at: NOW - 20_000, fresh: new Set(["e:9"]) }));
    const out = text(html);
    expect(out).toContain("Live · updated 20 s ago");
    expect(out).toContain("3 open checkouts on 2 tasks: 2 Cursor, 1 Claude Code.");
    expect(out).toContain("Cursor ×2");
    expect(out).toContain("TASK-221 WMS integration");
    expect(out).toContain("PLX Portal Go-Live · WMS Integration · plx-customer-portal");
    expect(out).toContain("PR #312 opened · 3 hr ago");
    expect(out).toContain("2 open checkouts");
    expect(out).toContain("No activity for 3 hr");
    expect(out).toContain("Checkout ends in 45 min");
    expect(out).toContain("TASK-404 Not in Mission Control");
    expect(out).toContain("Claude Code · Checked out");
    expect(out).toContain("TASK-221 · WMS integration");
    // Only the event that arrived with this poll animates.
    expect(html.match(/dash-new/g)).toHaveLength(1);
    expect(out).not.toMatch(/bucket|dsp_/i);
  });

  it("narrows both cards to the focused project", () => {
    const out = text(render(view({ report: busy, at: NOW }), "PRJ-PORTAL-GOLIVE"));
    expect(out).toContain("In PLX Portal Go-Live: 2 open checkouts on 1 task: 2 Cursor.");
    expect(out).not.toContain("TASK-404");
    expect(out).not.toContain("PR #5 merged");
  });

  it("names a task the snapshot doesn't hold yet from the live report", () => {
    const fresh = report({
      tasks: [flight("TASK-9999", { title: "Brand-new task", bucketId: "BKT-WMS" })],
      events: [event(3, { taskId: "TASK-9999" })],
    });
    const out = text(render(view({ report: fresh, at: NOW }), "PRJ-PORTAL-GOLIVE"));
    expect(out).toContain("TASK-9999 Brand-new task");
    expect(out).toContain("TASK-9999 · Brand-new task");
  });

  it("keeps the last report on screen when a later poll fails", () => {
    const out = text(render(view({ report: busy, at: NOW - 2 * MIN, error: "HTTP 502" })));
    expect(out).toContain("Paused · updated 2 min ago");
    expect(out).toContain("Live updates paused: HTTP 502 Retry");
    expect(out).toContain("TASK-221");
  });
});
