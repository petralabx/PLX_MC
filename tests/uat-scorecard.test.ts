// TASK-4196 — the UAT scorecard rubric: the plx-uat-scorecard/v1 contract with
// the portal, Toronto weeks, direction-aware grading against the default
// targets at the precision the screen shows, the score and letter
// (ci-scorecard's), the read that counts for a week, a pending final read, a
// closed week's point-in-time numbers, the trend against the calendar week
// before, and the failed pull the screen names. The fixtures are synthetic,
// with the shape the design gives the portal.

import { describe, expect, it } from "vitest";

import { formatNear, formatValue } from "@/components/mc/uat-scorecard/helpers";
import * as ci from "@/lib/ci-scorecard";
import {
  METRICS,
  NEAR_FACTOR,
  RUBRIC,
  addDays,
  buildScorecard,
  gradeValue,
  gradeWeek,
  latestPerWeek,
  letterOf,
  nearOf,
  scoreOf,
  snapshotDedupKey,
  torontoDate,
  unansweredPullFailure,
  weekOf,
  type Card,
  type Grade,
  type MetricRow,
  type PullFailure,
  type StoredSnapshot,
  type StoredWeek,
} from "@/lib/uat-scorecard";
import { snapshotSchema, type Snapshot } from "@/lib/uat-scorecard/schema";

// Friday 30 Oct, 06:00 in Toronto: the week of Oct 26 is open, earlier weeks have ended.
const NOW = new Date("2026-10-30T10:00:00.000Z");

