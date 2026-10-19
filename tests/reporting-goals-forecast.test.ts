// Revenue forecast (TASK-3151), pure: the AO ↔ order-line link (the portal's
// OE Fix), the bucket precedence, several AOs on one line, the four numbers to
// the cent, the hit rate from the stored per-run summaries, production with no
// order behind it, and the list's chips, customer class and item category
// filters (TASK-3177), search and totals. The fixture is a
// synthetic October 2026 (tests/fixtures/reporting-goals/2026-10-14/forecast.json,
// what the two forecast queries return for the source rows in
// forecast-source.json), at the run's USD/CAD 1.4219. The SQL-level choices
// (quotes, standing orders, COMPLETE never read, misc lines, the expected-date
// fallback) are tested against Postgres in tests/reporting-goals-postgres.test.ts.

import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ForecastSection } from "@/components/mc/goals/forecast";
import { isReady } from "@/components/mc/goals/helpers";

import {
  FORECAST_CATEGORY_COLUMNS,
  FORECAST_COLUMNS,
  MANUFACTURING_CATEGORIES,
  aoStage,
  buildForecast,
  bucketFor,
  centsToDecimal,
  channelOf,
  computeGoals,
  customerClassOf,
  filterForecastRows,
  fixOeNumber,
  forecastCadCents,
  activeCategoryFilter,
  forecastCategoryOptions,
  forecastRows,
  forecastSummary,
  hitRateMonths,
  isBulkMade,
  linkedOrderNumber,
  oeNumbersFromList,
  otherCurrencyTotals,
  productionWithoutOrders,
  type ForecastAoRow,
  type ForecastBucket,
  type ForecastCategoryFilter,
  type ForecastClassFilter,
  type ForecastDatasets,
  type ForecastLineRow,
  type ForecastReady,
  type ForecastRunPoint,
  type ForecastView,
} from "@/lib/reporting/goals";
import { forecastAosQuery } from "@/lib/reporting/goals/queries/forecast-assembly-orders";
import { forecastOrdersQuery } from "@/lib/reporting/goals/queries/forecast-orders";

import { FORECAST, RATE, RUN, SETTINGS, TODAY, goalsInput, goalsPage } from "./reporting-goals-helpers";

const money = (cents: number | null) => (cents === null ? null : centsToDecimal(cents));
const END = "2026-10-31";
const RUN_RATE = RUN.fxRate!;

function ready(view: ForecastView | null): ForecastReady {
  if (!view || view.state !== "ready") throw new Error(`forecast is ${view?.state ?? "missing"}`);
  return view;
}

/** The page's forecast for the fixture (M1–M7 entered unless `entries` is given). */
function pageForecast(...args: Parameters<typeof goalsPage>): ForecastReady {
  return ready(goalsPage(...args).forecast);
}

function ao(fields: Partial<ForecastAoRow> & { id: string }): ForecastAoRow {
  return {
    ao: `AO-${fields.id}`,
    status: "Allocated",
    scheduled: "2026-10-20",
    item: "FP-1",
    oeList: "OR1000000001",
    qty: "1200",
    unitsPerBox: "12",
    batch: null,
    batchStatus: null,
    openOrder: true,
    ...fields,
  };
}

function line(fields: Partial<ForecastLineRow> & { orderNo: string }): ForecastLineRow {
  return {
    lineNo: 32,
    customerCode: "CUST1",
    customer: "Customer One",
    po: "PO-1",
    item: "FP-1",
    description: "Hand soap",
    expected: "2026-10-20",
    qty: "100.0000",
    unit: "CSE",
    unitPrice: "10.000000",
    currency: "CAD",
    category: "PLABEL",
    laterQty: "0",
    ...fields,
  };
}

const data = (lines: ForecastLineRow[], aos: ForecastAoRow[]): ForecastDatasets => ({ access: "read", missing: [], categoryMissing: [], lines, aos });

describe("the link: Sage order number + item ↔ the AO's order list + item code (the portal's OE Fix)", () => {
  it("normalizes an order number as the portal's OE Fix does", () => {
    expect(fixOeNumber("OR1000160001")).toBe("OR1000160001");
    // The sixth character is "0": the first 12 characters, so trailing notes drop.
    expect(fixOeNumber("OR1000160012 (rush)")).toBe("OR1000160012");
    // Otherwise "OR1000" and the six characters from the sixth on.
    expect(fixOeNumber("OR10 158877")).toBe("OR1000158877");
    expect(fixOeNumber("  ")).toBe("");
    expect(fixOeNumber(null)).toBe("");
  });

  it("reads every order in a free-text list, fixed, once each, and links the AO to the first", () => {
    expect(oeNumbersFromList("OR10 158877, OR1000160010;OR1000160010 ,")).toEqual(["OR1000158877", "OR1000160010"]);
    expect(linkedOrderNumber("OR10 158877, OR1000160010")).toBe("OR1000158877");
    expect(linkedOrderNumber(null)).toBeNull();
    expect(linkedOrderNumber("   ")).toBeNull();
  });

  it("an AO listing two orders covers the first order's line only; the second shows Not planned", () => {
    const rows = forecastRows(FORECAST.data, TODAY, RUN_RATE);
    const first = rows.filter((r) => r.orderNo === "OR1000158877");
    const second = rows.filter((r) => r.orderNo === "OR1000160010");
    expect(first.map((r) => [r.bucket, r.ao?.number])).toEqual([["planned", "AO-26299K"]]);
    expect(second.map((r) => [r.bucket, r.ao])).toEqual([["not_planned", null]]);
  });

  it("works out openOrder from the open orders of any date that share the AO's item, with the TS OE Fix", () => {
    const base = { id: "1", ao: "AO-1", status: "Allocated", scheduled: "2026-10-20", item: "FP-1", qty: "10", units_per_box: "1", batch: null, batch_status: null };
    const out = forecastAosQuery.map([
      { ...base, oe_list: "OR10 158877, OR1000160010", open_orders: ["OR1000158877", "OR1000160010"] },
      // Matched by the SQL's loose prefilter (same last six digits) but not linked: OR2000… is another order.
      { ...base, id: "2", oe_list: "OR2000160002", open_orders: ["OR1000160002"] },
      { ...base, id: "3", oe_list: null, open_orders: [] },
    ]);
    expect(out.map((r) => [r.id, r.oeList, r.openOrder])).toEqual([
      ["1", "OR10 158877, OR1000160010", true],
      ["2", "OR2000160002", false],
      ["3", null, false],
    ]);
  });
});

