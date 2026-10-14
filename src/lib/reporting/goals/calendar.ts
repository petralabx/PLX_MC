// Toronto calendar for the Goals & Production report. "Today" is always the
// America/Toronto date (never the database's UTC current_date); working days are
// Monday–Friday less the report_holiday table. Pure — no I/O.
//
// ontarioStatutoryHolidays() is the rule the report_holiday seed in migration
// 039 was generated from (a test keeps the two equal). It matches the portal's
// work-routing calendar: weekend holidays move to the next free weekday, and the
// Civic Holiday is a working day.

import type { IsoDate } from "./types";

export const REPORT_TIME_ZONE = "America/Toronto";

const torontoParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function parts(now: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of torontoParts.formatToParts(now)) out[part.type] = part.value;
  return out;
}

/** The Toronto calendar date of an instant. */
export function torontoDate(now: Date): IsoDate {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The Toronto wall-clock hour (0–23) of an instant. */
export function torontoHour(now: Date): number {
  return Number(parts(now).hour);
}

function toUtc(day: IsoDate): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: IsoDate, days: number): IsoDate {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: IsoDate): number {
  return ((toUtc(day).getUTCDay() + 6) % 7) + 1;
}

export function monthStart(day: IsoDate): IsoDate {
  return `${day.slice(0, 7)}-01`;
}

export function monthEnd(day: IsoDate): IsoDate {
  const date = toUtc(monthStart(day));
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return fromUtc(date);
}

export function previousMonthStart(day: IsoDate): IsoDate {
  return monthStart(addDays(monthStart(day), -1));
}

/** Every day from `from` to `to`, inclusive (empty when to < from). */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function isWorkingDay(day: IsoDate, holidays: ReadonlySet<IsoDate>): boolean {
  return isoWeekday(day) <= 5 && !holidays.has(day);
}

/** Working days from `from` to `to`, inclusive (0 when to < from). */
export function workingDaysBetween(from: IsoDate, to: IsoDate, holidays: ReadonlySet<IsoDate>): number {
  return eachDay(from, to).filter((day) => isWorkingDay(day, holidays)).length;
}

/** "October 2026". */
export function monthLabel(day: IsoDate): string {
  return toUtc(monthStart(day)).toLocaleString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ─── Ontario public holidays (Employment Standards Act) ─────────────────────

export interface Holiday {
  day: IsoDate;
  name: string;
}

function iso(year: number, month: number, day: number): IsoDate {
  return fromUtc(new Date(Date.UTC(year, month - 1, day)));
}

function nthMonday(year: number, month: number, n: number): IsoDate {
  const first = iso(year, month, 1);
  const offset = (8 - isoWeekday(first)) % 7;
  return addDays(first, offset + 7 * (n - 1));
}

/** Gregorian Easter Sunday (anonymous algorithm). */
function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** The Monday on or before May 24. */
function victoriaDay(year: number): IsoDate {
  const may24 = iso(year, 5, 24);
  return addDays(may24, -(isoWeekday(may24) - 1));
}

/**
 * Ontario's nine public holidays for `year`, on their observed dates: a holiday
 * on a weekend moves to the next weekday that is not already a holiday (so a
 * Saturday Christmas and Sunday Boxing Day become Monday and Tuesday).
 */
export function ontarioStatutoryHolidays(year: number): Holiday[] {
  const actual: Holiday[] = [
    { day: iso(year, 1, 1), name: "New Year's Day" },
    { day: nthMonday(year, 2, 3), name: "Family Day" },
    { day: addDays(easterSunday(year), -2), name: "Good Friday" },
    { day: victoriaDay(year), name: "Victoria Day" },
    { day: iso(year, 7, 1), name: "Canada Day" },
    { day: nthMonday(year, 9, 1), name: "Labour Day" },
    { day: nthMonday(year, 10, 2), name: "Thanksgiving" },
    { day: iso(year, 12, 25), name: "Christmas Day" },
    { day: iso(year, 12, 26), name: "Boxing Day" },
  ];
  const taken = new Set<IsoDate>();
  return actual.map(({ day, name }) => {
    if (isoWeekday(day) <= 5) {
      taken.add(day);
      return { day, name };
    }
    let observed = addDays(day, 8 - isoWeekday(day));
    while (taken.has(observed)) observed = addDays(observed, 1);
    taken.add(observed);
    return { day: observed, name: `${name} (observed)` };
  });
}
