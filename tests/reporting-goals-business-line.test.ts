// Revenue by business line (Ricardo Savelli, 26 Oct 2026). Manufacturing +
// Distribution + Services equal the Revenue headline to the cent. Freight and
// other charges stay out. Returns come off. A shipped-not-invoiced estimate,
// when the snapshot has one, is inside the headline. Item amounts follow the
// finished-good and 3PL rules. A total with no item lines is Distribution.
// The three lines add to the headline to the cent.

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GoalCards } from "@/components/mc/goals/goal-cards";
import { cents, isReady } from "@/components/mc/goals/helpers";
import {
  businessLineOf,
  businessLineSum,
  pendingProductsOf,
  revenueByBusinessLine,
} from "@/lib/reporting/goals/business-line";
import { allocateCents, sumToCents } from "@/lib/reporting/goals/money";
import { FINISHED_GOOD_MATCH_SQL } from "@/lib/reporting/goals/queries/finished-goods";
import type { CreditNoteRow, CreditNotesDataset, Datasets, RevenueRateBasis, ShipmentLineRow } from "@/lib/reporting/goals/types";

import creditNotesJson from "./fixtures/reporting-goals/2026-10-14/credit-notes.json";
import {
  DATASETS,
  ENTRIES,
  FINISHED_GOOD_CODES,
  FORECAST,
  FTL_CUSTOMERS,
  SHIPMENT_LINES,
  SHIPMENT_LINES_SUMMARY,
  goalsPage,
} from "./reporting-goals-helpers";

const CREDIT_NOTES = creditNotesJson as unknown as CreditNotesDataset;
const html = <P extends object>(component: ComponentType<P>, props: P) => renderToStaticMarkup(createElement(component, props));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

function pageAt(basis: RevenueRateBasis, snapshot: Datasets = DATASETS) {
  const page = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, basis, snapshot);
  if (!isReady(page) || !page.revenueGoal || !page.revenueScope || !page.revenueByBusinessLine || !page.revenueByClass) {
    throw new Error("fixture page should be ready");
  }
  return page;
}