describe("buckets: one per line portion, by the approved precedence", () => {
  it("reads AO statuses like the portal: Realized/Completed packed, Cancelled never counts", () => {
    expect(["Realized", " realized ", "Completed"].map(aoStage)).toEqual(["realized", "realized", "realized"]);
    expect(["Cancelled", "CANCELED"].map(aoStage)).toEqual(["cancelled", "cancelled"]);
    expect(["Allocated", "Committed", "Generated", null].map(aoStage)).toEqual(["open", "open", "open", "open"]);
    expect([isBulkMade("Realized"), isBulkMade("realized "), isBulkMade("Committed"), isBulkMade(null)]).toEqual([true, true, false, false]);
  });

  it("applies the six rules in order", () => {
    const at = (fields: Partial<ForecastAoRow>) => bucketFor(ao({ id: "x", ...fields }), TODAY, END);
    // 1. Packed beats everything, even a date after month end and no bulk.
    expect(at({ status: "Realized", scheduled: "2026-11-20" })).toBe("ready");
    // 2. Scheduled after month end can't ship this month, even with its bulk made.
    expect(at({ scheduled: "2026-11-01", batchStatus: "Realized" })).toBe("late");
    // 3. Bulk made: only packing remains, whether the AO is later this month or past its date.
    expect(at({ scheduled: "2026-10-28", batchStatus: "Realized" })).toBe("ready");
    expect(at({ scheduled: "2026-10-02", batchStatus: "Realized" })).toBe("ready");
    // 4. From today to month end, both inclusive.
    expect(at({ scheduled: TODAY })).toBe("planned");
    expect(at({ scheduled: END, batchStatus: "Committed" })).toBe("planned");
    // 5. Before today and not done.
    expect(at({ scheduled: "2026-10-13" })).toBe("late");
    // 6. No AO.
    expect(bucketFor(null, TODAY, END)).toBe("not_planned");
    // An AO with no scheduled date isn't on the plan (unless it's packed or its bulk is made).
    expect(at({ scheduled: null })).toBe("not_planned");
    expect(at({ scheduled: null, batchStatus: "Realized" })).toBe("ready");
  });

  it("buckets the fixture's 15 open lines into 18 rows, each in exactly one bucket", () => {
    const rows = forecastRows(FORECAST.data, TODAY, RUN_RATE);
    expect(rows.map((r) => [r.orderNo, r.qty, r.bucket, r.ao?.number ?? null])).toEqual([
      ["OR1000160001", 400, "ready", "AO-26279A"], // AO packed
      ["OR1000160006", 200, "late", "AO-26282F"], // AO Oct 9, not done
      ["OR1000160012", 100, "ready", "AO-26286M"], // AO past its date, bulk made
      ["OR1000160004", 6000, "planned", "AO-26287D"], // AO today
      ["OR1000160015", 100, "planned", "AO-26295R"], // the packed Sep AO's output already shipped
      ["OR1000160002", 10000, "late", "AO-26307B"], // AO Nov 3, though its bulk is made
      ["OR1000160011", 500, "planned", "AO-26292L"], // EUR
      ["OR1000160003", 250, "ready", "AO-26293C"], // AO Oct 20 and bulk made
      ["OR1000160008", 400, "ready", "AO-26275G"],
      ["OR1000160008", 300, "planned", "AO-26295H"],
      ["OR1000160008", 200, "late", "AO-26314J"],
      ["OR1000160008", 100, "not_planned", null], // no AO for the rest
      ["OR1000160007", 1200, "not_planned", null],
      ["OR1000158877", 80, "planned", "AO-26299K"],
      ["OR1000160014", 20, "not_planned", "AO-26289P"], // its AO has no date
      ["OR1000160010", 40, "not_planned", null],
      ["OR1000160005", 300, "planned", "AO-26301E"],
      ["OR1000160013", 60, "not_planned", null], // its only AO is cancelled
    ]);
    // Every line's quantity is split exactly across its rows.
    for (const l of FORECAST.data.lines) {
      const split = rows.filter((r) => r.orderNo === l.orderNo).reduce((n, r) => n + r.qty, 0);
      expect(split, l.orderNo).toBe(Number(l.qty));
    }
  });

  it("names each row's AO and its bulk batch (finalized link, else the planning link)", () => {
    const rows = forecastRows(FORECAST.data, TODAY, RUN_RATE);
    const of = (order: string) => rows.find((r) => r.orderNo === order)!;
    expect(of("OR1000160002").ao).toEqual({ id: "11402", number: "AO-26307B", scheduled: "2026-11-03", status: "Allocated" });
    expect(of("OR1000160002").bulk).toEqual({ batch: "BC-26162B", status: "Realized" });
    expect(of("OR1000160007").bulk).toBeNull();
    expect(rows.find((r) => r.ao?.number === "AO-26314J")!.bulk).toEqual({ batch: null, status: null });
  });
});

