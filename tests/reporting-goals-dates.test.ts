// The dates filter (TASK-4391): the page for some days of the run's month. One
// `dates` parameter (mtd, week, 7d or a range of days; absent, the whole
// month), resolved against the run's today and clamped to its month. Every
// figure with a date follows the days by the same rules as the whole page, so
// days that cover the month add up to it; the goals stay the whole month's, so
// a partial page has no status, due so far, pace or last month, and the
// forecast and potential revenue are the month's.

import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DailyLine1Chart, DailyRevenueChart, DailyTable } from "@/components/mc/goals/charts";
import { CustomerRevenueSection } from "@/components/mc/goals/customers";
import { DatesNote, DatesPicker } from "@/components/mc/goals/dates";
import { ForecastSection } from "@/components/mc/goals/forecast";
import { GoalCards } from "@/components/mc/goals/goal-cards";
import { isReady, type ReadyPage } from "@/components/mc/goals/helpers";
import { CompletedTiles, TruckloadTable } from "@/components/mc/goals/tables";
import {
  DATES_PARAM_MESSAGE,
  WHOLE_MONTH,
  datesKey,
  datesParam,
  datesTitle,
  filterRunByDates,
  resolveDates,
} from "@/lib/reporting/goals/date-filter";
import { buildGoalsWorkbook } from "@/lib/reporting/goals/excel/export";
import { workbookFileName } from "@/lib/reporting/goals/excel/layout";
import { batchDates, normalizeRef } from "@/lib/reporting/goals/rules";
import { filterRunBySalespeople, salespeopleScope } from "@/lib/reporting/goals/salesperson-filter";
import type { CreditNotesDataset, Datasets, PendingShipmentsDataset } from "@/lib/reporting/goals/types";
import { buildGoalsViewAndRun, type GoalsView, type GoalsViewInput } from "@/lib/reporting/goals/view";

import creditNotesJson from "./fixtures/reporting-goals/2026-10-14/credit-notes.json";
import pendingJson from "./fixtures/reporting-goals/2026-10-14/pending-shipments.json";
import {
  DATASETS,
  ENTRIES,
  FORECAST,
  RATE,
  SETTINGS,
  SHIPMENT_LINES,
  SHIPMENT_LINES_SUMMARY,
  TODAY,
  datesGoalsPage,
  fixtureSalespeople,
  goalsPage,
  goalsViewInput,
  manualEntry,
  salesGoalsPage,
} from "./reporting-goals-helpers";

