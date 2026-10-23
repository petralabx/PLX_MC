// Goals & Production: the revenue rate switch (TASK-3780), revenue by customer
// class (TASK-3781) and the forecast's four numbers following the class and
// category filters (TASK-3190), on the 2026-10-14 fixture (USD/CAD 1.4219) and
// on test-local rows. Expected figures are worked out by hand in the comments.

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ForecastNumbers } from "@/components/mc/goals/forecast";
import { GoalCards } from "@/components/mc/goals/goal-cards";
import { isReady, type ReadyPage } from "@/components/mc/goals/helpers";
import { RevenueByClassTable, RulesText } from "@/components/mc/goals/tables";
import { routeToUrl, urlToRoute } from "@/components/mc/route";
import {
  CUSTOMER_CLASSES,
  allocateConvertedCents,
  buildForecast,
  convertCents,
  filteredForecastKpis,
  forecastKpis,
  revenueBasisParam,
  revenueByClass,
  usableRate,
  type Datasets,
  type ForecastReady,
  type GoalsModel,
  type ShipmentListRow,
} from "@/lib/reporting/goals";
import customerClasses from "@/lib/reporting/goals/customer-classes.json";

import { DATASETS, ENTRIES, FORECAST, FTL_CUSTOMERS, RUN, SETTINGS, SHIPMENT_LINES_SUMMARY, goalsPage } from "./reporting-goals-helpers";

const html = <P extends object>(component: ComponentType<P>, props: P) => renderToStaticMarkup(createElement(component, props));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

function ready(page: ReturnType<typeof goalsPage>): ReadyPage {
  if (!isReady(page)) throw new Error("fixture page should be ready");
  return page;
}

const BOC = ready(goalsPage());
const SAGE = ready(goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "sage"));
const PLAIN_SAGE = ready(goalsPage({}, [], FORECAST, SHIPMENT_LINES_SUMMARY, "sage"));

function forecastOf(page: ReadyPage): ForecastReady {
  if (page.forecast?.state !== "ready") throw new Error("fixture forecast should be ready");
  return page.forecast;
}

describe("allocateConvertedCents", () => {
  it("adds up to the month converted once, giving the cent still owed to the largest remainder", () => {
    // Exclusive Manufacturing's and Unclassified's USD on the fixture: 5,765,432 × 1.4219 = 8,197,867.7608 and
    // 11,477,444 × 1.4219 = 16,319,777.6236; the month, 17,242,876 × 1.4219 = 24,517,645.3844, rounds to 24,517,645,
    // so one cent is owed and the larger remainder (.7608) gets it. Unclassified is a cent under its own 16,319,778.
    expect(allocateConvertedCents([5_765_432, 0, 0, 11_477_444], "1.4219")).toEqual([8_197_868, 0, 0, 16_319_777]);
    expect(convertCents(11_477_444, "1.4219")).toBe(16_319_778);
  });

  it("floors negative parts toward minus infinity and breaks a tie in favour of the earlier part", () => {
    // −2 × 1.25 = −2.5 and 2 × 1.25 = 2.5: floors −3 and 2, the sum 0 is owed one cent, both remainders are .5.
    expect(allocateConvertedCents([-2, 2], "1.25")).toEqual([-2, 2]);
    expect(allocateConvertedCents([0, 0, 7], "1.25")).toEqual([0, 0, 9]);
    expect(allocateConvertedCents([], "1.25")).toEqual([]);
  });

  it("always sums to convertCents of the sum, never bumps an exact part, and stays within a cent of each part", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (const rate of ["1.25", "1.4021", "1.402100", "1.4219", "1", "0.733"]) {
      for (let n = 0; n < 400; n += 1) {
        const parts = Array.from({ length: 1 + (next() % 5) }, () => (next() % 3 === 0 ? 0 : (next() % 2_000_000) - 500_000));
        const out = allocateConvertedCents(parts, rate);
        expect(out.reduce((a, b) => a + b, 0)).toBe(convertCents(parts.reduce((a, b) => a + b, 0), rate));
        parts.forEach((p, i) => {
          const exact = (p * Number(rate)) / 1;
          expect(Math.abs(out[i] - exact)).toBeLessThan(1 + 1e-6);
          if (p === 0) expect(out[i]).toBe(0);
        });
      }
    }
  });
});

