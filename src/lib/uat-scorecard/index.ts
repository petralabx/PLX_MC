// UAT scorecard (TASK-4196, for TASK-3712): grades the portal's weekly numbers
// for the UAT fix loop (plx-uat-scorecard/v1) against the team's targets, one
// card per area, week by week. The portal measures and Mission Control grades,
// so a target changes here without a portal deploy. The daily UAT check
// (GET /api/cron/uat-drift) pulls last week's final numbers and this week so
// far. Client-safe, with no runtime imports: the payload's zod schema is
// ./schema.ts and the server-only store and pull are ./store.ts, each imported
// separately (module contract: docs/modules/uat-scorecard/README.md).

import type { Grade, Letter, Trend } from "@/lib/ci-scorecard";

import type { Snapshot } from "./schema";

export type { Grade, Letter, Trend } from "@/lib/ci-scorecard";
export type { Snapshot } from "./schema";

/** The mc_events kind of one stored read of a week. */
export const SNAPSHOT_EVENT_KIND = "uat.scorecard.snapshot";

/** The portal's weeks run Monday to Sunday here, and speed counts its business days. */
export const TIME_ZONE = "America/Toronto";

/** The weekly UAT loop health readout this scorecard automates (UFL-24). */
export const PARENT_TASK = "TASK-3712";

/** One stored read, as the store reads it back. */
export interface StoredSnapshot {
  seq: string;
  recordedAt: string;
  snapshot: Snapshot;
}

const HOUR_MS = 3_600_000;

/** An instant in UTC, so the offset the portal writes cannot change a key. */
const utc = (at: string) => new Date(at).toISOString();

/** The hour an instant falls in, in UTC. */
export function truncateToHour(at: string): string {
  return new Date(Math.floor(Date.parse(at) / HOUR_MS) * HOUR_MS).toISOString();
}

/** A clean final read: the week had closed, and every section was read. */
export function isCleanFinalRead(snapshot: Snapshot): boolean {
  return snapshot.window.complete && snapshot.readErrors.length === 0;
}

/**
 * The dedup key, in two forms that never meet. A clean final read keys on its
 * week (`<start>|final`), so a replay is a no-op. Any other read (an open
 * week, or a closed week with read errors) keys on the hour it was read
 * (`<start>|read:<hour>`), so each daily read appends, and a clean final read
 * can still follow a partial one, even one read in the hour the week closed.
 * recordSnapshot drops a partial re-read of a week whose clean final read is
 * stored: it could never be shown.
 */
export function snapshotDedupKey(snapshot: Snapshot): string {
  if (isCleanFinalRead(snapshot)) return finalReadKey(snapshot);
  return `uat-scorecard:${utc(snapshot.window.start)}|read:${truncateToHour(snapshot.generatedAt)}`;
}

/** The key of the week's clean final read, for any read of the week. */
export function finalReadKey(snapshot: Snapshot): string {
  return `uat-scorecard:${utc(snapshot.window.start)}|final`;
}

// ─── Weeks (Toronto) ─────────────────────────────────────────────────────────

