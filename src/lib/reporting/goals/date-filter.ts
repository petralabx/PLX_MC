// The dates filter (TASK-4391): the page and the workbook for some days of the
// run's month. One request parameter, `dates`: mtd (the 1st to today), week
// (Monday to Sunday around today), 7d (today and the 6 days before it) or
// YYYY-MM-DD..YYYY-MM-DD. Absent (or `month`): the whole month, the canonical
// spelling, so a link to the whole month never carries `dates`. Presets resolve
// against the run's today, on the server and on the page alike. A range is
// clamped to the run's month; one wholly outside it shows the whole month.
//
// The filter narrows the run before the page model is built, as the
// salesperson filter does (salesperson-filter.ts): invoices and the
// shipped-not-invoiced estimate by ship date, credit notes by their date, this
// month's truckloads by ship date, hand entries and batches by their own date
// (a batch an entry completes, by the entry's). Undated and other-month entries
// stay: they never count. Batch history, the cutoffs, the truckload customers
// and the forecast stay whole. The goals are the whole month's, so a partial
// page has no status, due so far, pace or last month. Pure.
//
// Client code imports this file directly, never the barrel; it must not reach
// forecast.ts or customer-revenue.ts (they carry the customer roster).

import { addDays, isoWeekday, monthEnd, monthLabel, monthStart } from "./calendar";
import { dailyRowsOf, revenueRowsOf, type SalespeopleRun } from "./salesperson-filter";
import type { IsoDate } from "./types";

export const DATES_PRESETS = ["mtd", "week", "7d"] as const;
export type DatesPreset = (typeof DATES_PRESETS)[number];

/** What a request asks for: the whole month, a preset, or a range of days. */
export type DatesChoice = { kind: "month" } | { kind: "preset"; preset: DatesPreset } | { kind: "range"; from: IsoDate; to: IsoDate };

export const WHOLE_MONTH: DatesChoice = { kind: "month" };

/** The 400 answer's message for a `dates` the routes can't read. */
export const DATES_PARAM_MESSAGE = "dates must be mtd, week, 7d or YYYY-MM-DD..YYYY-MM-DD.";

