// CI scorecard (TASK-3913): grades the weekly CI metrics against the targets of
// the 2026-10 CI redesign (agentic-swarm docs/ci-redesign-2026-10.md, section
// 3.6), per repo and for the fleet, week by week. The numbers come from
// agentic-swarm's scripts/ci-audit/weekly_metrics.py, which the Monday CI
// metrics task posts to POST /api/cursor/ci-scorecard. Client-safe, with no
// runtime imports: the snapshot's zod schema is ./schema.ts and the server-only
// store is ./store.ts, each imported separately (module contract:
// docs/modules/ci-scorecard/README.md).

import type { RepoSnapshot, Snapshot } from "./schema";

export type { RepoSnapshot, Snapshot } from "./schema";

/** The mc_events kind of one weekly snapshot. */
export const SNAPSHOT_EVENT_KIND = "ci.scorecard.snapshot";

/** The portal: some targets are its own, and only it has a merge queue today. */
export const PORTAL_REPO = "plx-customer-portal";

/** The repos weekly_metrics.py reads, in the order the screen shows them. */
export const SCORECARD_REPOS = [PORTAL_REPO, "PLX_MC", "agentic-swarm"] as const;

export type Phase = 1 | 2;

/**
 * The rollout phase whose targets grade a week. Phase 1 of the one org ruleset
 * is current (2026-10-25). Set 2 when Vince imports phase 2.
 */
export const CURRENT_PHASE: Phase = 1;

/** One stored snapshot, as the store reads it back. */
export interface StoredSnapshot {
  seq: string;
  recordedAt: string;
  snapshot: Snapshot;
}

/** The dedup key: a replay of the same window is a no-op; a new run of a week appends and wins. */
export function snapshotDedupKey(snapshot: Snapshot): string {
  return `ci-scorecard:${snapshot.window.start}|${snapshot.window.end}`;
}

// ─── The rubric ──────────────────────────────────────────────────────────────

export type Unit = "hours" | "minutes" | "percent" | "count";

/** Every target is an upper bound: lower is better. */
export type Targets = Partial<Record<Phase, number>>;

export interface Reading {
  value: number | null;
  /** Why the number reads differently this week, when it does. */
  note?: string;
}

interface MetricBase {
  id: string;
  label: string;
  unit: Unit;
  /** What the number is and where weekly_metrics.py puts it. */
  detail: string;
}

export interface RepoMetricDef extends MetricBase {
  /** The repos it applies to; all of them when absent. */
  repos?: readonly string[];
  targets: (repo: string) => Targets;
  read: (repo: RepoSnapshot) => Reading;
}

export interface FleetMetricDef extends MetricBase {
  targets: Targets;
  read: (snapshot: Snapshot) => Reading;
}

const portalOnly = (portal: Targets, others: Targets = {}) => (repo: string) => (repo === PORTAL_REPO ? portal : others);

function percentOf({ n, failed }: { n: number; failed: number }): Reading {
  return { value: n > 0 ? (100 * failed) / n : null };
}

