// Freight and other charges out of the Revenue goal (TASK-3952), against the
// 2026-10-14 fixture. A Sage invoice's charges are its other charges (invmisc,
// the sum of its line type 2 lines); an entry's are its freight. The goal view
// leaves them out of the headline, status and pace, and everything still adds
// up to the card's all-in total to the cent. The reconcile check: each Sage
// invoice's item lines (amount less discount) plus its charge lines come to its
// net before tax (invnetnotx).

import { describe, expect, it } from "vitest";

import { isReady } from "@/components/mc/goals/helpers";
import { sumToCents } from "@/lib/reporting/goals/money";
import { revenueScope } from "@/lib/reporting/goals/revenue-scope";

import { SHIPMENT_LINES, goalsPage } from "./reporting-goals-helpers";

const PAGE = goalsPage();
if (!isReady(PAGE)) throw new Error("fixture page should be ready");

describe("charges out of the goal", () => {
  it("the goal view is the card's total less its charges, to the cent", () => {
    const goal = PAGE.revenueGoal!;
    const byClass = PAGE.revenueByClass!;
    expect(goal.totalCadCents).toBe(PAGE.model.revenue.totalCents);
    expect(goal.chargesCadCents).toBe(byClass.total.charges.totalCadCents);
    expect(goal.goalCadCents + goal.chargesCadCents).toBe(PAGE.model.revenue.totalCents);
    expect(goal.chargesCadCents).toBeGreaterThan(0);
    expect(goal.progress).toBeCloseTo(goal.goalCadCents / PAGE.model.revenue.targetCents, 10);
  });

  it("each class's charges are its CAD charges, its share of the USD converted once, and its entries' freight", () => {
    const byClass = PAGE.revenueByClass!;
    for (const row of byClass.rows) {
      const c = row.charges;
      expect(c.totalCadCents).toBe(c.cadCents + c.usdCadCents + c.byHandCadCents);
      expect(c.totalCadCents).toBeLessThanOrEqual(row.totalCadCents);
    }
    const sageCad = PAGE.shipments.filter((r) => r.source === "Sage" && r.currency === "CAD").reduce((n, r) => n + r.otherCents, 0);
    const sageUsd = PAGE.shipments.filter((r) => r.source === "Sage" && r.currency === "USD").reduce((n, r) => n + r.otherCents, 0);
    expect(byClass.total.charges.cadCents).toBe(sageCad);
    expect(byClass.total.charges.usdCents).toBe(sageUsd);
  });

  it("at scope=mfg the headline, its charges and the distribution left out add back to the all-in total", () => {
    const mfg = PAGE.revenueScope!;
    expect(mfg.goalCadCents + mfg.chargesCadCents + mfg.excludedCadCents).toBe(PAGE.model.revenue.totalCents);
    expect(mfg.goalCadCents).toBeLessThanOrEqual(PAGE.revenueGoal!.goalCadCents);
  });

  it("pace and status read the goal figure, not the all-in total", () => {
    const byClass = PAGE.revenueByClass!;
    const target = PAGE.model.revenue.targetCents;
    const goal = PAGE.revenueGoal!;
    const justAbove = revenueScope(byClass, "all", target, { dueSoFarCents: goal.goalCadCents + 1, remaining: 1 });
    expect(justAbove.status).toBe("behind");
    expect(justAbove.neededPerDayCents).toBe(Math.max(0, target - goal.goalCadCents));
  });

  it("reconcile: item lines less discounts plus charge lines = each Sage invoice's net before tax", () => {
    const gaps: string[] = [];
    let checked = 0;
    for (const row of PAGE.shipments) {
      if (row.source !== "Sage") continue;
      const own = SHIPMENT_LINES.filter((l) => l.invoice === row.invoice);
      if (own.length === 0) continue;
      const items = own.filter((l) => l.kind === "item");
      const charges = own.filter((l) => l.kind === "charge");
      const cents = sumToCents([...items.map((l) => l.amount), ...charges.map((l) => l.amount)], items.map((l) => l.discount));
      checked += 1;
      const chargeCents = sumToCents(charges.map((l) => l.amount));
      if (cents !== row.netCents || chargeCents !== row.otherCents) gaps.push(row.invoice);
    }
    expect(checked).toBeGreaterThan(0);
    // The known gaps are the fixture's off invoices with lines, named in its README
    // and flagged by the lines export: IN1000180368 and IN1000180370 (freight a
    // dollar short, 18.35 against 19.35). IN1000180353 has no lines, so it's skipped. The goal reads the header's
    // other charges, so these gaps don't move the headline.
    expect(gaps.sort()).toEqual(["IN1000180368", "IN1000180370"]);
  });
});
