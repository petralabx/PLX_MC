// The live salesperson lookup (TASK-4277): the replica is asked only for the
// customers the run names, after checking the login can read the columns. A
// missing grant waits and names the columns; a failure leaves the filter
// unavailable and is tried again next time; a read is kept for five minutes.

import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  configured: true,
  missing: [] as string[],
  rows: [] as { customer: string; slot: number; salesperson: string; name: string | null }[],
  fail: false,
  reads: [] as { kind: "catalog" | "salespeople"; params?: unknown[] }[],
}));

vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  reportingDatabaseConfigured: () => h.configured,
  reportingMcpConfigured: () => false,
}));
vi.mock("@/lib/reporting/goals/source-db", () => ({
  withReportingSnapshot: vi.fn(async (fn: (q: (sql: string, params?: unknown[]) => Promise<unknown[]>) => Promise<unknown>) => {
    if (h.fail) throw new Error("the reporting database could not be reached");
    return fn(async (sql, params) => {
      if (sql.includes("has_column_privilege")) {
        h.reads.push({ kind: "catalog" });
        return h.missing.map((missing) => ({ missing }));
      }
      h.reads.push({ kind: "salespeople", params });
      return h.rows;
    });
  }),
}));

import { lookupSalespeople } from "@/lib/reporting/goals/salespeople";

afterEach(() => {
  h.configured = true;
  h.missing = [];
  h.rows = [];
  h.fail = false;
  h.reads = [];
});

describe("lookupSalespeople", () => {
  it("asks for nothing without customers, and is unavailable without a reporting database", async () => {
    expect(await lookupSalespeople([" ", ""])).toEqual({ state: "ready", customers: {}, names: {} });
    h.configured = false;
    expect(await lookupSalespeople(["AERO02"])).toEqual({ state: "unavailable" });
    expect(h.reads).toEqual([]);
  });

  it("reads the customers asked for, trimmed and upper-cased, once in five minutes", async () => {
    h.rows = [
      { customer: "AERO02", slot: 1, salesperson: "GGC", name: "Glenn" },
      { customer: "1SHOP11", slot: 2, salesperson: "VA", name: "Vince Alton" },
      { customer: "1SHOP11", slot: 1, salesperson: "VENE", name: "Venessa" },
    ];
    const lookup = await lookupSalespeople(["aero02 ", "1SHOP11", "AERO02"]);
    expect(lookup).toEqual({
      state: "ready",
      customers: { AERO02: ["GGC"], "1SHOP11": ["VENE", "VA"] },
      names: { GGC: "Glenn", VENE: "Venessa", VA: "Vince Alton" },
    });
    expect(h.reads).toEqual([{ kind: "catalog" }, { kind: "salespeople", params: [["1SHOP11", "AERO02"]] }]);
    h.reads = [];
    expect(await lookupSalespeople(["1SHOP11", "AERO02"])).toEqual(lookup);
    expect(h.reads).toEqual([]);
  });

  it("waits for read access and names the columns the login lacks", async () => {
    h.missing = ["sage.ar_customer.codeslsp1", "sage.ar_salesperson.nameempl"];
    expect(await lookupSalespeople(["THECAR10"])).toEqual({
      state: "waiting_for_access",
      missing: ["sage.ar_customer.codeslsp1", "sage.ar_salesperson.nameempl"],
    });
    expect(h.reads).toEqual([{ kind: "catalog" }]);
  });

  it("is unavailable when the replica can't be read, and tries again next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.fail = true;
    expect(await lookupSalespeople(["DIVE11"])).toEqual({ state: "unavailable" });
    expect(warn).toHaveBeenCalledWith("[reporting-goals] salesperson lookup failed: %s", "the reporting database could not be reached");
    h.fail = false;
    h.rows = [{ customer: "DIVE11", slot: 1, salesperson: "HS", name: "House Account" }];
    expect(await lookupSalespeople(["DIVE11"])).toMatchObject({ state: "ready", customers: { DIVE11: ["HS"] } });
    warn.mockRestore();
  });
});
