// CI scorecard screen helpers (TASK-3913): pure formatting and the trend chart's
// model, kept apart from the component so tests can pin them.

import type { Card, Grade, Letter, MetricRow, Phase, Trend, Unit, WeekScore } from "@/lib/ci-scorecard";

const REPO_LABELS: Record<string, string> = {
  "plx-customer-portal": "Portal",
  PLX_MC: "Mission Control",
  "agentic-swarm": "Agentic swarm",
  fleet: "All repos",
};

export function cardLabel(id: string): string {
  return REPO_LABELS[id] ?? id;
}

export const GRADE_LABELS: Record<Grade, string> = {
  met: "Met",
  near: "Near",
  missed: "Missed",
  "no-data": "No data",
  "no-target": "No target yet",
};

/** One decimal, none on a whole number: 6 and 6.4, not 6.0. */
function oneDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatValue(value: number | null, unit: Unit): string {
  if (value === null) return "—";
  switch (unit) {
    case "hours":
      return value < 1 ? `${Math.round(value * 60)} min` : `${oneDecimal(value)} h`;
    case "minutes":
      return value < 10 ? `${oneDecimal(value)} min` : `${Math.round(value)} min`;
    case "percent":
      return `${oneDecimal(value)}%`;
    case "count":
      return String(Math.round(value));
  }
}

export function formatTarget(target: number | null, unit: Unit): string {
  if (target === null) return "—";
  return target === 0 ? "0" : `≤ ${formatValue(target, unit)}`;
}

export function trendLabel(row: Pick<MetricRow, "trend" | "previous" | "unit">): string {
  if (row.previous === null) return "—";
  const was = formatValue(row.previous, row.unit);
  const words: Record<Trend, string> = { better: "Better", worse: "Worse", same: "Same" };
  return row.trend ? `${words[row.trend]} (was ${was})` : was;
}

/** "4 of 6 targets met", or why nothing was graded. */
export function metLine(card: Pick<Card, "met" | "graded">, phase: Phase): string {
  if (card.graded === 0) return `No phase ${phase} target has data yet`;
  return `${card.met} of ${card.graded} ${card.graded === 1 ? "target" : "targets"} met`;
}

export function scoreLine(score: number | null, letter: Letter | null): string {
  return score === null || letter === null ? "Not graded" : `${letter} · ${score}/100`;
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Oct 19 – Oct 26": the window's UTC dates. */
export function windowLabel(start: string, end: string): string {
  return `${DAY.format(new Date(start))} – ${DAY.format(new Date(end))}`;
}

export function weekLabel(week: Pick<WeekScore, "windowEnd">): string {
  return DAY.format(new Date(week.windowEnd));
}

/** The trend chart's lines: every repo seen in the history, then the overall score. */
export function trendSeries(history: readonly WeekScore[]): { key: string; label: string; values: (number | null)[] }[] {
  const repos: string[] = [];
  for (const week of history) for (const repo of Object.keys(week.repos)) if (!repos.includes(repo)) repos.push(repo);
  return [
    ...repos.map((repo) => ({ key: repo, label: cardLabel(repo), values: history.map((w) => w.repos[repo] ?? null) })),
    { key: "overall", label: "Overall", values: history.map((w) => w.overall) },
  ];
}
