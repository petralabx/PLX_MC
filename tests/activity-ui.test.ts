// Activity screen (/?screen=activity) — static render of each distinct state
// (loading / error-with-retry / empty / data) plus the pure helpers and the
// screen + sidebar registration. vitest has no DOM, so the presentational body
// is rendered to static markup with react-dom/server.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityBody, type ActivityState } from "@/components/mc/activity-view";
import {
  fmtAge,
  fmtDuration,
  fmtRate,
  freshnessTone,
  hasActivitySignal,
} from "@/components/mc/activity-view.helpers";
import { SCREEN_VALUES, urlToRoute } from "@/components/mc/route";
import { NAV_GROUPS } from "@/components/mc/nav-model";
import { SCREENS } from "@/components/mc/screens";
import type { RepoActivityReport, RepoActivityRow } from "@/lib/compliance";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function row(partial: Partial<RepoActivityRow> = {}): RepoActivityRow {
  return {
    repo: "petralabx/PLX_MC",
    displayName: "PLX Mission Control",
    lastActivityAt: hoursAgo(3),
    freshness: "fresh",
    openPrs: { open: 2, unstamped: 1, items: [{ pr: "5", title: "Operator PR", stamped: false, at: hoursAgo(4) }] },
    gate: { passed: 3, blocked: 1, blockRate: 0.25 },
    unattributed: {
      count: 1,
      status: "ok",
      reason: null,
      truncated: false,
      items: [
        {
          number: 9,
          title: "Unlinked fix",
          url: "https://github.com/petralabx/PLX_MC/pull/9",
          author: "octo",
          mergedAt: hoursAgo(30),
          reason: "no_stamp",
        },
      ],
    },
    ...partial,
  };
}

function report(repos: RepoActivityRow[], partial: Partial<RepoActivityReport> = {}): RepoActivityReport {
  return {
    generatedAt: NOW.toISOString(),
    events: { newestAt: hoursAgo(3), oldestSampledAt: hoursAgo(500), sampled: 12, truncated: false },
    backfill: { generatedAt: hoursAgo(5), windowDays: 7, stale: false },
    gateWindowDays: 30,
    repos,
    ...partial,
  };
}

const render = (state: ActivityState) =>
  renderToStaticMarkup(createElement(ActivityBody, { state, onRetry: () => undefined, now: NOW }));

describe("ActivityBody states", () => {
  it("loading", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('aria-label="Loading repo activity"');
    expect(html).not.toContain('role="alert"');
  });

  it("error shows the message and a retry button", () => {
    const html = render({ status: "error", message: "Authenticated session with Entra oid required." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Authenticated session with Entra oid required.");
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  });

  it("empty when no registry repo has any signal yet", () => {
    const quiet = row({
      lastActivityAt: null,
      freshness: "none",
      openPrs: null,
      gate: { passed: 0, blocked: 0, blockRate: null },
      unattributed: null,
    });
    const html = render({
      status: "ready",
      report: report([quiet], { events: { newestAt: null, oldestSampledAt: null, sampled: 0, truncated: false }, backfill: { generatedAt: null, windowDays: null, stale: true } }),
    });
    expect(html).toContain("No activity recorded yet");
    expect(html).toContain("PLX_MC_GITHUB_BACKFILL_ENABLED");
    expect(html).not.toContain("PLX Mission Control");
  });

  it("data: one row per registry repo with honest unknowns", () => {
    const portal = row({
      repo: "petralabx/plx-customer-portal",
      displayName: "PLX Customer Portal",
      lastActivityAt: hoursAgo(24 * 12),
      freshness: "stale",
      openPrs: null,
      gate: { passed: 0, blocked: 0, blockRate: null },
      unattributed: { count: 0, status: "degraded", reason: "permission_denied", truncated: false, items: [] },
    });
    const html = render({ status: "ready", report: report([row(), portal]) });
    expect(html).toContain('data-testid="activity-rows"');
    expect(html).toContain("PLX Mission Control");
    expect(html).toContain("PLX Customer Portal");
    expect(html).toContain("25%");
    expect(html).toContain("3h ago");
    expect(html).toContain("fresh");
    expect(html).toContain("stale");
    expect(html).toContain("degraded · permission_denied");
    // Unknown open-PR signal renders as an em dash, not 0.
    expect(html).toMatch(/<b>—<\/b>/);
    expect(html).toContain("Backfill 5h ago");
  });

  it("flags a stale backfill and a truncated event sample", () => {
    const html = render({
      status: "ready",
      report: report([row()], {
        backfill: { generatedAt: hoursAgo(50), windowDays: 7, stale: true },
        events: { newestAt: hoursAgo(3), oldestSampledAt: hoursAgo(20), sampled: 5000, truncated: true },
      }),
    });
    expect(html).toContain("backfill stale");
    expect(html).toContain("newest 5000 events");
  });
});

describe("activity helpers", () => {
  it("formats ages and rates", () => {
    expect(fmtAge(null, NOW)).toBe("never");
    expect(fmtAge(hoursAgo(0.2), NOW)).toBe("just now");
    expect(fmtAge(hoursAgo(3), NOW)).toBe("3h ago");
    expect(fmtAge(hoursAgo(49), NOW)).toBe("2d ago");
    expect(fmtAge("garbage", NOW)).toBe("never");
    expect(fmtRate(null)).toBe("—");
    expect(fmtRate(0.254)).toBe("25%");
    expect(fmtRate(1)).toBe("100%");
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(45 * 60_000)).toBe("45m");
    expect(fmtDuration(3.5 * 3_600_000)).toBe("3.5h");
  });

  it("maps freshness to existing pill tones", () => {
    expect(freshnessTone("fresh")).toBe("ok");
    expect(freshnessTone("stale")).toBe("warn");
    expect(freshnessTone("dormant")).toBe("hot");
    expect(freshnessTone("none")).toBe("muted");
  });

  it("detects whether any repo has signal", () => {
    expect(hasActivitySignal(report([row()]))).toBe(true);
    expect(
      hasActivitySignal(
        report([row({ lastActivityAt: null, openPrs: null, unattributed: null })])
      )
    ).toBe(false);
  });
});

describe("Activity screen registration", () => {
  it("is a routable ?screen= value with a registered component", () => {
    expect(SCREEN_VALUES).toContain("activity");
    expect(urlToRoute("/?screen=activity")).toEqual({ screen: "activity" });
    expect(SCREENS.activity).toBeTypeOf("function");
  });

  it("has a sidebar entry in the Admin & health group", () => {
    const admin = NAV_GROUPS.find((g) => g.id === "admin")!;
    expect(admin.items).toContainEqual(expect.objectContaining({ screen: "activity", label: "Repo activity" }));
  });
});
