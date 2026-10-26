import { describe, expect, it } from "vitest";
import type { RevenueByClass } from "../src/lib/reporting/goals/revenue-by-class";
import { revenueScope } from "../src/lib/reporting/goals/revenue-scope";

function byClass(cents: Record<string, number>): RevenueByClass {
  const rows = Object.entries(cents).map(([customerClass, totalCadCents]) => ({ customerClass, totalCadCents })) as unknown as RevenueByClass["rows"];
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
  it("no target, no progress", () => {
    expect(revenueScope(sample, "mfg", 0).progress).toBeNull();
  });
});
