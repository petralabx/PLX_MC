// Revenue by business line (Ricardo Savelli, 26 Oct 2026). Manufacturing +
// Distribution + Services equal the Revenue headline to the cent. Freight and
// other charges stay out. Returns come off. A shipped-not-invoiced estimate,
// when the snapshot has one, is split the same way and stays beside the
// headline until the headline itself includes it.

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GoalCards } from "@/components/mc/goals/goal-cards";
import { cents, isReady, type ReadyPage } from "@/components/mc/goals/helpers";
import {
  businessLineOf,
  businessLineSum,
  pendingProductsOf,
  revenueByBusinessLine,
} from "@/lib/reporting/goals/business-line";
import { allocateCents } from "@/lib/reporting/goals/money";
import { FINISHED_GOOD_MATCH_SQL } from "@/lib/reporting/goals/queries/finished-goods";
import type { CreditNotesDataset, Datasets, RevenueRateBasis } from "@/lib/reporting/goals/types";

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
      expect(split.all.amounts.distributionCadCents).toBeGreaterThan(split.all.amounts.manufacturingCadCents);
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

  it("subtracts returns and still matches the headline", () => {
    const base = pageAt("boc");
    const page = pageAt("boc", { ...DATASETS, creditNotes: CREDIT_NOTES });
    const split = page.revenueByBusinessLine!;
    expect(businessLineSum(split.all.amounts)).toBe(page.revenueGoal!.goalCadCents);
    expect(businessLineSum(split.mfg.amounts)).toBe(page.revenueScope!.goalCadCents);
    expect(businessLineSum(split.all.amounts)).toBeLessThan(base.revenueGoal!.goalCadCents);
    expect(split.returnsShared).toBe(CREDIT_NOTES.notes.length);
  });

  it("splits a shipped-not-invoiced estimate beside the headline, and skips a hand-entered duplicate", () => {
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
    } as Datasets;
    const kept = pendingProductsOf(snapshot, new Set(["po0104001"]));
    expect(kept.map((row) => row.productValue)).toEqual(["100.00", "40.00"]);
    expect(kept[0].lines).toBeUndefined();

    const page = pageAt("boc", snapshot);
    const split = page.revenueByBusinessLine!;
    expect(businessLineSum(split.all.amounts)).toBe(page.revenueGoal!.goalCadCents);
    expect(split.pendingWithoutLines).toBe(1);
    expect(split.all.pending.distributionCadCents).toBe(10_000);
    expect(split.all.pending.manufacturingCadCents).toBeGreaterThan(0);
    expect(split.all.pending.servicesCadCents).toBeGreaterThan(0);
    expect(businessLineSum(split.all.pending)).toBe(
      10_000 + split.all.pending.manufacturingCadCents + split.all.pending.servicesCadCents
    );
    const markup = text(html(GoalCards, { page }));
    expect(markup).toContain("Shipped, not invoiced (not in this headline)");
    expect(markup).not.toContain("$0.10");

    const included = {
      ...page,
      revenueGoal: { ...page.revenueGoal!, pendingCadCents: businessLineSum(split.all.pending) },
    } as ReadyPage;
    const folded = text(html(GoalCards, { page: included }));
    expect(folded).not.toContain("not in this headline");
    expect(folded).toContain(cents(split.all.amounts.distributionCadCents + split.all.pending.distributionCadCents));
  });

  it("waits when the lines or the finished-good list are missing", () => {
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
    expect(revenueByBusinessLine({ ...input, finishedGoodCodes: null }).waiting).toBe("The MRP finished-good list can’t be read yet.");
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
    expect(cents(businessLineSum(amounts))).toBe(cents(page.revenueGoal!.goalCadCents));

    const mfg = text(html(GoalCards, { page, scope: "mfg" }));
    const mfgAmounts = page.revenueByBusinessLine!.mfg.amounts;
    expect(mfg).toContain(`Manufacturing ${cents(mfgAmounts.manufacturingCadCents)}`);
    expect(businessLineSum(mfgAmounts)).toBe(page.revenueScope!.goalCadCents);
  });
});
