// Goals & Production money: exact cents and half-to-even conversion.

import { describe, expect, it } from "vitest";

import {
  centsToDecimal,
  convertCents,
  formatDollars,
  invertCents,
  prorateCents,
  toCents,
} from "@/lib/reporting/goals/money";

describe("toCents", () => {
  it("parses Sage and Postgres decimal strings exactly", () => {
    expect(toCents("121837.710")).toBe(12_183_771);
    expect(toCents("172428.76")).toBe(17_242_876);
    expect(toCents("  24500 ")).toBe(2_450_000);
    expect(toCents("-12.5")).toBe(-1250);
    expect(toCents(".5")).toBe(50);
    expect(toCents(null)).toBe(0);
    expect(toCents("")).toBe(0);
  });

  it("rounds a third decimal half to even", () => {
    expect(toCents("0.005")).toBe(0);
    expect(toCents("0.015")).toBe(2);
    expect(toCents("10.1251")).toBe(1013);
  });

  it("rejects anything that is not a decimal", () => {
    expect(() => toCents("abc")).toThrow(RangeError);
    expect(() => toCents("1,000.00")).toThrow(RangeError);
    expect(() => toCents("-")).toThrow(RangeError);
  });
});

describe("conversion", () => {
  it("rounds each converted amount half to even (the published M3 figure)", () => {
    // 25,750 × 1.4219 = 36,613.925 exactly → 36,613.92 (half-up would give .93).
    expect(convertCents(2_575_000, "1.4219")).toBe(3_661_392);
    expect(convertCents(2_575_000, "1.421900")).toBe(3_661_392);
  });

  it("converts this month's Sage USD to the published CAD figure", () => {
    expect(convertCents(17_242_876, "1.4219")).toBe(24_517_645);
    expect(12_183_771 + convertCents(17_242_876, "1.4219")).toBe(36_701_416);
  });

  it("converts CAD to USD by dividing by USD/CAD", () => {
    expect(invertCents(10_000, "1.25")).toBe(8000);
    expect(invertCents(2_500_000, "1.4219")).toBe(1_758_211);
  });

  it("prorates a target to the cent", () => {
    expect(prorateCents(100_000_000, 9, 21)).toBe(42_857_143);
    expect(prorateCents(100_000_000, 0, 21)).toBe(0);
    expect(prorateCents(100_000_000, 9, 0)).toBe(0);
  });

  it("formats for display only", () => {
    expect(centsToDecimal(36_701_416)).toBe("367014.16");
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(formatDollars(36_701_416)).toBe("$367,014");
    expect(formatDollars(42_857_143)).toBe("$428,571");
  });
});