describe("the Sage rate setting", () => {
  it("accepts a positive rate with at most six decimals and refuses anything else", () => {
    for (const ok of ["1.25", "1.250000", "1", "0.5", " 1.4021 "]) expect(usableRate(ok)).toBe(ok.trim());
    for (const bad of [null, undefined, "", "0", "0.000", "-1.25", "+1.25", "1.2500001", "abc", "1,25", "1e2", "."]) {
      expect(usableRate(bad), String(bad)).toBeNull();
    }
  });

  it("keeps the Sage rate in the page URL, and drops any other fx", () => {
    expect(routeToUrl({ screen: "goals", fx: "sage" })).toBe("/?screen=goals&fx=sage");
    expect(routeToUrl({ screen: "goals" })).toBe("/?screen=goals");
    expect(urlToRoute("/?screen=goals&fx=sage")).toEqual({ screen: "goals", fx: "sage" });
    expect(urlToRoute("/?screen=goals&fx=boc")).toEqual({ screen: "goals" });
    expect(urlToRoute("/?screen=goals&fx=1.25")).toEqual({ screen: "goals" });
  });

  it("reads ?fx= as the Bank of Canada rate unless it says sage, and refuses anything else", () => {
    expect([revenueBasisParam(null), revenueBasisParam("boc"), revenueBasisParam("sage")]).toEqual(["boc", "boc", "sage"]);
    expect(revenueBasisParam("SAGE")).toBeNull();
    expect(revenueBasisParam("")).toBeNull();
  });
});