describe("revenue by business line", () => {
  it("adds up to the headline at both rates and both customer scopes", () => {
    for (const basis of ["boc", "sage"] as const) {
      const page = pageAt(basis);
      const split = page.revenueByBusinessLine!;
      expect(split.state).toBe("ready");
      expect(businessLineSum(split.all.amounts)).toBe(page.revenueGoal!.goalCadCents);
      expect(businessLineSum(split.mfg.amounts)).toBe(page.revenueScope!.goalCadCents);
      expect(split.all.amounts.manufacturingCadCents).toBeGreaterThan(0);
      expect(split.all.amounts.servicesCadCents).toBe(0);
      expect(split.all.serviceChargesCadCents).toBe(0);
      expect(split.all.amounts.distributionCadCents).toBeGreaterThan(split.all.amounts.manufacturingCadCents);
      const goal = page.revenueGoal!;
      expect(goal.goalCadCents + goal.chargesCadCents + goal.returnsCadCents).toBe(goal.totalCadCents);
    }
  });

  it("classifies a finished good, a 3PL service, and every other product", () => {
    expect(businessLineOf("FP-2002", "Shampoo", FINISHED_GOOD_CODES)).toEqual({ line: "manufacturing", ambiguous: false });
    expect(businessLineOf(" fp-2002 ", "Shampoo", FINISHED_GOOD_CODES).line).toBe("manufacturing");
    expect(businessLineOf("TP-DBS-1L", "Terra Pure shampoo", FINISHED_GOOD_CODES).line).toBe("distribution");
    expect(businessLineOf("3PL", "Storage", FINISHED_GOOD_CODES)).toEqual({ line: "services", ambiguous: false });
    expect(businessLineOf("3PL-STORE", null, FINISHED_GOOD_CODES).line).toBe("services");
    expect(businessLineOf("BLK-SHB-KG", "3PL pick and pack", FINISHED_GOOD_CODES).line).toBe("services");
    expect(businessLineOf("FP-2002", "3PL finished good", FINISHED_GOOD_CODES)).toEqual({ line: "manufacturing", ambiguous: true });
    expect(businessLineOf("FRT", "Freight", FINISHED_GOOD_CODES).line).toBe("distribution");
  });

  it("moves a product line to Services without changing the total, and names an ambiguous code", () => {
    const page = pageAt("boc");
    const lines = SHIPMENT_LINES.map((line) =>
      line.invoice === "IN1000180349" && line.code === "TP-DBS-1L" ? { ...line, code: "3PL", description: "3PL storage" } : line
    );
    const ambiguous = SHIPMENT_LINES.map((line) =>
      line.code === "FP-2002" ? { ...line, description: "3PL finished good" } : line
    );
    const input = {
      shipments: page.shipments,
      linesSummary: SHIPMENT_LINES_SUMMARY,
      finishedGoodCodes: FINISHED_GOOD_CODES,
      creditNotes: [],
      ftlCustomers: FTL_CUSTOMERS,
      rate: page.model.revenue.rate,
      byClass: page.revenueByClass!,
    };
    const moved = revenueByBusinessLine({ ...input, lines });
    const both = revenueByBusinessLine({ ...input, lines: ambiguous });
    expect(moved.state).toBe("ready");
    expect(businessLineSum(moved.all.amounts)).toBe(page.revenueGoal!.goalCadCents);
    expect(moved.all.amounts.servicesCadCents).toBeGreaterThan(0);
    expect(moved.all.amounts.distributionCadCents).toBeLessThan(page.revenueByBusinessLine!.all.amounts.distributionCadCents);
    expect(both.ambiguousCodes).toContain("FP-2002");
    expect(both.all.amounts.manufacturingCadCents).toBe(page.revenueByBusinessLine!.all.amounts.manufacturingCadCents);
  });

  it("counts a 3PL miscellaneous charge as Services inside the headline, and leaves freight on the side line", () => {
    const sample = pageAt("boc");
    const chosen = new Set<string>();
    for (const row of sample.shipments) {
      if (row.source === "Sage" && (row.currency === "CAD" || row.currency === "USD") && row.otherCents > 0) chosen.add(row.invoice);
    }
    const seen = new Set<string>();
    const lines: ShipmentLineRow[] = SHIPMENT_LINES.map((line) => {
      if (line.kind !== "charge" || !chosen.has(line.invoice) || seen.has(line.invoice)) return line;
      seen.add(line.invoice);
      return { ...line, code: "3PL", description: "3PL storage" };
    });
    expect(seen.size).toBeGreaterThan(0);
    for (const basis of ["boc", "sage"] as const) {
      const before = pageAt(basis);
      const page = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, basis, DATASETS, lines);
      if (!isReady(page) || !page.revenueGoal || !page.revenueScope || !page.revenueByBusinessLine) throw new Error("ready");
      const split = page.revenueByBusinessLine;
      const goal = page.revenueGoal;
      expect(split.state).toBe("ready");
      expect(split.all.serviceChargesCadCents).toBeGreaterThan(0);
      expect(split.all.amounts.servicesCadCents).toBe(split.all.serviceChargesCadCents);
      expect(businessLineSum(split.all.amounts)).toBe(goal.goalCadCents);
      expect(businessLineSum(split.mfg.amounts)).toBe(page.revenueScope.goalCadCents);
      expect(goal.goalCadCents + goal.chargesCadCents + goal.returnsCadCents).toBe(goal.totalCadCents);
      expect(goal.goalCadCents - before.revenueGoal!.goalCadCents).toBe(split.all.serviceChargesCadCents);
      expect(before.revenueGoal!.chargesCadCents - goal.chargesCadCents).toBe(split.all.serviceChargesCadCents);
      expect(goal.chargesCadCents).toBeGreaterThan(0);
    }
  });

  it("takes a credited 3PL charge off Services when that invoice is in this month", () => {
    const sample = pageAt("boc");
    const invoice = sample.shipments.find((row) => row.source === "Sage" && row.currency === "CAD" && row.otherCents > 0);
    if (!invoice) throw new Error("fixture should have a CAD invoice with charges");
    const lines = SHIPMENT_LINES.map((line) =>
      line.invoice === invoice.invoice && line.kind === "charge" ? { ...line, code: "3PL", description: "3PL storage" } : line
    );
    const charged = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", DATASETS, lines);
    const amount = (invoice.otherCents / 100).toFixed(2);
    const note: CreditNoteRow = {
      creditNote: "CN-3PL",
      invoice: invoice.invoice,
      customerCode: invoice.customerCode,
      customer: invoice.customer,
      creditDate: "2026-10-10",
      currency: "CAD",
      productValue: "0.00",
      otherCharges: amount,
      netBeforeTax: amount,
    };
    const credited = goalsPage(
      {},
      ENTRIES,
      FORECAST,
      SHIPMENT_LINES_SUMMARY,
      "boc",
      { ...DATASETS, creditNotes: { access: "read", missing: [], notes: [note] } },
      lines
    );
    if (!isReady(charged) || !isReady(credited) || !charged.revenueGoal || !credited.revenueGoal) throw new Error("ready");
    const moved = charged.revenueByBusinessLine!.all.serviceChargesCadCents;
    const back = credited.revenueByBusinessLine!.all.creditedServiceChargesCadCents;
    expect(moved).toBe(invoice.otherCents);
    expect(back).toBe(moved);
    expect(charged.revenueByBusinessLine!.all.amounts.servicesCadCents - credited.revenueByBusinessLine!.all.amounts.servicesCadCents).toBe(back);
    expect(businessLineSum(credited.revenueByBusinessLine!.all.amounts)).toBe(credited.revenueGoal.goalCadCents);
    expect(credited.revenueGoal.goalCadCents + credited.revenueGoal.chargesCadCents + credited.revenueGoal.returnsCadCents).toBe(
      credited.revenueGoal.totalCadCents
    );
    const unrelated = pageAt("boc", { ...DATASETS, creditNotes: CREDIT_NOTES });
    expect(unrelated.revenueByBusinessLine!.all.creditedServiceChargesCadCents).toBe(0);
  });

  it("subtracts returns and still matches the headline", () => {
    const base = pageAt("boc");
    const page = pageAt("boc", { ...DATASETS, creditNotes: CREDIT_NOTES });
    const split = page.revenueByBusinessLine!;
    expect(businessLineSum(split.all.amounts)).toBe(page.revenueGoal!.goalCadCents);
    expect(businessLineSum(split.mfg.amounts)).toBe(page.revenueScope!.goalCadCents);
    expect(businessLineSum(split.all.amounts)).toBeLessThan(base.revenueGoal!.goalCadCents);
    expect(split.returnsShared).toBe(CREDIT_NOTES.notes.length);
  });

  it("puts a shipped-not-invoiced estimate in the headline, classifies item lines, and skips a hand-entered duplicate", () => {
    const snapshot = {
      ...DATASETS,
      pendingShipments: {
        access: "read",
        shipments: [
          { shipment: "SH-LUMP", customerCode: "1HRA01", currency: "CAD", productValue: "100.00", lines: 2 },
          {
            shipment: "SH-LINES",
            customerCode: "5STA10",
            currency: "USD",
            productValue: "40.00",
            lines: [
              { code: "FP-2002", description: "Shampoo", amount: "25.00", discount: "0" },
              { code: "3PL", description: "Storage", amount: "15.00" },
            ],
          },
          { shipment: "PO0104001", customerCode: "ACECA01", currency: "CAD", productValue: "10.00" },
        ],
      },
    } as unknown as Datasets;
    const kept = pendingProductsOf(snapshot, new Set(["po0104001"]));
    expect(kept.map((row) => row.productValue)).toEqual(["100.00", "40.00"]);
    expect(kept[0].lines).toBeUndefined();

    const page = pageAt("boc", snapshot);
    const split = page.revenueByBusinessLine!;
    const goal = page.revenueGoal!;
    const mfg = page.revenueScope!;
    // Invoiced lines add to the headline before the estimate. The estimate is inside the headline.
    expect(businessLineSum(split.all.amounts) + businessLineSum(split.all.pending)).toBe(goal.goalCadCents);
    expect(businessLineSum(split.mfg.amounts) + businessLineSum(split.mfg.pending)).toBe(mfg.goalCadCents);
    expect(businessLineSum(split.all.pending)).toBe(goal.pendingCadCents);
    expect(businessLineSum(split.mfg.pending)).toBe(mfg.pendingCadCents);
    expect(goal.goalCadCents + goal.chargesCadCents + goal.returnsCadCents - goal.pendingCadCents).toBe(goal.totalCadCents);
    expect(split.pendingWithoutLines).toBe(1);
    expect(split.all.pending.distributionCadCents).toBe(10_000);
    expect(split.all.pending.manufacturingCadCents).toBeGreaterThan(0);
    expect(split.all.pending.servicesCadCents).toBeGreaterThan(0);
    expect(businessLineSum(split.all.pending)).toBe(
      10_000 + split.all.pending.manufacturingCadCents + split.all.pending.servicesCadCents
    );
    const markup = text(html(GoalCards, { page }));
    expect(markup).not.toContain("not in this headline");
    expect(markup).toContain("no item lines");
    expect(markup).toContain("shipped, not yet invoiced");
    expect(markup).toContain(cents(split.all.amounts.distributionCadCents + split.all.pending.distributionCadCents));
    expect(markup).not.toContain("$0.10");
  });

  it("waits when the lines are missing, and still splits when the finished-good list can't be read", () => {
    const page = pageAt("boc");
    const input = {
      shipments: page.shipments,
      lines: SHIPMENT_LINES,
      linesSummary: SHIPMENT_LINES_SUMMARY,
      finishedGoodCodes: FINISHED_GOOD_CODES,
      creditNotes: [],
      ftlCustomers: FTL_CUSTOMERS,
      rate: page.model.revenue.rate,
      byClass: page.revenueByClass!,
    };
    expect(revenueByBusinessLine({ ...input, linesSummary: null }).waiting).toBe("Invoice lines aren’t in this refresh yet.");
    expect(revenueByBusinessLine({ ...input, lines: null }).waiting).toBe("Invoice lines aren’t loaded.");
    const unread = revenueByBusinessLine({ ...input, finishedGoodCodes: null });
    expect(unread.state).toBe("ready");
    expect(unread.finishedGoodsUnavailable).toBe(true);
    expect(unread.waiting).toBeNull();
    expect(unread.all.amounts.manufacturingCadCents).toBe(0);
    expect(unread.all.amounts.distributionCadCents).toBeGreaterThan(0);
    expect(
      revenueByBusinessLine({
        ...input,
        linesSummary: { access: "missing", missing: ["silver.oeinvd.item"], lines: 0 },
      }).waiting
    ).toContain("silver.oeinvd.item");
  });

  it("splits cents so the parts add up, and reads only finished-good codes", () => {
    expect(allocateCents(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateCents(5, [0, 0])).toEqual([0, 0]);
    expect(allocateCents(100, [1, 3]).reduce((sum, part) => sum + part, 0)).toBe(100);
    expect(FINISHED_GOOD_MATCH_SQL).toContain("silver.finished_products");
    expect(FINISHED_GOOD_MATCH_SQL).toContain("erp_code");
    expect(FINISHED_GOOD_MATCH_SQL).toContain("$1::text[]");
    expect(FINISHED_GOOD_MATCH_SQL.toLowerCase()).not.toMatch(/\b(insert|update|delete|drop)\b/);
  });

  function withCharges(replace: (line: ShipmentLineRow) => ShipmentLineRow[]): { invoice: string; otherCents: number; lines: ShipmentLineRow[] } {
    const sample = pageAt("boc");
    const invoice = sample.shipments.find((row) => row.source === "Sage" && row.currency === "CAD" && row.otherCents > 0);
    if (!invoice) throw new Error("fixture should have a CAD invoice with charges");
    let replaced = false;
    const lines = SHIPMENT_LINES.flatMap((line) => {
      if (line.invoice !== invoice.invoice || line.kind !== "charge") return [line];
      if (replaced) return [];
      replaced = true;
      return replace(line);
    });
    expect(replaced).toBe(true);
    return { invoice: invoice.invoice, otherCents: invoice.otherCents, lines };
  }

  function tiesToHeadline(page: ReturnType<typeof goalsPage>) {
    if (!isReady(page) || !page.revenueGoal || !page.revenueScope || !page.revenueByBusinessLine) throw new Error("ready");
    const split = page.revenueByBusinessLine;
    const goal = page.revenueGoal;
    const mfg = page.revenueScope;
    expect(split.state).toBe("ready");
    expect(businessLineSum(split.all.amounts) + businessLineSum(split.all.pending)).toBe(goal.goalCadCents);
    expect(businessLineSum(split.mfg.amounts) + businessLineSum(split.mfg.pending)).toBe(mfg.goalCadCents);
    expect(goal.goalCadCents + goal.chargesCadCents + goal.returnsCadCents - goal.pendingCadCents).toBe(goal.totalCadCents);
  }

  it("keeps a 3PL charge in Services when the finished-good lookup fails, and the three lines add to the headline", () => {
    const sample = pageAt("boc");
    const chosen = new Set<string>();
    for (const row of sample.shipments) {
      if (row.source === "Sage" && (row.currency === "CAD" || row.currency === "USD") && row.otherCents > 0) chosen.add(row.invoice);
    }
    const seen = new Set<string>();
    const lines = SHIPMENT_LINES.map((line) => {
      if (line.kind !== "charge" || !chosen.has(line.invoice) || seen.has(line.invoice)) return line;
      seen.add(line.invoice);
      return { ...line, code: "3PL", description: "3PL storage" };
    });
    const read = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", DATASETS, lines);
    const failed = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", DATASETS, lines, null);
    if (!isReady(read) || !isReady(failed) || !read.revenueGoal || !failed.revenueGoal || !failed.revenueByBusinessLine) {
      throw new Error("ready");
    }
    const split = failed.revenueByBusinessLine;
    tiesToHeadline(failed);
    tiesToHeadline(read);
    expect(split.finishedGoodsUnavailable).toBe(true);
    expect(read.revenueByBusinessLine!.finishedGoodsUnavailable).toBe(false);
    expect(split.all.amounts.manufacturingCadCents).toBe(0);
    expect(split.all.serviceChargesCadCents).toBe(read.revenueByBusinessLine!.all.serviceChargesCadCents);
    expect(split.all.serviceChargesCadCents).toBeGreaterThan(0);
    expect(split.all.amounts.servicesCadCents).toBe(split.all.serviceChargesCadCents);
    expect(failed.revenueGoal.goalCadCents).toBe(read.revenueGoal.goalCadCents);
    expect(split.all.amounts.distributionCadCents).toBe(
      read.revenueByBusinessLine!.all.amounts.manufacturingCadCents + read.revenueByBusinessLine!.all.amounts.distributionCadCents
    );
    const markup = text(html(GoalCards, { page: failed }));
    expect(markup).toContain("The MRP finished-good list can’t be read, so nothing is counted as Manufacturing.");
    expect(markup).toContain("3PL charges still count as Services.");
    expect(markup).toContain(`Services (3PL) ${cents(split.all.amounts.servicesCadCents)}`);
  });

  it("weights a 3PL charge by its amount, not its discount, and the three lines add to the headline", () => {
    const { otherCents, lines } = withCharges((line) => [
      { ...line, code: "3PL", description: "3PL storage", amount: "100.000", discount: "90.000" },
      { ...line, lineNo: (line.lineNo ?? 0) + 1, code: "FRT", description: "Freight", amount: "10.000", discount: "0.000" },
    ]);
    const gross = allocateCents(otherCents, [sumToCents(["100.000"]), sumToCents(["10.000"])])[0];
    const net = allocateCents(otherCents, [sumToCents(["100.000"], ["90.000"]), sumToCents(["10.000"])])[0];
    expect(gross).not.toBe(net);
    const page = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", DATASETS, lines);
    if (!isReady(page) || !page.revenueGoal || !page.revenueByBusinessLine) throw new Error("ready");
    tiesToHeadline(page);
    expect(page.revenueByBusinessLine.all.serviceChargesCadCents).toBe(gross);
    expect(page.revenueByBusinessLine.all.amounts.servicesCadCents).toBe(gross);
  });

  it("rounds charge weights once after summing, and the three lines add to the headline", () => {
    const { otherCents, lines } = withCharges((line) => [
      { ...line, code: "3PL", description: "3PL storage", amount: "0.004", discount: "0.000" },
      { ...line, lineNo: (line.lineNo ?? 0) + 1, code: "3PL", description: "3PL handling", amount: "0.004", discount: "0.000" },
      { ...line, lineNo: (line.lineNo ?? 0) + 2, code: "FRT", description: "Freight", amount: "0.004", discount: "0.000" },
    ]);
    const service = sumToCents(["0.004", "0.004"]);
    const accessorial = sumToCents(["0.004"]);
    expect(service).toBe(1);
    expect(accessorial).toBe(0);
    expect(sumToCents(["0.004"])).toBe(0);
    const page = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", DATASETS, lines);
    if (!isReady(page) || !page.revenueGoal || !page.revenueByBusinessLine) throw new Error("ready");
    tiesToHeadline(page);
    expect(page.revenueByBusinessLine.all.serviceChargesCadCents).toBe(allocateCents(otherCents, [service, accessorial])[0]);
    expect(page.revenueByBusinessLine.all.serviceChargesCadCents).toBe(otherCents);
  });

  it("shows the three totals on the Revenue card", () => {
    const page = pageAt("boc");
    const amounts = page.revenueByBusinessLine!.all.amounts;
    const markup = html(GoalCards, { page });
    const out = text(markup);
    expect(markup).toContain('data-testid="goals-revenue-lines"');
    expect(out).toContain(`Manufacturing ${cents(amounts.manufacturingCadCents)}`);
    expect(out).toContain(`Distribution ${cents(amounts.distributionCadCents)}`);
    expect(out).toContain(`Services (3PL) ${cents(amounts.servicesCadCents)}`);
    expect(out).toContain("These add to the headline.");
    expect(out).not.toContain("finished-good list");
    expect(cents(businessLineSum(amounts))).toBe(cents(page.revenueGoal!.goalCadCents));

    const mfg = text(html(GoalCards, { page, scope: "mfg" }));
    const mfgAmounts = page.revenueByBusinessLine!.mfg.amounts;
    expect(mfg).toContain(`Manufacturing ${cents(mfgAmounts.manufacturingCadCents)}`);
    expect(businessLineSum(mfgAmounts)).toBe(page.revenueScope!.goalCadCents);
  });
});
