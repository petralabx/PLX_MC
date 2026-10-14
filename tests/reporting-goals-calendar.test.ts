// Goals & Production calendar: Toronto dates, working days and Ontario holidays.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  addDays,
  isWorkingDay,
  monthEnd,
  monthLabel,
  ontarioStatutoryHolidays,
  torontoDate,
  torontoHour,
  workingDaysBetween,
} from "@/lib/reporting/goals/calendar";

import { HOLIDAYS } from "./reporting-goals-helpers";

describe("Toronto date and hour", () => {
  it("uses the Toronto calendar date, not UTC", () => {
    // 23:30 EDT on Oct 13 is already Oct 14 in UTC.
    expect(torontoDate(new Date("2026-10-14T03:30:00Z"))).toBe("2026-10-13");
    expect(torontoDate(new Date("2026-10-14T04:30:00Z"))).toBe("2026-10-14");
  });

  it("finds 06:00 Toronto in both summer and winter time", () => {
    expect(torontoHour(new Date("2026-10-14T10:00:00Z"))).toBe(6); // EDT
    expect(torontoHour(new Date("2026-10-14T11:00:00Z"))).toBe(7);
    expect(torontoHour(new Date("2026-12-14T10:00:00Z"))).toBe(5); // EST
    expect(torontoHour(new Date("2026-12-14T11:00:00Z"))).toBe(6);
    // The Mondays after each 2026 clock change.
    expect(torontoHour(new Date("2026-03-09T10:00:00Z"))).toBe(6);
    expect(torontoHour(new Date("2026-11-02T11:00:00Z"))).toBe(6);
  });

  it("does date arithmetic on calendar days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(monthEnd("2026-09-14")).toBe("2026-09-30");
    expect(monthEnd("2028-02-03")).toBe("2028-02-29");
    expect(monthLabel("2026-10-14")).toBe("October 2026");
  });
});

describe("Ontario public holidays", () => {
  it("lists 2026 on the dates the portal calendar uses", () => {
    expect(ontarioStatutoryHolidays(2026).map((h) => h.day)).toEqual([
      "2026-01-01",
      "2026-02-16",
      "2026-04-03",
      "2026-05-18",
      "2026-07-01",
      "2026-09-07",
      "2026-10-12",
      "2026-12-25",
      "2026-12-28",
    ]);
  });

  it("moves weekend holidays to the next free weekday", () => {
    const named = (year: number) => Object.fromEntries(ontarioStatutoryHolidays(year).map((h) => [h.name, h.day]));
    // Boxing Day 2026 is a Saturday.
    expect(named(2026)["Boxing Day (observed)"]).toBe("2026-12-28");
    // Christmas 2027 is a Saturday and Boxing Day a Sunday: Monday and Tuesday.
    expect(named(2027)["Christmas Day (observed)"]).toBe("2027-12-27");
    expect(named(2027)["Boxing Day (observed)"]).toBe("2027-12-28");
    // New Year's Day and Canada Day 2028 are Saturdays.
    expect(named(2028)["New Year's Day (observed)"]).toBe("2028-01-03");
    expect(named(2028)["Canada Day (observed)"]).toBe("2028-07-03");
    expect(named(2027)["Good Friday"]).toBe("2027-03-26");
  });

  it("keeps the Civic Holiday a working day", () => {
    expect(isWorkingDay("2026-08-03", HOLIDAYS)).toBe(true);
  });

  it("matches the report_holiday seed in migration 039 exactly", () => {
    const sql = readFileSync(path.join(__dirname, "..", "db", "migrations", "039_reporting_goals.sql"), "utf8");
    const seeded = [...sql.matchAll(/\('(\d{4}-\d{2}-\d{2})', '((?:[^']|'')+)'\)/g)].map(([, day, name]) => ({
      day,
      name: name.replace(/''/g, "'"),
    }));
    expect(seeded).toEqual([2026, 2027, 2028].flatMap((year) => ontarioStatutoryHolidays(year)));
  });
});

describe("working days", () => {
  it("counts October 2026 as 21, 9 through the 14th and 13 from the 14th (Thanksgiving excluded)", () => {
    expect(isWorkingDay("2026-10-12", HOLIDAYS)).toBe(false);
    expect(workingDaysBetween("2026-10-01", "2026-10-31", HOLIDAYS)).toBe(21);
    expect(workingDaysBetween("2026-10-01", "2026-10-14", HOLIDAYS)).toBe(9);
    expect(workingDaysBetween("2026-10-14", "2026-10-31", HOLIDAYS)).toBe(13);
  });

  it("counts December 2026 without Christmas and the observed Boxing Day", () => {
    expect(workingDaysBetween("2026-12-01", "2026-12-31", HOLIDAYS)).toBe(21);
  });

  it("returns 0 for an empty range", () => {
    expect(workingDaysBetween("2026-10-15", "2026-10-14", HOLIDAYS)).toBe(0);
  });
});