describe("several AOs on one line (each keeps its own date and quantity)", () => {
  it("splits a line across its AOs, packed first then by date, and leaves the rest Not planned", () => {
    const rows = forecastRows(FORECAST.data, TODAY, RUN_RATE).filter((r) => r.orderNo === "OR1000160008");
    expect(rows.map((r) => [r.bucket, r.qty, money(r.valueCents), money(r.cadCents)])).toEqual([
      ["ready", 400, "12000.00", "17062.80"],
      ["planned", 300, "9000.00", "12797.10"],
      ["late", 200, "6000.00", "8531.40"],
      ["not_planned", 100, "3000.00", "4265.70"],
    ]);
    // The portions add up to the line: 1,000 cases × US$30.
    expect(rows.reduce((n, r) => n + r.valueCents, 0)).toBe(3_000_000);
  });

  it("takes AO output beyond what the line still needs as already shipped, oldest first", () => {
    const rows = forecastRows(
      data(
        [line({ orderNo: "OR1000000001", qty: "100.0000" })],
        [
          ao({ id: "old", status: "Realized", scheduled: "2026-09-20", qty: "1200" }), // 100 cases, shipped already
          ao({ id: "new", scheduled: "2026-10-22", qty: "600" }), // 50 cases
        ]
      ),
      TODAY,
      RATE
    );
    expect(rows.map((r) => [r.ao?.id, r.qty, r.bucket])).toEqual([
      ["old", 50, "ready"],
      ["new", 50, "planned"],
    ]);
  });

  it("shares one order and item's AOs between its lines in expected-date order", () => {
    const rows = forecastRows(
      data(
        [
          line({ orderNo: "OR1000000001", lineNo: 32, expected: "2026-10-10", qty: "60.0000" }),
          line({ orderNo: "OR1000000001", lineNo: 64, expected: "2026-10-30", qty: "60.0000" }),
        ],
        [ao({ id: "a", status: "Realized", scheduled: "2026-10-05", qty: "960" }), ao({ id: "b", scheduled: "2026-11-02", qty: "600" })]
      ),
      TODAY,
      RATE
    );
    expect(rows.map((r) => [r.lineNo, r.ao?.id ?? null, r.qty, r.bucket])).toEqual([
      // 80 + 50 cases for 120 needed: the oldest 10 shipped already.
      [32, "a", 60, "ready"],
      [64, "a", 10, "ready"],
      [64, "b", 50, "late"],
    ]);
  });

  it("counts the order's later lines of the item as still needed, so the output made for them isn't taken as shipped", () => {
    // October's 100 cases, and 100 more on the order's November line: a packed AO made October's, an AO
    // in November makes November's. Nothing has shipped, so October's line is Ready.
    const aos = [ao({ id: "oct", status: "Realized", scheduled: "2026-10-05", qty: "1200" }), ao({ id: "nov", scheduled: "2026-11-05", qty: "1200" })];
    const rows = (laterQty: string) =>
      forecastRows(data([line({ orderNo: "OR1000000001", qty: "100.0000", laterQty })], aos), TODAY, RATE).map((r) => [r.ao?.id, r.qty, r.bucket]);
    expect(rows("100.0000")).toEqual([["oct", 100, "ready"]]);
    // With no later line, output beyond the 100 still to ship has shipped (the packed AO's), so October waits for November's AO.
    expect(rows("0")).toEqual([["nov", 100, "late"]]);
  });

  it("converts the AO's pieces to the line's unit: cases by units per box, else pieces", () => {
    const one = (fields: Partial<ForecastLineRow>, aoFields: Partial<ForecastAoRow>) =>
      forecastRows(data([line({ orderNo: "OR1000000001", ...fields })], [ao({ id: "a", ...aoFields })]), TODAY, RATE).map((r) => [r.qty, r.bucket]);
    // 600 pieces at 12 a box = 50 cases of 100: the other 50 aren't planned.
    expect(one({ unit: "CSE" }, { qty: "600", unitsPerBox: "12" })).toEqual([[50, "planned"], [50, "not_planned"]]);
    // An each line takes pieces as they are.
    expect(one({ unit: "EA", qty: "600.0000" }, { qty: "600", unitsPerBox: "12" })).toEqual([[600, "planned"]]);
    // One unit a box: no conversion (the portal's "fmconv > 1" rule).
    expect(one({ unit: "CSE" }, { qty: "100", unitsPerBox: "1" })).toEqual([[100, "planned"]]);
    // An AO without a readable quantity covers nothing.
    expect(one({}, { qty: null })).toEqual([[100, "not_planned"]]);
  });

  it("never links a cancelled AO", () => {
    const rows = forecastRows(data([line({ orderNo: "OR1000000001" })], [ao({ id: "c", status: "Cancelled", qty: "1200" })]), TODAY, RATE);
    expect(rows.map((r) => [r.bucket, r.ao])).toEqual([["not_planned", null]]);
  });
});

