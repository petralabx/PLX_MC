// TASK-3913 — the CI scorecard rubric: the snapshot contract with
// weekly_metrics.py, grading against the CI redesign targets, the score and
// letter, one snapshot per week, and the week-over-week trend. The fixtures
// are synthetic, with the shape of weekly_metrics.py's --json output.

import { describe, expect, it } from "vitest";

import {
  FLEET_METRICS,
  PORTAL_REPO,
  REPO_METRICS,
  buildScorecard,
  gradeValue,
  gradeWeek,
  latestPerWeek,
  letterOf,
  scoreOf,
  snapshotDedupKey,
  weekOf,
  type Card,
  type MetricRow,
  type StoredSnapshot,
} from "@/lib/ci-scorecard";
import { snapshotSchema, type Snapshot } from "@/lib/ci-scorecard/schema";

const summary = (p50: number | null, p90: number | null, n = 10) => ({ n, p50, p90 });

/** One repo as weekly_metrics.py writes it, with every target met in phase 1. */
function repo(overrides: Record<string, unknown> = {}) {
  return {
    merged: 40,
    dependabot_merged: 2,
    open_to_merge_hours: summary(0.8, 6),
    dependabot_open_to_merge_hours: summary(20, 100, 2),
    landing_wait_minutes: summary(5, 40),
    landing_wait_minutes_non_dependabot: summary(4, 25),
    runs: {
      runs: 400,
      by_conclusion: { success: 380, failure: 20 },
      pr_ci_first_attempt: { n: 100, failed: 4 },
      compliance_first_attempt: { n: 100, failed: 6 },
      passed_on_rerun: 2,
    },
    failed_compliance_runs: [[101, "#12"]],
    bypass_merges: 0,
    bypass_detail: [],
    open: { non_draft: 6, auto_merge_armed: 3, green_unmerged: [[12, 30.5, "clean"]] },
    ...overrides,
  };
}

function portal(overrides: Record<string, unknown> = {}) {
  return repo({
    merge_queue: { groups: 30, failed_groups: 0, enqueue_to_merge_minutes: summary(12, 28) },
    commit_to_verdict_minutes: summary(15, 40),
    lane_cap_failures: 0,
    ...overrides,
  });
}

function snapshot(end: string, repos: Record<string, unknown> = {}, errors: string[] = []): Snapshot {
  const start = new Date(Date.parse(end) - 7 * 86_400_000).toISOString().replace(".000Z", "Z");
  return snapshotSchema.parse({
    window: { start, end },
    repos: { [PORTAL_REPO]: portal(), PLX_MC: repo(), "agentic-swarm": repo(), ...repos },
    errors,
  });
}

function stored(seq: number, snap: Snapshot): StoredSnapshot {
  return { seq: String(seq), recordedAt: snap.window.end, snapshot: snap };
}

const cardOf = (cards: Card[], id: string) => cards.find((c) => c.id === id)!;
const rowOf = (c: Card, id: string): MetricRow => c.metrics.find((m) => m.id === id)!;

