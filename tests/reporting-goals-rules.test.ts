// Goals & Production business rules against the 2026-10-14 fixtures: every
// number the brief publishes, the Line 1 bulk goal (2026-10-16), the M1–M7
// manual-entry scenarios, and each rule's edge cases (bands, matching,
// statuses, freshness, covered-through, overlap).

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
  type BatchStage,
  type EntryContext,
  type GoalsModel,
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

/** Batch-list kg summed in whole grams (the list's kg carry up to 3 decimals). */
const listKg = (model: GoalsModel, stages: readonly BatchStage[]) =>
  model.batches.filter((b) => b.line1 && stages.includes(b.stage)).reduce((g, b) => g + Math.round(b.kg * 1000), 0) / 1000;

/** The invariant behind every Line 1 figure: it is a sum over the batch list, so card, chart and list agree. */
function expectLine1FromList(model: GoalsModel) {
  const minKg = 5_000;
  expect(model.batches.every((b) => b.line1 === b.kg >= minKg)).toBe(true);
  expect(model.line1).toMatchObject({
    inSystemKg: listKg(model, ["completed"]),
    byHandKg: listKg(model, ["completed_by_hand"]),
    scheduledFromTodayKg: listKg(model, ["scheduled"]),
    openPastDateKg: listKg(model, ["open_past_date"]),
  });
  expect(model.line1.totalKg).toBe(listKg(model, ["completed", "completed_by_hand"]));
  expect(model.line1.ifAllRunKg).toBe(listKg(model, ["completed", "completed_by_hand", "scheduled", "open_past_date"]));
  const daily = (pick: (d: GoalsModel["daily"][number]) => number) =>
    model.daily.reduce((g, d) => g + Math.round(pick(d) * 1000), 0) / 1000;
  expect(daily((d) => d.line1DoneKg)).toBe(model.line1.inSystemKg);
  expect(daily((d) => d.line1ByHandKg)).toBe(model.line1.byHandKg);
  expect(daily((d) => d.line1ScheduledKg)).toBe(listKg(model, ["scheduled", "open_past_date"]));
}

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

  it("works out Line 1 bulk: batches of 5,000 kg or more against 20,000 kg a working day", () => {
    // Worked out by hand from datasets.json's 94 batches (EXPECTED.line1). Realized at 5,000 kg or
    // more: 8 batches, 7,139 + 10,011 + 8,013 + 10,099 + 6,036 + 10,121 + 11,127 + 10,106 = 72,652 kg.
    // Open (planned kg) from today on: 16 batches, 136,555 kg, two of them exactly 5,000.000; open
    // past their date: 8 batches, 76,940 kg. Target 20,000 × 21 working days = 420,000 kg; due so
    // far 20,000 × 9 = 180,000 kg; needed per day (420,000 − 72,652) / 13 = 26,719.08 kg.
    const L = EXPECTED.line1;
    expect(model.line1).toMatchObject({
      targetKg: L.targetKg,
      dueSoFarKg: L.dueSoFarKg,
      dueBy: TODAY,
      inSystemKg: L.doneKg,
      byHandKg: 0,
      totalKg: L.doneKg,
      scheduledFromTodayKg: L.scheduledFromTodayKg,
      openPastDateKg: L.openPastDateKg,
      ifAllRunKg: L.ifAllRunKg,
      status: L.status,
    });
    expect(L.targetKg).toBe(SETTINGS.line1KgPerWorkingDay * EXPECTED.workingDays.month);
    expect(model.line1.neededPerDayKg.toFixed(2)).toBe(L.neededPerDayKg);
    const rows = (stage: BatchStage) => model.batches.filter((b) => b.line1 && b.stage === stage).length;
    expect([rows("completed"), rows("scheduled"), rows("open_past_date")]).toEqual([
      L.doneBatches,
      L.scheduledFromTodayBatches,
      L.openPastDateBatches,
    ]);
  });

  it("derives every Line 1 figure from the batch list, by size, whatever line FileMaker records", () => {
    expectLine1FromList(model);
    // Size decides: every batch of 5,000 kg or more is on FileMaker line 10 or 5, none on line 1.
    expect([...new Set(model.batches.filter((b) => b.line1).map((b) => b.line))].sort()).toEqual(["10", "5"]);
    expect(model.batches.filter((b) => b.line1 && b.kg === 5_000).map((b) => b.batch)).toEqual(["BC-26289G", "BC-26295A"]);
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

  it("matches the prototype's day-by-day sheet, with Line 1 kg on the days the batches ran or are planned", () => {
    const line1 = new Map(EXPECTED.line1.byDay.map((d) => [d.day, d]));
    for (const [i, proto] of EXPECTED.dailyFromPrototype.entries()) {
      const point = model.daily[i];
      expect(point.day).toBe(proto.day);
      expect(point.isWorkingDay).toBe(proto.isWorkingDay);
      expect(point.line1DoneKg, proto.day).toBe(line1.get(proto.day)?.doneKg ?? 0);
      expect(point.line1ByHandKg, proto.day).toBe(0);
      expect(point.line1ScheduledKg, proto.day).toBe(line1.get(proto.day)?.scheduledKg ?? 0);
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
      "72,652 kg of Line 1 bulk against 180,000 kg due so far, 2 full truckloads, and $367,014 of the $428,571 revenue due so far."
    );
  });

  it("is not behind when both cutoffs are today", () => {
    expect(model.behind).toEqual({ production: false, sage: false });
  });
});

