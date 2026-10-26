// TASK-3913 — the CI scorecard screen (/?screen=ci-scorecard): a static render
// of each load state, the pure helpers, and the screen and sidebar
// registration. vitest has no DOM, so the body renders with react-dom/server.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CiScorecardBody, CiScorecardView, type CiScorecardState } from "@/components/mc/ci-scorecard";
import {
  cardLabel,
  formatTarget,
  formatValue,
  metLine,
  scoreLine,
  trendLabel,
  trendSeries,
  windowLabel,
} from "@/components/mc/ci-scorecard/helpers";
import { NAV_GROUPS, ZONED_NAV_GROUPS } from "@/components/mc/nav-model";
import { urlToRoute } from "@/components/mc/route";
import { SCREENS } from "@/components/mc/screens";
import { buildScorecard, type StoredSnapshot } from "@/lib/ci-scorecard";
import { snapshotSchema } from "@/lib/ci-scorecard/schema";

const summary = (p50: number | null, p90: number | null) => ({ n: 10, p50, p90 });

function week(seq: number, start: string, end: string, landingP90: number): StoredSnapshot {
  const repo = {
    merged: 40,
    open_to_merge_hours: summary(0.8, 6),
    landing_wait_minutes: summary(5, landingP90),
    landing_wait_minutes_non_dependabot: summary(4, landingP90),
    runs: {
      runs: 400,
      pr_ci_first_attempt: { n: 100, failed: 4 },
      compliance_first_attempt: { n: 100, failed: 6 },
      passed_on_rerun: 2,
    },
    bypass_merges: 0,
    open: { non_draft: 6, auto_merge_armed: 3, green_unmerged: [[12, 30.5, "clean"]] },
  };
  const snapshot = snapshotSchema.parse({
    window: { start, end },
    repos: { "plx-customer-portal": { ...repo, lane_cap_failures: 3 }, PLX_MC: repo },
  });
  return { seq: String(seq), recordedAt: end, snapshot };
}

const render = (state: CiScorecardState) => renderToStaticMarkup(createElement(CiScorecardBody, { state }));

describe("CI scorecard screen states", () => {
  it("shows a loading line, then an error as an alert", () => {
    expect(render({ status: "loading" })).toContain("Loading the CI scorecard");
    const error = render({ status: "error", message: "signin_required" });
    expect(error).toContain('role="alert"');
    expect(error).toContain("signin_required");
  });

  it("says where the first snapshot comes from when there is none", () => {
    const html = render({ status: "ready", data: buildScorecard([]) });
    expect(html).toContain("No weekly snapshot yet");
    expect(html).toContain("TASK-3866");
    expect(html).not.toContain("Score by week");
  });

  it("asks for a second week before drawing the trend", () => {
    const html = render({
      status: "ready",
      data: buildScorecard([week(1, "2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z", 25)]),
    });
    expect(html).toContain("The trend starts once a second week is in.");
    expect(html).toContain("Week of Oct 19 – Oct 26");
  });

  it("renders the cards, grades, targets, last week and the trend", () => {
    const data = buildScorecard([
      week(1, "2026-10-12T12:45:00Z", "2026-10-19T12:45:00Z", 50),
      week(2, "2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z", 25),
    ]);
    const html = render({ status: "ready", data });
    expect(html).toContain('data-testid="ci-scorecard-screen"');
    for (const label of ["Portal", "Mission Control", "All repos"]) expect(html).toContain(`>${label}</h2>`);
    expect(html).toContain("Landing wait, p90");
    expect(html).toContain("≤ 30 min");
    expect(html).toContain("Phase 2: ≤ 4 h");
    expect(html).toContain("cs-g-met");
    expect(html).toContain("Better (was 50 min)");
    expect(html).toContain("PR CI runs stopped by the lane cap");
    expect(html).toContain('role="img"');
    expect(html).toContain("How grading works");
  });

  it("names a snapshot's read errors", () => {
    const stored = week(1, "2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z", 25);
    stored.snapshot.errors = ["agentic-swarm: GET failed"];
    expect(render({ status: "ready", data: buildScorecard([stored]) })).toContain("agentic-swarm: GET failed");
  });
});

describe("CI scorecard helpers", () => {
  it("formats each unit", () => {
    expect(formatValue(0.75, "hours")).toBe("45 min");
    expect(formatValue(6, "hours")).toBe("6 h");
    expect(formatValue(19.34, "hours")).toBe("19.3 h");
    expect(formatValue(4.25, "minutes")).toBe("4.3 min");
    expect(formatValue(42.4, "minutes")).toBe("42 min");
    expect(formatValue(6, "percent")).toBe("6%");
    expect(formatValue(32.67, "percent")).toBe("32.7%");
    expect(formatValue(3, "count")).toBe("3");
    expect(formatValue(null, "count")).toBe("—");
    expect(formatTarget(0, "count")).toBe("0");
    expect(formatTarget(168, "hours")).toBe("≤ 168 h");
    expect(formatTarget(null, "minutes")).toBe("—");
  });

  it("words the trend, the targets met and the score", () => {
    expect(trendLabel({ trend: "worse", previous: 20, unit: "minutes" })).toBe("Worse (was 20 min)");
    expect(trendLabel({ trend: null, previous: null, unit: "minutes" })).toBe("—");
    expect(metLine({ met: 1, graded: 1 }, 1)).toBe("1 of 1 target met");
    expect(metLine({ met: 0, graded: 0 }, 2)).toBe("No phase 2 target has data yet");
    expect(scoreLine(87, "B")).toBe("B · 87/100");
    expect(scoreLine(null, null)).toBe("Not graded");
    expect(windowLabel("2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z")).toBe("Oct 19 – Oct 26");
    expect(cardLabel("fleet")).toBe("All repos");
    expect(cardLabel("local-inference")).toBe("local-inference");
  });

  it("draws one line per repo seen, then the overall score", () => {
    const series = trendSeries([
      { windowStart: "a", windowEnd: "2026-10-19T12:45:00Z", overall: 70, repos: { PLX_MC: 60 } },
      { windowStart: "b", windowEnd: "2026-10-26T12:45:00Z", overall: 90, repos: { PLX_MC: 80, "agentic-swarm": 100 } },
    ]);
    expect(series.map((s) => [s.key, s.values])).toEqual([
      ["PLX_MC", [60, 80]],
      ["agentic-swarm", [null, 100]],
      ["overall", [70, 90]],
    ]);
  });
});

describe("CI scorecard registration", () => {
  it("is a screen with a deep link", () => {
    expect(SCREENS["ci-scorecard"]).toBe(CiScorecardView);
    expect(urlToRoute("/?screen=ci-scorecard")).toEqual({ screen: "ci-scorecard" });
  });

  it("sits beside AI spend in both sidebars", () => {
    const admin = NAV_GROUPS.find((g) => g.id === "admin")!.items.map((i) => i.screen);
    expect(admin.indexOf("ci-scorecard")).toBe(admin.indexOf("ai-spend") + 1);
    const reporting = ZONED_NAV_GROUPS.find((g) => g.id === "reporting")!.items.map((i) => i.screen);
    expect(reporting.at(-1)).toBe("ci-scorecard");
  });
});