describe("values", () => {
  it("values a row at quantity × unit price in the order's currency, and converts USD at the run's rate, half to even", () => {
    const rows = forecastRows(FORECAST.data, TODAY, RUN_RATE);
    const of = (order: string) => rows.find((r) => r.orderNo === order)!;
    expect([money(of("OR1000160004").valueCents), money(of("OR1000160004").cadCents)]).toEqual(["13500.00", "19195.65"]);
    expect([money(of("OR1000160006").valueCents), money(of("OR1000160006").cadCents)]).toEqual(["7300.00", "7300.00"]);
    // The value rounds to the cent in its currency first (1 × US$0.125 = 0.125 → 0.12, half to even),
    // then converts (US$25,750 × 1.4219 = 36,613.925 → 36,613.92, as the Revenue card rounds).
    const halves = forecastRows(
      data(
        [
          line({ orderNo: "OR1000000001", qty: "1.0000", unitPrice: "0.125000", currency: "USD" }),
          line({ orderNo: "OR1000000002", qty: "1.0000", unitPrice: "25750.000000", currency: "USD" }),
        ],
        []
      ),
      TODAY,
      "1.4219"
    );
    expect(halves.map((r) => [money(r.valueCents), money(r.cadCents)])).toEqual([
      ["0.12", "0.17"],
      ["25750.00", "36613.92"],
    ]);
  });

  it("lists other currencies without converting them", () => {
    const rows = forecastRows(FORECAST.data, TODAY, RUN_RATE);
    const eur = rows.find((r) => r.currency === "EUR")!;
    expect([money(eur.valueCents), eur.cadCents]).toEqual(["2100.00", null]);
    expect(otherCurrencyTotals(rows)).toEqual([{ currency: "EUR", cents: 210_000, rows: 1 }]);
  });

  it("includes overdue lines and flags them; their bucket comes from the AO", () => {
    const rows = forecastRows(FORECAST.data, TODAY, RUN_RATE);
    const overdue = rows.filter((r) => r.overdue).map((r) => [r.orderNo, r.expected, r.bucket]);
    expect(overdue).toEqual([
      ["OR1000160001", "2026-10-09", "ready"],
      ["OR1000160006", "2026-10-12", "late"],
    ]);
  });
});

describe("the four numbers, against the $1,000,000 target", () => {
  it("adds up on the fixture with M1–M7 entered, to the cent", () => {
    const f = pageForecast();
    expect(money(f.invoicedCents)).toBe("408628.08");
    expect(Object.fromEntries(Object.entries(f.buckets).map(([k, v]) => [k, [money(v.cents), v.rows]]))).toEqual({
      ready: ["53762.80", 4],
      planned: ["64627.53", 6],
      late: ["27917.55", 3],
      not_planned: ["12785.70", 5],
    });
    expect(money(f.theoreticalCents)).toBe("527018.41");
    expect(money(f.atRiskCents)).toBe("40703.25");
    expect(f.pace).toEqual({ cents: 95_346_552, coveredDays: 9, workingDays: 21 });
    expect(money(f.targetCents)).toBe("1000000.00");
  });

  it("follows the Revenue card: without entries the invoiced figure, Theoretical and Pace drop", () => {
    const f = pageForecast({}, []);
    expect(money(f.invoicedCents)).toBe("367014.16");
    expect(money(f.theoreticalCents)).toBe("485404.49");
    expect(money(f.atRiskCents)).toBe("40703.25");
    expect(money(f.pace!.cents)).toBe("856366.37");
  });

  it("has no Pace before a working day is covered", () => {
    const model = computeGoals(goalsInput({ today: "2026-10-01", data: { ...goalsInput().data, cutoffs: { productionCutoff: null, sageCutoff: null } } }));
    const f = ready(buildForecast({ snapshot: FORECAST, model, settings: SETTINGS, rate: RUN_RATE }));
    expect(f.pace).toBeNull();
  });

  it("Realistic: invoiced + (Ready + Planned in time) × September's 80% hit rate", () => {
    const f = pageForecast();
    expect(money(f.realistic!.cents)).toBe("503340.34");
    expect(f.realistic!.hitRate).toBeCloseTo(0.8, 12);
    expect(f.realistic!.months).toEqual([
      {
        month: "2026-09-01",
        label: "September 2026",
        firstRunId: 20,
        firstRunDay: "2026-09-01",
        closingRunId: 41,
        readyPlannedCents: 118_750_000,
        invoicedAfterCents: 95_000_000,
      },
    ]);
  });
});