describe("goals on 2026-10-14 with M1–M7", () => {
  const model = computeGoals(goalsInput({ entries: ENTRIES }));

  it("counts M1 and M2 as Line 1 by hand without double-counting the open batch M1 completes", () => {
    // M1 (10,050 kg) completes BC-26286C, open for Oct 13 with 10,000 kg planned; M2 (9,000 kg) is
    // not in FileMaker. By hand 10,050 + 9,000 = 19,050; total 72,652 + 19,050 = 91,702; open past
    // their date 76,940 − 10,000 = 66,940; if all run 91,702 + 136,555 + 66,940 = 295,197; needed
    // per day (420,000 − 91,702) / 13 = 25,253.69.
    const W = EXPECTED.withAllEntries;
    expect(model.line1).toMatchObject({
      inSystemKg: EXPECTED.line1.doneKg,
      byHandKg: W.line1ByHandKg,
      totalKg: W.line1TotalKg,
      scheduledFromTodayKg: EXPECTED.line1.scheduledFromTodayKg,
      openPastDateKg: W.line1OpenPastDateKg,
      ifAllRunKg: W.line1IfAllRunKg,
    });
    expect(model.line1.neededPerDayKg.toFixed(2)).toBe(W.line1NeededPerDayKg);
    expectLine1FromList(model);
    // Oct 13: BC-26286C's 10,000 planned kg leave the schedule (28,000 → 18,000); M1's 10,050 count by hand.
    expect(model.daily.find((d) => d.day === "2026-10-13")).toMatchObject({ line1ScheduledKg: 18_000, line1ByHandKg: 10_050 });
    expect(model.daily.find((d) => d.day === TODAY)).toMatchObject({ line1DoneKg: 10_106, line1ByHandKg: 9_000, line1ScheduledKg: 43_000 });
    expect(model.entries.filter((e) => e.line1).map((e) => e.entryId)).toEqual(["M001", "M002"]);
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
    expect(m1Row).toMatchObject({ stage: "completed_by_hand", status: "Completed (by hand)", date: "2026-10-13", kg: 10050, line1: true, line: "10", entryId: "M001", source: "By hand" });
    const m2Row = model.batches.find((b) => b.batch === "BC-26290X")!;
    expect(m2Row).toMatchObject({ stage: "completed_by_hand", date: TODAY, kg: 9000, band: "~10,000", line1: true, line: null, entryId: "M002" });
    expect(model.batches.filter((b) => b.source === "By hand")).toHaveLength(2);
    expect(model.sizes.openPastDate).toBe(19);
  });

  it("keeps covered-through at today", () => {
    expect(model.coveredThrough).toEqual({ production: TODAY, revenue: TODAY });
    expect(model.line1.dueSoFarKg).toBe(180_000);
    expect(money(model.revenue.dueSoFarCents)).toBe("428571.43");
  });

  it("builds the takeaway from the totals including entries", () => {
    expect(model.takeaway).toBe(
      "91,702 kg of Line 1 bulk against 180,000 kg due so far, 3 full truckloads, and $408,628 of the $428,571 revenue due so far."
    );
  });
});

