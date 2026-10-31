// UAT scorecard screen helpers (TASK-4196): pure formatting and the trend's
// model, kept apart from the component so tests can pin them.

import { PORTAL_ORIGIN } from "@/lib/tasks/uat-tickets";
import {
  AREAS,
  BOUND_DECIMALS,
  TIME_ZONE,
  shownValue,
  type Card,
  type Direction,
  type MetricRow,
  type Trend,
  type Unit,
  type WeekScore,
} from "@/lib/uat-scorecard";

/** At most `digits` decimals, and no trailing zeros: 6, 6.4 and 0.75, not 6.0. */
function trimmed(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

// At the precision the rubric grades it (DECIMALS), so the number shown is the number graded.
export function formatValue(value: number | null, unit: Unit): string {
  if (value === null) return "—";
  const shown = String(shownValue(value, unit));
  switch (unit) {
    case "percent":
      return `${shown}%`;
    case "days":
      return `${shown} bd`;
    case "count":
    case "score":
      return shown;
  }
}

/** A target or a band edge, at BOUND_DECIMALS for every unit, as it is graded: a count's band of 7.5 is not 8. */
function formatBound(value: number, unit: Unit): string {
  if (unit === "percent") return `${trimmed(value, BOUND_DECIMALS)}%`;
  if (unit === "days") return `${trimmed(value, BOUND_DECIMALS)} bd`;
  return trimmed(value, BOUND_DECIMALS);
}

const sign = (direction: Direction) => (direction === "lower" ? "≤" : "≥");

export function formatTarget(row: Pick<MetricRow, "target" | "direction" | "unit">): string {
  if (row.target === null || row.direction === null) return "—";
  if (row.direction === "lower" && row.target === 0) return "0";
  return `${sign(row.direction)} ${formatBound(row.target, row.unit)}`;
}

/** "Near ≥ 60%", or null when the metric has no near band. */
export function formatNear(row: Pick<MetricRow, "near" | "direction" | "unit">): string | null {
  if (row.near === null || row.direction === null) return null;
  return `Near ${sign(row.direction)} ${formatBound(row.near, row.unit)}`;
}

export function trendLabel(row: Pick<MetricRow, "trend" | "previous" | "unit">): string {
  if (row.previous === null) return "—";
  const was = formatValue(row.previous, row.unit);
  const words: Record<Trend, string> = { better: "Better", worse: "Worse", same: "Same" };
  return row.trend ? `${words[row.trend]} (was ${was})` : was;
}

/** "4 of 6 targets met", or why nothing was graded. */
export function metLine(card: Pick<Card, "met" | "graded">): string {
  if (card.graded === 0) return "No target has data";
  return `${card.met} of ${card.graded} ${card.graded === 1 ? "target" : "targets"} met`;
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: TIME_ZONE });
// A calendar date (YYYY-MM-DD) is a day, not an instant: format it in UTC so it stays that day.
const CALENDAR_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const AT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: TIME_ZONE,
  timeZoneName: "short",
});

/** "Oct 19 – Oct 25": the week's first and last Toronto days (the window's end is the next Monday). */
export function weekLabel(week: Pick<WeekScore, "windowStart" | "windowEnd">): string {
  return `${DAY.format(new Date(week.windowStart))} – ${DAY.format(new Date(Date.parse(week.windowEnd) - 1))}`;
}

/** The week's label with what kind of read it is: so far, final read pending, no final read, incomplete. */
export function weekName(week: Pick<WeekScore, "windowStart" | "windowEnd" | "state" | "finalReadPending" | "readErrors">): string {
  const state =
    week.state === "no-final-read" ? ", no final read" : week.finalReadPending ? ", final read pending" : week.state === "open" ? ", so far" : "";
  return `${weekLabel(week)}${state}${week.readErrors.length > 0 ? ", incomplete" : ""}`;
}

/** The trend's column label: the week's Monday. */
export function axisLabel(week: Pick<WeekScore, "windowStart">): string {
  return DAY.format(new Date(week.windowStart));
}

/** "Oct 26" for the week 2026-10-26. */
export function dayLabel(day: string): string {
  return CALENDAR_DAY.format(new Date(`${day}T00:00:00Z`));
}

/** "Oct 30, 6:00 AM EDT", Toronto time. */
export function readAtLabel(iso: string): string {
  return AT.format(new Date(iso));
}

/** The open weeks beside the headline week, oldest first: one that ended with its final read pending, then this week so far. */
export function openWeeks(history: readonly WeekScore[], latest: Pick<WeekScore, "week"> | null): WeekScore[] {
  return history.filter((w) => w.state === "open" && w.week !== latest?.week);
}

/** The trend's sentence on its shaded (open) weeks, or "" when none is shaded. */
export function shadedNote(history: readonly WeekScore[]): string {
  const shaded = history.filter((w) => w.state === "open");
  if (shaded.length > 1) return ` The ${shaded.length} shaded weeks have no final read yet.`;
  if (shaded.length === 0) return "";
  return shaded[0].finalReadPending ? " The shaded week has ended; its final read is pending." : " The shaded week is still open.";
}

/** The open week's name: this week so far, or its Monday once it has ended and waits for its final read. */
export function soFarLabel(week: Pick<WeekScore, "windowStart" | "finalReadPending">): string {
  return week.finalReadPending ? `Week of ${axisLabel(week)} so far` : "This week so far";
}

/** The weekly table's columns: one per area, then the overall score the chart draws. */
export function weeklyColumns(history: readonly WeekScore[]): { key: string; label: string; values: (number | null)[] }[] {
  return [
    ...AREAS.map((area) => ({ key: area.id, label: area.label, values: history.map((w) => w.areas[area.id] ?? null) })),
    { key: "overall", label: "Overall", values: history.map((w) => w.overall) },
  ];
}

/** The staff Loop board in the portal. */
export function loopBoardUrl(origin = PORTAL_ORIGIN): string {
  return `${origin}/uat?view=loop`;
}
