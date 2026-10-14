// Goals & Production business rules against the 2026-10-14 fixtures: every
// number the brief publishes, the M1–M7 manual-entry scenarios, and each rule's
// edge cases (bands, matching, statuses, freshness, covered-through, overlap).

import { describe, expect, it } from "vitest";

import { centsToDecimal } from "@/lib/reporting/goals/money";
import {
  classifyLoad,
  computeGoals,
  coveredThrough,
  entryStatus,
  isBehind,
  normalizeRef,
  rateOn,
  sizeBand,
  truckloadCustomerFor,
  type EntryContext,
} from "@/lib/reporting/goals/rules";
import { buildGoalsView } from "@/lib/reporting/goals/view";
import type { BatchRow, RefreshRun } from "@/lib/reporting/goals/types";

import {
  DATASETS,
  ENTRIES,
  EXPECTED,
  FTL_CUSTOMERS,
  HOLIDAYS,
  SETTINGS,
  TODAY,
  goalsInput,
  manualEntry,
  refsOf,
} from "./reporting-goals-helpers";

const money = (cents: number) => centsToDecimal(cents);

describe("size bands", () => {
  it("puts 9,000–11,000 kg inclusive in ~10,000 (9,000–9,999 is not 5,000–8,999)", () => {
    expect(sizeBand(4999)).toBe("Under 5,000");
    expect(sizeBand(5000)).toBe("5,000–8,999");
    expect(sizeBand(8999)).toBe("5,000–8,999");
    expect(sizeBand(9000)).toBe("~10,000");
    expect(sizeBand(9999)).toBe("~10,000");
    expect(sizeBand(11000)).toBe("~10,000");
    expect(sizeBand(11001)).toBe("Over 11,000");
  });
});

describe("matching", () => {
  it("compares references without case or spaces (including no-break spaces)", () => {
    expect(normalizeRef(" BC-26286c ")).toBe("bc-26286c");
    expect(normalizeRef("bc 26286 C")).toBe("bc26286c");
    expect(normalizeRef(null)).toBe("");
  });

  it("finds truckload customers by Sage code or by name", () => {
    const find = (customer: string | null, customerCode: string | null = null) =>
      truckloadCustomerFor({ customer, customerCode }, FTL_CUSTOMERS)?.code ?? null;
    expect(find("A1 American")).toBe("A1TEXT11");
    expect(find("Tiger Hospitality LLC DBA of A1 American")).toBe("A1TEXT11");
    expect(find("PET SUPPLIES PLUS #42")).toBe("PETSUP10");
    expect(find("Diversified Hospitality Solutions, Ltd.")).toBe("DIVE11");
    expect(find("1 Shoppe")).toBe("1SHOP11");
    expect(find("The Soap Box Co.")).toBe("SOAP11");
    expect(find("anything", "DIVE11")).toBe("DIVE11");
    expect(find("soap11")).toBe("SOAP11");
    expect(find("Sahajan Inc.")).toBeNull();
    expect(find(null)).toBeNull();
  });

  it("classifies loads at US$18,000 of product and never counts ≤ 0", () => {
    expect(classifyLoad(1_800_000, SETTINGS)).toBe("full");
    expect(classifyLoad(1_799_999, SETTINGS)).toBe("partial");
    expect(classifyLoad(0, SETTINGS)).toBeNull();
    expect(classifyLoad(-500, SETTINGS)).toBeNull();
  });

  it("uses the latest stored rate on or before a day", () => {
    const rates = [
      { date: "2026-10-09", rate: "1.38" },
      { date: "2026-10-13", rate: "1.39" },
    ];
    expect(rateOn(rates, "2026-10-12", "1.5")).toBe("1.38");
    expect(rateOn(rates, "2026-10-14", "1.5")).toBe("1.39");
    expect(rateOn(rates, "2026-10-01", "1.5")).toBe("1.5");
  });
});