// Targets from the report's success criteria. Phase 2 keeps each phase 1
// target that it does not tighten.
export const REPO_METRICS: readonly RepoMetricDef[] = [
  {
    id: "open-to-merge-p50",
    label: "Open to merge, median",
    unit: "hours",
    detail: "Hours from a PR's opening to its merge, Dependabot excluded (open_to_merge_hours).",
    targets: portalOnly({ 1: 1, 2: 0.75 }),
    read: (r) => ({ value: r.open_to_merge_hours.p50 }),
  },
  {
    id: "open-to-merge-p90",
    label: "Open to merge, p90",
    unit: "hours",
    detail: "The same time at the 90th percentile.",
    targets: portalOnly({ 1: 8, 2: 4 }, { 2: 4 }),
    read: (r) => ({ value: r.open_to_merge_hours.p90 }),
  },
  {
    id: "landing-wait-p90",
    label: "Landing wait, p90",
    unit: "minutes",
    detail:
      "Minutes from every required check passing to the merge, or for the portal to joining the merge queue. Dependabot excluded.",
    targets: () => ({ 1: 30, 2: 30 }),
    read: (r) =>
      r.landing_wait_minutes_non_dependabot
        ? { value: r.landing_wait_minutes_non_dependabot.p90 }
        : { value: r.landing_wait_minutes.p90, note: "Includes Dependabot PRs: this week's snapshot does not split them." },
  },
  {
    id: "compliance-first-fail",
    label: "Compliance fails on the first try",
    unit: "percent",
    detail: "Share of PR compliance runs whose first attempt failed (runs.compliance_first_attempt).",
    targets: portalOnly({ 1: 8, 2: 8 }),
    read: (r) => percentOf(r.runs.compliance_first_attempt),
  },
  {
    id: "ci-first-fail",
    label: "PR CI fails on the first try",
    unit: "percent",
    detail: "Share of PR CI runs whose first attempt failed (runs.pr_ci_first_attempt).",
    targets: () => ({ 2: 5 }),
    read: (r) => percentOf(r.runs.pr_ci_first_attempt),
  },
  {
    id: "rerun-pass",
    label: "Runs that passed only on a re-run",
    unit: "percent",
    detail: "Workflow runs that passed on attempt 2 or later, as a share of all runs: the flaky-test signal.",
    targets: () => ({ 2: 1 }),
    read: (r) => ({ value: r.runs.runs > 0 ? (100 * r.runs.passed_on_rerun) / r.runs.runs : null }),
  },
  {
    id: "bypass-merges",
    label: "Bypass merges",
    unit: "count",
    detail:
      "Merges that bypassed a ruleset (rule-suite insights). A logged break-glass merge counts too. Until cip-only-merge was disabled on 2026-10-25, every CIP merge in PLX_MC and agentic-swarm logged as one.",
    targets: () => ({ 1: 0, 2: 0 }),
    read: (r) => ({ value: r.bypass_merges }),
  },
  {
    id: "dependabot-p90",
    label: "Dependabot open to merge, p90",
    unit: "hours",
    detail: "Hours from a Dependabot PR's opening to its merge, at the 90th percentile. The target is under 7 days.",
    targets: () => ({ 1: 168, 2: 168 }),
    read: (r) => ({ value: r.dependabot_open_to_merge_hours?.p90 ?? null }),
  },
  {
    id: "queue-p90",
    label: "Merge queue, p90",
    unit: "minutes",
    detail: "Minutes from joining the merge queue to the merge (merge_queue.enqueue_to_merge_minutes).",
    repos: [PORTAL_REPO],
    targets: portalOnly({ 2: 30 }),
    read: (r) => ({ value: r.merge_queue?.enqueue_to_merge_minutes.p90 ?? null }),
  },
  {
    id: "verdict-p90",
    label: "Commit to AI review verdict, p90",
    unit: "minutes",
    detail: "Minutes from a merged head's commit to its first final ai-review/verdict status.",
    repos: [PORTAL_REPO],
    targets: portalOnly({ 2: 45 }),
    read: (r) => ({ value: r.commit_to_verdict_minutes?.p90 ?? null }),
  },
  {
    id: "lane-cap",
    label: "PR CI runs stopped by the lane cap",
    unit: "count",
    detail: "PR CI runs that failed at the lane-cap step. Decision D15 moves the cap into the Mission Control checkout.",
    repos: [PORTAL_REPO],
    targets: () => ({}),
    read: (r) => ({ value: r.lane_cap_failures ?? null }),
  },
];

export const FLEET_METRICS: readonly FleetMetricDef[] = [
  {
    id: "green-unmerged",
    label: "Green PRs left unmerged",
    unit: "count",
    detail:
      "Open, non-draft PRs that pass every required check but have not merged, across the repos, when the weekly task ran. The target was set for an 11:00 AM ET sample.",
    targets: { 1: 5, 2: 5 },
    read: (s) => {
      const open = Object.values(s.repos).map((r) => r.open);
      if (open.length === 0 || open.some((o) => o === null)) return { value: null };
      return { value: open.reduce((n, o) => n + (o?.green_unmerged.length ?? 0), 0) };
    },
  },
];

/** Phase 2 targets that weekly_metrics.py does not measure yet. */
export const UNMEASURED_TARGETS: readonly { label: string; target: string; phase: Phase }[] = [
  { label: "Portal PR heavy CI, p90", target: "at most 25 min", phase: 2 },
  { label: "Agent PRs opened as taylorvalton", target: "none", phase: 2 },
];

// ─── Grading ─────────────────────────────────────────────────────────────────

export type Grade = "met" | "near" | "missed" | "no-data" | "no-target";
export type Letter = "A" | "B" | "C" | "D" | "F";

/** A value within this factor of a non-zero target is "near". A target of 0 has no near band. */
export const NEAR_FACTOR = 1.5;

const POINTS = { met: 1, near: 0.5, missed: 0 } as const;
type Scored = keyof typeof POINTS;