describe("Line 1 bulk edges", () => {
  const batch = (over: Partial<BatchRow> & { id: string; kg: string }): BatchRow => ({
    batch: `B-${over.id}`,
    product: null,
    status: "Realized",
    statusQc: "QC Released",
    line: "10",
    date: "2026-10-05",
    ...over,
  });
  const goals = (batches: BatchRow[], entries: ReturnType<typeof manualEntry>[] = []) =>
    computeGoals(goalsInput({ data: { ...DATASETS, batches }, entries }));

  it("counts exactly 5,000 kg and not 4,999.999 kg, from FileMaker and by hand", () => {
    const model = goals(
      [batch({ id: "1", kg: "5000.000" }), batch({ id: "2", kg: "4999.999" })],
      [
        manualEntry({ entryId: "E1", type: "Batch", date: "2026-10-06", reference: "N-1", kg: "5000.000" }),
        manualEntry({ entryId: "E2", type: "Batch", date: "2026-10-06", reference: "N-2", kg: "4999.999" }),
      ]
    );
    expect(model.batches.map((b) => [b.batch, b.line1])).toEqual([
      ["B-1", true],
      ["B-2", false],
      ["N-1", true],
      ["N-2", false],
    ]);
    expect(model.entries.map((e) => [e.entryId, e.line1])).toEqual([
      ["E1", true],
      ["E2", false],
    ]);
    expect(model.line1).toMatchObject({ inSystemKg: 5_000, byHandKg: 5_000, totalKg: 10_000, ifAllRunKg: 10_000 });
    expect(model.daily.find((d) => d.day === "2026-10-05")?.line1DoneKg).toBe(5_000);
    expect(model.daily.find((d) => d.day === "2026-10-06")?.line1ByHandKg).toBe(5_000);
    expectLine1FromList(model);
  });

  it("moves an open Line 1 batch's planned kg out of the schedule when an entry completes it, and counts the entry's own kg", () => {
    const open = batch({ id: "3", batch: "O-3", status: "Allocated", statusQc: null, date: "2026-10-20", kg: "8000.000" });
    expect(goals([open]).line1).toMatchObject({ byHandKg: 0, scheduledFromTodayKg: 8_000, ifAllRunKg: 8_000 });

    const done = goals([open], [manualEntry({ entryId: "E3", type: "Batch", date: "2026-10-13", reference: " o-3 ", kg: "7250.500" })]);
    expect(done.line1).toMatchObject({ byHandKg: 7_250.5, scheduledFromTodayKg: 0, totalKg: 7_250.5, ifAllRunKg: 7_250.5 });
    expect(done.daily.find((d) => d.day === "2026-10-20")?.line1ScheduledKg).toBe(0);
    expect(done.daily.find((d) => d.day === "2026-10-13")?.line1ByHandKg).toBe(7_250.5);
    expect(done.batches).toEqual([expect.objectContaining({ batch: "O-3", stage: "completed_by_hand", kg: 7_250.5, line1: true, entryId: "E3" })]);
    expectLine1FromList(done);

    // An entry under 5,000 kg still takes the open batch off the schedule, but is not Line 1 itself.
    const small = goals([open], [manualEntry({ entryId: "E4", type: "Batch", date: "2026-10-13", reference: "O-3", kg: "4000" })]);
    expect(small.line1).toMatchObject({ byHandKg: 0, scheduledFromTodayKg: 0, ifAllRunKg: 0 });
    expect(small.entries[0]).toMatchObject({ counts: true, line1: false, completesBatchId: "3" });
    expectLine1FromList(small);
  });

  it("adds kg to the gram, without floating-point drift", () => {
    const model = goals(
      [],
      ["5000.1", "5000.2", "5000.3"].map((kg, i) =>
        manualEntry({ entryId: `G${i}`, type: "Batch", date: "2026-10-06", reference: `G-${i}`, kg })
      )
    );
    expect(5000.1 + 5000.2 + 5000.3).not.toBe(15_000.6); // what plain addition would show
    expect(model.line1).toMatchObject({ byHandKg: 15_000.6, totalKg: 15_000.6 });
    expect(model.daily.find((d) => d.day === "2026-10-06")?.line1ByHandKg).toBe(15_000.6);
  });

  it("targets the per-day kg setting times the month's working days, and due so far times the days covered", () => {
    const model = computeGoals(goalsInput({ settings: { ...SETTINGS, line1KgPerWorkingDay: 12_500 } }));
    expect(model.line1).toMatchObject({ targetKg: 12_500 * 21, dueSoFarKg: 12_500 * 9 });
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
    expect(model.line1).toMatchObject({ scheduledFromTodayKg: 10_000, openPastDateKg: 10_000, ifAllRunKg: 20_000 });
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
    expect(stale.line1.dueSoFarKg).toBe(100_000); // 5 working days × 20,000 kg
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
    // A counted Line 1 batch by hand moves production's covered-through, as large batches did; a smaller one doesn't.
    const production = (kg: string) =>
      computeGoals(
        goalsInput({
          data: { ...DATASETS, cutoffs: { productionCutoff: "2026-10-07", sageCutoff: "2026-10-09" } },
          entries: [manualEntry({ entryId: "B1", type: "Batch", date: "2026-10-13", reference: "BC-NEW-1", kg })],
        })
      );
    expect(production("5000")).toMatchObject({ coveredThrough: { production: "2026-10-13" }, line1: { dueSoFarKg: 160_000 } }); // 8 days
    expect(production("4999.999")).toMatchObject({ coveredThrough: { production: "2026-10-07" }, line1: { dueSoFarKg: 100_000 } });
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
    expect(view.sections.revenue).toEqual(["revenue-by-currency", "credit-notes"]);
    // Line 1 is built from the batch list; the day-by-day charts add it to the revenue per day.
    expect(view.sections.line1).toEqual(["batches"]);
    expect(view.sections.daily).toEqual(["daily", "batches"]);
    expect(view.settings).toEqual(SETTINGS);
  });

  it("flags a stored (fallback) rate as stale", () => {
    const view = buildGoalsView({ ...base, run: { ...run, fxSource: "stored" }, latestRun: run, snapshot: DATASETS });
    expect(view.fx?.stale).toBe(true);
    expect(view.latestAttempt).toBeNull();
  });

  it("says whether there is no data yet or no reporting database", () => {
    expect(buildGoalsView({ ...base, run: null, latestRun: null, snapshot: null })).toMatchObject({ state: "no_data", settings: null });
    expect(buildGoalsView({ ...base, configured: false, run: null, latestRun: null, snapshot: null }).state).toBe("not_configured");
  });
});
