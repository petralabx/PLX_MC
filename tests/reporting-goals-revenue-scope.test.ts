import { describe, expect, it } from "vitest";
import type { RevenueByClass } from "../src/lib/reporting/goals/revenue-by-class";
import { revenueScope } from "../src/lib/reporting/goals/revenue-scope";

function byClass(cents: Record<string, number>): RevenueByClass {
  const rows = Object.entries(cents).map(([customerClass, totalCadCents]) => ({
    customerClass,
    totalCadCents,
    byHand: { entries: 0, cadCents: 0 },
    charges: { cadCents: 0, usdCents: 0, usdCadCents: 0, byHandCadCents: 0, totalCadCents: 0 },
  })) as unknown as RevenueByClass["rows"];
  return { rows, matchesCard: true } as unknown as RevenueByClass;
}

const sample = byClass({
  "Exclusive Manufacturing": 600_000_00,
  "Exclusive Distribution": 250_000_00,
  Mixed: 100_000_00,
  Unclassified: 50_000_00,
});

describe("revenueScope", () => {
  it("all keeps every class", () => {
    const v = revenueScope(sample, "all", 1_000_000_00);
    expect(v.totalCadCents).toBe(1_000_000_00);
    expect(v.excludedCadCents).toBe(0);
    expect(v.progress).toBe(1);
  });
  it("mfg leaves Exclusive Distribution out and still adds up", () => {
    const v = revenueScope(sample, "mfg", 1_000_000_00);
    expect(v.totalCadCents).toBe(750_000_00);
    expect(v.excludedCadCents).toBe(250_000_00);
    expect(v.totalCadCents + v.excludedCadCents).toBe(1_000_000_00);
    expect(v.progress).toBeCloseTo(0.75);
  });
  it("mfg pace reads the scoped total against the unchanged target", () => {
    const behind = revenueScope(sample, "mfg", 1_000_000_00, { dueSoFarCents: 800_000_00, remaining: 5 });
    expect(behind.status).toBe("behind");
    expect(behind.neededPerDayCents).toBe(50_000_00);
    const ahead = revenueScope(sample, "mfg", 1_000_000_00, { dueSoFarCents: 700_000_00, remaining: 0 });
    expect(ahead.status).toBe("on_track");
    expect(ahead.neededPerDayCents).toBe(0);
  });
  it("without pace input, status and pace are null", () => {
    const v = revenueScope(sample, "mfg", 1_000_000_00);
    expect(v.status).toBeNull();
    expect(v.neededPerDayCents).toBeNull();
  });
  it("charges in scope stay in the total but out of the goal, progress and pace (TASK-3952)", () => {
    const withCharges = byClass({ "Exclusive Manufacturing": 600_000_00, "Exclusive Distribution": 250_000_00 });
    withCharges.rows[0].charges.totalCadCents = 20_000_00;
    withCharges.rows[1].charges.totalCadCents = 5_000_00;
    const all = revenueScope(withCharges, "all", 1_000_000_00, { dueSoFarCents: 830_000_00, remaining: 2 });
    expect(all.totalCadCents).toBe(850_000_00);
    expect(all.chargesCadCents).toBe(25_000_00);
    expect(all.goalCadCents).toBe(825_000_00);
    expect(all.status).toBe("behind");
    expect(all.neededPerDayCents).toBe(87_500_00);
    const mfg = revenueScope(withCharges, "mfg", 1_000_000_00);
    expect(mfg.goalCadCents).toBe(580_000_00);
    expect(mfg.goalCadCents + mfg.chargesCadCents + mfg.excludedCadCents).toBe(850_000_00);
  });
  it("no target, no progress", () => {
    expect(revenueScope(sample, "mfg", 0).progress).toBeNull();
  });
});