describe("manual-entry status (first match wins)", () => {
  const ctx: EntryContext = {
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
    filemakerRefs: refsOf("filemaker"),
    sageRefs: refsOf("sage"),
  };

  it("gives M1–M7 the statuses the brief lists", () => {
    expect(ENTRIES.map((e) => [e.entryId, entryStatus(e, ctx)])).toEqual([
      ["M001", "counted"],
      ["M002", "counted"],
      ["M003", "counted"],
      ["M004", "in_sage"],
      ["M005", "in_filemaker"],
      ["M006", "not_this_month"],
      ["M007", "counted"],
    ]);
  });

  it("matches FileMaker references only for batches and Sage references only for shipments", () => {
    const batchNamedLikeInvoice = manualEntry({ entryId: "X1", type: "Batch", date: TODAY, reference: "IN1000180418", kg: "100" });
    expect(entryStatus(batchNamedLikeInvoice, ctx)).toBe("counted");
    const realizedRefTyped = manualEntry({ entryId: "X2", type: "Batch", date: TODAY, reference: " bc-26280E ", kg: "1" });
    expect(entryStatus(realizedRefTyped, ctx)).toBe("in_filemaker");
  });

  it("ignores blank references when matching Sage", () => {
    const blank = manualEntry({ entryId: "X3", type: "Shipment", date: TODAY, reference: "  ", productValue: "10", currency: "CAD" });
    expect(entryStatus(blank, ctx)).toBe("counted");
  });

  it("reports validation failures in the brief's order", () => {
    const status = (fields: Partial<Parameters<typeof manualEntry>[0]>) =>
      entryStatus(manualEntry({ entryId: "V", type: "Batch", ...fields }), ctx);
    expect(status({ date: null, kg: "100" })).toBe("needs_date");
    expect(status({ date: "2026-11-01", kg: "100" })).toBe("not_this_month");
    expect(status({ date: TODAY, kg: null })).toBe("needs_kg");
    expect(status({ date: TODAY, kg: "0" })).toBe("needs_kg");
    expect(status({ type: "Shipment", date: TODAY, productValue: null, freight: "50", currency: "CAD" })).toBe("needs_value");
    expect(status({ type: "Shipment", date: TODAY, productValue: "0", freight: "0", currency: "CAD" })).toBe("needs_value");
    expect(status({ type: "Shipment", date: TODAY, productValue: "100", currency: null })).toBe("needs_value");
    expect(status({ type: "Shipment", date: TODAY, productValue: "0", freight: "75", currency: "USD" })).toBe("counted");
    expect(status({ type: "Pallet", date: TODAY })).toBe("bad_type");
    expect(status({ type: "Pallet", date: null })).toBe("needs_date");
  });
});