// Monday 00:00 in Toronto, to the next Monday; summer time ends on Nov 1.
const WEEKS: Record<string, [string, string]> = {
  "2026-10-05": ["2026-10-05T04:00:00.000Z", "2026-10-12T04:00:00.000Z"],
  "2026-10-12": ["2026-10-12T04:00:00.000Z", "2026-10-19T04:00:00.000Z"],
  "2026-10-19": ["2026-10-19T04:00:00.000Z", "2026-10-26T04:00:00.000Z"],
  "2026-10-26": ["2026-10-26T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
};

type Patch = Record<string, Record<string, unknown> | unknown[] | null>;
interface Opts {
  complete?: boolean;
  generatedAt?: string;
  patch?: Patch;
  readErrors?: string[];
  window?: [string, string];
}

/** One week as the portal would serve it, with every target met. A closed week has no point-in-time numbers. */
function payload(week: string, opts: Opts = {}) {
  const [start, end] = opts.window ?? WEEKS[week];
  const complete = opts.complete ?? true;
  const patch = opts.patch ?? {};
  const section = (name: string, base: Record<string, unknown>) =>
    patch[name] === null ? null : { ...base, ...(patch[name] as Record<string, unknown> | undefined) };
  return {
    schema: "plx-uat-scorecard/v1",
    window: { start, end, timeZone: "America/Toronto", complete },
    generatedAt: opts.generatedAt ?? (complete ? "2026-11-02T15:00:00.000Z" : "2026-10-30T10:00:00.000Z"),
    outcomes: section("outcomes", {
      verdicts: 10,
      pass: 8,
      fail: 1,
      stale: 1,
      legacyStallExpiries: 0,
      passWithin5bdOfFiling: 6,
      firstAttemptPass: 6,
      reopened: 1,
      closedPollable: 8,
    }),
    speed: section("speed", {
      filedToPass: { p50: 4, p90: 9, n: 8 },
      holders: { plx: { p50: 0.5, n: 8 }, agent: { p50: 1, n: 8 }, pipeline: { p50: 0.25, n: 8 }, submitter: { p50: 2, n: 1 } },
    }),
    flow: section("flow", {
      filed: 12,
      open: complete ? null : 14,
      overClock: complete ? null : 0,
      waitingOnPlx: complete ? null : 3,
      stuck: complete ? null : 2,
      duplicatesClosed: null,
    }),
    users: section("users", {
      closingPoll: { responses: 4, average: 4.5, low: 1, lowWithFollowUp: 1 },
      pulse: [
        { campaignId: "c1", title: "October pulse", responses: 12, questions: [{ id: "q1", label: "Ease", average: 4 }, { id: "q2", label: "Speed", average: 3.6 }] },
      ],
    }),
    reliability: section("reliability", { outboxFailedTerminal: 0, watchdogPages: 4, deadOutboxOpen: complete ? null : 0 }),
    readErrors: opts.readErrors ?? [],
  };
}

const snap = (week: string, opts?: Opts): Snapshot => snapshotSchema.parse(payload(week, opts));
const stored = (seq: number, snapshot: Snapshot): StoredSnapshot => ({ seq: String(seq), recordedAt: snapshot.generatedAt, snapshot });
const weekWith = (snapshot: Snapshot, ...openReads: Snapshot[]): StoredWeek => ({
  week: weekOf(snapshot.window.start),
  read: stored(9, snapshot),
  openReads: openReads.map((s, i) => stored(8 - i, s)),
});
const cardOf = (cards: Card[], id: string) => cards.find((c) => c.id === id)!;
const rowOf = (cards: Card[], id: string): MetricRow => cards.flatMap((c) => c.metrics).find((m) => m.id === id)!;
// Pulse rounds as the portal lists them: the newest two scored rounds opened before the week ended, oldest
// first, each over all its answers by then.
const pulse = (...rounds: [string, number | null, number?][]) => ({
  users: {
    closingPoll: { responses: 4, average: 4.5, low: 0, lowWithFollowUp: 0 },
    pulse: rounds.map(([title, average, responses = 8], i) => ({ campaignId: `c${i}`, title, responses, questions: [{ id: "q", label: "Ease", average }] })),
  },
});

describe("the plx-uat-scorecard/v1 contract", () => {
  it("accepts the portal's payload, keeps fields the rubric does not read, and defaults readErrors", () => {
    const body: Record<string, unknown> = { ...payload("2026-10-19", { patch: { outcomes: { retestsAsked: 14 } } }), throughput: { kept: true } };
    delete body.readErrors;
    const parsed = snapshotSchema.parse(body);
    expect(parsed.readErrors).toEqual([]);
    expect((parsed as Record<string, unknown>).throughput).toEqual({ kept: true });
    expect((parsed.outcomes as Record<string, unknown>).retestsAsked).toBe(14);
  });

  it("accepts a closed week without point-in-time numbers, and a section that could not be read", () => {
    expect(snapshotSchema.safeParse(payload("2026-10-19", { patch: { flow: null } })).success).toBe(true);
    const unread = payload("2026-10-19", {
      patch: { reliability: { outboxFailedTerminal: null, watchdogPages: null, deadOutboxOpen: null } },
      readErrors: ["reliability: could not be read."],
    });
    expect(snapshotSchema.safeParse(unread).success).toBe(true);
  });

  it("accepts a read without outcomes.closedPollable or outcomes.passWithoutRun, which the portal adds to the contract", () => {
    const body = payload("2026-10-19");
    delete (body.outcomes as Record<string, unknown>).closedPollable;
    const parsed = snapshotSchema.parse(body);
    expect(parsed.outcomes.closedPollable).toBeUndefined();
    expect(parsed.outcomes.passWithoutRun).toBeUndefined();
  });

  it.each([
    ["another schema", { schema: "plx-uat-scorecard/v2" }],
    ["a window that ends before it starts", { window: { start: WEEKS["2026-10-26"][0], end: WEEKS["2026-10-19"][0], timeZone: "America/Toronto", complete: true } }],
    ["a negative count", { outcomes: { ...payload("2026-10-19").outcomes, fail: -1 } }],
    ["a fractional count", { outcomes: { ...payload("2026-10-19").outcomes, pass: 7.5 } }],
    ["a missing section", { speed: undefined }],
    ["a date that is not ISO 8601", { generatedAt: "this morning" }],
  ])("rejects %s", (_label, patch) => {
    expect(snapshotSchema.safeParse({ ...payload("2026-10-19"), ...patch }).success).toBe(false);
  });

  it("keys a clean final read on its week, and any other read on the hour it was read, in disjoint forms", () => {
    expect(snapshotDedupKey(snap("2026-10-19"))).toBe("uat-scorecard:2026-10-19T04:00:00.000Z|final");
    // A clean final read's key does not move with the time of the read: a replay is a no-op.
    expect(snapshotDedupKey(snap("2026-10-19", { generatedAt: "2026-10-27T10:00:00.000Z" }))).toBe(snapshotDedupKey(snap("2026-10-19")));
    // A final read with read errors keys like an open read, so a later clean final read appends.
    const partial = (at: string) => snapshotDedupKey(snap("2026-10-19", { generatedAt: at, readErrors: ["users.closingPoll: could not be read."] }));
    expect(partial("2026-10-26T10:00:05.000Z")).toBe("uat-scorecard:2026-10-19T04:00:00.000Z|read:2026-10-26T10:00:00.000Z");
    expect(partial("2026-10-27T10:00:05.000Z")).not.toBe(partial("2026-10-26T10:00:05.000Z"));
    // Toronto midnight falls on a UTC hour: a partial read in the first hour after the week closes keeps its own key.
    expect(partial("2026-10-26T00:20:00.000-04:00")).toBe("uat-scorecard:2026-10-19T04:00:00.000Z|read:2026-10-26T04:00:00.000Z");
    expect(partial("2026-10-26T00:20:00.000-04:00")).not.toBe(snapshotDedupKey(snap("2026-10-19")));
    const read = (at: string) => snapshotDedupKey(snap("2026-10-26", { complete: false, generatedAt: at }));
    expect(read("2026-10-30T10:00:12.000Z")).toBe("uat-scorecard:2026-10-26T04:00:00.000Z|read:2026-10-30T10:00:00.000Z");
    expect(read("2026-10-30T10:59:59.000Z")).toBe(read("2026-10-30T10:00:12.000Z"));
    expect(read("2026-10-31T10:00:00.000Z")).not.toBe(read("2026-10-30T10:00:00.000Z"));
  });

  it("normalises the instants in the key, so the portal's offset format cannot store a week twice", () => {
    const toronto = snap("2026-10-26", { window: ["2026-10-26T00:00:00.000-04:00", "2026-11-02T00:00:00.000-05:00"] });
    expect(snapshotDedupKey(toronto)).toBe(snapshotDedupKey(snap("2026-10-26")));
    expect(snapshotDedupKey(toronto)).toBe("uat-scorecard:2026-10-26T04:00:00.000Z|final");
    const open = (window: [string, string], at: string) => snapshotDedupKey(snap("2026-10-26", { complete: false, window, generatedAt: at }));
    expect(open(["2026-10-26T00:00:00.000-04:00", "2026-11-02T00:00:00.000-05:00"], "2026-10-30T06:00:12.000-04:00")).toBe(
      open(WEEKS["2026-10-26"], "2026-10-30T10:00:12.000Z")
    );
  });
});

describe("Toronto weeks", () => {
  it("starts a week on Monday in Toronto, across the change from summer time", () => {
    expect(weekOf("2026-10-26T03:59:59Z")).toBe("2026-10-19"); // Sunday 23:59 in Toronto
    expect(weekOf("2026-10-26T04:00:00Z")).toBe("2026-10-26");
    expect(weekOf("2026-10-30T10:00:00Z")).toBe("2026-10-26");
    expect(weekOf("2026-11-02T04:30:00Z")).toBe("2026-10-26"); // Sunday 23:30 EST
    expect(weekOf("2026-11-02T05:00:00Z")).toBe("2026-11-02");
    expect(weekOf("2026-10-26T00:00:00.000-04:00")).toBe("2026-10-26");
    expect(torontoDate(new Date("2026-11-01T03:30:00Z"))).toBe("2026-10-31");
  });

  it("moves a date by whole days over month ends", () => {
    expect(addDays("2026-10-26", -7)).toBe("2026-10-19");
    expect(addDays("2026-11-02", -7)).toBe("2026-10-26");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });
});

describe("grading one value, by direction", () => {
  const lower = (target: number) => ({ direction: "lower" as const, target });
  const higher = (target: number, nearFloor?: number) => ({ direction: "higher" as const, target, nearFloor });

  it("lower is better: met at or under the target, near within 1.5x, missed beyond", () => {
    expect(gradeValue(20, lower(20))).toBe("met");
    expect(gradeValue(4, lower(20))).toBe("met");
    expect(gradeValue(30, lower(20))).toBe("near");
    expect(gradeValue(30.1, lower(20))).toBe("missed");
    expect(nearOf(lower(20))).toBe(30);
  });

  it("rounds a computed near band to the two decimals it shows, so a value on the band is near", () => {
    // Non-default targets: 0.3 × 1.5 is 0.44999… in floating point, shown as 0.45.
    for (const target of [0.3, 0.7, 0.25, 1.25, 0.05]) {
      const goal = lower(target);
      const shown = Number(formatNear({ near: nearOf(goal), direction: "lower", unit: "days" })!.replace(/[^\d.]/g, ""));
      expect(nearOf(goal), `target ${target}`).toBe(shown);
      expect(gradeValue(shown, goal), `target ${target} bd, shown band ${shown}`).toBe("near");
    }
    expect(nearOf(lower(0.3))).toBe(0.45);
    // A count's band keeps its half: it is shown and graded at two decimals too.
    expect(nearOf(lower(5))).toBe(7.5);
  });

  it("has no near band for a target of 0", () => {
    expect(gradeValue(0, lower(0))).toBe("met");
    expect(gradeValue(1, lower(0))).toBe("missed");
    expect(nearOf(lower(0))).toBeNull();
  });

  it("higher is better: met at or over the target, near down to the band's floor, missed below", () => {
    expect(gradeValue(70, higher(70, 60))).toBe("met");
    expect(gradeValue(95, higher(70, 60))).toBe("met");
    expect(gradeValue(60, higher(70, 60))).toBe("near");
    expect(gradeValue(59.9, higher(70, 60))).toBe("missed");
    expect(gradeValue(69, higher(70))).toBe("missed");
    expect(nearOf(higher(70, 60))).toBe(60);
  });

  it("does not grade a missing number or a metric with no target", () => {
    expect(gradeValue(null, lower(5))).toBe("no-data");
    expect(gradeValue(Number.NaN, higher(4, 3.5))).toBe("no-data");
    expect(gradeValue(3, { direction: "lower" })).toBe("no-target");
    expect(gradeValue(3, {})).toBe("no-target");
  });
});

describe("the default targets", () => {
  it("are the design's, with each near band", () => {
    expect(RUBRIC.filter((r) => r.target !== null).map((r) => [r.id, r.direction, r.target, r.near])).toEqual([
      ["pass-share", "higher", 70, 60],
      ["fail-share", "lower", 20, 30],
      ["stale-share", "lower", 10, 15],
      ["pass-within-5bd", "higher", 60, 50],
      ["first-attempt-pass", "higher", 70, 60],
      ["filed-to-pass-p50", "lower", 5, 7.5],
      ["hold-plx", "lower", 1, 1.5],
      ["hold-agent", "lower", 1, 1.5],
      ["hold-pipeline", "lower", 0.5, 0.75],
      ["hold-submitter", "lower", 3, 4.5],
      ["over-clock", "lower", 0, null],
      ["stuck", "lower", 5, 7.5],
      ["waiting-on-plx", "lower", 5, 7.5],
      ["poll-average", "higher", 4, 3.5],
      ["poll-response-rate", "higher", 30, 20],
      ["low-without-follow-up", "lower", 0, null],
      ["pulse-average", "higher", 3.5, 3],
      ["outbox-failed-terminal", "lower", 0, null],
      ["watchdog-pages", "lower", 10, 15],
    ]);
  });

  it("give every graded metric a direction, and a near floor only below a higher-is-better target", () => {
    for (const m of METRICS) {
      if (m.target !== undefined) expect(m.direction, m.id).toBeDefined();
      if (m.nearFloor !== undefined) {
        expect(m.direction, m.id).toBe("higher");
        expect(m.nearFloor, m.id).toBeLessThan(m.target!);
      }
    }
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
  });

  it("describe holder time by the portal's custody model", () => {
    for (const id of ["hold-plx", "hold-agent", "hold-pipeline", "hold-submitter"]) {
      const detail = RUBRIC.find((r) => r.id === id)!.detail;
      expect(detail, id).toMatch(/custody model/);
      expect(detail, id).not.toMatch(/UFL-0b/);
    }
  });

  it("say what the portal counts: follow-ups by the week's end, and every failed outbox row", () => {
    const detail = (id: string) => RUBRIC.find((r) => r.id === id)!.detail;
    expect(detail("low-without-follow-up")).toMatch(/with no follow-up by the end of the week/);
    expect(detail("outbox-failed-terminal")).toMatch(/^Every outbox row that reached FAILED_TERMINAL this week, of any kind/);
    expect(detail("poll-response-rate")).toMatch(/outcomes\.closedPollable/);
    expect(detail("first-attempt-pass")).toMatch(/passWithoutRun/);
  });
});

describe("the score and the letter", () => {
  it("count met as 1 and near as a half, over the graded metrics only", () => {
    expect(scoreOf(["met", "met", "near", "missed"])).toBe(63);
    expect(scoreOf(["met", "no-data", "no-target"])).toBe(100);
    expect(scoreOf(["no-data", "no-target"])).toBeNull();
    expect([100, 90, 89, 80, 70, 60, 59, 0].map(letterOf)).toEqual(["A", "A", "B", "B", "C", "D", "F", "F"]);
    expect(letterOf(null)).toBeNull();
  });

  it("are exactly ci-scorecard's", () => {
    const all: Grade[] = ["met", "near", "missed", "no-data", "no-target"];
    const sets: Grade[][] = [[], ...all.map((g) => [g])];
    for (const a of all) for (const b of all) for (const c of all) sets.push([a, b, c]);
    for (const grades of sets) expect(scoreOf(grades), grades.join(",")).toBe(ci.scoreOf(grades));
    for (let score = 0; score <= 100; score += 1) expect(letterOf(score)).toBe(ci.letterOf(score));
    expect(NEAR_FACTOR).toBe(ci.NEAR_FACTOR);
  });
});

describe("grading a week", () => {
  const open = gradeWeek(weekWith(snap("2026-10-26", { complete: false })), null);

  it("shows one card per area, in order, every target met", () => {
    expect(open.map((c) => c.id)).toEqual(["outcomes", "speed", "flow", "users", "reliability"]);
    expect(open.map((c) => [c.id, c.graded, c.met, c.letter])).toEqual([
      ["outcomes", 5, 5, "A"],
      ["speed", 5, 5, "A"],
      ["flow", 3, 3, "A"],
      ["users", 4, 4, "A"],
      ["reliability", 2, 2, "A"],
    ]);
    expect(rowOf(open, "filed")).toMatchObject({ value: 12, direction: null, grade: "no-target" });
    expect(rowOf(open, "reopened")).toMatchObject({ value: 1, target: null, grade: "no-target" });
  });

  it("reads shares and medians with what they are out of", () => {
    expect(rowOf(open, "pass-share")).toMatchObject({ value: 80, basis: "8 of 10 verdicts", grade: "met" });
    expect(rowOf(open, "pass-within-5bd")).toMatchObject({ value: 75, basis: "6 of 8 PASS" });
    expect(rowOf(open, "filed-to-pass-p50")).toMatchObject({ value: 4, basis: "8 tickets", target: 5, near: 7.5 });
    expect(rowOf(open, "hold-submitter")).toMatchObject({ value: 2, basis: "1 ticket" });
    expect(rowOf(open, "low-without-follow-up")).toMatchObject({ value: 0, basis: "of 1 low score", grade: "met" });
  });

  it("grades both directions against their bands", () => {
    const week = gradeWeek(
      weekWith(
        snap("2026-10-26", {
          complete: false,
          patch: {
            outcomes: { pass: 6, fail: 3, stale: 1, passWithin5bdOfFiling: 2, firstAttemptPass: 6 },
            speed: { filedToPass: { p50: 8, p90: 20, n: 6 } },
            reliability: { outboxFailedTerminal: 1, watchdogPages: 15 },
          },
        })
      ),
      null
    );
    expect(rowOf(week, "pass-share")).toMatchObject({ value: 60, grade: "near" }); // higher: floor 60
    expect(rowOf(week, "fail-share")).toMatchObject({ value: 30, grade: "near" }); // lower: 1.5 × 20
    expect(rowOf(week, "pass-within-5bd")).toMatchObject({ value: 33.3, grade: "missed" }); // 2 of 6, as shown
    expect(rowOf(week, "first-attempt-pass")).toMatchObject({ value: 100, grade: "met" });
    expect(rowOf(week, "filed-to-pass-p50")).toMatchObject({ value: 8, grade: "missed" }); // over 7.5
    expect(rowOf(week, "outbox-failed-terminal")).toMatchObject({ value: 1, grade: "missed" }); // target 0: no near band
    expect(rowOf(week, "watchdog-pages")).toMatchObject({ value: 15, grade: "near" });
    expect(cardOf(week, "reliability")).toMatchObject({ graded: 2, met: 0, score: 25, letter: "F" });
  });

  it("has no number for a share of nothing, or for counts that disagree", () => {
    const week = gradeWeek(
      weekWith(
        snap("2026-10-26", {
          complete: false,
          patch: {
            outcomes: { verdicts: 0, pass: 0, fail: 0, stale: 0, passWithin5bdOfFiling: 0, firstAttemptPass: 0, closedPollable: 0 },
            users: { closingPoll: { responses: 0, average: null, low: 1, lowWithFollowUp: 2 }, pulse: [] },
          },
        })
      ),
      null
    );
    for (const id of ["pass-share", "first-attempt-pass", "poll-response-rate", "poll-average", "pulse-average"]) {
      expect(rowOf(week, id), id).toMatchObject({ value: null, grade: "no-data" });
    }
    expect(rowOf(week, "low-without-follow-up")).toMatchObject({ value: null, grade: "no-data" });
    expect(rowOf(week, "low-without-follow-up").note).toMatch(/more follow-ups than low scores/);
  });

  it("counts closing poll answers over the closed tickets whose submitter can answer, and stops at 100%", () => {
    const rate = (closedPollable: number | null | undefined, responses = 4, extra: Record<string, unknown> = {}) => {
      const body = payload("2026-10-26", { complete: false, patch: { users: { closingPoll: { responses, average: 4.5, low: 0, lowWithFollowUp: 0 }, pulse: [] } } });
      const outcomes = Object.assign(body.outcomes as Record<string, unknown>, extra);
      if (closedPollable === undefined) delete outcomes.closedPollable;
      else outcomes.closedPollable = closedPollable;
      return rowOf(gradeWeek(weekWith(snapshotSchema.parse(body)), null), "poll-response-rate");
    };
    expect(rate(8)).toMatchObject({ value: 50, basis: "4 answers for 8 closed tickets that can answer", grade: "met", note: null });
    expect(rate(null)).toMatchObject({ value: null, grade: "no-data" });
    expect(rate(undefined)).toMatchObject({ value: null, grade: "no-data" });
    expect(rate(0)).toMatchObject({ value: null, grade: "no-data" });
    // The old outcomes.closed counted every closed ticket: it is not the denominator.
    expect(rate(undefined, 4, { closed: 8 })).toMatchObject({ value: null, grade: "no-data" });
    expect(rate(2, 5)).toMatchObject({ value: 100, basis: "5 answers for 2 closed tickets that can answer", grade: "met" });
    expect(rate(2, 5).note).toMatch(/escalated tickets also get the poll/);
  });

  it("says when STALE includes legacy stall expiries", () => {
    const week = gradeWeek(weekWith(snap("2026-10-26", { complete: false, patch: { outcomes: { legacyStallExpiries: 2 } } })), null);
    expect(rowOf(week, "stale-share")).toMatchObject({ value: 10, note: "Includes 2 legacy stall expiries." });
    expect(rowOf(open, "stale-share").note).toBeNull();
  });

  it("leaves PASS verdicts on a ticket with no agent run out of the first-attempt share", () => {
    const firstAttempt = (outcomes: Record<string, unknown>) =>
      rowOf(gradeWeek(weekWith(snap("2026-10-26", { complete: false, patch: { outcomes } })), null), "first-attempt-pass");
    // 8 PASS, 2 of them legacy with no run: 6 first-attempt PASS of the 6 with a run.
    expect(firstAttempt({ pass: 8, passWithoutRun: 2, firstAttemptPass: 6 })).toMatchObject({ value: 100, basis: "6 of 6 PASS with a run", grade: "met" });
    // More first-attempt PASS than PASS with a run cannot be: no number, and a note, never 600%.
    expect(firstAttempt({ pass: 8, passWithoutRun: 7, firstAttemptPass: 6 })).toMatchObject({
      value: null,
      grade: "no-data",
      note: "The portal counted more first-attempt PASS than PASS with a run.",
    });
    // Until the portal sends it, every PASS counts as one with a run.
    expect(firstAttempt({ pass: 8, firstAttemptPass: 6 })).toMatchObject({ value: 75, basis: "6 of 8 PASS with a run" });
    // No PASS with a run, or counts that disagree: no number.
    expect(firstAttempt({ pass: 2, passWithoutRun: 2, firstAttemptPass: 0 })).toMatchObject({ value: null, grade: "no-data" });
    expect(firstAttempt({ pass: 2, passWithoutRun: 3, firstAttemptPass: 0 })).toMatchObject({ value: null, grade: "no-data" });
    expect(firstAttempt({ pass: 8, passWithoutRun: null, firstAttemptPass: 6 })).toMatchObject({ value: null, grade: "no-data" });
  });

  it("averages the newest scored round, the last one listed", () => {
    expect(rowOf(open, "pulse-average")).toMatchObject({ value: 3.8, basis: "October pulse, 12 answers", grade: "met", note: null });
    // A question with no average, such as a text question, is left out of the mean.
    const rounds = [
      { campaignId: "c1", title: "Early October", responses: 9, questions: [{ id: "q", label: "Ease", average: 2.5 }] },
      { campaignId: "c2", title: "Late October", responses: 5, questions: [{ id: "q", label: "Ease", average: 4.2 }, { id: "t", label: "Notes", average: null }] },
    ];
    const week = gradeWeek(weekWith(snap("2026-10-26", { complete: false, patch: { users: { pulse: rounds } } })), null);
    expect(rowOf(week, "pulse-average")).toMatchObject({ value: 4.2, basis: "Late October, 5 answers", note: null });
  });

  it("flags a pulse average 0.5 or more below the round before", () => {
    const flag = (...rounds: [string, number | null][]) =>
      rowOf(gradeWeek(weekWith(snap("2026-10-26", { complete: false, patch: pulse(...rounds) })), null), "pulse-average");
    expect(flag(["September pulse", 4.2], ["October pulse", 3.5])).toMatchObject({ value: 3.5, note: "Down 0.7 from September pulse (4.2)." });
    // Off the contract, a listed round with no scored answer is skipped.
    expect(flag(["September pulse", 4], ["October pulse", 3.5], ["Just opened", null])).toMatchObject({ value: 3.5, note: "Down 0.5 from September pulse (4)." });
    // 2.3 − 1.8 is 0.4999… in floating point: still a fall of 0.5.
    expect(flag(["September pulse", 2.3], ["October pulse", 1.8]).note).toBe("Down 0.5 from September pulse (2.3).");
    // Each mean as shown: 3.6042 shows as 3.6, a fall of 0.5 from 4.1; 3.6051 shows as 3.61, a fall of 0.49.
    expect(flag(["September pulse", 4.1], ["October pulse", 3.6042])).toMatchObject({ value: 3.6, note: "Down 0.5 from September pulse (4.1)." });
    expect(flag(["September pulse", 4.1], ["October pulse", 3.6051]).note).toBeNull();
    expect(flag(["September pulse", 3.6], ["October pulse", 4.3]).note).toBeNull();
  });

  it("leaves a section the portal could not read ungraded", () => {
    const week = gradeWeek(
      weekWith(
        snap("2026-10-26", {
          complete: false,
          patch: { reliability: { outboxFailedTerminal: null, watchdogPages: null, deadOutboxOpen: null } },
          readErrors: ["reliability: could not be read."],
        })
      ),
      null
    );
    expect(cardOf(week, "reliability")).toMatchObject({ graded: 0, score: null, letter: null });
  });
});

describe("grading at the precision the screen shows", () => {
  // One metric's value in a week's read. A share is out of 10,000, so it lands within 0.01% of any edge.
  const OF = 10_000;
  const part = (percent: number) => Math.round((percent * OF) / 100);
  const count = (v: number) => Math.max(0, Math.round(v));
  const holders = { plx: { p50: 0.5, n: 8 }, agent: { p50: 1, n: 8 }, pipeline: { p50: 0.25, n: 8 }, submitter: { p50: 2, n: 8 } };
  const poll = (closingPoll: Record<string, number>) => ({ closingPoll: { responses: 4, average: 4.5, low: 0, lowWithFollowUp: 0, ...closingPoll } });
  const round = (title: string, ...averages: number[]) => ({
    campaignId: title,
    title,
    responses: 12,
    questions: averages.map((average, i) => ({ id: `q${i}`, label: `Question ${i + 1}`, average })),
  });
  const SET: Record<string, (v: number) => Patch> = {
    "pass-share": (v) => ({ outcomes: { verdicts: OF, pass: part(v) } }),
    "fail-share": (v) => ({ outcomes: { verdicts: OF, fail: part(v) } }),
    "stale-share": (v) => ({ outcomes: { verdicts: OF, stale: part(v) } }),
    "pass-within-5bd": (v) => ({ outcomes: { verdicts: OF, pass: OF, passWithin5bdOfFiling: part(v) } }),
    "first-attempt-pass": (v) => ({ outcomes: { verdicts: OF, pass: OF, firstAttemptPass: part(v) } }),
    "filed-to-pass-p50": (v) => ({ speed: { filedToPass: { p50: v, p90: 9, n: 8 } } }),
    "hold-plx": (v) => ({ speed: { holders: { ...holders, plx: { p50: v, n: 8 } } } }),
    "hold-agent": (v) => ({ speed: { holders: { ...holders, agent: { p50: v, n: 8 } } } }),
    "hold-pipeline": (v) => ({ speed: { holders: { ...holders, pipeline: { p50: v, n: 8 } } } }),
    "hold-submitter": (v) => ({ speed: { holders: { ...holders, submitter: { p50: v, n: 8 } } } }),
    "over-clock": (v) => ({ flow: { overClock: count(v) } }),
    stuck: (v) => ({ flow: { stuck: count(v) } }),
    "waiting-on-plx": (v) => ({ flow: { waitingOnPlx: count(v) } }),
    "poll-average": (v) => ({ users: poll({ average: v }) }),
    "poll-response-rate": (v) => ({ outcomes: { closedPollable: OF }, users: poll({ responses: part(v) }) }),
    "low-without-follow-up": (v) => ({ users: poll({ low: count(v) }) }),
    "pulse-average": (v) => ({ users: { pulse: [round("October pulse", v)] } }),
    "outbox-failed-terminal": (v) => ({ reliability: { outboxFailedTerminal: count(v) } }),
    "watchdog-pages": (v) => ({ reliability: { watchdogPages: count(v) } }),
  };
  const read = (patch: Patch) => snap("2026-10-26", { complete: false, patch });
  /** The grade a reader gets from the number on screen and the target and near band shown beside it. */
  const gradeOnScreen = (r: MetricRow): Grade => {
    const shown = Number(formatValue(r.value, r.unit).replace(/[^\d.]/g, ""));
    const within = (bound: number) => (r.direction === "lower" ? shown <= bound : shown >= bound);
    return within(r.target!) ? "met" : r.near !== null && within(r.near) ? "near" : "missed";
  };

  it("agrees with the shown value at every band edge of every graded metric", () => {
    const offsets = [-0.06, -0.051, -0.05, -0.049, -0.006, -0.005, -0.004, 0, 0.004, 0.005, 0.006, 0.049, 0.05, 0.051, 0.06];
    for (const m of RUBRIC.filter((r) => r.target !== null)) {
      expect(SET[m.id], m.id).toBeDefined();
      for (const edge of [m.target!, m.near].filter((e): e is number => e !== null)) {
        for (const v of offsets.map((d) => Math.max(0, edge + d))) {
          const r = rowOf(gradeWeek(weekWith(read(SET[m.id](v))), null), m.id);
          expect(r.grade, `${m.id} at ${v}, shown ${formatValue(r.value, r.unit)}`).toBe(gradeOnScreen(r));
        }
      }
    }
  });

  it("grades a pulse mean of rounded averages as it shows", () => {
    const pulseOf = (...averages: number[]) => rowOf(gradeWeek(weekWith(read({ users: { pulse: [round("October pulse", ...averages)] } })), null), "pulse-average");
    // 3.4967 shows as 3.5 and meets ≥ 3.5; 2.9967 shows as 3 and is near, at the band's floor of 3.
    expect(pulseOf(3.49, 3.5, 3.5)).toMatchObject({ value: 3.5, grade: "met" });
    expect(pulseOf(2.99, 3, 3)).toMatchObject({ value: 3, grade: "near" });
  });

  it("compares a week with the one before as both show", () => {
    const scorecard = buildScorecard(
      [
        stored(1, snap("2026-10-12", { patch: { users: { pulse: [round("September pulse", 3.5)] } } })),
        stored(2, snap("2026-10-19", { patch: { users: { pulse: [round("September pulse", 3.5), round("October pulse", 3.49, 3.5, 3.5)] } } })),
      ],
      NOW
    );
    expect(rowOf(scorecard.latest!.cards, "pulse-average")).toMatchObject({ value: 3.5, previous: 3.5, trend: "same", note: null });
  });
});

describe("weeks, the headline and the trend", () => {
  const daily = (seq: number, at: string, opts: Opts = {}) => stored(seq, snap("2026-10-19", { complete: false, generatedAt: at, ...opts }));

  it("counts a closed week's final read over any open read of it, and keeps its open reads newest first", () => {
    const final = stored(5, snap("2026-10-19"));
    const weeks = latestPerWeek([daily(1, "2026-10-20T10:00:00.000Z"), final, daily(6, "2026-10-25T10:00:00.000Z"), daily(3, "2026-10-24T10:00:00.000Z")]);
    expect(weeks.map((w) => [w.week, w.read.seq, w.openReads.map((r) => r.seq)])).toEqual([["2026-10-19", "5", ["6", "3", "1"]]]);
    const openOnly = latestPerWeek([daily(1, "2026-10-20T10:00:00.000Z"), daily(3, "2026-10-24T10:00:00.000Z")]);
    expect(openOnly.map((w) => [w.read.seq, w.openReads])).toEqual([["3", []]]);
  });

  it("counts a clean final read over a partial one, whichever came first", () => {
    const partial = (seq: number, at: string) =>
      stored(seq, snap("2026-10-19", { generatedAt: at, readErrors: ["users.closingPoll: could not be read."] }));
    const clean = (seq: number) => stored(seq, snap("2026-10-19", { generatedAt: "2026-10-27T10:00:00.000Z" }));
    expect(latestPerWeek([partial(1, "2026-10-26T10:00:00.000Z"), clean(2)])[0].read.seq).toBe("2");
    expect(latestPerWeek([clean(1), partial(2, "2026-10-28T10:00:00.000Z")])[0].read.seq).toBe("1");
    expect(latestPerWeek([partial(1, "2026-10-26T10:00:00.000Z"), partial(2, "2026-10-27T10:00:00.000Z")])[0].read.seq).toBe("2");
  });

  it("grades a clean final read that follows a partial one", () => {
    const partial = snap("2026-10-19", {
      generatedAt: "2026-10-26T10:00:00.000Z",
      patch: { reliability: { outboxFailedTerminal: null, watchdogPages: null, deadOutboxOpen: null } },
      readErrors: ["reliability: could not be read."],
    });
    const clean = snap("2026-10-19", { generatedAt: "2026-10-27T10:00:00.000Z", patch: { reliability: { outboxFailedTerminal: 3, watchdogPages: 25 } } });
    const latest = buildScorecard([stored(1, partial), stored(2, clean)], NOW).latest!;
    expect(latest).toMatchObject({ week: "2026-10-19", state: "final", readErrors: [] });
    expect(cardOf(latest.cards, "reliability")).toMatchObject({ graded: 2, met: 0, score: 0, letter: "F" });
  });

  it("headlines the newest closed week and keeps this week so far last in the history", () => {
    const scorecard = buildScorecard(
      [stored(1, snap("2026-10-12")), stored(2, snap("2026-10-26", { complete: false })), stored(3, snap("2026-10-19"))],
      NOW
    );
    expect(scorecard.latest).toMatchObject({ week: "2026-10-19", state: "final", recordedAt: "2026-11-02T15:00:00.000Z" });
    expect(scorecard.history.map((w) => [w.week, w.state])).toEqual([
      ["2026-10-12", "final"],
      ["2026-10-19", "final"],
      ["2026-10-26", "open"],
    ]);
    expect(scorecard.history[2].areas.flow).toBe(100);
    expect(scorecard.rubric).toBe(RUBRIC);
  });

  it("headlines the open week while no week has closed", () => {
    const scorecard = buildScorecard([stored(1, snap("2026-10-26", { complete: false }))], NOW);
    expect(scorecard.latest).toMatchObject({ week: "2026-10-26", state: "open", overall: 100, letter: "A" });
  });

  it("marks an ended week that never got a final read, and grades it from its newest open read", () => {
    const scorecard = buildScorecard(
      [
        stored(1, snap("2026-10-12", { complete: false, generatedAt: "2026-10-16T10:00:00.000Z" })),
        stored(2, snap("2026-10-12", { complete: false, generatedAt: "2026-10-18T10:00:00.000Z", patch: { flow: { stuck: 9 } } })),
        stored(3, snap("2026-10-19")),
        stored(4, snap("2026-10-26", { complete: false })),
      ],
      NOW
    );
    expect(scorecard.history.map((w) => [w.week, w.state])).toEqual([
      ["2026-10-12", "no-final-read"],
      ["2026-10-19", "final"],
      ["2026-10-26", "open"],
    ]);
    expect(scorecard.history[0]).toMatchObject({ generatedAt: "2026-10-18T10:00:00.000Z", areas: { flow: 67 } });
    expect(scorecard.latest!.week).toBe("2026-10-19");
    // Without a final read anywhere, an ended week still beats the open one for the headline.
    const noFinal = buildScorecard([stored(1, snap("2026-10-19", { complete: false, generatedAt: "2026-10-25T10:00:00.000Z" })), stored(2, snap("2026-10-26", { complete: false }))], NOW);
    expect(noFinal.latest).toMatchObject({ week: "2026-10-19", state: "no-final-read" });
  });

  it("keeps the week that just ended open for a day while its final read is pending, across the change from summer time", () => {
    const rows = [stored(1, snap("2026-10-19")), stored(2, snap("2026-10-26", { complete: false, generatedAt: "2026-11-01T10:00:00.000Z" }))];
    const at = (iso: string, more: StoredSnapshot[] = []) => buildScorecard([...rows, ...more], new Date(iso));
    const weekAt = (iso: string, more?: StoredSnapshot[]) => at(iso, more).history.find((w) => w.week === "2026-10-26");
    // Sunday 23:30 EST: the week runs to 05:00 UTC, an hour later than in summer time.
    expect(weekAt("2026-11-02T04:30:00.000Z")).toMatchObject({ state: "open", finalReadPending: false });
    // Monday 00:30 EST, and a minute before the daily pull at 10:00 UTC: ended, its final read pending.
    expect(weekAt("2026-11-02T05:30:00.000Z")).toMatchObject({ state: "open", finalReadPending: true });
    expect(weekAt("2026-11-02T09:59:00.000Z")).toMatchObject({ state: "open", finalReadPending: true });
    expect(at("2026-11-02T09:59:00.000Z").latest?.week).toBe("2026-10-19");
    // The pull at 10:00 UTC stores its final read.
    const final = stored(3, snap("2026-10-26", { generatedAt: "2026-11-02T10:00:00.000Z" }));
    expect(weekAt("2026-11-02T10:00:00.000Z", [final])).toMatchObject({ state: "final", finalReadPending: false });
    // A day after it ended without a final read, it has no final read.
    expect(weekAt("2026-11-03T04:59:59.999Z")).toMatchObject({ state: "open", finalReadPending: true });
    expect(weekAt("2026-11-03T05:00:00.000Z")).toMatchObject({ state: "no-final-read", finalReadPending: false });
  });

  it("keeps the headline on a week whose final read is pending, when no week is final yet", () => {
    // Launch: the only stored week has open reads. Monday's pull of it fails; this week's first read is stored.
    const lastWeek = stored(1, snap("2026-10-26", { complete: false, generatedAt: "2026-11-01T10:00:00.000Z" }));
    const thisWeek = stored(2, snap("2026-11-02", { complete: false, window: ["2026-11-02T05:00:00.000Z", "2026-11-09T05:00:00.000Z"], generatedAt: "2026-11-02T10:00:00.000Z" }));
    const headline = (iso: string, rows: StoredSnapshot[]) => buildScorecard(rows, new Date(iso)).latest;
    expect(headline("2026-11-02T09:00:00.000Z", [lastWeek])).toMatchObject({ week: "2026-10-26", finalReadPending: true });
    // Not this week's first read, then back again a day later.
    expect(headline("2026-11-02T10:05:00.000Z", [lastWeek, thisWeek])).toMatchObject({ week: "2026-10-26", finalReadPending: true });
    expect(headline("2026-11-03T05:01:00.000Z", [lastWeek, thisWeek])).toMatchObject({ week: "2026-10-26", state: "no-final-read" });
  });

  it("takes a closed week's point-in-time numbers from its newest open read that has them, and says so", () => {
    const saturday = snap("2026-10-19", { complete: false, generatedAt: "2026-10-24T10:00:00.000Z", patch: { flow: { stuck: 7, overClock: 3, waitingOnPlx: 9 } } });
    const sunday = snap("2026-10-19", {
      complete: false,
      generatedAt: "2026-10-25T10:00:00.000Z",
      patch: { flow: { filed: null, open: null, overClock: null, waitingOnPlx: null, stuck: null } },
      readErrors: ["flow: could not be read."],
    });
    const latest = buildScorecard([stored(1, saturday), stored(2, sunday), stored(3, snap("2026-10-19"))], NOW).latest!;
    expect(rowOf(latest.cards, "stuck")).toMatchObject({ value: 7, grade: "near", note: "As read Sat, Oct 24, before the week closed." });
    expect(rowOf(latest.cards, "over-clock")).toMatchObject({ value: 3, grade: "missed" });
    // Sunday's dead outbox count was read: the newest open read with a number wins.
    expect(rowOf(latest.cards, "dead-outbox-open")).toMatchObject({ value: 0, note: "As read Sun, Oct 25, before the week closed." });
    // Every point-in-time number was found, so Sunday's error is not the week's.
    expect(latest.readErrors).toEqual([]);
  });

  it("names the newest open read's errors when no open read has the number", () => {
    const sunday = snap("2026-10-19", {
      complete: false,
      generatedAt: "2026-10-25T10:00:00.000Z",
      patch: { flow: { filed: null, open: null, overClock: null, waitingOnPlx: null, stuck: null } },
      readErrors: ["flow: could not be read."],
    });
    const latest = buildScorecard([stored(1, sunday), stored(2, snap("2026-10-19"))], NOW).latest!;
    expect(rowOf(latest.cards, "stuck")).toMatchObject({ value: null, grade: "no-data", note: null });
    expect(cardOf(latest.cards, "flow")).toMatchObject({ graded: 0, score: null });
    expect(latest.readErrors).toEqual(["Sun, Oct 25 read: flow: could not be read."]);
    // Without any open read, there is nothing to name.
    const alone = buildScorecard([stored(2, snap("2026-10-19"))], NOW).latest!;
    expect(rowOf(alone.cards, "stuck")).toMatchObject({ value: null, grade: "no-data", note: null });
    expect(alone.readErrors).toEqual([]);
  });

  it("takes a count over the week from the final read only", () => {
    const lastOpen = snap("2026-10-19", { complete: false, generatedAt: "2026-10-25T10:00:00.000Z", patch: { flow: { filed: 9 } } });
    const final = snap("2026-10-19", { patch: { flow: { filed: null } }, readErrors: ["flow: could not be read."] });
    const cards = buildScorecard([stored(1, lastOpen), stored(2, final)], NOW).latest!.cards;
    expect(rowOf(cards, "filed")).toMatchObject({ value: null, note: null });
    expect(rowOf(cards, "stuck")).toMatchObject({ value: 2, note: "As read Sun, Oct 25, before the week closed." });
  });

  it("compares each row with the calendar week before, by direction", () => {
    const before = snap("2026-10-12", { patch: { outcomes: { pass: 6, fail: 3, stale: 1 } } });
    const scorecard = buildScorecard([stored(1, before), stored(2, snap("2026-10-19"))], NOW);
    const cards = scorecard.latest!.cards;
    expect(rowOf(cards, "pass-share")).toMatchObject({ value: 80, previous: 60, trend: "better" }); // higher, up
    expect(rowOf(cards, "fail-share")).toMatchObject({ value: 10, previous: 30, trend: "better" }); // lower, down
    expect(rowOf(cards, "stale-share")).toMatchObject({ previous: 10, trend: "same" });
    expect(rowOf(cards, "filed")).toMatchObject({ previous: 12, trend: null }); // a volume: no better or worse
    expect(scorecard.history[0].overall).toBeLessThan(scorecard.history[1].overall!);
  });

  it("has no previous week when the calendar week before is not stored", () => {
    const older = snap("2026-10-05", { patch: { outcomes: { pass: 6, fail: 4, stale: 0 } } });
    const cards = buildScorecard([stored(1, older), stored(2, snap("2026-10-19"))], NOW).latest!.cards;
    expect(rowOf(cards, "fail-share")).toMatchObject({ value: 10, previous: null, trend: null });
  });

  it("compares the newest round with the week before only for the trend", () => {
    // One round in both reads, over all its answers by each week's end: no round before it to fall from.
    const scorecard = buildScorecard(
      [stored(1, snap("2026-10-12", { patch: pulse(["October pulse", 4.2, 12]) })), stored(2, snap("2026-10-19", { patch: pulse(["October pulse", 3.4, 20]) }))],
      NOW
    );
    expect(rowOf(scorecard.latest!.cards, "pulse-average")).toMatchObject({ value: 3.4, basis: "October pulse, 20 answers", previous: 4.2, trend: "worse", note: null });
  });

  it("flags a fall to a new round, though nobody answered the round before it that week", () => {
    // One round a week: the read of the week October pulse opened still lists September pulse, over all its answers.
    const scorecard = buildScorecard(
      [
        stored(1, snap("2026-10-12", { patch: pulse(["September pulse", 4.2, 12]) })),
        stored(2, snap("2026-10-19", { patch: pulse(["September pulse", 4.2, 12], ["October pulse", 3.5, 8]) })),
      ],
      NOW
    );
    expect(rowOf(scorecard.latest!.cards, "pulse-average")).toMatchObject({ value: 3.5, note: "Down 0.7 from September pulse (4.2).", previous: 4.2, trend: "worse" });
  });

  it("compares with the old round's mean over all its answers, so its few late answers raise no false fall", () => {
    // September pulse's 3 late answers this week average 4.8; over all its 20 answers it is 4, under October pulse's 4.1.
    const week = gradeWeek(weekWith(snap("2026-10-19", { patch: pulse(["September pulse", 4, 20], ["October pulse", 4.1, 9]) })), null);
    expect(rowOf(week, "pulse-average")).toMatchObject({ value: 4.1, basis: "October pulse, 9 answers", note: null });
  });

  it("carries each week's read errors, and has no headline before the first read", () => {
    const scorecard = buildScorecard(
      [
        stored(1, snap("2026-10-19", { readErrors: ["users.pulse: could not be read."] })),
        stored(2, snap("2026-10-26", { complete: false, patch: { flow: null }, readErrors: ["flow: could not be read."] })),
      ],
      NOW
    );
    expect(scorecard.latest!.readErrors).toEqual(["users.pulse: could not be read."]);
    expect(scorecard.history.map((w) => w.readErrors)).toEqual([["users.pulse: could not be read."], ["flow: could not be read."]]);
    expect(buildScorecard([], NOW)).toEqual({ latest: null, history: [], rubric: RUBRIC });
  });
});

describe("the failed pull the screen names", () => {
  const failure = (week: string, at: string): PullFailure => ({ week, message: "The portal answered HTTP 503.", at });
  const storedAt = (recordedAt: string, week: string, opts: Opts): StoredSnapshot => ({ ...stored(1, snap(week, opts)), recordedAt });
  const partial = { readErrors: ["reliability: could not be read."] };

  it("answers a failure only with a later read of its own week", () => {
    const failed = failure("2026-10-19", "2026-10-26T10:00:00.700Z");
    const now = new Date("2026-10-27T12:00:00.000Z");
    // The same run stores this week's read after it: that answers nothing for last week.
    expect(unansweredPullFailure([failed], [storedAt("2026-10-26T10:00:01.400Z", "2026-10-26", { complete: false })], now)).toBe(failed);
    expect(unansweredPullFailure([failed], [storedAt("2026-10-26T09:00:00.000Z", "2026-10-19", partial)], now)).toBe(failed);
    expect(unansweredPullFailure([failed], [storedAt("2026-10-27T10:00:01.000Z", "2026-10-19", partial)], now)).toBeNull();
  });

  it("names the newest failure that no later read answers, past newer ones that are answered", () => {
    // Saturday's pull failed for both weeks. A re-run in the same hour stored this week's read; last week failed again, one row an hour.
    const older = failure("2026-10-19", "2026-10-31T10:00:00.000Z");
    const newer = failure("2026-10-26", "2026-10-31T10:00:01.000Z");
    const now = new Date("2026-10-31T11:00:00.000Z");
    expect(unansweredPullFailure([newer, older], [storedAt("2026-10-31T10:30:00.000Z", "2026-10-26", { complete: false })], now)).toBe(older);
    expect(unansweredPullFailure([], [], now)).toBeNull();
  });

  it("counts a week with its clean final read stored as answered: nothing is left to pull", () => {
    const failed = failure("2026-10-19", "2026-10-28T10:00:00.000Z");
    const now = new Date("2026-10-28T12:00:00.000Z");
    expect(unansweredPullFailure([failed], [storedAt("2026-10-26T10:00:00.000Z", "2026-10-19", {})], now)).toBeNull();
    expect(unansweredPullFailure([failed], [storedAt("2026-10-26T10:00:00.000Z", "2026-10-19", partial)], now)).toBe(failed);
  });

  it("names a failure only while the daily pull still reads its week, in Toronto weeks", () => {
    // The pull stops reading the week of Oct 19 at Monday 00:00 Toronto: 05:00 UTC once summer time has ended, not 04:00.
    const failed = failure("2026-10-19", "2026-11-01T10:00:00.000Z");
    expect(unansweredPullFailure([failed], [], new Date("2026-11-02T04:30:00.000Z"))).toBe(failed);
    expect(unansweredPullFailure([failed], [], new Date("2026-11-02T05:00:00.000Z"))).toBeNull();
  });
});