const TORONTO_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Toronto calendar date of an instant, YYYY-MM-DD. */
export function torontoDate(at: Date | string): string {
  const parts = Object.fromEntries(TORONTO_DAY.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Monday (Toronto) that starts the week of an instant: the portal's `week`. */
export function weekOf(at: Date | string): string {
  const day = torontoDate(at);
  const [y, m, d] = day.split("-").map(Number);
  return addDays(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
}

/** The weeks the daily pull reads as of `now`: last week, which has closed, then this week so far. */
export function pulledWeeks(now: Date): [lastWeek: string, thisWeek: string] {
  const thisWeek = weekOf(now);
  return [addDays(thisWeek, -7), thisWeek];
}

// ─── The rubric ──────────────────────────────────────────────────────────────

export type Area = "outcomes" | "speed" | "flow" | "users" | "reliability";

export const AREAS: readonly { id: Area; label: string }[] = [
  { id: "outcomes", label: "Outcomes" },
  { id: "speed", label: "Speed" },
  { id: "flow", label: "Flow" },
  { id: "users", label: "Users" },
  { id: "reliability", label: "Reliability" },
];

/** `days` are Toronto business days; `score` is a 1 to 5 average. */
export type Unit = "percent" | "days" | "count" | "score";
export type Direction = "lower" | "higher";

/** Decimals each unit shows. Scores and days keep two, so 3.95 never shows as the 4 it missed. */
export const DECIMALS: Readonly<Record<Unit, number>> = { percent: 1, days: 2, count: 0, score: 2 };

/** A value at the precision the screen shows it: the number that is graded, compared and noted, so the screen and the grade agree. */
export function shownValue(value: number, unit: Unit): number {
  return Number(value.toFixed(DECIMALS[unit]));
}

export interface Reading {
  value: number | null;
  /** What the number is out of, e.g. "7 of 10 verdicts". */
  basis?: string;
  /** Why the number reads differently this week, when it does. */
  note?: string;
}

export interface MetricDef {
  id: string;
  area: Area;
  label: string;
  unit: Unit;
  /** Which way is better. Absent for a volume, where neither is. */
  direction?: Direction;
  /** Absent: shown for context and not graded. */
  target?: number;
  /** Higher is better only: the lowest value still near. Lower is better: near is target × NEAR_FACTOR. */
  nearFloor?: number;
  /** Read when the portal ran, not over the week: a closed week takes it from its open reads. */
  pointInTime?: true;
  /** What the number is and where the payload puts it. */
  detail: string;
  read: (snapshot: Snapshot) => Reading;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A share of `whole`, in percent; no number without a whole above 0. */
function share(part: number | null, whole: number | null, of: string): Reading {
  if (part === null || whole === null || whole <= 0) return { value: null };
  return { value: (100 * part) / whole, basis: `${part} of ${whole} ${of}` };
}

function median(m: { p50: number | null; n: number | null }): Reading {
  return { value: m.p50, basis: m.n ? plural(m.n, "ticket") : undefined };
}

/** A pulse average this far or more below the round before is flagged. */
export const PULSE_DROP_FLAG = 0.5;

/**
 * The last scored round listed: the mean of its score questions, flagged when
 * it is PULSE_DROP_FLAG or more below the scored round before it. The portal
 * lists the newest two scored rounds opened before the week ended, oldest
 * first, each over all its answers by then, so the round before is listed even
 * when nobody answered it that week. Each mean and the fall are as shown.
 */
function latestPulse(rounds: Snapshot["users"]["pulse"]): Reading {
  const scored = (rounds ?? []).flatMap((round) => {
    const scores = round.questions.map((q) => q.average).filter((a): a is number => a !== null);
    return scores.length > 0 ? [{ round, mean: shownValue(scores.reduce((a, b) => a + b, 0) / scores.length, "score") }] : [];
  });
  const latest = scored.at(-1);
  if (!latest) return { value: null };
  const before = scored.at(-2);
  // As shown, 2.3 − 1.8 (0.4999… in floating point) is the fall of 0.5.
  const fall = before ? shownValue(before.mean - latest.mean, "score") : 0;
  const answers = latest.round.responses === null ? "" : `, ${plural(latest.round.responses, "answer")}`;
  return {
    value: latest.mean,
    basis: `${latest.round.title}${answers}`,
    note: before && fall >= PULSE_DROP_FLAG ? `Down ${fall} from ${before.round.title} (${before.mean}).` : undefined,
  };
}

function holder(key: "plx" | "agent" | "pipeline" | "submitter", label: string, target: number, where: string): MetricDef {
  return {
    id: `hold-${key}`,
    area: "speed",
    label,
    unit: "days",
    direction: "lower",
    target,
    detail: `Median business days a ticket sat ${where}, by the portal's custody model (the staff board's holder clocks), over this week's PASS tickets (speed.holders.${key}).`,
    read: (s) => median(s.speed.holders[key]),
  };
}

// The default targets of the TASK-4196 design (2026-10-30). The team adjusts
// them here, and a change regrades every stored week.
export const METRICS: readonly MetricDef[] = [
  {
    id: "pass-share",
    area: "outcomes",
    label: "PASS share of verdicts",
    unit: "percent",
    direction: "higher",
    target: 70,
    nearFloor: 60,
    detail: "Re-test results this week that were PASS, out of PASS, FAIL and STALE (outcomes.pass / outcomes.verdicts).",
    read: (s) => share(s.outcomes.pass, s.outcomes.verdicts, "verdicts"),
  },
  {
    id: "fail-share",
    area: "outcomes",
    label: "FAIL share of verdicts",
    unit: "percent",
    direction: "lower",
    target: 20,
    detail: "Re-test results this week that were FAIL (outcomes.fail / outcomes.verdicts).",
    read: (s) => share(s.outcomes.fail, s.outcomes.verdicts, "verdicts"),
  },
  {
    id: "stale-share",
    area: "outcomes",
    label: "STALE share of verdicts",
    unit: "percent",
    direction: "lower",
    target: 10,
    detail:
      "Re-tests nobody answered in time (outcomes.stale / outcomes.verdicts). Until STALE ships, a RETEST_FAILED set by the stall SLA counts here, not as FAIL.",
    read: (s) => {
      const reading = share(s.outcomes.stale, s.outcomes.verdicts, "verdicts");
      const legacy = s.outcomes.legacyStallExpiries ?? 0;
      return legacy > 0 ? { ...reading, note: `Includes ${plural(legacy, "legacy stall expiry", "legacy stall expiries")}.` } : reading;
    },
  },
  {
    id: "pass-within-5bd",
    area: "outcomes",
    label: "PASS within 5 business days of filing",
    unit: "percent",
    direction: "higher",
    target: 60,
    nearFloor: 50,
    detail: "PASS verdicts whose ticket was filed at most 5 business days earlier, out of all PASS (outcomes.passWithin5bdOfFiling).",
    read: (s) => share(s.outcomes.passWithin5bdOfFiling, s.outcomes.pass, "PASS"),
  },
  {
    id: "first-attempt-pass",
    area: "outcomes",
    label: "PASS on the first attempt",
    unit: "percent",
    direction: "higher",
    target: 70,
    nearFloor: 60,
    detail:
      "PASS verdicts on run attempt 1, out of the PASS verdicts on a ticket with an agent run (outcomes.firstAttemptPass / (pass − passWithoutRun)). A legacy PASS with no run is left out.",
    read: (s) => {
      const { firstAttemptPass, pass, passWithoutRun } = s.outcomes;
      const withRun = pass === null || passWithoutRun === null ? null : pass - (passWithoutRun ?? 0);
      if (firstAttemptPass !== null && withRun !== null && firstAttemptPass > withRun) {
        return { value: null, note: "The portal counted more first-attempt PASS than PASS with a run." };
      }
      return share(firstAttemptPass, withRun, "PASS with a run");
    },
  },
  {
    id: "reopened",
    area: "outcomes",
    label: "Tickets reopened",
    unit: "count",
    direction: "lower",
    detail: "Tickets moved to REOPENED this week (outcomes.reopened). Shown for context, with no target yet.",
    read: (s) => ({ value: s.outcomes.reopened }),
  },
  {
    id: "filed-to-pass-p50",
    area: "speed",
    label: "Filed to PASS, median",
    unit: "days",
    direction: "lower",
    target: 5,
    detail: "Business days from filing to PASS, over the tickets that got a PASS this week (speed.filedToPass).",
    read: (s) => median(s.speed.filedToPass),
  },
  {
    id: "filed-to-pass-p90",
    area: "speed",
    label: "Filed to PASS, p90",
    unit: "days",
    direction: "lower",
    detail: "The same time at the 90th percentile. Shown for context, with no target yet.",
    read: (s) => ({ value: s.speed.filedToPass.p90 }),
  },
  holder("plx", "PLX hold, median", 1, "with PLX"),
  holder("agent", "Agent hold, median", 1, "with an agent"),
  holder("pipeline", "Pipeline hold, median", 0.5, "in the pipeline"),
  holder("submitter", "Submitter hold, median", 3, "with the person who filed it"),
  {
    id: "filed",
    area: "flow",
    label: "Tickets filed",
    unit: "count",
    detail: "Tickets filed this week (flow.filed). A volume, so neither more nor fewer is better.",
    read: (s) => ({ value: s.flow?.filed ?? null }),
  },
  {
    id: "open",
    area: "flow",
    label: "Open tickets",
    unit: "count",
    direction: "lower",
    pointInTime: true,
    detail: "Open tickets when the portal read the week (flow.open). Shown for context, with no target yet.",
    read: (s) => ({ value: s.flow?.open ?? null }),
  },
  {
    id: "over-clock",
    area: "flow",
    label: "Open tickets over their clock",
    unit: "count",
    direction: "lower",
    target: 0,
    pointInTime: true,
    detail: "Open tickets past their holder's clock when the portal read the week (flow.overClock).",
    read: (s) => ({ value: s.flow?.overClock ?? null }),
  },
  {
    id: "stuck",
    area: "flow",
    label: "Stuck tickets",
    unit: "count",
    direction: "lower",
    target: 5,
    pointInTime: true,
    detail: "Open tickets in at least one UFL-0b stuck category, each counted once (flow.stuck).",
    read: (s) => ({ value: s.flow?.stuck ?? null }),
  },
  {
    id: "waiting-on-plx",
    area: "flow",
    label: "Waiting on PLX",
    unit: "count",
    direction: "lower",
    target: 5,
    pointInTime: true,
    detail: "Open tickets waiting on PLX when the portal read the week (flow.waitingOnPlx).",
    read: (s) => ({ value: s.flow?.waitingOnPlx ?? null }),
  },
  {
    id: "poll-average",
    area: "users",
    label: "Closing poll average",
    unit: "score",
    direction: "higher",
    target: 4,
    nearFloor: 3.5,
    detail: "Average answer, 1 to 5, to the closing poll “How did getting this fixed go?” this week (users.closingPoll, UFL-23).",
    read: (s) => {
      const { average, responses } = s.users.closingPoll;
      return { value: average, basis: responses ? plural(responses, "answer") : undefined };
    },
  },
  {
    id: "poll-response-rate",
    area: "users",
    label: "Closing poll response rate",
    unit: "percent",
    direction: "higher",
    target: 30,
    nearFloor: 20,
    detail:
      "Closing poll answers this week as a share of the tickets closed this week, RESOLVED or REJECTED, whose submitter can answer the poll: signed in, and not rejected at identity review (users.closingPoll.responses / outcomes.closedPollable). The poll is offered when a ticket closes or escalates to a developer.",
    read: (s) => {
      const { responses } = s.users.closingPoll;
      const closed = s.outcomes.closedPollable ?? null;
      if (responses === null || closed === null || closed === 0) return { value: null };
      const basis = `${plural(responses, "answer")} for ${plural(closed, "closed ticket")} that can answer`;
      if (responses > closed) return { value: 100, basis, note: "Over 100%: escalated tickets also get the poll." };
      return { value: (100 * responses) / closed, basis };
    },
  },
  {
    id: "low-without-follow-up",
    area: "users",
    label: "Low scores without a follow-up",
    unit: "count",
    direction: "lower",
    target: 0,
    detail: "Low closing poll scores this week with no follow-up by the end of the week (users.closingPoll.low − lowWithFollowUp).",
    read: (s) => {
      const { low, lowWithFollowUp } = s.users.closingPoll;
      if (low === null || lowWithFollowUp === null) return { value: null };
      if (lowWithFollowUp > low) return { value: null, note: "The portal counted more follow-ups than low scores." };
      return { value: low - lowWithFollowUp, basis: `of ${plural(low, "low score")}` };
    },
  },
  {
    id: "pulse-average",
    area: "users",
    label: "Pulse average, latest round",
    unit: "score",
    direction: "higher",
    target: 3.5,
    nearFloor: 3,
    detail:
      "Mean of the score questions, 1 to 5, over every answer to the newest pulse round opened before the week ended (users.pulse). A fall of 0.5 or more from the round before it is flagged.",
    read: (s) => latestPulse(s.users.pulse),
  },
  {
    id: "outbox-failed-terminal",
    area: "reliability",
    label: "Outbox rows failed for good",
    unit: "count",
    direction: "lower",
    target: 0,
    detail: "Every outbox row that reached FAILED_TERMINAL this week, of any kind (reliability.outboxFailedTerminal).",
    read: (s) => ({ value: s.reliability.outboxFailedTerminal }),
  },
  {
    id: "watchdog-pages",
    area: "reliability",
    label: "Watchdog pages",
    unit: "count",
    direction: "lower",
    target: 10,
    detail: "Watchdog pages created this week (reliability.watchdogPages).",
    read: (s) => ({ value: s.reliability.watchdogPages }),
  },
  {
    id: "dead-outbox-open",
    area: "reliability",
    label: "Dead outbox rows open",
    unit: "count",
    direction: "lower",
    pointInTime: true,
    detail: "Dead outbox rows still open when the portal read the week (reliability.deadOutboxOpen). Shown for context, with no target yet.",
    read: (s) => ({ value: s.reliability.deadOutboxOpen }),
  },
];

// ─── Grading ─────────────────────────────────────────────────────────────────
// The points, bands and near factor are ci-scorecard's (tests pin the parity),
// kept here so this file stays free of runtime imports.

/** Lower is better: a value within this factor of a non-zero target is near. A target of 0 has no near band. */
export const NEAR_FACTOR = 1.5;

/** Decimals a target or a near band shows, for every unit: a count's band of 7.5 stays 7.5. */
export const BOUND_DECIMALS = 2;

const POINTS = { met: 1, near: 0.5, missed: 0 } as const;
type Scored = keyof typeof POINTS;

type Goal = Pick<MetricDef, "direction" | "target" | "nearFloor">;

/** The near bound: the ceiling when lower is better, the floor when higher is; null when there is no near band. */
export function nearOf(goal: Goal): number | null {
  if (goal.target === undefined || goal.direction === undefined) return null;
  if (goal.direction === "higher") return goal.nearFloor ?? null;
  // Graded as it shows: 0.3 × 1.5 is 0.44999… in floating point, shown as 0.45.
  return goal.target > 0 ? Number((goal.target * NEAR_FACTOR).toFixed(BOUND_DECIMALS)) : null;
}

export function gradeValue(value: number | null, goal: Goal): Grade {
  if (goal.target === undefined || goal.direction === undefined) return "no-target";
  if (value === null || !Number.isFinite(value)) return "no-data";
  const near = nearOf(goal);
  if (goal.direction === "lower") {
    if (value <= goal.target) return "met";
    return near !== null && value <= near ? "near" : "missed";
  }
  if (value >= goal.target) return "met";
  return near !== null && value >= near ? "near" : "missed";
}

function isScored(grade: Grade): grade is Scored {
  return grade === "met" || grade === "near" || grade === "missed";
}

/** 0 to 100: met counts 1, near counts half, missed 0. Null when nothing was graded. */
export function scoreOf(grades: readonly Grade[]): number | null {
  const scored = grades.filter(isScored);
  if (scored.length === 0) return null;
  return Math.round((100 * scored.reduce((n, g) => n + POINTS[g], 0)) / scored.length);
}

/** The usual 90 / 80 / 70 / 60 bands. */
export function letterOf(score: number | null): Letter | null {
  if (score === null) return null;
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ─── The scorecard model the screen renders ──────────────────────────────────

export interface RubricEntry {
  id: string;
  area: Area;
  label: string;
  unit: Unit;
  direction: Direction | null;
  target: number | null;
  near: number | null;
  detail: string;
}

export const RUBRIC: readonly RubricEntry[] = METRICS.map((m) => ({
  id: m.id,
  area: m.area,
  label: m.label,
  unit: m.unit,
  direction: m.direction ?? null,
  target: m.target ?? null,
  near: nearOf(m),
  detail: m.detail,
}));

export interface MetricRow extends RubricEntry {
  value: number | null;
  basis: string | null;
  note: string | null;
  grade: Grade;
  /** The value in the calendar week before, when it is stored, and which way this week moved from it. */
  previous: number | null;
  trend: Trend | null;
}

export interface Card {
  id: Area;
  label: string;
  score: number | null;
  letter: Letter | null;
  met: number;
  graded: number;
  metrics: MetricRow[];
}

/** One week: the read that counts and, once it closed, its open reads. */
export interface StoredWeek {
  /** The Monday (Toronto) that starts it, YYYY-MM-DD. */
  week: string;
  /** The newest clean final read, else the newest final read, else the newest open read. */
  read: StoredSnapshot;
  /** A closed week's reads from while it was open, newest first: its point-in-time numbers. */
  openReads: StoredSnapshot[];
}

/** An ended week waits this long for its first final read: the daily pull takes it at 10:00 UTC, 5 to 6 hours after Toronto midnight. */
export const FINAL_READ_GRACE_MS = 24 * HOUR_MS;

/** final: read after it closed. open: still running, or it ended under FINAL_READ_GRACE_MS ago and its final read is pending. no-final-read: it ended longer ago with open reads only. */
export type WeekState = "final" | "open" | "no-final-read";

export interface WeekScore {
  week: string;
  windowStart: string;
  windowEnd: string;
  state: WeekState;
  /** An open week that has ended: the daily pull has not stored its final read yet. */
  finalReadPending: boolean;
  /** When the portal computed the read that counts. */
  generatedAt: string;
  /** Sections the portal could not read, so their numbers show no data. */
  readErrors: string[];
  overall: number | null;
  areas: Record<Area, number | null>;
}

export interface WeekView extends WeekScore {
  recordedAt: string;
  letter: Letter | null;
  cards: Card[];
}

export interface Scorecard {
  /** The newest final week, else the newest ended week without one (lost, or pending), else this week so far. */
  latest: WeekView | null;
  /** Every stored week, oldest first, the open weeks last: one that ended with its final read pending, then this week so far. */
  history: WeekScore[];
  rubric: readonly RubricEntry[];
}

/** A daily pull of one week that failed (mc_events uat.scorecard.pull_failed). */
export interface PullFailure {
  week: string;
  message: string;
  at: string;
}

/** Where the numbers come from, for the screen's states (GET /api/uat-scorecard). */
export interface ScorecardSource {
  /** PLX_MC_UAT_PORTAL_READ_ENABLED. */
  portalRead: boolean;
  /** The daily UAT check runs: CRON_SECRET and PLX_MC_UAT_DRIFT_CRON_ENABLED. */
  dailyCheck: boolean;
  /** PLX_MC_PORTAL_BASE_URL: the host of the read and of the portal links. */
  portalOrigin: string;
  /** The newest failed pull of a week the daily pull still reads that no later read of its own week answers (unansweredPullFailure); null while the portal read or the daily check is off. */
  lastPullFailure: PullFailure | null;
}

export type ScorecardResponse = Scorecard & { source: ScorecardSource };

/**
 * The newest failed pull of a week the daily pull still reads as of `now`
 * (pulledWeeks) that no later stored read of its own week answers; `failures`
 * newest first, as the store lists them. A read of another week answers
 * nothing: the daily pull reads last week, then this week. A week with its
 * clean final read stored has nothing left to pull, so a failed re-read of it
 * is answered too. Once a week leaves the pull, its failure is not named: its
 * no-final-read state says what happened.
 */
export function unansweredPullFailure(
  failures: readonly PullFailure[],
  snapshots: readonly StoredSnapshot[],
  now: Date
): PullFailure | null {
  const pulled = new Set(pulledWeeks(now));
  const newestRead = new Map<string, number>();
  const settled = new Set<string>();
  for (const { recordedAt, snapshot } of snapshots) {
    const week = weekOf(snapshot.window.start);
    newestRead.set(week, Math.max(newestRead.get(week) ?? -Infinity, Date.parse(recordedAt)));
    if (isCleanFinalRead(snapshot)) settled.add(week);
  }
  const answered = (f: PullFailure) => settled.has(f.week) || (newestRead.get(f.week) ?? -Infinity) > Date.parse(f.at);
  return failures.find((f) => pulled.has(f.week) && !answered(f)) ?? null;
}

const bySeqDesc = (a: StoredSnapshot, b: StoredSnapshot) => Number(b.seq) - Number(a.seq);

/**
 * One entry per week, oldest first. A clean final read beats a partial one,
 * newer or older, and any final read beats the open reads.
 */
export function latestPerWeek(snapshots: readonly StoredSnapshot[]): StoredWeek[] {
  const byWeek = new Map<string, StoredSnapshot[]>();
  for (const s of snapshots) {
    const week = weekOf(s.snapshot.window.start);
    const rows = byWeek.get(week);
    if (rows) rows.push(s);
    else byWeek.set(week, [s]);
  }
  const weeks: StoredWeek[] = [];
  for (const [week, rows] of byWeek) {
    const newestFirst = [...rows].sort(bySeqDesc);
    const final = newestFirst.find((r) => isCleanFinalRead(r.snapshot)) ?? newestFirst.find((r) => r.snapshot.window.complete);
    const open = newestFirst.filter((r) => !r.snapshot.window.complete);
    weeks.push(final ? { week, read: final, openReads: open } : { week, read: open[0], openReads: [] });
  }
  return weeks.sort((a, b) => a.week.localeCompare(b.week));
}

const READ_DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TIME_ZONE });
const readDay = (snapshot: Snapshot) => READ_DAY.format(new Date(snapshot.generatedAt));

/** A metric's reading for a week: a closed week takes a point-in-time number from its newest open read that has it. */
function readWeek(def: MetricDef, week: StoredWeek): Reading {
  const reading = def.read(week.read.snapshot);
  if (!def.pointInTime || reading.value !== null) return reading;
  for (const open of week.openReads) {
    const earlier = def.read(open.snapshot);
    if (earlier.value !== null) return { ...earlier, note: `As read ${readDay(open.snapshot)}, before the week closed.` };
  }
  return reading;
}

/** The week's read errors, and, when a point-in-time number has no open read to come from, its newest open read's. */
function weekErrors(week: StoredWeek): string[] {
  const errors = [...week.read.snapshot.readErrors];
  const newestOpen = week.openReads[0];
  if (newestOpen && METRICS.some((def) => def.pointInTime && readWeek(def, week).value === null)) {
    errors.push(...newestOpen.snapshot.readErrors.map((e) => `${readDay(newestOpen.snapshot)} read: ${e}`));
  }
  return errors;
}

function trendOf(value: number | null, previous: number | null, direction: Direction | undefined): Trend | null {
  if (value === null || previous === null || direction === undefined) return null;
  if (value === previous) return "same";
  return (value < previous) === (direction === "lower") ? "better" : "worse";
}

function row(def: MetricDef, entry: RubricEntry, week: StoredWeek, previous: StoredWeek | null): MetricRow {
  // Graded and compared as shown, so the number on screen and its grade agree.
  const shown = (r: Reading) => (r.value === null ? null : shownValue(r.value, def.unit));
  const reading = readWeek(def, week);
  const value = shown(reading);
  const prev = previous ? shown(readWeek(def, previous)) : null;
  return {
    ...entry,
    value,
    basis: reading.basis ?? null,
    note: reading.note ?? null,
    grade: gradeValue(value, def),
    previous: prev,
    trend: trendOf(value, prev, def.direction),
  };
}

/** Every card of one week, each row compared with `previous`. */
export function gradeWeek(week: StoredWeek, previous: StoredWeek | null): Card[] {
  return AREAS.map(({ id, label }) => {
    const metrics = METRICS.flatMap((def, i) => (def.area === id ? [row(def, RUBRIC[i], week, previous)] : []));
    const grades = metrics.map((m) => m.grade);
    const score = scoreOf(grades);
    return {
      id,
      label,
      score,
      letter: letterOf(score),
      met: grades.filter((g) => g === "met").length,
      graded: grades.filter(isScored).length,
      metrics,
    };
  });
}

function weekScore(week: StoredWeek, cards: readonly Card[], now: Date): WeekScore {
  const { window, generatedAt } = week.read.snapshot;
  const sinceEnd = now.getTime() - Date.parse(window.end);
  return {
    week: week.week,
    windowStart: window.start,
    windowEnd: window.end,
    state: window.complete ? "final" : sinceEnd < FINAL_READ_GRACE_MS ? "open" : "no-final-read",
    finalReadPending: !window.complete && sinceEnd >= 0 && sinceEnd < FINAL_READ_GRACE_MS,
    generatedAt,
    readErrors: weekErrors(week),
    overall: scoreOf(cards.flatMap((c) => c.metrics.map((m) => m.grade))),
    areas: Object.fromEntries(cards.map((c) => [c.id, c.score])) as Record<Area, number | null>,
  };
}

/** The scorecard as of `now`, which tells an ended week from the open one. */
export function buildScorecard(snapshots: readonly StoredSnapshot[], now: Date): Scorecard {
  const weeks = latestPerWeek(snapshots);
  const stored = new Map(weeks.map((w) => [w.week, w]));
  const graded = weeks.map((week) => {
    // Compared only with the calendar week before: after a gap there is no previous value.
    const cards = gradeWeek(week, stored.get(addDays(week.week, -7)) ?? null);
    return { week, cards, score: weekScore(week, cards, now) };
  });
  // A week waiting for its final read ranks with the weeks that have none, so the headline stays on it.
  const shown =
    graded.findLast((g) => g.score.state === "final") ??
    graded.findLast((g) => g.score.state === "no-final-read" || g.score.finalReadPending) ??
    graded.at(-1);
  return {
    latest: shown
      ? { ...shown.score, recordedAt: shown.week.read.recordedAt, letter: letterOf(shown.score.overall), cards: shown.cards }
      : null,
    history: graded.map((g) => g.score),
    rubric: RUBRIC,
  };
}