export function gradeValue(value: number | null, target: number | undefined): Grade {
  if (target === undefined) return "no-target";
  if (value === null || !Number.isFinite(value)) return "no-data";
  if (value <= target) return "met";
  if (target > 0 && value <= target * NEAR_FACTOR) return "near";
  return "missed";
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

export type Trend = "better" | "worse" | "same";

export interface MetricRow {
  id: string;
  label: string;
  unit: Unit;
  detail: string;
  value: number | null;
  note: string | null;
  /** The current phase's target; null when it has none. */
  target: number | null;
  /** The next phase's target, when it differs from the current one. */
  nextTarget: number | null;
  grade: Grade;
  /** The previous stored week's value, and which way this week moved from it. */
  previous: number | null;
  trend: Trend | null;
}

export interface Card {
  /** A repo name, or "fleet". */
  id: string;
  score: number | null;
  letter: Letter | null;
  met: number;
  graded: number;
  metrics: MetricRow[];
}

export interface WeekScore {
  windowStart: string;
  windowEnd: string;
  overall: number | null;
  repos: Record<string, number | null>;
}

export interface Scorecard {
  phase: Phase;
  latest: {
    windowStart: string;
    windowEnd: string;
    recordedAt: string;
    overall: number | null;
    letter: Letter | null;
    cards: Card[];
    errors: string[];
  } | null;
  /** Oldest week first. */
  history: WeekScore[];
}

/** The Monday (UTC) that starts the ISO week of an instant. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** One snapshot per ISO week of its window end, the latest recorded one; oldest week first. */
export function latestPerWeek(snapshots: readonly StoredSnapshot[]): StoredSnapshot[] {
  const byWeek = new Map<string, StoredSnapshot>();
  for (const s of snapshots) {
    const week = weekOf(s.snapshot.window.end);
    const kept = byWeek.get(week);
    if (!kept || Number(s.seq) > Number(kept.seq)) byWeek.set(week, s);
  }
  return [...byWeek.values()].sort((a, b) => Date.parse(a.snapshot.window.end) - Date.parse(b.snapshot.window.end));
}

function trendOf(value: number | null, previous: number | null): Trend | null {
  if (value === null || previous === null) return null;
  if (value === previous) return "same";
  return value < previous ? "better" : "worse";
}

function row(
  def: MetricBase,
  targets: Targets,
  reading: Reading,
  previous: Reading | null,
  phase: Phase
): MetricRow {
  const target = targets[phase];
  const next = phase === 1 ? targets[2] : undefined;
  const prev = previous?.value ?? null;
  return {
    id: def.id,
    label: def.label,
    unit: def.unit,
    detail: def.detail,
    value: reading.value,
    note: reading.note ?? null,
    target: target ?? null,
    nextTarget: next !== undefined && next !== target ? next : null,
    grade: gradeValue(reading.value, target),
    previous: prev,
    trend: trendOf(reading.value, prev),
  };
}

function card(id: string, metrics: MetricRow[]): Card {
  const grades = metrics.map((m) => m.grade);
  const score = scoreOf(grades);
  return {
    id,
    score,
    letter: letterOf(score),
    met: grades.filter((g) => g === "met").length,
    graded: grades.filter(isScored).length,
    metrics,
  };
}

/** The repos a snapshot shows: the known ones in order, then any new one. */
function reposOf(snapshot: Snapshot): string[] {
  const names = Object.keys(snapshot.repos);
  const known = SCORECARD_REPOS.filter((r) => names.includes(r));
  return [...known, ...names.filter((n) => !(SCORECARD_REPOS as readonly string[]).includes(n)).sort()];
}

/** Every card of one week, graded against `phase`, each row compared with `previous`. */
export function gradeWeek(snapshot: Snapshot, previous: Snapshot | null, phase: Phase): Card[] {
  const cards = reposOf(snapshot).map((repo) => {
    const now = snapshot.repos[repo];
    const before = previous?.repos[repo] ?? null;
    const metrics = REPO_METRICS.filter((m) => !m.repos || m.repos.includes(repo)).map((m) =>
      row(m, m.targets(repo), m.read(now), before ? m.read(before) : null, phase)
    );
    return card(repo, metrics);
  });
  const fleet = FLEET_METRICS.map((m) =>
    row(m, m.targets, m.read(snapshot), previous ? m.read(previous) : null, phase)
  );
  return [...cards, card("fleet", fleet)];
}

function overallOf(cards: readonly Card[]): number | null {
  return scoreOf(cards.flatMap((c) => c.metrics.map((m) => m.grade)));
}

export function buildScorecard(snapshots: readonly StoredSnapshot[], phase: Phase = CURRENT_PHASE): Scorecard {
  const weeks = latestPerWeek(snapshots);
  const history = weeks.map((w, i): WeekScore => {
    const cards = gradeWeek(w.snapshot, i > 0 ? weeks[i - 1].snapshot : null, phase);
    return {
      windowStart: w.snapshot.window.start,
      windowEnd: w.snapshot.window.end,
      overall: overallOf(cards),
      repos: Object.fromEntries(cards.filter((c) => c.id !== "fleet").map((c) => [c.id, c.score])),
    };
  });
  const last = weeks.at(-1);
  if (!last) return { phase, latest: null, history };
  const cards = gradeWeek(last.snapshot, weeks.length > 1 ? weeks[weeks.length - 2].snapshot : null, phase);
  const overall = overallOf(cards);
  return {
    phase,
    latest: {
      windowStart: last.snapshot.window.start,
      windowEnd: last.snapshot.window.end,
      recordedAt: last.recordedAt,
      overall,
      letter: letterOf(overall),
      cards,
      errors: last.snapshot.errors,
    },
    history,
  };
}