describe("revenue at the Sage rate (TASK-3780)", () => {
  it("converts the month's US dollars at 1.25, entries by hand included, and nothing else moves", () => {
    const boc = BOC.model.revenue;
    const sage = SAGE.model.revenue;
    expect([boc.basis, boc.rate, sage.basis, sage.rate]).toEqual(["boc", "1.421900", "sage", "1.25"]);
    // 17,242,876 × 1.25 = 21,553,595 exactly; CAD 12,183,771 as invoiced.
    expect(sage.usd).toEqual({ invoices: 13, cents: 17_242_876, cadCents: 21_553_595 });
    expect(sage.cad).toEqual(boc.cad);
    expect(sage.inSystemCents).toBe(12_183_771 + 21_553_595);
    // By hand: M003 A1 American US$24,500 + 1,250 = 25,750 × 1.25 = 32,187.50; M007 Sahajan CAD 5,000.
    expect(sage.byHandCents).toBe(3_218_750 + 500_000);
    expect(sage.totalCents).toBe(33_737_366 + 3_718_750);
    expect(PLAIN_SAGE.model.revenue.totalCents).toBe(33_737_366);
    expect(SAGE.model.takeaway).toContain("$374,561 of the");
    // The last day's running total is the card's, at the same rate.
    expect(SAGE.model.daily[SAGE.model.daily.length - 1].withHandToDateCents).toBe(sage.totalCents);
    // Nothing but revenue follows the rate: the run's Bank of Canada rate stays on the page, and so do the goals that aren't revenue.
    expect(SAGE.fx).toEqual(BOC.fx);
    expect(SAGE.model.truckloads).toEqual(BOC.model.truckloads);
    expect(SAGE.model.line1).toEqual(BOC.model.line1);
    expect(SAGE.model.truckloads.rate).toBe(RUN.fxRate);
  });

  it("tests a full truckload at the Bank of Canada rate whatever rate revenue is at", () => {
    // CAD 24,000 to A1 American on Oct 5, a day with no stored rate: 24,000 ÷ 1.4219 = US$16,878.80, a partial load.
    // At 1.25 it would be US$19,200, a full one; the card, the shipments list and the workbook must all say partial.
    const snapshot: Datasets = {
      ...DATASETS,
      truckloads: [
        ...DATASETS.truckloads,
        { code: "A1TEXT11", shipment: "SH-CAD-1", shipDate: "2026-10-05", productUsd: "0", productCad: "24000.00", thisMonth: true },
      ],
      shipments: [
        ...DATASETS.shipments,
        {
          invoice: "IN-CAD-1",
          shipment: "SH-CAD-1",
          orderNo: null,
          po: null,
          customerCode: "A1TEXT11",
          customer: "A1 American",
          shipDate: "2026-10-05",
          currency: "CAD",
          productValue: "24000.00",
          otherCharges: "0.00",
          netBeforeTax: "24000.00",
        },
      ],
    };
    for (const basis of ["boc", "sage"] as const) {
      const page = ready(goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, basis, snapshot));
      const a1 = page.model.truckloads.customers.find((c) => c.code === "A1TEXT11")!;
      const base = BOC.model.truckloads.customers.find((c) => c.code === "A1TEXT11")!;
      expect(a1.thisMonth.partial, basis).toBe(base.thisMonth.partial + 1);
      expect(a1.thisMonth.full, basis).toBe(base.thisMonth.full);
      expect(page.shipments.find((s) => s.invoice === "IN-CAD-1")?.truckload, basis).toBe("partial");
    }
  });

  it("puts the forecast's rows at the Sage rate while the hit rate stays as each month measured it", () => {
    const boc = forecastOf(BOC);
    const sage = forecastOf(SAGE);
    sage.rows.forEach((row, i) => {
      const b = boc.rows[i];
      expect(row.key).toBe(b.key);
      expect(row.cadCents).toBe(row.currency === "USD" ? convertCents(row.valueCents, "1.25") : b.cadCents);
    });
    expect(sage.kpiBasis).toEqual(boc.kpiBasis);
    expect(sage.realistic?.hitRate).toBe(boc.realistic?.hitRate);
    expect(sage.invoicedCents).toBe(SAGE.model.revenue.totalCents);
  });

  it("names the rate it shows on the Revenue card and in the rules", () => {
    expect(text(html(GoalCards, { page: SAGE }))).toContain(
      "CAD $121,838 (57 invoices) + USD US$172,429 (13 invoices) = $215,536 at 1.25 (Sage rate)"
    );
    expect(text(html(GoalCards, { page: BOC }))).toContain("= $245,176 at 1.4219 (Bank of Canada, Oct 13)");
    const rules = text(html(RulesText, { page: SAGE }));
    expect(rules).toContain("US dollars are converted at the fixed Sage rate 1.25, or at the Bank of Canada rate with the switch above the cards");
    expect(rules).toContain("at the Bank of Canada rate, whichever rate the revenue is shown at");
  });
});

