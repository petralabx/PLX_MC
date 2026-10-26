// Goals & Production page (TASK-2896): the wording and maths helpers, the
// refresh-run poller, and every section rendered from the 2026-10-14 fixture
// (M1–M7 entered) — the numbers the brief publishes must appear as written.
// Browser behaviour (refresh flow, filters, failures, layout, a11y) is in
// e2e/goals.spec.ts and e2e/ui-goals-*.spec.ts.

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { niceMax, ticksFor } from "@/components/mc/charts";
import { DailyLine1Chart, DailyRevenueChart, DailyTable, SizeHistoryChart } from "@/components/mc/goals/charts";
import { GoalCards } from "@/components/mc/goals/goal-cards";
import {
  barParts,
  cents,
  compactKg,
  dollars,
  filterBatches,
  isReady,
  newestRun,
  nextRefreshAt,
  nextSort,
  rate,
  refreshedText,
  sortBatches,
  sourceText,
  stepText,
  when,
  wholeKg,
  type ReadyPage,
} from "@/components/mc/goals/helpers";
import { GoalsView } from "@/components/mc/goals";
import { RUN_POLL_FAILURES, RUN_POLL_MS, watchRun } from "@/components/mc/goals/run-watch";
import { Section } from "@/components/mc/goals/section";
import { BatchList, CompletedTiles, EntriesTable, RulesText, ScheduledTiles, TruckloadTable } from "@/components/mc/goals/tables";
import type { RefreshRun } from "@/lib/reporting/goals";

import { RUN, goalsPage } from "./reporting-goals-helpers";

const PAGE = goalsPage();
if (!isReady(PAGE)) throw new Error("fixture page should be ready");
const READY: ReadyPage = PAGE;