describe("the hit rate, measured from the stored per-run summaries", () => {
  const sage = (cadThis: number, usdThis: number, cadLast: number, usdLast: number) => ({
    cadThisMonth: Math.round(cadThis * 100),
    usdThisMonth: Math.round(usdThis * 100),
    cadLastMonth: Math.round(cadLast * 100),
    usdLastMonth: Math.round(usdLast * 100),
  });
  const point = (runId: number, today: string, rate: string, readyPlanned: number | null, s: ForecastRunPoint["sage"]): ForecastRunPoint => ({
    runId,
    today,
    rate,
    readyPlannedCents: readyPlanned === null ? null : Math.round(readyPlanned * 100),
    sage: s,
  });
  // July: 1,000,000 ready + planned at its first run; 730,000 invoiced after it (600,000 CAD + US$100,000 × 1.30).
  // August: 500,000; 470,000 after (400,000 + US$50,000 × 1.40). September: 800,000; 970,000 after (700,000 + US$200,000 × 1.35).
  // BEFORE is a run from before the forecast, so July's first runs are on record.
  const BEFORE = point(0, "2026-06-30", "1.300000", null, sage(0, 0, 0, 0));
  const THREE: ForecastRunPoint[] = [
    point(1, "2026-07-02", "1.300000", 1_000_000, sage(0, 0, 0, 0)),
    point(2, "2026-07-20", "1.310000", 2_000_000, sage(300_000, 0, 0, 0)), // not July's first run
    point(3, "2026-08-04", "1.400000", 500_000, sage(10_000, 0, 999_999, 0)),
    point(4, "2026-08-31", "1.400000", 400_000, sage(380_000, 40_000, 600_000, 100_000)), // closes July
    point(5, "2026-09-01", "1.350000", 800_000, sage(0, 20_000, 400_000, 45_000)),
    point(6, "2026-09-30", "1.350000", 50_000, sage(690_000, 200_000, 410_000, 50_000)), // closes August
    point(7, "2026-10-01", "1.360000", null, sage(0, 0, 690_000, 210_000)), // waiting for access
    point(8, "2026-10-14", "1.421900", 118_390.33, sage(121_837.71, 172_428.76, 700_000, 220_000)), // closes September
  ];

  it("takes each complete month's first good run and the last run of the month after", () => {
    expect(hitRateMonths([BEFORE, ...THREE], TODAY).map((m) => [m.month, m.firstRunId, m.closingRunId, money(m.readyPlannedCents), money(m.invoicedAfterCents)])).toEqual([
      ["2026-09-01", 5, 8, "800000.00", "970000.00"],
      ["2026-08-01", 3, 6, "500000.00", "470000.00"],
      ["2026-07-01", 1, 4, "1000000.00", "730000.00"],
    ]);
    // The oldest month on record never counts: runs are kept 90 days, so its first runs may be gone.
    expect(hitRateMonths(THREE, TODAY).map((m) => m.month)).toEqual(["2026-09-01", "2026-08-01"]);
  });

  it("Realistic averages up to the three latest complete months", () => {
    const f = ready(buildForecast({ snapshot: { ...FORECAST, history: [BEFORE, ...THREE] }, model: goalsPage().model!, settings: SETTINGS, rate: RUN_RATE }));
    // (0.73 + 0.94 + 1.2125) ÷ 3 of 118,390.33, each month rounded to the cent first, then the mean.
    expect(money(f.realistic!.cents)).toBe("522381.46");
    expect(f.realistic!.hitRate).toBeCloseTo((0.73 + 0.94 + 1.2125) / 3, 12);
    // A fourth, older complete month is left out.
    const june = [point(-1, "2026-05-29", "1.300000", null, sage(0, 0, 0, 0)), point(0, "2026-06-01", "1.300000", 100_000, sage(0, 0, 0, 0))];
    const four = ready(
      buildForecast({ snapshot: { ...FORECAST, history: [...june, ...THREE] }, model: goalsPage().model!, settings: SETTINGS, rate: RUN_RATE })
    );
    expect(four.realistic!.months.map((m) => m.month)).toEqual(["2026-09-01", "2026-08-01", "2026-07-01"]);
    expect(four.realistic!.cents).toBe(f.realistic!.cents);
  });

  it("skips a month without a run in the month after, or whose first good run had no forecast or nothing ready or planned", () => {
    const noClose = [BEFORE, ...THREE].filter((p) => p.today.slice(0, 7) !== "2026-08"); // July can't close; August has no run
    expect(hitRateMonths(noClose, TODAY).map((m) => m.month)).toEqual(["2026-09-01"]);
    const empty = [BEFORE, ...THREE].map((p) => (p.runId === 5 ? { ...p, readyPlannedCents: 0 } : p));
    expect(hitRateMonths(empty, TODAY).map((m) => m.month)).toEqual(["2026-08-01", "2026-07-01"]);
    // August's first good run was waiting for access: a later run's forecast doesn't stand in for it.
    const waited = [BEFORE, ...THREE].map((p) => (p.runId === 3 ? { ...p, readyPlannedCents: null } : p));
    expect(hitRateMonths(waited, TODAY).map((m) => m.month)).toEqual(["2026-09-01", "2026-07-01"]);
  });

  it("with no complete month to measure, Realistic has no number and names the first month it will measure", () => {
    const build = (history: ForecastRunPoint[]) =>
      ready(buildForecast({ snapshot: { ...FORECAST, history }, model: goalsPage().model!, settings: SETTINGS, rate: RUN_RATE }));
    const october = FORECAST.history.find((p) => p.today === TODAY)!;
    const august = point(12, "2026-08-31", "1.380000", null, sage(0, 0, 0, 0)); // from before the forecast
    // October's first good run had a forecast and an earlier month is on record: October counts once it ends.
    const f = build([august, october]);
    expect([f.realistic, f.measuredFrom]).toEqual([null, "2026-10-01"]);
    // Not when October's first good run was waiting for access, nor when October is the oldest month on record.
    const waiting = point(30, "2026-10-01", "1.360000", null, sage(0, 0, 0, 0));
    expect(build([august, waiting, october]).measuredFrom).toBe("2026-11-01");
    expect(build([october]).measuredFrom).toBe("2026-11-01");
  });
});

describe("production with no order behind it (a note, never revenue)", () => {
  it("counts open AOs scheduled this month that match no open Sage order line", () => {
    expect(productionWithoutOrders(FORECAST.data.aos, TODAY)).toEqual({ count: 2, pieces: 8400 });
    expect(pageForecast().unordered).toEqual({ count: 2, pieces: 8400 });
    // Packed, cancelled, unscheduled and next month's AOs are left out.
    const more = [
      ...FORECAST.data.aos,
      ao({ id: "p", status: "Realized", scheduled: "2026-10-03", openOrder: false }),
      ao({ id: "c", status: "Cancelled", scheduled: "2026-10-03", openOrder: false }),
      ao({ id: "u", scheduled: null, openOrder: false }),
      ao({ id: "n", scheduled: "2026-11-02", openOrder: false }),
    ];
    expect(productionWithoutOrders(more, TODAY)).toEqual({ count: 2, pieces: 8400 });
  });
});