describe("goals on 2026-10-14 (system data only)", () => {
  const model = computeGoals(goalsInput());

  it("counts working days 21 / 9 / 13", () => {
    expect(model.calendar).toMatchObject({
      workingDays: EXPECTED.workingDays.month,
      throughToday: EXPECTED.workingDays.throughToday,
      remaining: EXPECTED.workingDays.remaining,
    });
  });

  it("reproduces the large-batch goal", () => {
    expect(model.largeBatches).toMatchObject({
      total: 6,
      inSystem: 6,
      byHand: 0,
      dueSoFar: 18,
      dueBy: TODAY,
      target: 42,
      openFromToday: 11,
      openPastDate: 7,
      ifAllRun: 24,
      status: "behind",
    });
    expect(model.largeBatches.neededPerDay.toFixed(1)).toBe(EXPECTED.largeBatches.neededPerDay);
  });

  it("reproduces the completed-by-size tiles", () => {
    const tiles = Object.fromEntries(model.sizes.completed.map((t) => [t.band, t]));
    expect(tiles["Total"].count).toBe(30);
    expect(tiles["~10,000"].count).toBe(4);
    expect(tiles["5,000–8,999"].count).toBe(3);
    expect(tiles["Under 5,000"].count).toBe(22);
    expect(tiles["Over 11,000"].count).toBe(1);
    expect(tiles["Total"].notQcReleased).toBe(2);
    expect(tiles["Total"].pacePer20).toBeCloseTo((30 / 9) * 20, 10);
  });

  it("reproduces truckloads this month and last", () => {
    expect(model.truckloads.full).toEqual({ inSystem: 2, byHand: 0, total: 2 });
    expect(model.truckloads.partial).toEqual({ inSystem: 0, byHand: 0, total: 0 });
    const byCode = Object.fromEntries(model.truckloads.customers.map((c) => [c.code, c]));
    expect(money(byCode.A1TEXT11.thisMonth.productUsdCents)).toBe("31394.40");
    expect(money(byCode.DIVE11.thisMonth.productUsdCents)).toBe("22705.92");
    expect(model.truckloads.lastMonth.full).toBe(7);
    expect(model.truckloads.lastMonth.partial).toBe(5);
    expect(money(model.truckloads.lastMonth.productUsdCents)).toBe("215065.66");
    expect(model.truckloads.customers.map((c) => c.code)).toEqual(["A1TEXT11", "PETSUP10", "DIVE11", "1SHOP11", "SOAP11"]);
    expect(model.truckloads.target).toBeNull();
  });

  it("reproduces revenue, due so far and needed per working day", () => {
    const r = model.revenue;
    expect(r.cad).toEqual({ invoices: 57, cents: 12_183_771 });
    expect(r.usd.invoices).toBe(13);
    expect(money(r.usd.cents)).toBe("172428.76");
    expect(money(r.inSystemCents)).toBe("367014.16");
    expect(money(r.totalCents)).toBe("367014.16");
    expect(money(r.dueSoFarCents)).toBe("428571.43");
    expect(money(r.neededPerDayCents)).toBe("48691.22");
    expect(money(r.lastMonthCadCents)).toBe("1007365.11");
    expect(r.status).toBe("behind");
    expect(r.otherCurrencies).toEqual([]);
  });

  it("matches the prototype's day-by-day sheet", () => {
    for (const [i, proto] of EXPECTED.dailyFromPrototype.entries()) {
      const point = model.daily[i];
      expect(point.day).toBe(proto.day);
      expect(point.isWorkingDay).toBe(proto.isWorkingDay);
      expect(point.largeDone).toBe(proto.largeDoneFileMaker);
      expect(point.largeScheduled).toBe(proto.largeStillScheduled);
      expect(money(point.cadCents)).toBe(proto.cadInvoiced);
      expect(money(point.usdCents)).toBe(proto.usdInvoiced);
      expect(Math.round(point.targetToDateCents / 100)).toBe(proto.targetToDate);
      expect(Math.abs(point.lastMonthToDateCents / 100 - proto.lastMonthToDate)).toBeLessThanOrEqual(0.5);
    }
    expect(model.daily.at(-1)!.sageToDateCents).toBe(model.revenue.inSystemCents);
    expect(model.daily.find((d) => d.isToday)?.day).toBe(TODAY);
  });

  it("builds the takeaway sentence from the numbers", () => {
    expect(model.takeaway).toBe(
      "6 large batches against 18 due so far, 2 full truckloads, and $367,014 of the $428,571 revenue due so far."
    );
  });

  it("is not behind when both cutoffs are today", () => {
    expect(model.behind).toEqual({ production: false, sage: false });
  });
});