/** Each choice's name, as the picker and the takeaway say it. */
export const DATES_NAMES: Record<DatesPreset | "month", string> = {
  month: "This month",
  mtd: "Month to date",
  week: "This week",
  "7d": "Last 7 days",
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

/** A real calendar day in YYYY-MM-DD (not 2026-02-30). */
export function isIsoDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * A request's `dates` (TASK-4391). Absent, blank or `month`: the whole month.
 * null when it's none of the presets or a range of real days with from ≤ to
 * (the routes answer 400 with DATES_PARAM_MESSAGE).
 */
export function datesParam(value: string | null): DatesChoice | null {
  const v = (value ?? "").trim();
  if (!v || v === "month") return WHOLE_MONTH;
  if ((DATES_PRESETS as readonly string[]).includes(v)) return { kind: "preset", preset: v as DatesPreset };
  const m = RANGE_RE.exec(v);
  if (!m || !isIsoDay(m[1]) || !isIsoDay(m[2]) || m[1] > m[2]) return null;
  return { kind: "range", from: m[1], to: m[2] };
}

/** The canonical `dates` value: "" for the whole month (never written), the preset, or "from..to". */
export function datesKey(choice: DatesChoice): string {
  return choice.kind === "month" ? "" : choice.kind === "preset" ? choice.preset : `${choice.from}..${choice.to}`;
}

/** The days a page shows. */
export interface DatesRange {
  /** The canonical `dates` asked for (datesKey): "" for the whole month. The page compares it with its URL to tell it's waiting. */
  asked: string;
  /** Which choice: a preset, the whole month, or a custom range. */
  preset: DatesPreset | "month" | "custom";
  /** The first and last day shown, inside the run's month. */
  from: IsoDate;
  to: IsoDate;
  /** Every day of the month: the page as it is without the filter. */
  whole: boolean;
  /** The days asked for ran past the month, so they were cut to it. */
  clamped: boolean;
  /** The days asked for were wholly outside the month, so the whole month is shown. */
  outside: boolean;
  /** "Oct 12 to Oct 18", "Oct 14" for one day, the month ("October 2026") when whole. */
  label: string;
}

const SHORT_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Oct 12". */
export function shortDay(day: IsoDate): string {
  return SHORT_DAY.format(new Date(`${day}T00:00:00Z`));
}

/** The days `choice` asks for, against the run's `today`, within its month. */
export function resolveDates(choice: DatesChoice, today: IsoDate): DatesRange {
  const start = monthStart(today);
  const end = monthEnd(today);
  let [from, to] = [start, end];
  if (choice.kind === "preset") {
    if (choice.preset === "mtd") [from, to] = [start, today];
    else if (choice.preset === "week") {
      from = addDays(today, 1 - isoWeekday(today));
      to = addDays(from, 6);
    } else [from, to] = [addDays(today, -6), today];
  } else if (choice.kind === "range") [from, to] = [choice.from, choice.to];
  const outside = to < start || from > end;
  const shownFrom = outside || from < start ? start : from;
  const shownTo = outside || to > end ? end : to;
  const whole = shownFrom === start && shownTo === end;
  return {
    asked: datesKey(choice),
    preset: choice.kind === "month" ? "month" : choice.kind === "preset" ? choice.preset : "custom",
    from: shownFrom,
    to: shownTo,
    whole,
    clamped: !outside && (shownFrom !== from || shownTo !== to),
    outside,
    label: whole ? monthLabel(start) : shownFrom === shownTo ? shortDay(shownFrom) : `${shortDay(shownFrom)} to ${shortDay(shownTo)}`,
  };
}

/** The range as a heading: "This week, Oct 12 to Oct 18"; a custom range is its days. */
export function datesTitle(range: Pick<DatesRange, "preset" | "label" | "whole">): string {
  if (range.whole) return range.label;
  return range.preset === "custom" || range.preset === "month" ? range.label : `${DATES_NAMES[range.preset]}, ${range.label}`;
}

/**
 * The run narrowed to the days of `range` (TASK-4391): invoices, the estimate
 * and this month's truckloads by ship date, credit notes by their date, batches
 * by `batchDates` (rules.batchDates: a batch an entry completes takes the
 * entry's date) and hand entries by theirs; undated and other-month entries
 * stay. Revenue by currency and by day are rebuilt from the kept invoices.
 * Batch history, cutoffs, truckload customers and the forecast stay whole.
 */
export function filterRunByDates<T extends SalespeopleRun>(run: T, range: Pick<DatesRange, "from" | "to">, batchDates: ReadonlyMap<string, IsoDate>): T {
  const inRange = (day: IsoDate) => day >= range.from && day <= range.to;
  const start = monthStart(range.from);
  const end = monthEnd(range.from);
  const s = run.snapshot;
  const shipments = s ? s.shipments.filter((r) => inRange(r.shipDate)) : [];
  return {
    ...run,
    entries: run.entries.filter((e) => !e.date || e.date < start || e.date > end || inRange(e.date)),
    snapshot: s && {
      ...s,
      shipments,
      truckloads: s.truckloads.filter((r) => !r.thisMonth || inRange(r.shipDate)),
      batches: s.batches.filter((b) => inRange(batchDates.get(b.id) ?? b.date)),
      revenue: revenueRowsOf(shipments),
      daily: dailyRowsOf(s.daily, shipments),
      creditNotes: s.creditNotes && { ...s.creditNotes, notes: s.creditNotes.notes.filter((r) => inRange(r.creditDate)) },
      pendingShipments: s.pendingShipments && {
        ...s.pendingShipments,
        shipments: s.pendingShipments.shipments.filter((r) => inRange(r.shipDate)),
      },
    },
  };
}