const html = <P extends object>(component: ComponentType<P>, props: P) => renderToStaticMarkup(createElement(component, props));
/** Visible text with tags dropped and whitespace collapsed. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("wording helpers", () => {
  it("formats money as the brief writes it", () => {
    expect(dollars(36701416)).toBe("$367,014");
    expect(dollars(42857143)).toBe("$428,571");
    expect(cents(3139440)).toBe("$31,394.40");
    expect(cents(-150)).toBe("-$1.50");
    expect(rate("1.421900")).toBe("1.4219");
    expect(rate("1.250000")).toBe("1.25");
    expect(rate("2.000000")).toBe("2");
  });

  it("shows kg whole, and compact on chart axes", () => {
    expect(wholeKg(91_702)).toBe("91,702");
    expect(wholeKg(25_253.692)).toBe("25,254");
    expect(wholeKg(7_250.5)).toBe("7,251");
    expect([0, 20_000, 80_000, 1_200_000].map(compactKg)).toEqual(["0", "20K", "80K", "1.2M"]);
  });

  it("speaks Toronto time and names the run and queries", () => {
    expect(when(RUN.finishedAt!)).toBe("Oct 14, 6:00 AM");
    expect(refreshedText(RUN)).toBe("Refreshed 6:00 AM · FileMaker through Oct 14 · Sage through Oct 14");
    expect(sourceText(RUN, ["daily", "batches"])).toBe("From queries daily, batches · run #41, Oct 14, 6:00 AM");
    expect(sourceText(RUN, ["daily"])).toBe("From query daily · run #41, Oct 14, 6:00 AM");
    expect(stepText("reading-sources")).toBe("Reading FileMaker and Sage");
    expect(stepText(null)).toBe("Refreshing");
  });

  it("counts the run the page just followed toward the 5-minute limit", () => {
    // Bugbot on #321: right after a run finishes, the reloaded page model may not
    // carry it yet (or the reload failed); the run the page followed still counts.
    const earlier = { ...RUN, id: 40, startedAt: "2026-10-14T10:00:02.000Z" };
    const justRan = { ...RUN, id: 42, startedAt: "2026-10-14T13:41:50.000Z" };
    expect(newestRun(earlier, null, justRan)).toBe(justRan);
    expect(newestRun(null, undefined, null)).toBeNull();
    expect(nextRefreshAt(newestRun(earlier, null, justRan), Date.parse("2026-10-14T13:42:30.000Z"))).toBe(
      Date.parse(justRan.startedAt) + 300_000
    );
  });

  it("allows a user refresh 5 minutes after the newest run started", () => {
    const started = Date.parse(RUN.startedAt);
    expect(nextRefreshAt(RUN, started + 60_000)).toBe(started + 300_000);
    expect(nextRefreshAt(RUN, started + 300_000)).toBeNull();
    expect(nextRefreshAt(null, started)).toBeNull();
  });

  it("splits a progress bar without ever overflowing the track", () => {
    expect(barParts({ inSystem: 6, byHand: 2, schedule: 17, scale: 42, tickAt: 18 })).toEqual({
      system: 6 / 42,
      byHand: 2 / 42,
      schedule: 17 / 42,
      tick: 18 / 42,
    });
    const over = barParts({ inSystem: 40, byHand: 10, schedule: 10, scale: 42, tickAt: 50 });
    expect(over.system + over.byHand + over.schedule).toBeCloseTo(1);
    expect(over.tick).toBe(1);
    expect(barParts({ inSystem: 1, byHand: 0, scale: 0 }).system).toBe(1);
  });

  it("knows when a page model can render every section", () => {
    expect(isReady(PAGE)).toBe(true);
    expect(isReady(null)).toBe(false);
    expect(isReady({ ...PAGE, state: "no_data", model: null })).toBe(false);
  });
});

describe("batch list helpers", () => {
  const rows = READY.model.batches;

  it("filters by stage, source, Line 1 and search", () => {
    const all = filterBatches(rows, { filter: "all", line1Only: false, query: "" });
    expect(all).toHaveLength(rows.length);
    const byHand = filterBatches(rows, { filter: "by_hand", line1Only: false, query: "" });
    expect(byHand.map((r) => r.batch).sort()).toEqual(["BC-26286C", "BC-26290X"]);
    const completed = filterBatches(rows, { filter: "completed", line1Only: false, query: "" });
    expect(completed.length).toBe(32); // 30 in FileMaker + 2 by hand
    expect(filterBatches(rows, { filter: "open_past_date", line1Only: false, query: "" }).every((r) => r.stage === "open_past_date")).toBe(true);
    // Line 1 only: the 8 completed in FileMaker, M1 and M2 by hand, 16 from today and 7 past their date.
    const line1 = filterBatches(rows, { filter: "all", line1Only: true, query: "" });
    expect(line1.length).toBe(33);
    expect(line1.every((r) => r.line1 && r.kg >= 5000)).toBe(true);
    expect(filterBatches(rows, { filter: "completed", line1Only: true, query: "" })).toHaveLength(10);
    expect(filterBatches(rows, { filter: "all", line1Only: false, query: "  bc-26290x " }).map((r) => r.batch)).toEqual(["BC-26290X"]);
  });

  it("sorts by any column, with a stable tie-break, and flips on a second click", () => {
    const byKg = sortBatches(rows, { key: "kg", dir: -1 });
    expect(byKg[0].kg).toBeGreaterThanOrEqual(byKg[1].kg);
    const byDate = sortBatches(rows, { key: "date", dir: 1 });
    expect(byDate.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
    expect(nextSort({ key: "date", dir: 1 }, "date")).toEqual({ key: "date", dir: -1 });
    expect(nextSort({ key: "date", dir: 1 }, "kg")).toEqual({ key: "kg", dir: -1 });
    expect(nextSort({ key: "date", dir: 1 }, "batch")).toEqual({ key: "batch", dir: 1 });
  });
});

describe("following a refresh run", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const running = (step: string): RefreshRun => ({ ...RUN, id: 42, status: "running", step, finishedAt: null });

  it("polls every 2 s, reports each step, and stops when the run finishes", async () => {
    const replies = [running("exchange-rate"), running("reading-sources"), { ...RUN, id: 42 }];
    const load = vi.fn(async () => replies.shift()!);
    const onStep = vi.fn();
    const onDone = vi.fn();
    watchRun(42, { load, onStep, onDone, onLost: vi.fn() });
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS);
    expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ step: "exchange-rate" }));
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS);
    expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ step: "reading-sources" }));
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 5);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("rides out a failed poll but gives up after three in a row", async () => {
    const load = vi.fn(async () => {
      throw new Error("network down");
    });
    const onLost = vi.fn();
    watchRun(42, { load, onStep: vi.fn(), onDone: vi.fn(), onLost });
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * (RUN_POLL_FAILURES - 1));
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS);
    expect(onLost).toHaveBeenCalledWith("network down");
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 5);
    expect(load).toHaveBeenCalledTimes(RUN_POLL_FAILURES);
  });

  it("stops polling when the page goes away", async () => {
    const load = vi.fn(async () => running("saving"));
    const watch = watchRun(42, { load, onStep: vi.fn(), onDone: vi.fn(), onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS);
    watch.stop();
    await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 5);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("goal cards (2026-10-14 with M1–M7)", () => {
  const out = text(html(GoalCards, { page: READY }));

  it("shows Line 1 bulk in kg: 91,702 of 420,000, split, due so far, needed per day and the schedule", () => {
    expect(out).toContain("Line 1 bulk Behind");
    expect(out).toContain(
      "Bulk kg of batches of 5,000 kg or more (assumed to run on Line 1), 20,000 kg per working day (420,000 kg this month)."
    );
    expect(out).toContain("91,702 of 420,000 kg");
    expect(out).toContain("72,652 kg in FileMaker + 19,050 kg entered by hand");
    expect(out).toContain("Due so far: 180,000 kg by Oct 14");
    expect(out).toContain("Needed per working day: 25,254 kg over 13 working days");
    expect(out).toContain("If every scheduled batch runs: 295,197 kg (136,555 kg from today, 66,940 kg open past their date)");
  });

  it("builds the Line 1 definition from the settings, never from fixed numbers", () => {
    const page = goalsPage();
    if (!isReady(page)) throw new Error("ready");
    const custom = { ...page, settings: { ...page.settings, line1MinKg: 6_000, line1KgPerWorkingDay: 25_000 } };
    const card = text(html(GoalCards, { page: custom }));
    expect(card).toContain("Bulk kg of batches of 6,000 kg or more (assumed to run on Line 1), 25,000 kg per working day");
  });

  it("shows full truckloads without a status chip and against last month", () => {
    expect(out).toContain("Full truckloads Shipments with US$18,000 or more of product to the 5 truckload customers. 3 · no monthly target set");
    expect(out).toContain("2 in Sage + 1 entered by hand");
    expect(out).toContain("Last month: 7 full, 5 partial, US$215,066 of product");
  });

  it("shows revenue: $408,628 of $1,000,000, the split, the rate and what's needed", () => {
    expect(out).toContain("Revenue Behind");
    expect(out).toContain("$408,628 of $1,000,000");
    expect(out).toContain("$367,014 in Sage + $41,614 entered by hand");
    expect(out).toContain("Due so far: $428,571 by Oct 14");
    expect(out).toContain("Needed per working day: $45,490");
    expect(out).toContain("CAD $121,838 (57 invoices) + USD US$172,429 (13 invoices) = $245,176 at 1.4219 (Bank of Canada, Oct 13)");
  });

  it("marks the by-hand figures amber and names query and run in the tooltips", () => {
    const markup = html(GoalCards, { page: READY });
    expect(markup).toContain('<span class="gp-amber">19,050 kg entered by hand</span>');
    expect(markup).toContain('title="From query batches · run #41, Oct 14, 6:00 AM"');
    expect(markup).toContain('title="From query revenue-by-currency · run #41, Oct 14, 6:00 AM"');
  });

  it("hides the amber part at zero and flags a stored exchange rate", () => {
    const plain = goalsPage({}, []);
    if (!isReady(plain)) throw new Error("ready");
    const stale = { ...plain, fx: { ...plain.fx, source: "stored" as const, stale: true } };
    const markup = html(GoalCards, { page: stale });
    expect(markup).not.toContain("entered by hand</span>");
    expect(text(markup)).toContain("72,652 kg in FileMaker Due so far");
    expect(text(markup)).toContain("stored rate from Oct 13; the Bank of Canada rate couldn't be fetched");
  });
});

describe("tables and tiles", () => {
  it("lists truckloads by customer with amber by-hand columns and a total", () => {
    const markup = html(TruckloadTable, { page: READY });
    const out = text(markup);
    expect(out).toContain("A1 American A1TEXT11 1 0 31,394.40 1 0 24,500.00 3 1 88,512.70");
    expect(out).toContain("Diversified Hospitality DIVE11 1 0 22,705.92");
    expect(out).toContain("Total 2 0 54,100.32 1 0 24,500.00 7 5 215,065.66");
    expect(markup).toContain('<td class="num hand">1</td>');
  });

  it("shows every entry with its status; ones that no longer count are dimmed, not hidden", () => {
    const markup = html(EntriesTable, { page: READY });
    expect(markup.match(/<tr class="hand( retired)?">/g)).toHaveLength(7);
    expect(markup.match(/<tr class="hand retired">/g)).toHaveLength(3);
    const out = text(markup);
    for (const label of ["In FileMaker now", "In Sage now", "Not this month", "Counted"]) expect(out).toContain(label);
    expect(out).toContain("M003 Shipment Oct 14 PO0104001");
  });

  it("says so when nothing was entered by hand", () => {
    const plain = goalsPage({}, []);
    if (!isReady(plain)) throw new Error("ready");
    expect(text(html(EntriesTable, { page: plain }))).toContain("No entries by hand.");
  });

  it("tiles completed and scheduled batches by size", () => {
    const done = text(html(CompletedTiles, { tiles: READY.model.sizes.completed }));
    expect(done).toContain("~10,000 kg 4 8.9 per 20 working days");
    expect(done).toContain("Total 30 66.7 per 20 working days 99,660 kg 2 not yet QC released");
    const scheduled = text(html(ScheduledTiles, { tiles: READY.model.sizes.scheduledFromToday, openPastDate: READY.model.sizes.openPastDate }));
    expect(scheduled).toContain("Total 44 171,044 kg planned");
    expect(scheduled).toContain("Plus 19 batches of every size still open past their scheduled date.");
  });

  it("lists every batch, by-hand rows in amber", () => {
    const markup = html(BatchList, { page: READY });
    expect(text(markup)).toContain(`Showing ${READY.model.batches.length} of ${READY.model.batches.length} batches`);
    expect(markup.match(/<tr class="hand">/g)).toHaveLength(2);
    expect(markup).toContain('aria-sort="ascending"');
  });

  it("offers a Line 1 only filter worded from the settings, and keeps FileMaker's Line column", () => {
    const markup = html(BatchList, { page: READY });
    expect(text(markup)).toContain("Line 1 only (5,000 kg or more)");
    expect(markup).not.toMatch(/7,500|[Ll]arge/);
    expect(text(markup)).toContain(" Line ");
  });

  it("states the rules with the configured numbers", () => {
    const out = text(html(RulesText, { page: READY }));
    expect(out).toContain("October 2026 has 21 working days");
    expect(out).toContain(
      "Line 1 bulk is the kg of every batch of 5,000 kg or more, whatever line FileMaker records for it: a batch that size is assumed to run on Line 1."
    );
    expect(out).toContain("The goal is 20,000 kg a working day");
    expect(out).not.toMatch(/[Ll]arge batch|7,500/);
    expect(out).toContain("A1 American, Pet Supplies Plus, Diversified Hospitality, 1-Shoppe or Soapbox with US$18,000 or more");
    expect(out).toContain("The target is $1,000,000 a month");
  });
});

describe("charts", () => {
  it("picks round axes that don't waste the plot", () => {
    expect([niceMax(6, true), niceMax(7, true), niceMax(42, true), niceMax(1.0074e8), niceMax(0)]).toEqual([6, 8, 50, 1.2e8, 1]);
    expect(ticksFor(8, true)).toEqual([0, 2, 4, 6, 8]);
    expect(ticksFor(50, true)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(ticksFor(80)).toEqual([0, 20, 40, 60, 80]);
    expect(ticksFor(1.2e8)).toEqual([0, 2e7, 4e7, 6e7, 8e7, 1e8, 1.2e8]);
  });

  it("summarises the daily Line 1 chart for assistive tech and marks today", () => {
    const markup = html(DailyLine1Chart, { page: READY });
    // Still scheduled: 136,555 kg from today + 66,940 kg open past their date = 203,495 kg.
    expect(markup).toContain(
      'aria-label="Line 1 bulk kg per day, October 2026: 91,702 kg done so far (72,652 kg in FileMaker, 19,050 kg entered by hand) and 203,495 kg still scheduled, against 20,000 kg a working day. Weekends and holidays are shaded."'
    );
    expect(markup).toContain(">Today<");
    expect(text(markup)).toContain("Target: 20,000 kg a working day");
    // Compact kg ticks up to the tallest day (Oct 14: 10,106 + 9,000 by hand + 43,000 scheduled = 62,106).
    expect(text(markup.split('<div class="colchart-plot"')[0])).toBe(" 0 20K 40K 60K 80K ");
    // 10 weekend days and Thanksgiving are shaded.
    expect(markup.match(/class="shade"/g)).toHaveLength(10);
  });

  it("lists Line 1 kg per day in the chart table, by hand in amber", () => {
    const markup = html(DailyTable, { page: READY });
    expect(text(markup)).toContain("Line 1 kg done Line 1 kg by hand Line 1 kg scheduled");
    // Oct 13: M1's 10,050 kg by hand; BC-26286G and BC-26286H (18,000 kg) still open.
    expect(text(markup)).toContain("Oct 13 Yes 0 10,050 18,000");
    expect(markup).toContain('<td class="num hand">9,000</td>');
  });

  it("summarises the revenue chart and draws Sage only up to today", () => {
    const markup = html(DailyRevenueChart, { page: READY });
    expect(markup).toContain("Revenue to date in CAD, October 2026: $367,014 in Sage and $408,628 with entries by hand");
    expect(markup).toContain("against $428,571 due so far and $1,000,000 for the month. Last month reached $1,007,365.");
    // One polyline per series: Sage and Sage + by hand stop at today; last month and the target run to the 31st.
    expect(markup.match(/<polyline/g)).toHaveLength(4);
    // Last month's $1,007,365 tops the scale at $1.2M, with the $1M target on a tick.
    expect(text(markup.split('<div class="colchart-plot"')[0])).toBe(" $0 $200K $400K $600K $800K $1M $1.2M ");
  });

  it("draws a line that has only one point so far (the 1st of the month)", () => {
    // Bugbot on #321: an SVG polyline with one point paints nothing.
    const firstDay = goalsPage();
    if (!isReady(firstDay)) throw new Error("ready");
    firstDay.model.daily = firstDay.model.daily.map((d, i) => ({ ...d, isToday: i === 0, isFuture: i > 0 }));
    const markup = html(DailyRevenueChart, { page: firstDay });
    const points = [...markup.matchAll(/<polyline class="line" points="([^"]+)" stroke="var\(--p-(accent|warn)\)"/g)].map((m) => m[1].split(" ").length);
    // Sage and Sage + by hand each draw a short flat segment on day 1.
    expect(points).toEqual([2, 2]);
  });

  it("charts three months by size against this month's pace, with the numbers in a table", () => {
    const out = text(html(SizeHistoryChart, { page: READY }));
    expect(out).toContain("Oct (pace)");
    expect(out).toContain("Monthly numbers");
  });
});

describe("page shell", () => {
  it("renders skeletons, not spinners, before the page model arrives", () => {
    const markup = html(GoalsView, { route: { screen: "goals" }, nav: () => {} });
    expect(text(markup)).toContain("Loading the latest refresh…");
    // One skeleton per section, the shipments list and the revenue forecast included.
    expect(markup).toContain('data-testid="goals-shipments"');
    expect(markup).toContain('data-testid="goals-forecast"');
    expect(markup.match(/class="gp-skel"/g)).toHaveLength(markup.match(/<section /g)?.length ?? -1);
    expect(text(markup)).toContain("Amber marks figures your team entered by hand that aren’t in FileMaker or Sage yet.");
  });

  it("shows Failed to load with Retry in place of a section", () => {
    const markup = html(Section, { id: "x", title: "Truckloads by customer", state: "failed" as const, onRetry: () => {} });
    expect(text(markup)).toContain("Truckloads by customer Failed to load. Retry");
  });
});