describe("states", () => {
  it("before the first refresh with a forecast, and while the login can't read the tables", () => {
    const model = goalsPage().model!;
    expect(buildForecast({ snapshot: null, model, settings: SETTINGS, rate: RUN_RATE })).toEqual({ state: "not_in_run" });
    const waiting = buildForecast({
      snapshot: {
        data: {
          access: "missing",
          missing: ["sage.oe_order_header.type", "sage.oe_order_header.expdate", "public.assembly_order.qtytotal"],
          categoryMissing: [],
          lines: [],
          aos: [],
        },
        history: [],
      },
      model,
      settings: SETTINGS,
      rate: RUN_RATE,
    });
    expect(waiting).toEqual({
      state: "waiting_for_access",
      missing: [
        { relation: "sage.oe_order_header", columns: ["type", "expdate"] },
        { relation: "public.assembly_order", columns: ["qtytotal"] },
      ],
    });
  });

  it("stores, per run, the four buckets from Sage and FileMaker only", () => {
    expect(forecastSummary(FORECAST.data, TODAY, RUN_RATE)).toEqual({
      lines: 15,
      rows: 18,
      readyCents: 5_376_280,
      plannedCents: 6_462_753,
      lateCents: 2_791_755,
      notPlannedCents: 1_278_570,
    });
  });
});

describe("the list: bucket chips, search and totals that follow them", () => {
  const rows = pageForecast().rows;
  const view = (filter: "all" | ForecastBucket, query = "") => {
    const shown = filterForecastRows(rows, { filter, query });
    return { rows: shown.length, cad: money(forecastCadCents(shown)), other: otherCurrencyTotals(shown) };
  };

  it("counts each chip and totals the CAD of what is shown", () => {
    expect(view("all")).toEqual({ rows: 18, cad: "159093.58", other: [{ currency: "EUR", cents: 210_000, rows: 1 }] });
    expect(view("ready")).toMatchObject({ rows: 4, cad: "53762.80" });
    expect(view("planned")).toMatchObject({ rows: 6, cad: "64627.53" });
    expect(view("late")).toEqual({ rows: 3, cad: "27917.55", other: [] });
    expect(view("not_planned")).toMatchObject({ rows: 5, cad: "12785.70" });
  });

  it("searches order, customer (name or code), PO, item, description and AO, ignoring case and spacing", () => {
    // A1 American's billing name has a no-break space.
    expect(view("all", "a1 american")).toMatchObject({ rows: 5, cad: "54743.15" });
    expect(view("all", "a1text11")).toMatchObject({ rows: 5 });
    expect(view("all", "ao-26295")).toMatchObject({ rows: 2, cad: "14797.10" });
    expect(view("all", " PO-5511 ")).toEqual({ rows: 1, cad: "0.00", other: [{ currency: "EUR", cents: 210_000, rows: 1 }] });
    expect(view("all", "hand sanitizer")).toMatchObject({ rows: 2, cad: "11400.00" });
    expect(view("all", "fp-1001")).toMatchObject({ rows: 1 });
    expect(view("all", "or1000160008")).toMatchObject({ rows: 4 });
    expect(view("planned", "diversified")).toMatchObject({ rows: 1, cad: "7600.00" });
    expect(view("late", "nothing like this")).toEqual({ rows: 0, cad: "0.00", other: [] });
  });
});