describe("revenue by customer class (TASK-3781)", () => {
  it("splits the Revenue card's month by class and adds up to it to the cent, at either rate", () => {
    for (const page of [BOC, SAGE, PLAIN_SAGE]) {
      const data = page.revenueByClass!;
      expect(data.rows.map((r) => r.customerClass)).toEqual([...CUSTOMER_CLASSES]);
      expect(data.matchesCard).toBe(true);
      expect(data.total.totalCadCents).toBe(page.model.revenue.totalCents);
      expect(data.rows.reduce((n, r) => n + r.totalCadCents, 0)).toBe(page.model.revenue.totalCents);
      expect(data.total.usd.cadCents).toBe(page.model.revenue.usd.cadCents);
      expect(data.total.invoices).toBe(70);
    }
  });

  it("classes the fixture's invoices and entries by hand as worked out by hand", () => {
    const [em, ed, mixed, none] = BOC.revenueByClass!.rows;
    // A1TEXT11 and DIVE11 (two USD invoices, US$57,654.32) are Exclusive Manufacturing; M003, typed "A1 American",
    // takes A1TEXT11's class by its truckload name: 25,750 × 1.4219 = 36,613.925 → 36,613.92.
    expect(em).toMatchObject({ invoices: 2, cad: { invoices: 0, cents: 0 }, usd: { invoices: 2, cents: 5_765_432, cadCents: 8_197_868 } });
    expect(em.byHand).toEqual({ entries: 1, cadCents: 3_661_392 });
    expect(em.totalCadCents).toBe(11_859_260);
    expect([ed.totalCadCents, mixed.totalCadCents]).toEqual([0, 0]);
    // Everyone else is Unclassified, with M007 (Sahajan Inc., CAD 5,000), which matches no Sage customer.
    expect(none).toMatchObject({ invoices: 68, usd: { invoices: 11, cents: 11_477_444, cadCents: 16_319_777 } });
    expect(none.byHand).toEqual({ entries: 1, cadCents: 500_000 });
    expect(none.totalCadCents).toBe(29_003_548);
    expect(BOC.revenueByClass!.unresolvedByHand).toEqual({ entries: 1, cadCents: 500_000 });
    expect(em.share! + none.share!).toBeCloseTo(1, 12);
    expect(ed.share).toBe(0);
  });

  const code = (cls: keyof typeof customerClasses.classes) => customerClasses.classes[cls][0];
  const sage = (invoice: string, customerCode: string | null, currency: string, netCents: number): ShipmentListRow => ({
    key: `sage:${invoice}`,
    shipDate: "2026-10-05",
    invoice,
    shipment: null,
    orderNo: null,
    po: null,
    customer: null,
    customerCode,
    currency,
    productCents: netCents,
    otherCents: 0,
    netCents,
    truckloadCustomer: false,
    truckload: null,
    source: "Sage",
    entryId: null,
    cadCents: currency === "CAD" ? netCents : currency === "USD" ? convertCents(netCents, "1.25") : null,
  });
  const hand = (entryId: string, customer: string, customerCode: string | null, cadCents: number): ShipmentListRow => ({
    ...sage(entryId, customerCode, "CAD", cadCents),
    key: `entry:${entryId}`,
    customer,
    source: "By hand",
    entryId,
    cadCents,
  });
  const card = (revenue: Partial<GoalsModel["revenue"]>): Pick<GoalsModel, "revenue"> => ({
    revenue: {
      targetCents: 0,
      dueSoFarCents: 0,
      dueBy: "2026-10-14",
      inSystemCents: 0,
      byHandCents: 0,
      totalCents: 0,
      status: "on_track",
      neededPerDayCents: 0,
      rate: "1.25",
      basis: "sage",
      cad: { invoices: 0, cents: 0 },
      usd: { invoices: 0, cents: 0, cadCents: 0 },
      otherCurrencies: [],
      lastMonthCadCents: 0,
      ...revenue,
    },
  });

  const ROWS = [
    sage("I1", code("Exclusive Distribution"), "CAD", 100_000),
    sage("I2", code("Exclusive Distribution"), "USD", 3),
    sage("I3", code("Mixed"), "USD", 5),
    sage("I4", code("Mixed"), "EUR", 7_000),
    sage("I5", "NOSUCHCUSTOMER", "CAD", 250),
    hand("M1", "Whatever Ltd", code("Mixed"), 1_000),
    hand("M2", "A1 American Inc", null, 2_000),
    hand("M3", "Someone New", null, 400),
  ];

  it("puts each row in its customer's class, an entry by hand by its picked customer or its truckload name", () => {
    // USD 3 + 5 = 8¢ × 1.25 = 10¢ for the month; 3 × 1.25 = 3.75 and 5 × 1.25 = 6.25: floors 3 and 6, one cent owed, to .75.
    const data = revenueByClass(
      ROWS,
      card({ cad: { invoices: 2, cents: 100_250 }, usd: { invoices: 2, cents: 8, cadCents: 10 }, otherCurrencies: [{ currency: "EUR", invoices: 1, cents: 7_000 }], byHandCents: 3_400, totalCents: 103_660 }),
      FTL_CUSTOMERS
    );
    const [em, ed, mixed, none] = data.rows;
    // "A1 American Inc" matches A1 American's name ("a1 american"), A1TEXT11, which the roster has as Exclusive Manufacturing.
    expect(em).toMatchObject({ invoices: 0, byHand: { entries: 1, cadCents: 2_000 }, totalCadCents: 2_000 });
    expect(ed).toMatchObject({ invoices: 2, cad: { invoices: 1, cents: 100_000 }, usd: { invoices: 1, cents: 3, cadCents: 4 }, totalCadCents: 100_004 });
    expect(mixed).toMatchObject({
      invoices: 2,
      usd: { invoices: 1, cents: 5, cadCents: 6 },
      otherCurrencies: [{ currency: "EUR", invoices: 1, cents: 7_000 }],
      byHand: { entries: 1, cadCents: 1_000 },
      totalCadCents: 1_006,
    });
    expect(none).toMatchObject({ invoices: 1, cad: { invoices: 1, cents: 250 }, byHand: { entries: 1, cadCents: 400 }, totalCadCents: 650 });
    expect(data.unresolvedByHand).toEqual({ entries: 1, cadCents: 400 });
    expect(data.total.totalCadCents).toBe(103_660);
    expect(data.matchesCard).toBe(true);
  });

  it("says so, instead of claiming to match, when the card's invoices differ from the list's", () => {
    // On the reporting MCP path the card and the list are two reads: here the card missed I2.
    const data = revenueByClass(
      ROWS,
      card({ cad: { invoices: 2, cents: 100_250 }, usd: { invoices: 1, cents: 5, cadCents: 6 }, otherCurrencies: [{ currency: "EUR", invoices: 1, cents: 7_000 }], byHandCents: 3_400, totalCents: 103_656 }),
      FTL_CUSTOMERS
    );
    expect(data.matchesCard).toBe(false);
    expect(data.cardTotalCents).toBe(103_656);
    const page = { ...BOC, revenueByClass: data };
    expect(text(html(RevenueByClassTable, { page }))).toContain("These invoices add up to $1,036.60, not the Revenue card’s $1,036.56: Sage changed between two reads");
  });

  it("shows no share while the month has no revenue", () => {
    const data = revenueByClass([], card({}), FTL_CUSTOMERS);
    expect(data.rows.every((r) => r.share === null && r.totalCadCents === 0)).toBe(true);
    expect(data.matchesCard).toBe(true);
  });

  it("renders the table with its total equal to the card, and the rate it converts at", () => {
    const out = text(html(RevenueByClassTable, { page: BOC }));
    expect(out).toContain("Exclusive Manufacturing 2 0.00 57,654.32 81,978.68 36,613.92 118,592.60 29.0%");
    expect(out).toContain("Unclassified 68 121,837.71 114,774.44 163,197.77 5,000.00 290,035.48 71.0%");
    expect(out).toContain("Total 70 121,837.71 172,428.76 245,176.45 41,613.92 408,628.08 100%");
    expect(out).toContain("US dollars at today’s Bank of Canada rate 1.4219 (Oct 13)");
    expect(out).toContain("So is 1 shipment entered by hand without a Sage customer ($5,000).");
    expect(text(html(RevenueByClassTable, { page: SAGE }))).toContain("US dollars at the Sage rate 1.25");
  });
});