describe("the snapshot contract with weekly_metrics.py", () => {
  it("accepts the script's output, keeps fields the rubric does not read, and defaults errors", () => {
    const parsed = snapshotSchema.parse({
      window: { start: "2026-10-19T12:45:00Z", end: "2026-10-26T12:45:00Z" },
      repos: { PLX_MC: repo({ extra_section: { kept: true } }) },
    });
    expect(parsed.errors).toEqual([]);
    expect((parsed.repos.PLX_MC as Record<string, unknown>).extra_section).toEqual({ kept: true });
  });

  it("accepts a past window, whose point-in-time sections are null", () => {
    const parsed = snapshotSchema.safeParse({
      window: { start: "2026-10-05T12:45:00Z", end: "2026-10-12T12:45:00Z" },
      repos: { PLX_MC: repo({ bypass_merges: null, open: null }) },
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["a window that ends before it starts", { window: { start: "2026-10-26T12:45:00Z", end: "2026-10-19T12:45:00Z" } }],
    ["no repos", { repos: {} }],
    ["a negative count", { repos: { PLX_MC: repo({ merged: -1 }) } }],
    ["a repo without its runs", { repos: { PLX_MC: repo({ runs: undefined }) } }],
    ["a repo name with a slash", { repos: { "petralabx/PLX_MC": repo() } }],
    ["a date that is not ISO 8601", { window: { start: "last Monday", end: "2026-10-26T12:45:00Z" } }],
  ])("rejects %s", (_label, patch) => {
    const base = { window: { start: "2026-10-19T12:45:00Z", end: "2026-10-26T12:45:00Z" }, repos: { PLX_MC: repo() } };
    expect(snapshotSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it("dedups on the exact window", () => {
    const a = snapshot("2026-10-26T12:45:00Z");
    expect(snapshotDedupKey(a)).toBe("ci-scorecard:2026-10-19T12:45:00Z|2026-10-26T12:45:00Z");
    expect(snapshotDedupKey(snapshot("2026-10-26T12:45:00Z"))).toBe(snapshotDedupKey(a));
    expect(snapshotDedupKey(snapshot("2026-10-26T13:00:00Z"))).not.toBe(snapshotDedupKey(a));
  });
});

describe("grading one value", () => {
  it("is met at or under the target, near within 1.5x, missed beyond", () => {
    expect(gradeValue(30, 30)).toBe("met");
    expect(gradeValue(12, 30)).toBe("met");
    expect(gradeValue(45, 30)).toBe("near");
    expect(gradeValue(45.1, 30)).toBe("missed");
  });

  it("has no near band for a target of 0", () => {
    expect(gradeValue(0, 0)).toBe("met");
    expect(gradeValue(1, 0)).toBe("missed");
  });

  it("separates a missing number from a metric with no target", () => {
    expect(gradeValue(null, 30)).toBe("no-data");
    expect(gradeValue(Number.NaN, 30)).toBe("no-data");
    expect(gradeValue(12, undefined)).toBe("no-target");
  });
});

describe("the score and the letter", () => {
  it("counts met as 1 and near as a half, over the graded metrics only", () => {
    expect(scoreOf(["met", "met", "near", "missed"])).toBe(63);
    expect(scoreOf(["met", "no-data", "no-target"])).toBe(100);
    expect(scoreOf(["no-data", "no-target"])).toBeNull();
    expect(scoreOf([])).toBeNull();
  });

  it("uses the 90 / 80 / 70 / 60 bands", () => {
    expect([100, 90, 89, 80, 70, 60, 59, 0].map(letterOf)).toEqual(["A", "A", "B", "B", "C", "D", "F", "F"]);
    expect(letterOf(null)).toBeNull();
  });
});

describe("grading a week against the report's targets", () => {
  const cards = gradeWeek(snapshot("2026-10-26T12:45:00Z"), null, 1);

  it("shows one card per repo, the known repos first, then the fleet", () => {
    expect(cards.map((c) => c.id)).toEqual([PORTAL_REPO, "PLX_MC", "agentic-swarm", "fleet"]);
    expect(cardOf(cards, "fleet").metrics.map((m) => m.id)).toEqual(FLEET_METRICS.map((m) => m.id));
  });

  it("gives only the portal its merge-queue, review-verdict and lane-cap rows", () => {
    const portalOnly = ["queue-p90", "verdict-p90", "lane-cap"];
    expect(cardOf(cards, PORTAL_REPO).metrics.map((m) => m.id)).toEqual(REPO_METRICS.map((m) => m.id));
    for (const id of portalOnly) expect(cardOf(cards, "PLX_MC").metrics.some((m) => m.id === id)).toBe(false);
  });

  it("applies the portal's own phase 1 targets, and shows the next phase's", () => {
    const p50 = rowOf(cardOf(cards, PORTAL_REPO), "open-to-merge-p50");
    expect(p50).toMatchObject({ value: 0.8, target: 1, nextTarget: 0.75, grade: "met" });
    const p90 = rowOf(cardOf(cards, PORTAL_REPO), "open-to-merge-p90");
    expect(p90).toMatchObject({ value: 6, target: 8, nextTarget: 4, grade: "met" });
    // Phase 1 sets no open-to-merge target outside the portal; phase 2 sets 4 h.
    expect(rowOf(cardOf(cards, "PLX_MC"), "open-to-merge-p90")).toMatchObject({
      target: null,
      nextTarget: 4,
      grade: "no-target",
    });
    expect(rowOf(cardOf(cards, "PLX_MC"), "compliance-first-fail")).toMatchObject({ target: null, grade: "no-target" });
  });

  it("reads percentages from the first-attempt counts", () => {
    expect(rowOf(cardOf(cards, PORTAL_REPO), "compliance-first-fail")).toMatchObject({ value: 6, target: 8, grade: "met" });
    expect(rowOf(cardOf(cards, PORTAL_REPO), "ci-first-fail")).toMatchObject({ value: 4, target: null, nextTarget: 5 });
    expect(rowOf(cardOf(cards, PORTAL_REPO), "rerun-pass").value).toBeCloseTo(0.5);
    const none = gradeWeek(
      snapshot("2026-10-26T12:45:00Z", {
        PLX_MC: repo({
          runs: { runs: 0, pr_ci_first_attempt: { n: 0, failed: 0 }, compliance_first_attempt: { n: 0, failed: 0 }, passed_on_rerun: 0 },
        }),
      }),
      null,
      2
    );
    expect(rowOf(cardOf(none, "PLX_MC"), "ci-first-fail")).toMatchObject({ value: null, grade: "no-data" });
  });

  it("grades the landing wait without Dependabot, and says so when a snapshot cannot split it", () => {
    expect(rowOf(cardOf(cards, "PLX_MC"), "landing-wait-p90")).toMatchObject({ value: 25, grade: "met", note: null });
    const old = gradeWeek(
      snapshot("2026-10-26T12:45:00Z", { PLX_MC: repo({ landing_wait_minutes_non_dependabot: undefined }) }),
      null,
      1
    );
    const row = rowOf(cardOf(old, "PLX_MC"), "landing-wait-p90");
    expect(row).toMatchObject({ value: 40, grade: "near" });
    expect(row.note).toMatch(/Dependabot/);
  });

  it("misses on any bypass merge", () => {
    const week = gradeWeek(snapshot("2026-10-26T12:45:00Z", { PLX_MC: repo({ bypass_merges: 1 }) }), null, 1);
    expect(rowOf(cardOf(week, "PLX_MC"), "bypass-merges")).toMatchObject({ value: 1, target: 0, grade: "missed" });
  });

  it("adds up green-but-unmerged PRs across the repos, and has no number for a past window", () => {
    expect(rowOf(cardOf(cards, "fleet"), "green-unmerged")).toMatchObject({ value: 3, target: 5, grade: "met" });
    const past = gradeWeek(snapshot("2026-10-12T12:45:00Z", { PLX_MC: repo({ open: null, bypass_merges: null }) }), null, 1);
    expect(rowOf(cardOf(past, "fleet"), "green-unmerged")).toMatchObject({ value: null, grade: "no-data" });
    expect(rowOf(cardOf(past, "PLX_MC"), "bypass-merges")).toMatchObject({ value: null, grade: "no-data" });
  });

  it("uses the phase 2 targets once phase 2 is current", () => {
    const p2 = gradeWeek(snapshot("2026-10-26T12:45:00Z"), null, 2);
    expect(rowOf(cardOf(p2, PORTAL_REPO), "open-to-merge-p90")).toMatchObject({ target: 4, nextTarget: null, grade: "near" });
    expect(rowOf(cardOf(p2, PORTAL_REPO), "queue-p90")).toMatchObject({ value: 28, target: 30, grade: "met" });
    expect(rowOf(cardOf(p2, "PLX_MC"), "open-to-merge-p90")).toMatchObject({ target: 4, grade: "near" });
  });

  it("scores each card on its graded rows", () => {
    const portalCard = cardOf(cards, PORTAL_REPO);
    // Phase 1 grades open to merge (2), landing wait, compliance, bypass and Dependabot for the portal.
    expect(portalCard).toMatchObject({ graded: 6, met: 6, score: 100, letter: "A" });
  });
});

describe("weeks and the trend", () => {
  it("starts a week on Monday (UTC)", () => {
    expect(weekOf("2026-10-26T12:45:00Z")).toBe("2026-10-26");
    expect(weekOf("2026-10-25T21:00:00Z")).toBe("2026-10-19");
    expect(weekOf("2026-11-01T23:59:59Z")).toBe("2026-10-26");
  });

  it("keeps the latest recorded snapshot of each week, oldest week first", () => {
    const first = stored(1, snapshot("2026-10-26T12:45:00Z"));
    const rerun = stored(3, snapshot("2026-10-27T09:00:00Z"));
    const before = stored(2, snapshot("2026-10-19T12:45:00Z"));
    expect(latestPerWeek([first, rerun, before]).map((s) => s.seq)).toEqual(["2", "3"]);
  });

  it("compares each row with the week before", () => {
    const scorecard = buildScorecard([
      stored(1, snapshot("2026-10-19T12:45:00Z", { PLX_MC: repo({ landing_wait_minutes_non_dependabot: summary(4, 50) }) })),
      stored(2, snapshot("2026-10-26T12:45:00Z")),
    ]);
    const plxmc = cardOf(scorecard.latest!.cards, "PLX_MC");
    expect(rowOf(plxmc, "landing-wait-p90")).toMatchObject({ value: 25, previous: 50, trend: "better" });
    expect(rowOf(plxmc, "bypass-merges")).toMatchObject({ previous: 0, trend: "same" });
    expect(scorecard.history.map((w) => w.windowEnd)).toEqual(["2026-10-19T12:45:00Z", "2026-10-26T12:45:00Z"]);
    expect(scorecard.history[0].repos.PLX_MC).toBeLessThan(scorecard.history[1].repos.PLX_MC!);
  });

  it("has no latest week before the first snapshot", () => {
    expect(buildScorecard([])).toEqual({ phase: 1, latest: null, history: [] });
  });

  it("carries the snapshot's read errors to the screen", () => {
    const scorecard = buildScorecard([stored(1, snapshot("2026-10-26T12:45:00Z", {}, ["agentic-swarm: GET failed"]))]);
    expect(scorecard.latest!.errors).toEqual(["agentic-swarm: GET failed"]);
  });
});