describe("goals on 2026-10-14 with M1–M7", () => {
  const model = computeGoals(goalsInput({ entries: ENTRIES }));

  it("counts two large batches by hand without double-counting the open one", () => {
    expect(model.largeBatches).toMatchObject({ inSystem: 6, byHand: 2, total: 8, ifAllRun: 25, openPastDate: 6, openFromToday: 11 });
    expect(model.largeBatches.neededPerDay.toFixed(1)).toBe(EXPECTED.withAllEntries.neededPerDay);
    // M1 completes BC-26286C, scheduled for Oct 13: one fewer still scheduled that day.
    expect(model.daily.find((d) => d.day === "2026-10-13")).toMatchObject({ largeScheduled: 2, largeByHand: 1 });
    expect(model.daily.find((d) => d.day === TODAY)).toMatchObject({ largeByHand: 1, largeScheduled: 4 });
  });

  it("adds M3 as a full load and M3 + M7 to revenue", () => {
    expect(model.truckloads.full).toEqual({ inSystem: 2, byHand: 1, total: 3 });
    const m3 = model.entries.find((e) => e.entryId === "M003")!;
    expect(money(m3.revenueCadCents)).toBe("36613.92");
    expect(m3.truckload).toEqual({ code: "A1TEXT11", kind: "full", productUsdCents: 2_450_000 });
    const m7 = model.entries.find((e) => e.entryId === "M007")!;
    expect(m7.revenueCadCents).toBe(500_000);
    expect(m7.truckload).toBeNull();
    expect(money(model.revenue.totalCents)).toBe("408628.08");
    expect(money(model.revenue.neededPerDayCents)).toBe("45490.15");
  });

  it("leaves entries that stopped counting without effect", () => {
    const byId = Object.fromEntries(model.entries.map((e) => [e.entryId, e]));
    for (const id of ["M004", "M005", "M006"]) {
      expect(byId[id].counts).toBe(false);
      expect(byId[id].revenueCadCents).toBe(0);
      expect(byId[id].truckload).toBeNull();
      expect(byId[id].completesBatchId).toBeNull();
    }
    expect(byId.M004.statusLabel).toBe("In Sage now");
    expect(byId.M005.statusLabel).toBe("In FileMaker now");
    expect(byId.M006.statusLabel).toBe("Not this month");
  });

  it("shows the hand-completed batch and the new one in the batch list", () => {
    const m1Row = model.batches.find((b) => b.batch === "BC-26286C")!;
    expect(m1Row).toMatchObject({ stage: "completed_by_hand", status: "Completed (by hand)", date: "2026-10-13", kg: 10050, entryId: "M001", source: "By hand" });
    const m2Row = model.batches.find((b) => b.batch === "BC-26290X")!;
    expect(m2Row).toMatchObject({ stage: "completed_by_hand", date: TODAY, kg: 9000, band: "~10,000", entryId: "M002" });
    expect(model.batches.filter((b) => b.source === "By hand")).toHaveLength(2);
    expect(model.sizes.openPastDate).toBe(19);
  });

  it("keeps covered-through at today", () => {
    expect(model.coveredThrough).toEqual({ production: TODAY, revenue: TODAY });
    expect(model.largeBatches.dueSoFar).toBe(18);
    expect(money(model.revenue.dueSoFarCents)).toBe("428571.43");
  });

  it("builds the takeaway from the totals including entries", () => {
    expect(model.takeaway).toBe(
      "8 large batches against 18 due so far, 3 full truckloads, and $408,628 of the $428,571 revenue due so far."
    );
  });
});

describe("today overlap regression", () => {
  it("counts a batch scheduled for today as 'from today' only, even when the cutoff is today", () => {
    const today: BatchRow = { id: "1", batch: "T-1", product: null, status: "Allocated", statusQc: null, line: null, date: TODAY, kg: "10000" };
    const past: BatchRow = { ...today, id: "2", batch: "T-2", date: "2026-10-13" };
    const model = computeGoals(
      goalsInput({
        data: {
          ...DATASETS,
          cutoffs: { productionCutoff: TODAY, sageCutoff: TODAY },
          goalSummary: { largeDone: 0, largeScheduledAhead: 1, largeOpenPastDate: 1 },
          batches: [today, past],
        },
      })
    );
    expect(model.batches.map((b) => [b.batch, b.stage])).toEqual([
      ["T-2", "open_past_date"],
      ["T-1", "scheduled"],
    ]);
    expect(model.sizes.scheduledFromToday.find((t) => t.band === "Total")?.count).toBe(1);
    expect(model.sizes.openPastDate).toBe(1);
    expect(model.largeBatches.ifAllRun).toBe(2);
  });
});

describe("freshness and covered-through", () => {
  it("flags a cutoff only when a working day is missing", () => {
    expect(isBehind("2026-10-16", "2026-10-19", HOLIDAYS)).toBe(false); // Friday → Monday
    expect(isBehind("2026-10-16", "2026-10-20", HOLIDAYS)).toBe(true); // Monday missing
    expect(isBehind("2026-10-09", "2026-10-13", HOLIDAYS)).toBe(false); // Thanksgiving Monday
    expect(isBehind("2026-10-09", TODAY, HOLIDAYS)).toBe(true); // the morning of Oct 14
    expect(isBehind(null, TODAY, HOLIDAYS)).toBe(true);
  });

  it("takes the later of the cutoff and counted entries, never past today", () => {
    expect(coveredThrough("2026-10-09", ["2026-10-13"], "2026-10-01", TODAY)).toBe("2026-10-13");
    expect(coveredThrough("2026-10-09", ["2026-10-20"], "2026-10-01", TODAY)).toBe(TODAY);
    expect(coveredThrough(null, [], "2026-10-01", TODAY)).toBe("2026-09-30");
  });

  it("runs due-so-far targets to the covered-through date", () => {
    const stale = computeGoals(
      goalsInput({ data: { ...DATASETS, cutoffs: { productionCutoff: "2026-10-07", sageCutoff: "2026-10-09" } } })
    );
    expect(stale.behind).toEqual({ production: true, sage: true });
    expect(stale.largeBatches.dueSoFar).toBe(10); // 5 working days × 2
    expect(money(stale.revenue.dueSoFarCents)).toBe("333333.33"); // 7 of 21 working days
    // A counted shipment dated the 13th moves revenue's covered-through to the 13th.
    const withEntry = computeGoals(
      goalsInput({
        data: { ...DATASETS, cutoffs: { productionCutoff: "2026-10-07", sageCutoff: "2026-10-09" } },
        entries: [manualEntry({ entryId: "S1", type: "Shipment", date: "2026-10-13", productValue: "100", currency: "CAD" })],
      })
    );
    expect(withEntry.coveredThrough.revenue).toBe("2026-10-13");
    expect(money(withEntry.revenue.dueSoFarCents)).toBe("380952.38"); // 8 of 21
  });
});