describe("the list: customer class and item category (TASK-3177)", () => {
  const rows = pageForecast().rows;
  const view = (customerClass: ForecastClassFilter, category: ForecastCategoryFilter, filter: "all" | ForecastBucket = "all") => {
    const shown = filterForecastRows(rows, { filter, query: "", customerClass, category });
    return { rows: shown.length, cad: money(forecastCadCents(shown)) };
  };

  it("classes customers from the workbook's Customer categories sheet; one not on it is Unclassified", () => {
    expect(customerClassOf("NIUB01")).toBe("Exclusive Manufacturing");
    expect(customerClassOf(" queE02 ")).toBe("Exclusive Distribution");
    // Derived from the item categories bought (not on Vince's list), still classed.
    expect(customerClassOf("SWEAT11")).toBe("Exclusive Manufacturing");
    expect(customerClassOf("FLAGCAR07")).toBe("Exclusive Distribution");
    expect(customerClassOf("NOT-A-CUSTOMER")).toBe("Unclassified");
    expect(customerClassOf(null)).toBe("Unclassified");
  });

  it("puts the workbook's eleven manufacturing categories in Manufacturing and every other in Distribution", () => {
    expect(MANUFACTURING_CATEGORIES).toHaveLength(11);
    for (const c of ["PLABEL", "LIQUID", "PHAD", "BRANDS", "BIOPH", "CROWN", "LSRVCA", "MFGRM", "MFGPKG"]) expect(channelOf(c)).toBe("Manufacturing");
    for (const c of ["AMEN", "TOWELS", "WIPES", "BOTTLE", "DISP", "MISC", "VCARE", "LABELS"]) expect(channelOf(c)).toBe("Distribution");
    expect(channelOf(null)).toBeNull();
  });

  it("carries each row's class, category and channel; a line split across AOs keeps them on every portion", () => {
    const amenity = rows.filter((r) => r.orderNo === "OR1000160008");
    expect(amenity).toHaveLength(4);
    for (const r of amenity) expect(r).toMatchObject({ customerClass: "Exclusive Manufacturing", category: "AMEN", channel: "Distribution" });
    expect(rows.find((r) => r.item === "FP-1414")).toMatchObject({ customerClass: "Unclassified", category: null, channel: null });
  });

  it("filters by class, channel, one category or no category, together with the bucket, and totals what is shown", () => {
    expect(view("all", "all")).toEqual({ rows: 18, cad: "159093.58" });
    expect(view("Exclusive Manufacturing", "all")).toEqual({ rows: 12, cad: "133177.93" });
    expect(view("Unclassified", "all")).toEqual({ rows: 6, cad: "25915.65" });
    expect(view("Mixed", "all")).toEqual({ rows: 0, cad: "0.00" });
    expect(view("all", "channel:Manufacturing")).toEqual({ rows: 8, cad: "75815.65" });
    expect(view("all", "channel:Distribution")).toEqual({ rows: 9, cad: "82277.93" });
    expect(view("all", "category:AMEN")).toEqual({ rows: 5, cad: "54743.15" });
    expect(view("all", "none")).toEqual({ rows: 1, cad: "1000.00" });
    expect(view("Exclusive Manufacturing", "channel:Distribution", "planned")).toEqual({ rows: 2, cad: "35831.88" });
    // The channels and "no category" split every row once.
    const parts = (["channel:Manufacturing", "channel:Distribution", "none"] as const).map((c) => view("all", c).rows);
    expect(parts.reduce((n, p) => n + p, 0)).toBe(18);
  });

  it("offers both channels, then each category on the list A to Z with its channel, then No category", () => {
    expect(forecastCategoryOptions(rows).map((o) => o.label)).toEqual([
      "All categories",
      "Manufacturing",
      "Distribution",
      "AMEN (Distribution)",
      "BOTTLE (Distribution)",
      "BRANDS (Manufacturing)",
      "DISP (Distribution)",
      "LIQUID (Manufacturing)",
      "PHAD (Manufacturing)",
      "PLABEL (Manufacturing)",
      "TOWELS (Distribution)",
      "WIPES (Distribution)",
      "No category",
    ]);
  });

  it("falls back to All when the chosen category is no longer a choice or categories can't be read, so rows never go empty behind 'All categories'", () => {
    const gone = rows.filter((r) => r.category !== "WIPES");
    expect(forecastCategoryOptions(rows).some((o) => o.key === "category:WIPES")).toBe(true);
    expect(forecastCategoryOptions(gone).some((o) => o.key === "category:WIPES")).toBe(false);
    // Still a choice: kept. Gone after a refresh: All, and every row shows again.
    expect(activeCategoryFilter("category:WIPES", rows, true)).toBe("category:WIPES");
    const after = activeCategoryFilter("category:WIPES", gone, true);
    expect(after).toBe("all");
    expect(filterForecastRows(gone, { filter: "all", query: "", category: "category:WIPES" })).toHaveLength(0);
    expect(filterForecastRows(gone, { filter: "all", query: "", category: after })).toHaveLength(gone.length);
    // Channels and No category stay valid while categories are readable; nothing is chosen while they are not.
    expect(activeCategoryFilter("channel:Manufacturing", gone, true)).toBe("channel:Manufacturing");
    expect(activeCategoryFilter("none", rows, true)).toBe("none");
    expect(activeCategoryFilter("none", gone.filter((r) => r.category !== null), true)).toBe("all");
    expect(activeCategoryFilter("channel:Distribution", rows, false)).toBe("all");
    expect(activeCategoryFilter("all", rows, false)).toBe("all");
  });

  it("trims Sage's space-padded category, and a blank or whitespace-only one is no category (TASK-3189)", () => {
    const padded = forecastRows(
      data(
        [
          line({ orderNo: "OR1000000001", category: "AMEN  " }),
          line({ orderNo: "OR1000000002", category: "PLABEL" }),
          line({ orderNo: "OR1000000003", category: "      " }),
          line({ orderNo: "OR1000000004", category: "" }),
        ],
        []
      ),
      TODAY,
      RATE
    );
    expect(padded.map((r) => [r.category, r.channel])).toEqual([
      ["AMEN", "Distribution"],
      ["PLABEL", "Manufacturing"],
      [null, null],
      [null, null],
    ]);
    expect(forecastCategoryOptions(padded).map((o) => o.key)).toEqual([
      "all", "channel:Manufacturing", "channel:Distribution", "category:AMEN", "category:PLABEL", "none",
    ]);
    expect(filterForecastRows(padded, { filter: "all", query: "", category: "category:AMEN" }).map((r) => r.orderNo)).toEqual(["OR1000000001"]);
    expect(filterForecastRows(padded, { filter: "all", query: "", category: "none" }).map((r) => r.orderNo)).toEqual(["OR1000000003", "OR1000000004"]);
  });

  it("keeps the customer roster out of the browser bundle: the page's client code never imports forecast.ts or customer-classes.json", () => {
    // Anything the client component imports ships in /_next/static, which is served without sign-in.
    const runtimeImports = (file: string) => {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      return [...source.matchAll(/^import\s+(type\s+)?[\s\S]*?\sfrom\s+"([^"]+)";/gm)].filter((m) => !m[1]).map((m) => m[2]);
    };
    const forbidden = /customer-classes|\/forecast$|\.\/forecast$|\/reporting\/goals$|\/reporting\/goals\/index$/;
    for (const file of ["src/components/mc/goals/forecast.tsx", "src/lib/reporting/goals/forecast-list.ts"]) {
      const imports = runtimeImports(file);
      expect(imports.length).toBeGreaterThan(0);
      expect(imports.filter((specifier) => forbidden.test(specifier))).toEqual([]);
    }
    expect(runtimeImports("src/components/mc/goals/forecast.tsx")).toContain("@/lib/reporting/goals/forecast-list");
    expect(customerClassOf("NIUB01")).toBe("Exclusive Manufacturing");
  });

  it("reads Sage's category only when the login may: otherwise the query never names the column", () => {
    expect(forecastOrdersQuery(true).sql).toContain("d.category");
    expect(forecastOrdersQuery(false).sql).not.toContain("d.category");
    expect(forecastAosQuery.sql).not.toContain("d.category");
  });
});