describe("the forecast's four numbers follow the class and category filters (TASK-3190)", () => {
  const f = forecastOf(BOC);

  it("works out the whole month with the same function the filters use", () => {
    const whole = forecastKpis(f.rows, f.invoicedCents, f.kpiBasis);
    expect(whole).toEqual({
      buckets: f.buckets,
      invoicedCents: f.invoicedCents,
      theoreticalCents: f.theoreticalCents,
      atRiskCents: f.atRiskCents,
      realistic: f.realistic,
      pace: f.pace,
      otherCurrencies: f.otherCurrencies,
    });
    expect(filteredForecastKpis(f, { customerClass: "all", category: "all" })).toEqual(whole);
    // Unchanged from before TASK-3190 (tests/reporting-goals-forecast.test.ts pins the same figures on the page).
    expect([f.theoreticalCents, f.atRiskCents, f.realistic?.cents, f.pace?.cents].map((c) => Math.round((c ?? 0) / 100))).toEqual([
      527_018, 40_703, 503_340, 953_466,
    ]);
  });

  it("counts a class's own open orders and invoices: the class table's total", () => {
    expect(f.invoicedByClass).toEqual(Object.fromEntries(BOC.revenueByClass!.rows.map((r) => [r.customerClass, r.totalCadCents])));
    const em = filteredForecastKpis(f, { customerClass: "Exclusive Manufacturing", category: "all" });
    const emRows = f.rows.filter((r) => r.customerClass === "Exclusive Manufacturing");
    expect(emRows).toHaveLength(12);
    expect(em.invoicedCents).toBe(11_859_260);
    const cad = (bucket: string) => emRows.filter((r) => r.bucket === bucket).reduce((n, r) => n + (r.cadCents ?? 0), 0);
    expect(em.theoreticalCents).toBe(11_859_260 + cad("ready") + cad("planned"));
    expect(em.atRiskCents).toBe(cad("late") + cad("not_planned"));
    expect(em.pace).toEqual({ cents: Math.round((11_859_260 * 21) / 9), coveredDays: 9, workingDays: 21 });
    // The buckets of the four classes add up to the month's.
    const byClass = CUSTOMER_CLASSES.map((c) => filteredForecastKpis(f, { customerClass: c, category: "all" }));
    for (const bucket of ["ready", "planned", "late", "not_planned"] as const) {
      expect(byClass.reduce((n, k) => n + k.buckets[bucket].cents, 0)).toBe(f.buckets[bucket].cents);
    }
  });

  it("counts open orders only with a category chosen, since invoices aren't split by category", () => {
    const dist = filteredForecastKpis(f, { customerClass: "all", category: "channel:Distribution" });
    expect(dist.invoicedCents).toBeNull();
    expect(dist.pace).toBeNull();
    expect(dist.theoreticalCents).toBe(dist.buckets.ready.cents + dist.buckets.planned.cents);
    expect(dist.realistic?.hitRate).toBe(f.realistic?.hitRate);
    const out = text(html(ForecastNumbers, { k: dist, targetCents: f.targetCents, measuredFrom: f.measuredFrom, filtered: true }));
    expect(out).toContain("Open orders only: ready");
    expect(out).toContain("Open orders only: (ready + planned in time) × 80.0% hit rate (all customers)");
    expect(out).toContain("Pace — Needs invoices split by item category (not available yet)");
    expect(out).not.toContain("of $1,000,000");
  });

  it("labels the target and the hit rate as all customers' with a class chosen, and not at all without a filter", () => {
    const em = filteredForecastKpis(f, { customerClass: "Exclusive Manufacturing", category: "all" });
    const out = text(html(ForecastNumbers, { k: em, targetCents: f.targetCents, measuredFrom: f.measuredFrom, filtered: true }));
    expect(out).toContain("of $1,000,000 (all customers) Invoiced $118,593 + ready");
    expect(out).toContain("× 80.0% hit rate (all customers), measured over September 2026");
    const whole = text(html(ForecastNumbers, { k: f, targetCents: f.targetCents, measuredFrom: f.measuredFrom, filtered: false }));
    expect(whole).not.toContain("all customers");
    expect(whole).toContain("Theoretical $527,018 of $1,000,000 Invoiced $408,628 + ready $53,763 + planned in time $64,628");
  });

  it("treats a class's invoiced revenue as unknown when the page model didn't supply it", () => {
    const bare = buildForecast({ snapshot: FORECAST, model: BOC.model, settings: SETTINGS, rate: BOC.model.revenue.rate });
    if (bare.state !== "ready") throw new Error("forecast should be ready");
    expect(bare.invoicedByClass).toBeNull();
    expect(filteredForecastKpis(bare, { customerClass: "Mixed", category: "all" }).invoicedCents).toBeNull();
  });
});
