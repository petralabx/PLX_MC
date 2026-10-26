import { describe, expect, it } from "vitest";

import { addWorkingDays, customerRevenue, searchCustomers, weekOf } from "../src/lib/reporting/goals/customer-revenue";
import type { ForecastRow } from "../src/lib/reporting/goals/forecast";
import type { ShipmentListRow } from "../src/lib/reporting/goals/shipment-list";
import type { BatchRow, ForecastAoRow } from "../src/lib/reporting/goals/types";
import { goalsPage } from "./reporting-goals-helpers";

const row = (over: Partial<ForecastRow>): ForecastRow =>
  ({ customerCode: "ACME", customer: "Acme", customerClass: "Unclassified", cadCents: 1000, ao: null, ...over }) as ForecastRow;
const ao = (id: string, status: string, scheduled: string | null) => ({ id, number: id, status, scheduled });
const sage = (key: string, code: string, currency: string, netCents: number, shipDate: string): ShipmentListRow =>
  ({ key, source: "Sage", customerCode: code, customer: code, currency, netCents, cadCents: null, shipDate }) as unknown as ShipmentListRow;
const batch = (b: string, date: string, kg: string): BatchRow =>
  ({ id: b, batch: b, product: null, status: "Allocated", statusQc: null, line: null, date, kg });

const base = { today: "2026-10-14", holidays: new Set<string>(), aos: [] as ForecastAoRow[], batches: [] as BatchRow[], shipments: [], rate: "1.3700", cardTotalCents: 0 };

describe("calendar helpers", () => {
  it("weeks start Monday", () => {
    expect(weekOf("2026-10-14")).toBe("2026-10-12");
    expect(weekOf("2026-10-12")).toBe("2026-10-12");
    expect(weekOf("2026-10-18")).toBe("2026-10-12");
  });
  it("adds working days over weekends and holidays", () => {
    expect(addWorkingDays("2026-10-14", 5, new Set())).toBe("2026-10-21");
    expect(addWorkingDays("2026-10-08", 5, new Set(["2026-10-12"]))).toBe("2026-10-16");
  });
});

describe("customerRevenue", () => {
  it("ranks AO-backed portions by customer and week; skips lines with no AO and cancelled AOs", () => {
    const v = customerRevenue({
      ...base,
      forecastRows: [
        row({ cadCents: 500, ao: ao("A1", "Open", "2026-10-15") }),
        row({ cadCents: 700, ao: ao("A2", "Realized", "2026-10-20") }),
        row({ customerCode: "BETA", customer: "Beta", cadCents: 2000, ao: ao("A3", "Open", null) }),
        row({ cadCents: 9999, ao: null }),
        row({ cadCents: 9999, ao: ao("A4", "Cancelled", "2026-10-15") }),
        row({ cadCents: null, ao: ao("A5", "Open", "2026-10-15") }),
      ],
    });
    expect(v.potential.customers.map((c) => [c.key, c.totalCadCents])).toEqual([["BETA", 2000], ["ACME", 1200]]);
    expect(v.potential.weeks).toEqual(["2026-10-12", "2026-10-19"]);
    expect(v.potential.customers[0].undatedCadCents).toBe(2000);
    expect(v.potential.totalCadCents).toBe(3200);
    expect(v.packedRows).toBe(1);
    expect(v.unpriced.otherCurrencyRows).toBe(1);
  });

  it("counts batches with no AO as unpriced kg, 5 working days on", () => {
    const v = customerRevenue({
      ...base,
      forecastRows: [],
      aos: [{ id: "A1", status: "Open", batch: "B-1" } as ForecastAoRow],
      batches: [batch("B-1", "2026-10-14", "500"), batch("B-2", "2026-10-14", "250.5"), batch("B-3", "2026-10-23", "100")],
    });
    expect(v.unpriced.batches.count).toBe(2);
    expect(v.unpriced.batches.kg).toBe(350.5);
    expect(v.unpriced.batches.byWeek).toEqual({ "2026-10-19": 250.5, "2026-10-26": 100 });
  });

  it("realized adds up to the card: USD converted once for the month and shared", () => {
    // 3 × US$0.01 at 1.37: alone each rounds to 0.01 CAD (0.03); once for the month it is 0.04.
    const v = customerRevenue({
      ...base,
      forecastRows: [],
      shipments: [
        sage("s1", "A", "USD", 1, "2026-10-01"),
        sage("s2", "B", "USD", 1, "2026-10-02"),
        sage("s3", "C", "USD", 1, "2026-10-08"),
        sage("s4", "A", "CAD", 10000, "2026-10-08"),
        sage("s5", "D", "EUR", 5000, "2026-10-08"),
      ],
      cardTotalCents: 10004,
    });
    expect(v.realized.totalCadCents).toBe(10004);
    expect(v.realized.customers[0].key).toBe("A");
    expect(v.realized.customers.find((c) => c.key === "D")).toBeUndefined();
  });

  it("searches by name or code, case-insensitive", () => {
    const v = customerRevenue({
      ...base,
      forecastRows: [row({ ao: ao("A1", "Open", "2026-10-15") }), row({ customerCode: "BETA", customer: "Beta Soap", ao: ao("A2", "Open", "2026-10-15") })],
    });
    expect(searchCustomers(v.potential, "soap").map((c) => c.key)).toEqual(["BETA"]);
    expect(searchCustomers(v.potential, " acme ").map((c) => c.key)).toEqual(["ACME"]);
    expect(searchCustomers(v.potential, "")).toHaveLength(2);
  });

  it("on the fixture page, realized matches the Revenue card to the cent", () => {
    const page = goalsPage();
    expect(page.customerRevenue).not.toBeNull();
    expect(page.customerRevenue!.realized.totalCadCents).toBe(page.model!.revenue.totalCents);
  });
});