const CREDIT_NOTES = creditNotesJson as unknown as CreditNotesDataset;
const PENDING = pendingJson as unknown as PendingShipmentsDataset;
// The whole fixture: invoices, returns, the estimate, open orders and M1–M7.
const SNAPSHOT: Datasets = { ...DATASETS, creditNotes: CREDIT_NOTES, pendingShipments: PENDING };
const INPUT = goalsViewInput(ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
const WHOLE = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
const page = (dates: string, sales?: string[], input: GoalsViewInput = INPUT) => datesGoalsPage(dates, sales, input);
const ready = (p: GoalsView): ReadyPage => {
  const full = { ...p, viewer: { editor: true } };
  if (!isReady(full)) throw new Error("ready");
  return full;
};
/** Rendered markup as text (tags dropped). */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const MONTHLY = /On track|Behind|Due so far|Needed per working day|Last month/;

describe("the dates request parameter", () => {
  it("reads the presets and a range of real days; absent, blank or month is the whole month", () => {
    for (const whole of [null, "", "  ", "month"]) expect(datesParam(whole), String(whole)).toEqual(WHOLE_MONTH);
    expect(datesParam("mtd")).toEqual({ kind: "preset", preset: "mtd" });
    expect(datesParam(" week ")).toEqual({ kind: "preset", preset: "week" });
    expect(datesParam("7d")).toEqual({ kind: "preset", preset: "7d" });
    expect(datesParam("2026-10-12..2026-10-18")).toEqual({ kind: "range", from: "2026-10-12", to: "2026-10-18" });
    expect(datesParam("2026-10-14..2026-10-14")).toEqual({ kind: "range", from: "2026-10-14", to: "2026-10-14" });
  });

  it("refuses anything else: other words, one day, impossible days and a range that runs backwards", () => {
    for (const bad of ["Week", "fortnight", "2026-10-14", "2026-10-1..2026-10-07", "2026-02-30..2026-03-01", "2026-13-01..2026-13-02", "2026-10-18..2026-10-12", "2026-10-01...2026-10-07", "mtd,week"]) {
      expect(datesParam(bad), bad).toBeNull();
    }
    expect(DATES_PARAM_MESSAGE).toBe("dates must be mtd, week, 7d or YYYY-MM-DD..YYYY-MM-DD.");
  });

  it("has one spelling for each choice, and none for the whole month", () => {
    expect(datesKey(WHOLE_MONTH)).toBe("");
    expect(datesKey(datesParam("month")!)).toBe("");
    expect(datesKey(datesParam(" 7d")!)).toBe("7d");
    expect(datesKey(datesParam("2026-10-01..2026-10-07")!)).toBe("2026-10-01..2026-10-07");
  });
});

describe("resolving the days against the run's today", () => {
  const days = (value: string, today = TODAY) => {
    const r = resolveDates(datesParam(value)!, today);
    return [r.from, r.to, r.whole, r.clamped, r.outside];
  };

  it("month to date is the 1st to today, this week Monday to Sunday, the last 7 days today and the 6 before", () => {
    expect(days("mtd")).toEqual(["2026-10-01", "2026-10-14", false, false, false]);
    expect(days("week")).toEqual(["2026-10-12", "2026-10-18", false, false, false]);
    expect(days("7d")).toEqual(["2026-10-08", "2026-10-14", false, false, false]);
    expect(days("month")).toEqual(["2026-10-01", "2026-10-31", true, false, false]);
    expect(resolveDates(datesParam("week")!, TODAY)).toMatchObject({ asked: "week", preset: "week", label: "Oct 12 to Oct 18" });
    expect(resolveDates(WHOLE_MONTH, TODAY)).toMatchObject({ asked: "", preset: "month", label: "October 2026" });
    expect(resolveDates(datesParam("2026-10-14..2026-10-14")!, TODAY).label).toBe("Oct 14");
    expect(datesTitle(resolveDates(datesParam("week")!, TODAY))).toBe("This week, Oct 12 to Oct 18");
    expect(datesTitle(resolveDates(datesParam("2026-10-03..2026-10-09")!, TODAY))).toBe("Oct 3 to Oct 9");
  });

  it("cuts days to the run's month, and shows the whole month for days wholly outside it", () => {
    // A week that runs past month end, and the last 7 days early in a month.
    expect(days("week", "2026-10-29")).toEqual(["2026-10-26", "2026-10-31", false, true, false]);
    expect(days("7d", "2026-10-03")).toEqual(["2026-10-01", "2026-10-03", false, true, false]);
    expect(days("2026-09-25..2026-10-05")).toEqual(["2026-10-01", "2026-10-05", false, true, false]);
    expect(days("2026-09-01..2026-09-30")).toEqual(["2026-10-01", "2026-10-31", true, false, true]);
    expect(days("2026-11-01..2026-11-07")).toEqual(["2026-10-01", "2026-10-31", true, false, true]);
    // Month to date on the month's last day is the whole month.
    expect(days("mtd", "2026-10-31")).toEqual(["2026-10-01", "2026-10-31", true, false, false]);
  });
});

describe("narrowing the run", () => {
  const dated = batchDates(WHOLE.model!);
  const range = resolveDates(datesParam("week")!, TODAY);

  it("keeps each row by its own date, and leaves batch history, cutoffs, truckload customers and the forecast whole", () => {
    const run = filterRunByDates(INPUT, range, dated);
    const s = run.snapshot!;
    const inWeek = (d: string) => d >= "2026-10-12" && d <= "2026-10-18";
    expect(s.shipments.map((r) => r.invoice)).toEqual(SNAPSHOT.shipments.filter((r) => inWeek(r.shipDate)).map((r) => r.invoice));
    expect(s.creditNotes!.notes).toEqual(CREDIT_NOTES.notes.filter((r) => inWeek(r.creditDate)));
    expect(s.pendingShipments!.shipments).toEqual(PENDING.shipments.filter((r) => inWeek(r.shipDate)));
    expect(s.truckloads).toEqual(SNAPSHOT.truckloads.filter((r) => !r.thisMonth || inWeek(r.shipDate)));
    expect(s.batches.every((b) => inWeek(dated.get(b.id) ?? b.date))).toBe(true);
    // Undated and other-month entries stay (they never count); dated ones follow the days.
    expect(run.entries.map((e) => e.entryId)).toEqual(ENTRIES.filter((e) => !e.date || !e.date.startsWith("2026-10") || inWeek(e.date)).map((e) => e.entryId));
    expect(run.entries.some((e) => e.entryId === "M006")).toBe(true);
    expect(s.batchHistory).toBe(SNAPSHOT.batchHistory);
    expect(s.cutoffs).toBe(SNAPSHOT.cutoffs);
    expect(run.ftlCustomers).toBe(INPUT.ftlCustomers);
    expect(run.forecast).toBe(INPUT.forecast);
    expect(s.daily.every((d) => d.cadLast === "0.00" && d.usdLast === "0.00")).toBe(true);
    // The input is never changed.
    expect(INPUT.snapshot!.shipments).toHaveLength(SNAPSHOT.shipments.length);
    expect(INPUT.entries).toHaveLength(ENTRIES.length);
  });

  it("commutes with the salesperson filter", () => {
    const roster = fixtureSalespeople(INPUT);
    if (roster.state !== "ready") throw new Error("ready");
    const keep = salespeopleScope(roster, ["BB"]);
    expect(filterRunByDates(filterRunBySalespeople(INPUT, keep), range, dated)).toEqual(filterRunBySalespeople(filterRunByDates(INPUT, range, dated), keep));
  });

  it("dates a batch an entry completes by the entry, not by FileMaker's schedule", () => {
    // An open Line 1 batch scheduled after the 14th, finished by hand on the 9th.
    const open = SNAPSHOT.batches.find(
      (b) => (b.status === "Allocated" || b.status === "Committed") && b.date > "2026-10-14" && Number(b.kg) >= SETTINGS.line1MinKg && !INPUT.filemakerRefs.has(normalizeRef(b.batch))
    )!;
    expect(open).toBeDefined();
    const done = manualEntry({ entryId: "M80", type: "Batch", date: "2026-10-09", reference: open.batch, kg: "8000" } as never);
    const input = goalsViewInput([...ENTRIES, done], FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
    const whole = goalsPage({}, [...ENTRIES, done], FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
    expect(batchDates(whole.model!).get(open.id)).toBe("2026-10-09");
    const row = (v: GoalsView) => v.model!.batches.find((b) => b.key === `fm:${open.id}`);
    expect(row(page("2026-10-08..2026-10-14", undefined, input))).toMatchObject({ stage: "completed_by_hand", date: "2026-10-09", kg: 8000 });
    // Its FileMaker date is in these days, but it was finished on the 9th: not here.
    expect(row(page("2026-10-15..2026-10-31", undefined, input))).toBeUndefined();
  });
});

describe("days that cover the month add up to it", () => {
  const parts = ["2026-10-01..2026-10-07", "2026-10-08..2026-10-14", "2026-10-15..2026-10-31"].map((d) => page(d));
  const sum = (pick: (v: GoalsView) => number) => parts.reduce((n, v) => n + pick(v), 0);

  it("Line 1 kg, full and partial loads, and the shipment and batch rows", () => {
    const grams = (kg: number) => Math.round(kg * 1000);
    expect(sum((v) => grams(v.model!.line1.totalKg))).toBe(grams(WHOLE.model!.line1.totalKg));
    expect(sum((v) => grams(v.model!.line1.byHandKg))).toBe(grams(WHOLE.model!.line1.byHandKg));
    expect(sum((v) => v.model!.truckloads.full.total)).toBe(WHOLE.model!.truckloads.full.total);
    expect(sum((v) => v.model!.truckloads.partial.total)).toBe(WHOLE.model!.truckloads.partial.total);
    expect(sum((v) => v.shipments.length)).toBe(WHOLE.shipments.length);
    expect(sum((v) => v.model!.batches.length)).toBe(WHOLE.model!.batches.length);
    expect(sum((v) => v.model!.entries.filter((e) => e.counts).length)).toBe(WHOLE.model!.entries.filter((e) => e.counts).length);
    expect(WHOLE.model!.line1.totalKg).toBeGreaterThan(0);
  });

  it("revenue in native cents per currency and by hand, returns and the estimate", () => {
    const whole = WHOLE.model!.revenue;
    expect(sum((v) => v.model!.revenue.cad.cents)).toBe(whole.cad.cents);
    expect(sum((v) => v.model!.revenue.usd.cents)).toBe(whole.usd.cents);
    expect(sum((v) => v.model!.revenue.cad.invoices + v.model!.revenue.usd.invoices)).toBe(whole.cad.invoices + whole.usd.invoices);
    expect(sum((v) => v.model!.revenue.byHandCents)).toBe(whole.byHandCents);
    expect(sum((v) => v.creditNotes!.notes)).toBe(WHOLE.creditNotes!.notes);
    expect(sum((v) => v.revenueGoal!.returnsNotes)).toBe(WHOLE.revenueGoal!.returnsNotes);
    expect(sum((v) => v.revenueGoal!.pendingShipments)).toBe(WHOLE.revenueGoal!.pendingShipments);
    expect(WHOLE.creditNotes!.notes).toBeGreaterThan(0);
    expect(WHOLE.revenueGoal!.pendingShipments).toBeGreaterThan(0);
    // Each page converts its own US dollars once, so the headlines can be a cent or so apart from the month's.
    expect(Math.abs(sum((v) => v.revenueGoal!.goalCadCents) - WHOLE.revenueGoal!.goalCadCents)).toBeLessThanOrEqual(parts.length);
  });
});

describe("a page for some days", () => {
  it("is the whole page, untouched, for the whole month", () => {
    const month = page("month");
    expect({ ...month, range: null }).toEqual({ ...WHOLE, range: null });
    expect(month.range).toMatchObject({ whole: true, asked: "", outside: false });
  });

  it("shows the whole month, and says so, for days wholly outside it", () => {
    const outside = page("2026-11-01..2026-11-07");
    expect(outside.range).toMatchObject({ whole: true, outside: true, asked: "2026-11-01..2026-11-07" });
    expect(outside.revenueGoal).toEqual(WHOLE.revenueGoal);
    const note = text(renderToStaticMarkup(createElement(DatesNote, { range: outside.range!, month: "October 2026" })));
    expect(note).toContain("outside October 2026, so the whole month is shown");
  });

  it("echoes the days, keeps only their days on the charts, and has no status or pace", () => {
    const week = page("week");
    expect(week.range).toEqual({
      asked: "week",
      preset: "week",
      from: "2026-10-12",
      to: "2026-10-18",
      whole: false,
      clamped: false,
      outside: false,
      label: "Oct 12 to Oct 18",
      // Monday the 12th is Thanksgiving.
      workingDays: 4,
    });
    expect(week.model!.daily.map((d) => d.day)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(week.model!.daily.every((d) => d.lastMonthToDateCents === null)).toBe(true);
    expect(week.model!.revenue.lastMonthCadCents).toBeNull();
    for (const goal of [week.revenueGoal!, week.revenueScope!]) {
      expect(goal.status).toBeNull();
      expect(goal.neededPerDayCents).toBeNull();
    }
    expect(week.model!.takeaway).toMatch(/^This week, Oct 12 to Oct 18: [\d,]+ kg of Line 1 bulk, \d+ full truckloads? and \$[\d,]+ of revenue\. The goals are for the whole month\.$/);
    // The revenue covered-through date stays the whole page's.
    expect(week.model!.coveredThrough.revenue).toBe(WHOLE.model!.coveredThrough.revenue);
  });

  it("renders cards, charts and tables with nothing to compare with the month's goals or last month", () => {
    const week = ready(page("week"));
    const html = [
      renderToStaticMarkup(createElement(GoalCards, { page: week })),
      renderToStaticMarkup(createElement(DailyLine1Chart, { page: week })),
      renderToStaticMarkup(createElement(DailyRevenueChart, { page: week })),
      renderToStaticMarkup(createElement(DailyTable, { page: week })),
      renderToStaticMarkup(createElement(TruckloadTable, { page: week })),
    ].join("");
    expect(text(html)).not.toMatch(MONTHLY);
    expect(html).not.toMatch(/Target to date|per 20 working days/);
    expect(text(html)).toContain("in Oct 12 to Oct 18");
    expect(text(html)).toContain("In these dates (Sage)");
    expect(renderToStaticMarkup(createElement(CompletedTiles, { tiles: week.model.sizes.completed, pace: false }))).not.toContain("per 20 working days");
    // The whole month keeps them.
    const whole = ready(WHOLE);
    expect(text(renderToStaticMarkup(createElement(GoalCards, { page: whole })))).toMatch(/Due so far.*Needed per working day/);
  });

  it("keeps the forecast and potential revenue the month's; realized revenue follows the days", () => {
    const week = page("week");
    expect(week.forecast).toEqual(WHOLE.forecast);
    expect(week.customerRevenue!.potential).toEqual(WHOLE.customerRevenue!.potential);
    expect(week.customerRevenue!.unpriced).toEqual(WHOLE.customerRevenue!.unpriced);
    expect(week.customerRevenue!.realized.weeks.every((w) => w >= "2026-10-12")).toBe(true);
    expect(week.customerRevenue!.cardTotalCents).toBe(week.model!.revenue.totalCents);
    expect(text(renderToStaticMarkup(createElement(ForecastSection, { page: ready(week) })))).toContain("The forecast is the whole month’s, whatever the dates.");
    expect(text(renderToStaticMarkup(createElement(CustomerRevenueSection, { page: ready(week) })))).toContain("Realized: invoiced in Oct 12 to Oct 18");
    // With salespeople too, the forecast is their month's.
    expect(page("week", ["BB"]).forecast).toEqual(salesGoalsPage(["BB"], INPUT).forecast);
  });

  it("sets some salespeople's days against every customer's same days", () => {
    const both = page("week", ["BB"]);
    const every = page("week");
    expect(both.salespeople).toMatchObject({ applied: true, selected: ["BB"] });
    expect(both.salespeople!.everyCustomer!.revenueGoalCadCents).toBe(every.revenueGoal!.goalCadCents);
    expect(both.salespeople!.everyCustomer!.revenueScopeGoalCadCents).toBe(every.revenueScope!.goalCadCents);
    expect(both.range).toEqual(every.range);
    expect(both.model!.takeaway).toMatch(/^This week, Oct 12 to Oct 18, for Bravo Rep \(BB\): [\d,]+ kg of Line 1 bulk \(every customer’s\), /);
    const html = text(renderToStaticMarkup(createElement(GoalCards, { page: ready(both) })));
    expect(html).toContain("for every customer in these dates");
    expect(html).not.toMatch(MONTHLY);
  });
});

describe("the picker and the note", () => {
  it("shows the choice in the URL with each preset's days, and the custom row on the days shown", () => {
    const html = renderToStaticMarkup(
      createElement(DatesPicker, { today: TODAY, asked: datesParam("week")!, waiting: false, failed: false, onPick: () => {}, onRetry: () => {} })
    );
    expect(text(html)).toContain("This week, Oct 12 to Oct 18");
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
    for (const span of ["October 2026", "Oct 1 to Oct 14", "Oct 12 to Oct 18", "Oct 8 to Oct 14"]) expect(text(html)).toContain(span);
    expect(html).toContain('min="2026-10-01"');
    expect(html).toContain('max="2026-10-31"');
    expect(html).toContain('value="2026-10-12"');
    expect(text(html)).toContain("Show the whole month");
    const waiting = renderToStaticMarkup(
      createElement(DatesPicker, { today: TODAY, asked: WHOLE_MONTH, waiting: true, failed: false, onPick: () => {}, onRetry: () => {} })
    );
    expect(waiting).toContain("Loading the figures for these dates…");
    expect(waiting).not.toContain("Show the whole month");
  });

  it("says what the days cover, and when they were cut to the month", () => {
    const note = text(renderToStaticMarkup(createElement(DatesNote, { range: page("week").range!, month: "October 2026" })));
    expect(note).toContain("Showing Oct 12 to Oct 18 only (4 working days).");
    expect(note).toContain("The forecast and potential revenue are the whole month’s.");
    expect(note).not.toContain("stop at its edge");
    const cut = text(renderToStaticMarkup(createElement(DatesNote, { range: page("2026-10-26..2026-11-03").range!, month: "October 2026" })));
    expect(cut).toContain("Showing Oct 26 to Oct 31 only");
    expect(cut).toContain("so they stop at its edge");
    expect(renderToStaticMarkup(createElement(DatesNote, { range: page("month").range!, month: "October 2026" }))).toBe("");
    // Days that cover the whole month once cut to it: the whole month, and the note says why.
    const both = page("2026-09-20..2026-11-03").range!;
    expect(both.whole).toBe(true);
    expect(text(renderToStaticMarkup(createElement(DatesNote, { range: both, month: "October 2026" })))).toContain(
      "run past October 2026 on both sides, so the whole month is shown"
    );
  });
});

describe("the workbook", () => {
  it("is named for the days, before the rate and the salespeople", () => {
    const week = { from: "2026-10-12", to: "2026-10-18" };
    expect(workbookFileName(TODAY, "boc", [], week)).toBe("PLX goals and production 2026-10-14 (2026-10-12 to 2026-10-18).xlsx");
    expect(workbookFileName(TODAY, "sage", ["BB"], week)).toBe("PLX goals and production 2026-10-14 (2026-10-12 to 2026-10-18) (Sage rate) (BB).xlsx");
    expect(workbookFileName(TODAY, "boc", [], null)).toBe("PLX goals and production 2026-10-14.xlsx");
  });

  it("has the days' rows on Daily and no goal-only cells on Goals", async () => {
    const { view, run, entries } = buildGoalsViewAndRun({ ...INPUT, dates: datesParam("week") });
    const range = view.range!;
    const buffer = await buildGoalsWorkbook({
      run: view.run!,
      model: view.model!,
      settings: SETTINGS,
      shipments: run.snapshot!.shipments,
      truckloads: run.snapshot!.truckloads,
      rates: [{ date: TODAY, rate: RATE }],
      exportedAt: new Date("2026-10-14T16:00:00Z"),
      forecast: view.forecast,
      shipmentLines: { access: "read", missing: [], lines: SHIPMENT_LINES },
      revenueByClass: view.revenueByClass,
      creditNotes: run.snapshot!.creditNotes,
      pendingShipments: run.snapshot!.pendingShipments,
      customerRevenue: view.customerRevenue,
      range,
      allEntries: entries,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const daily = wb.getWorksheet("Daily")!;
    // A header (row 1), the 7 days (rows 2–8) and the totals row.
    expect(daily.getCell("A2").value).toEqual(new Date("2026-10-12T00:00:00Z"));
    expect(daily.getCell("A8").value).toEqual(new Date("2026-10-18T00:00:00Z"));
    expect(daily.getCell("A9").value).toBe("Total");
    expect(daily.getCell("J2").value).toBeNull();
    expect(daily.getCell("K2").value).toBeNull();
    const goals = wb.getWorksheet("Goals")!;
    expect(String(goals.getCell("A2").value)).toContain("Only Oct 12 to Oct 18 (2026-10-12 to 2026-10-18)");
    for (const cell of ["B5", "C5", "D5", "H5", "I5", "B6", "B8", "C8", "D8", "H8", "I8"]) expect(goals.getCell(cell).value, cell).toBe("—");
    expect(goals.getCell("E8").value).toMatchObject({ formula: expect.stringContaining("Daily!F9") });
    expect(String(daily.getCell("J1").value)).toContain("whole month only");
    const trucks = wb.getWorksheet("Truckloads")!;
    expect(trucks.getCell("I2").value).toBeNull();
    expect(String(trucks.getCell("I1").value)).toContain("whole month only");
    // The forecast is the whole month's, so its invoiced so far is the month's, not these days' (Goals!G8).
    const forecast = wb.getWorksheet("Forecast")!;
    const invoiced = forecast.getRow(4).getCell(1).value; // FORECAST_NUMBER_ROW, column A: invoiced so far
    expect(invoiced).toBe(view.forecast!.state === "ready" ? view.forecast!.invoicedCents / 100 : 0);
    expect(invoiced).not.toMatchObject({ formula: expect.anything() });
    // The Manual entries sheet still lists every entry: the import template.
    let listed = 0;
    wb.getWorksheet("Manual entries")!.eachRow((row, n) => {
      if (n > 1 && row.getCell(1).value) listed += 1;
    });
    expect(listed).toBe(ENTRIES.length);
  });
});
