// TASK-4196 — the UAT scorecard screen (/?screen=uat-scorecard): a static
// render of each load state and source state, the pure helpers, and the screen
// and sidebar registration. vitest has no DOM, so the body renders with
// react-dom/server.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NavIcon } from "@/components/mc/nav-icon";
import { NAV_GROUPS, ZONED_NAV_GROUPS } from "@/components/mc/nav-model";
import { urlToRoute } from "@/components/mc/route";
import { SCREENS } from "@/components/mc/screens";
import { UatScorecardBody, UatScorecardView, type UatScorecardState } from "@/components/mc/uat-scorecard";
import {
  axisLabel,
  dayLabel,
  formatNear,
  formatTarget,
  formatValue,
  loopBoardUrl,
  metLine,
  openWeeks,
  readAtLabel,
  trendLabel,
  weekLabel,
  weeklyColumns,
} from "@/components/mc/uat-scorecard/helpers";
import { buildScorecard, type ScorecardSource, type StoredSnapshot, type WeekScore } from "@/lib/uat-scorecard";
import { snapshotSchema } from "@/lib/uat-scorecard/schema";

const NOW = new Date("2026-10-30T10:00:00.000Z");
const WINDOWS: Record<string, [string, string]> = {
  "2026-10-12": ["2026-10-12T04:00:00.000Z", "2026-10-19T04:00:00.000Z"],
  "2026-10-19": ["2026-10-19T04:00:00.000Z", "2026-10-26T04:00:00.000Z"],
  "2026-10-26": ["2026-10-26T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
  "2026-11-02": ["2026-11-02T05:00:00.000Z", "2026-11-09T05:00:00.000Z"],
};

function week(
  seq: number,
  start: string,
  opts: { complete?: boolean; fail?: number; readErrors?: string[]; flow?: null; generatedAt?: string } = {}
): StoredSnapshot {
  const [windowStart, windowEnd] = WINDOWS[start];
  const complete = opts.complete ?? true;
  const fail = opts.fail ?? 1;
  const snapshot = snapshotSchema.parse({
    schema: "plx-uat-scorecard/v1",
    window: { start: windowStart, end: windowEnd, timeZone: "America/Toronto", complete },
    generatedAt: opts.generatedAt ?? (complete ? windowEnd : "2026-10-30T10:00:00.000Z"),
    outcomes: { verdicts: 10, pass: 9 - fail, fail, stale: 1, legacyStallExpiries: 0, passWithin5bdOfFiling: 6, firstAttemptPass: 6, reopened: 0, closedPollable: 8 },
    speed: {
      filedToPass: { p50: 4, p90: 9, n: 8 },
      holders: { plx: { p50: 0.5, n: 8 }, agent: { p50: 1, n: 8 }, pipeline: { p50: 0.25, n: 8 }, submitter: { p50: 2, n: 8 } },
    },
    flow:
      opts.flow === null
        ? null
        : { filed: 12, open: complete ? null : 14, overClock: complete ? null : 0, waitingOnPlx: complete ? null : 3, stuck: complete ? null : 2, duplicatesClosed: null },
    users: { closingPoll: { responses: 4, average: 4.5, low: 0, lowWithFollowUp: 0 }, pulse: [] },
    reliability: { outboxFailedTerminal: 0, watchdogPages: 4, deadOutboxOpen: null },
    readErrors: opts.readErrors ?? [],
  });
  return { seq: String(seq), recordedAt: snapshot.generatedAt, snapshot };
}

const ON: ScorecardSource = { portalRead: true, dailyCheck: true, portalOrigin: "https://staging.plxcustomer.io", lastPullFailure: null };
const ready = (rows: StoredSnapshot[], source: ScorecardSource = ON, now = NOW): UatScorecardState => ({
  status: "ready",
  data: { ...buildScorecard(rows, now), source },
});
// ICU versions differ on the space before AM: compare with plain spaces.
const flat = (text: string) => text.replace(/\s/g, " ");
const render = (state: UatScorecardState, nav = vi.fn()) =>
  flat(renderToStaticMarkup(createElement(UatScorecardBody, { state, nav })));

describe("UAT scorecard screen states", () => {
  it("shows a loading line, then an error as an alert, with the links in every state", () => {
    const loading = render({ status: "loading" });
    expect(loading).toContain("Loading the UAT scorecard");
    expect(loading).toContain('href="https://staging.plxcustomer.io/uat?view=loop"');
    expect(loading).toContain("TASK-3712, the weekly UAT readout");
    const error = render({ status: "error", message: "signin_required" });
    expect(error).toContain('role="alert"');
    expect(error).toContain("signin_required");
  });

  it("says the portal read is off, and that no week is stored yet", () => {
    const html = render(ready([], { ...ON, portalRead: false }));
    expect(html).toContain("Portal read is off.");
    expect(html).toContain("PLX_MC_UAT_PORTAL_READ_ENABLED");
    expect(html).toContain("No week stored yet.");
    // The daily pull's schedule only when it can run.
    expect(html).not.toContain("10:00 UTC");
    expect(html).not.toContain("Score by week");
  });

  it("says when the daily check is off though the read is on, and when the pull will come", () => {
    const off = render(ready([], { ...ON, dailyCheck: false }));
    expect(off).toContain("The daily UAT check is off");
    expect(off).not.toContain("Portal read is off");
    expect(off).not.toContain("10:00 UTC");
    const on = render(ready([]));
    expect(on).toContain("No week stored yet. The daily UAT check pulls last week and this week from the portal at 10:00 UTC.");
    expect(on).not.toContain("cs-note-box");
  });

  it("names the last failed daily pull", () => {
    const failure = { week: "2026-10-26", message: "The portal answered HTTP 404.", at: "2026-10-30T10:00:01.000Z" };
    const html = render(ready([], { ...ON, lastPullFailure: failure }));
    expect(html).toContain("The last daily pull failed: The portal answered HTTP 404. (Oct 30, 6:00 AM EDT, week of Oct 26)");
    expect(html).toContain("No week stored yet.");
  });

  it("asks for a second week before drawing the trend", () => {
    const html = render(ready([week(1, "2026-10-19")]));
    expect(html).toContain("The trend starts once a second week is in.");
    expect(html).toContain("Week of Oct 19 – Oct 25");
  });

  it("renders the area cards, grades, targets, near bands, the week before and the trend", () => {
    const html = render(ready([week(1, "2026-10-12", { fail: 3 }), week(2, "2026-10-19"), week(3, "2026-10-26", { complete: false })]));
    expect(html).toContain('data-testid="uat-scorecard-screen"');
    for (const label of ["Outcomes", "Speed", "Flow", "Users", "Reliability"]) expect(html).toContain(`>${label}</h2>`);
    expect(html).toContain("PASS share of verdicts");
    expect(html).toContain("≥ 70%");
    expect(html).toContain("Near ≥ 60%");
    expect(html).toContain("≤ 20%");
    expect(html).toContain("Near ≤ 30%");
    // A count's band keeps its half: 8 grades Missed against Near ≤ 7.5.
    expect(html).toContain("Near ≤ 7.5");
    expect(html).not.toContain("Near ≤ 8<");
    expect(html).toContain("8 of 10 verdicts");
    expect(html).toContain("cs-g-met");
    expect(html).toContain("Better (was 30%)");
    expect(html).toContain("No target yet");
    // The cards name their week; the open week shows as this week so far.
    expect(html).toContain(">Week of Oct 19</th>");
    expect(html).not.toContain(">This week<");
    expect(html).toContain("Week of Oct 19 – Oct 25");
    expect(html).toContain("This week so far: A · 100/100");
    expect(html).not.toContain("incomplete");
    expect(html).toContain("Oct 26 – Nov 1, so far");
    expect(html).toContain("Last read from the portal Oct 30, 6:00 AM EDT");
    expect(html).toContain('role="img"');
    expect(html).toContain("How grading works");
  });

  it("names the portal's read errors for the headline week and for this week so far", () => {
    const html = render(
      ready([
        week(1, "2026-10-19", { readErrors: ["users.pulse: could not be read."] }),
        week(2, "2026-10-26", { complete: false, flow: null, readErrors: ["flow: could not be read."] }),
      ])
    );
    expect(html).toContain("The portal could not read everything for the week of Oct 19 – Oct 25");
    expect(html).toContain("users.pulse: could not be read.");
    expect(html).toContain("This week so far: A · 100/100, incomplete");
    expect(html).toContain("This week so far could not read everything: flow: could not be read.");
    expect(html).toContain("Oct 26 – Nov 1, so far, incomplete");
  });

  it("labels an ended week with no final read, never as this week so far", () => {
    const html = render(
      ready([week(1, "2026-10-12", { complete: false, generatedAt: "2026-10-18T10:00:00.000Z" }), week(2, "2026-10-19")])
    );
    expect(html).toContain("Oct 12 – Oct 18, no final read");
    expect(html).not.toContain(", so far");
    expect(html).not.toContain("This week so far");
  });

  it("names the week that just ended in the pill while its final read is pending", () => {
    const rows = [week(1, "2026-10-19"), week(2, "2026-10-26", { complete: false, generatedAt: "2026-11-01T10:00:00.000Z" })];
    // Sunday 23:30 EST: still this week.
    expect(render(ready(rows, ON, new Date("2026-11-02T04:30:00.000Z")))).toContain("This week so far: A · 100/100</span>");
    // Monday 00:30 EST, before the daily pull at 10:00 UTC.
    const pending = render(ready(rows, ON, new Date("2026-11-02T05:30:00.000Z")));
    expect(pending).toContain("Week of Oct 26 so far: A · 100/100. Its final read is pending.</span>");
    expect(pending).not.toContain("no final read");
    expect(pending).not.toContain("This week so far");
    // As the headline too, its cards name the week.
    expect(render(ready(rows.slice(1), ON, new Date("2026-11-02T05:30:00.000Z")))).toContain(">Week of Oct 26 so far</th>");
    // A day after it ended with no final read, the pill goes and the week says so.
    const lost = render(ready(rows, ON, new Date("2026-11-03T05:00:00.000Z")));
    expect(lost).toContain("Oct 26 – Nov 1, no final read");
    expect(lost).not.toContain("Week of Oct 26 so far");
    expect(lost).not.toContain("final read is pending");
  });

  it("says in the heading when the headline week's final read is pending", () => {
    // Launch: the only stored week has ended, and no final read is stored yet.
    const lastWeek = week(1, "2026-10-26", { complete: false, generatedAt: "2026-11-01T10:00:00.000Z" });
    const alone = render(ready([lastWeek], ON, new Date("2026-11-02T05:30:00.000Z")));
    expect(alone).toContain("Week of Oct 26 – Nov 1, final read pending</span>");
    expect(alone).not.toContain(", so far");
    // After this week's first read, it is still the headline, and says so.
    const thisWeek = week(2, "2026-11-02", { complete: false, generatedAt: "2026-11-02T10:00:00.000Z" });
    const both = render(ready([lastWeek, thisWeek], ON, new Date("2026-11-02T10:05:00.000Z")));
    expect(both).toContain("Week of Oct 26 – Nov 1, final read pending</span>");
    expect(both).toContain("This week so far: A · 100/100</span>");
  });

  it("calls a pending week by its name in its read errors and in the trend, never this week or still open", () => {
    const unread = week(2, "2026-10-26", { complete: false, generatedAt: "2026-11-01T10:00:00.000Z", flow: null, readErrors: ["flow: could not be read."] });
    const html = render(ready([week(1, "2026-10-19"), unread], ON, new Date("2026-11-02T05:30:00.000Z")));
    expect(html).toContain("Week of Oct 26 so far could not read everything: flow: could not be read.");
    expect(html).toContain("The shaded week has ended; its final read is pending.");
    expect(html).not.toContain("This week so far");
    expect(html).not.toContain("The shaded week is still open.");
  });

  it("gives the week that just ended and this week so far a pill each when Monday's pull of last week failed", () => {
    const rows = [
      week(1, "2026-10-19"),
      week(2, "2026-10-26", { complete: false, generatedAt: "2026-11-01T10:00:00.000Z" }),
      week(3, "2026-11-02", { complete: false, generatedAt: "2026-11-02T10:00:00.000Z" }),
    ];
    const html = render(ready(rows, ON, new Date("2026-11-02T10:05:00.000Z")));
    expect(html).toContain("Week of Oct 19 – Oct 25</span>");
    expect(html).toContain("Week of Oct 26 so far: A · 100/100. Its final read is pending.</span>");
    expect(html).toContain("This week so far: A · 100/100</span>");
    expect(html).toContain("The 2 shaded weeks have no final read yet.");
    expect(html).not.toContain("The shaded week");
  });

  it("links the Loop board on the portal origin the read uses", () => {
    expect(render(ready([], { ...ON, portalOrigin: "https://uat.portal.test" }))).toContain('href="https://uat.portal.test/uat?view=loop"');
  });
});

describe("UAT scorecard helpers", () => {
  it("formats each unit, scores and days to two decimals", () => {
    expect(formatValue(66.6667, "percent")).toBe("66.7%");
    expect(formatValue(70, "percent")).toBe("70%");
    expect(formatValue(0.5, "days")).toBe("0.5 bd");
    expect(formatValue(4, "days")).toBe("4 bd");
    expect(formatValue(1.3333, "days")).toBe("1.33 bd");
    expect(formatValue(3, "count")).toBe("3");
    expect(formatValue(4, "score")).toBe("4");
    expect(formatValue(3.84, "score")).toBe("3.84");
    // 3.95 grades Near against ≥ 4: it no longer shows as 4.0.
    expect(formatValue(3.95, "score")).toBe("3.95");
    expect(formatValue(null, "count")).toBe("—");
  });

  it("words targets and near bands by direction, to two decimals", () => {
    expect(formatTarget({ target: 70, direction: "higher", unit: "percent" })).toBe("≥ 70%");
    expect(formatTarget({ target: 5, direction: "lower", unit: "days" })).toBe("≤ 5 bd");
    expect(formatTarget({ target: 4, direction: "higher", unit: "score" })).toBe("≥ 4");
    expect(formatTarget({ target: 0, direction: "lower", unit: "count" })).toBe("0");
    expect(formatTarget({ target: null, direction: "lower", unit: "count" })).toBe("—");
    expect(formatNear({ near: 3.5, direction: "higher", unit: "score" })).toBe("Near ≥ 3.5");
    expect(formatNear({ near: 0.75, direction: "lower", unit: "days" })).toBe("Near ≤ 0.75 bd");
    expect(formatNear({ near: 7.5, direction: "lower", unit: "count" })).toBe("Near ≤ 7.5");
    expect(formatNear({ near: 15, direction: "lower", unit: "count" })).toBe("Near ≤ 15");
    expect(formatNear({ near: null, direction: "lower", unit: "count" })).toBeNull();
  });

  it("words the trend, the targets met and the weeks", () => {
    expect(trendLabel({ trend: "worse", previous: 4.2, unit: "score" })).toBe("Worse (was 4.2)");
    expect(trendLabel({ trend: null, previous: 12, unit: "count" })).toBe("12");
    expect(trendLabel({ trend: null, previous: null, unit: "count" })).toBe("—");
    expect(metLine({ met: 1, graded: 1 })).toBe("1 of 1 target met");
    expect(metLine({ met: 0, graded: 0 })).toBe("No target has data");
    expect(weekLabel({ windowStart: WINDOWS["2026-10-26"][0], windowEnd: WINDOWS["2026-10-26"][1] })).toBe("Oct 26 – Nov 1");
    expect(axisLabel({ windowStart: WINDOWS["2026-10-19"][0] })).toBe("Oct 19");
    expect(dayLabel("2026-10-26")).toBe("Oct 26");
    expect(flat(readAtLabel("2026-10-30T10:00:00.000Z"))).toBe("Oct 30, 6:00 AM EDT");
    expect(flat(readAtLabel("2026-11-02T15:00:00.000Z"))).toBe("Nov 2, 10:00 AM EST");
    expect(loopBoardUrl()).toBe("https://staging.plxcustomer.io/uat?view=loop");
  });

  it("lists the open weeks beside the headline week, oldest first", () => {
    const score = (w: string, state: WeekScore["state"]): WeekScore => ({
      week: w,
      windowStart: WINDOWS[w][0],
      windowEnd: WINDOWS[w][1],
      state,
      finalReadPending: false,
      generatedAt: WINDOWS[w][1],
      readErrors: [],
      overall: 90,
      areas: { outcomes: 80, speed: 100, flow: null, users: 90, reliability: 100 },
    });
    const history = [score("2026-10-19", "final"), score("2026-10-26", "open")];
    expect(openWeeks(history, history[0]).map((w) => w.week)).toEqual(["2026-10-26"]);
    expect(openWeeks(history, history[1])).toEqual([]); // the open week is the headline itself
    expect(openWeeks(history.slice(0, 1), history[0])).toEqual([]);
    expect(openWeeks([score("2026-10-12", "final"), score("2026-10-19", "no-final-read")], null)).toEqual([]);
    // Monday's pull of last week failed and this week's read is stored: both are open, oldest first.
    const twoOpen = [score("2026-10-19", "final"), { ...score("2026-10-26", "open"), finalReadPending: true }, score("2026-11-02", "open")];
    expect(openWeeks(twoOpen, twoOpen[0]).map((w) => w.week)).toEqual(["2026-10-26", "2026-11-02"]);
    expect(weeklyColumns(history).map((c) => [c.key, c.values])).toEqual([
      ["outcomes", [80, 80]],
      ["speed", [100, 100]],
      ["flow", [null, null]],
      ["users", [90, 90]],
      ["reliability", [100, 100]],
      ["overall", [90, 90]],
    ]);
  });
});

describe("UAT scorecard registration", () => {
  it("is a screen with a deep link", () => {
    expect(SCREENS["uat-scorecard"]).toBe(UatScorecardView);
    expect(urlToRoute("/?screen=uat-scorecard")).toEqual({ screen: "uat-scorecard" });
  });

  it("sits beside the CI scorecard in both sidebars, with its own icon", () => {
    const admin = NAV_GROUPS.find((g) => g.id === "admin")!.items;
    const screens = admin.map((i) => i.screen);
    expect(screens.indexOf("uat-scorecard")).toBe(screens.indexOf("ci-scorecard") + 1);
    const reporting = ZONED_NAV_GROUPS.find((g) => g.id === "reporting")!.items.map((i) => i.screen);
    expect(reporting.indexOf("uat-scorecard")).toBe(reporting.indexOf("ci-scorecard") + 1);
    const item = admin.find((i) => i.screen === "uat-scorecard")!;
    expect(item.label).toBe("UAT scorecard");
    expect(renderToStaticMarkup(createElement(NavIcon, { name: item.lucide }))).toContain("<svg");
  });
});