describe("read access", () => {
  /** "GRANT SELECT (a, b) ON schema.table TO mc_goals_ro" → { "schema.table": [a, b] } (quotes dropped). */
  function grantsIn(file: string): Record<string, string[]> {
    const sql = readFileSync(path.join(__dirname, "..", "docs", "modules", "reporting-goals", file), "utf8").replace(/--.*$/gm, "");
    const out: Record<string, string[]> = {};
    for (const m of sql.matchAll(/GRANT\s+SELECT\s*\(([^)]*)\)\s*ON\s+([\w.]+)\s+TO\s+mc_goals_ro/gi)) {
      out[m[2]] = [...(out[m[2]] ?? []), ...m[1].split(",").map((c) => c.trim().replace(/"/g, ""))];
    }
    return out;
  }
  const wanted: Record<string, string[]> = {};
  for (const [schema, table, columns] of [...FORECAST_COLUMNS, ...FORECAST_CATEGORY_COLUMNS]) {
    wanted[`${schema}.${table}`] = [...(wanted[`${schema}.${table}`] ?? []), ...columns].sort();
  }

  it("the one-off script for the existing login grants exactly the columns the forecast reads, its item category included", () => {
    const grants = grantsIn("readonly-grants-forecast.sql");
    expect(Object.fromEntries(Object.entries(grants).map(([k, v]) => [k, [...v].sort()]))).toEqual(
      Object.fromEntries(Object.entries(wanted).filter(([k]) => k !== "silver.batches"))
    );
  });

  it("the fresh-install script grants them too (silver.batches' columns were granted already)", () => {
    const grants = grantsIn("readonly-grants.sql");
    for (const [relation, columns] of Object.entries(wanted)) {
      expect(grants[relation], relation).toEqual(expect.arrayContaining(columns));
    }
  });
});

describe("the section", () => {
  /** Visible text of the rendered section, tags dropped and whitespace collapsed. */
  const render = (page: ReturnType<typeof goalsPage>) => {
    if (!isReady(page)) throw new Error("fixture page should be ready");
    return renderToStaticMarkup(createElement(ForecastSection, { page }))
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
  };

  it("shows the four numbers with their parts, the notes and every open order row", () => {
    const out = render(goalsPage());
    expect(out).toContain("Theoretical $527,018 of $1,000,000 Invoiced $408,628 + ready $53,763 + planned in time $64,628");
    expect(out).toContain("At risk $40,703 Late $27,918 + not planned $12,786 8 rows in the list");
    expect(out).toContain("Realistic $503,340 of $1,000,000 Invoiced + (ready + planned in time) × 80.0% hit rate, measured over September 2026");
    expect(out).toContain("Pace $953,466 of $1,000,000 Invoiced ÷ 9 working days covered × 21");
    expect(out).toContain("2 assembly orders scheduled this month (8,400 pieces) have no open Sage order behind them");
    expect(out).toContain("Not converted: EUR 2,100.00 (1 row)");
    expect(out).toContain("Showing 18 of 18 rows · 159,093.58 CAD (and EUR 2,100.00, not converted)");
    for (const chip of ["All 18", "Ready 4", "Planned in time 6", "Late 3", "Not planned 5"]) expect(out).toContain(chip);
    expect(out).toContain(
      "Oct 9 (overdue) OR1000160001 1-Shoppe Inc. 1SHOP11 Exclusive Manufacturing PO-5501 FP-1001 PLABEL Hand soap 500 mL 400 CSE 48.00 CAD 19,200.00 CAD 19,200.00 Ready AO-26279A · Oct 6 · Realized BC-26161A · Realized"
    );
    expect(out).toContain("10,000 EA 0.85 USD 8,500.00 USD 12,086.15 Late AO-26307B · Nov 3 · Allocated BC-26162B · Realized");
    expect(out).toContain("500 EA 4.20 EUR 2,100.00 EUR not converted Planned in time");
    expect(out).toContain("20 CSE 50.00 CAD 1,000.00 CAD 1,000.00 Not planned AO-26289P · no date · Generated —");
    expect(out).toContain("Total shown, CAD 159,093.58");
  });

  it("offers the class and category filters with their counts, and says while categories wait", () => {
    const out = render(goalsPage());
    expect(out).toContain("Customer class All classes Exclusive Manufacturing (12) Exclusive Distribution (0) Mixed (0) Unclassified (6)");
    expect(out).toContain("Item category All categories Manufacturing (8) Distribution (9) AMEN (Distribution) (5)");
    expect(out).not.toContain("Item categories fill in");
    const waiting = render(
      goalsPage({}, undefined, { ...FORECAST, data: { ...FORECAST.data, categoryMissing: ["sage.oe_order_detail.category"] } })
    );
    expect(waiting).toContain("The item category filter waits for read access to sage.oe_order_detail.category.");
    expect(waiting).toContain("readonly-grants-forecast.sql");
    const older = render(goalsPage({}, undefined, { ...FORECAST, data: { ...FORECAST.data, categoryMissing: null } }));
    expect(older).toContain("Item categories fill in at the next refresh.");
  });

  it("says when Realistic will be measured, before a month is complete", () => {
    const out = render(goalsPage({}, undefined, { ...FORECAST, history: FORECAST.history.filter((p) => p.runId !== 20) }));
    expect(out).toContain("Realistic — Measured from October 2026, once a full month of forecasts has ended");
  });

  it("names what the login can't read while it waits for access, and says when it fills in", () => {
    const waiting = render(
      goalsPage({}, undefined, {
        data: {
          access: "missing",
          missing: ["sage.oe_order_header.type", "sage.oe_order_header.expdate", "public.assembly_order.qtytotal"],
          categoryMissing: [],
          lines: [],
          aos: [],
        },
        history: [],
      })
    );
    expect(waiting).toContain("Waiting for read access to Sage orders and FileMaker assembly orders.");
    expect(waiting).toContain("sage.oe_order_header : type, expdate");
    expect(waiting).toContain("public.assembly_order : qtytotal");
    expect(waiting).toContain("readonly-grants-forecast.sql");
    expect(render(goalsPage({}, undefined, null))).toContain("This refresh has no forecast yet. It fills in at the next refresh.");
  });
});