describe("currencies", () => {
  it("lists currencies other than CAD and USD instead of dropping them", () => {
    const model = computeGoals(
      goalsInput({
        data: { ...DATASETS, revenue: [...DATASETS.revenue, { currency: "EUR", thisMonth: true, invoices: 1, netBeforeTax: "250.00" }] },
      })
    );
    expect(model.revenue.otherCurrencies).toEqual([{ currency: "EUR", invoices: 1, cents: 25_000 }]);
    expect(money(model.revenue.inSystemCents)).toBe("367014.16");
  });

  it("converts a CAD invoice to a truckload customer at its ship day's rate", () => {
    const model = computeGoals(
      goalsInput({
        rates: [
          { date: "2026-10-05", rate: "1.25" },
          { date: TODAY, rate: "1.4219" },
        ],
        data: {
          ...DATASETS,
          truckloads: [
            { code: "SOAP11", shipment: "SH-CAD", shipDate: "2026-10-06", productUsd: "0", productCad: "25000.00", thisMonth: true },
          ],
        },
      })
    );
    const soapbox = model.truckloads.customers.find((c) => c.code === "SOAP11")!;
    expect(soapbox.thisMonth).toEqual({ full: 1, partial: 0, productUsdCents: 2_000_000 }); // 25,000 CAD ÷ 1.25
  });
});

describe("page view", () => {
  const run: RefreshRun = {
    id: 7,
    trigger: "cron",
    requestedBy: "cron",
    today: TODAY,
    status: "succeeded",
    step: null,
    startedAt: "2026-10-14T10:00:01.000Z",
    finishedAt: "2026-10-14T10:00:09.000Z",
    error: null,
    productionCutoff: TODAY,
    sageCutoff: TODAY,
    fxRate: "1.421900",
    fxRateDate: "2026-10-13",
    fxSource: "boc",
    rowCounts: {},
  };
  const base = {
    configured: true,
    entries: [],
    filemakerRefs: refsOf("filemaker"),
    sageRefs: refsOf("sage"),
    settings: SETTINGS,
    ftlCustomers: FTL_CUSTOMERS,
    holidays: HOLIDAYS,
    rates: [],
  };

  it("reads the latest good run and reports a later failure beside it", () => {
    const failed: RefreshRun = { ...run, id: 8, status: "failed", error: "57014: canceling statement due to statement timeout" };
    const view = buildGoalsView({ ...base, run, latestRun: failed, snapshot: DATASETS });
    expect(view.state).toBe("ready");
    expect(view.run?.id).toBe(7);
    expect(view.latestAttempt?.id).toBe(8);
    expect(money(view.model!.revenue.inSystemCents)).toBe("367014.16");
    expect(view.fx).toEqual({ rate: "1.421900", date: "2026-10-13", source: "boc", stale: false });
    expect(view.sections.revenue).toEqual(["revenue-by-currency"]);
  });

  it("flags a stored (fallback) rate as stale", () => {
    const view = buildGoalsView({ ...base, run: { ...run, fxSource: "stored" }, latestRun: run, snapshot: DATASETS });
    expect(view.fx?.stale).toBe(true);
    expect(view.latestAttempt).toBeNull();
  });

  it("says whether there is no data yet or no reporting database", () => {
    expect(buildGoalsView({ ...base, run: null, latestRun: null, snapshot: null }).state).toBe("no_data");
    expect(buildGoalsView({ ...base, configured: false, run: null, latestRun: null, snapshot: null }).state).toBe("not_configured");
  });
});
