// The salesperson (account manager) filter (TASK-4277). A customer belongs to
// every salesperson on its Sage customer record; picking salespeople narrows
// every figure that has a customer (invoices, returns, the shipped-not-invoiced
// estimate, truckloads, open orders, shipments entered by hand) and leaves
// production whole. Picking every salesperson and `none` gives back the whole
// page to the cent; customers shared by two salespeople count once.

import { readFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DailyRevenueChart } from "@/components/mc/goals/charts";
import { ForecastSection } from "@/components/mc/goals/forecast";
import { GoalCards } from "@/components/mc/goals/goal-cards";
import { isReady } from "@/components/mc/goals/helpers";
import { SalespeopleNote, SalespeoplePicker } from "@/components/mc/goals/salespeople";
import { routeToUrl, urlToRoute } from "@/components/mc/route";
import { monthEnd, monthStart } from "@/lib/reporting/goals/calendar";
import { buildGoalsWorkbook } from "@/lib/reporting/goals/excel/export";
import { planImport, readEntriesSheet } from "@/lib/reporting/goals/excel/import";
import { workbookFileName } from "@/lib/reporting/goals/excel/layout";
import { formatDollars } from "@/lib/reporting/goals/money";
import { CUSTOMER_SALESPEOPLE_SQL, SALESPERSON_COLUMNS } from "@/lib/reporting/goals/queries/salespeople";
import {
  NO_SALESPERSON,
  canonicalSales,
  entryCustomerCode,
  filterRunBySalespeople,
  runCustomerCodes,
  salesParam,
  salespeopleLabel,
  salespeopleScope,
  salespersonLookupFromRows,
  type SalespersonLookup,
} from "@/lib/reporting/goals/salesperson-filter";
import type { CreditNotesDataset, Datasets, PendingShipmentsDataset } from "@/lib/reporting/goals/types";
import { buildGoalsViewAndRun, type GoalsView, type GoalsViewInput } from "@/lib/reporting/goals/view";

import creditNotesJson from "./fixtures/reporting-goals/2026-10-14/credit-notes.json";
import pendingJson from "./fixtures/reporting-goals/2026-10-14/pending-shipments.json";
import {
  DATASETS,
  ENTRIES,
  FORECAST,
  FTL_CUSTOMERS,
  RATE,
  SETTINGS,
  SHIPMENT_LINES,
  SHIPMENT_LINES_SUMMARY,
  TODAY,
  fixtureSalespeople,
  goalsPage,
  goalsViewInput,
  manualEntry,
  salesGoalsPage,
} from "./reporting-goals-helpers";

const CREDIT_NOTES = creditNotesJson as unknown as CreditNotesDataset;
const PENDING = pendingJson as unknown as PendingShipmentsDataset;
// The whole fixture: invoices, returns, the estimate, open orders and M1–M7.
const SNAPSHOT: Datasets = { ...DATASETS, creditNotes: CREDIT_NOTES, pendingShipments: PENDING };
const INPUT = goalsViewInput(ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
const ROSTER = fixtureSalespeople(INPUT);
const page = (selected: string[], lookup: SalespersonLookup = ROSTER) => salesGoalsPage(selected, INPUT, lookup);
const WHOLE = goalsPage({}, ENTRIES, FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
const ALL_PICKED = ["AA", "BB", "CC", NO_SALESPERSON];

/** The workbook GET …/export?sales= would send for `selected` (the route's inputs, from buildGoalsViewAndRun). */
async function narrowedWorkbook(selected: string[], input: GoalsViewInput = INPUT): Promise<{ view: GoalsView; wb: ExcelJS.Workbook; buffer: Buffer }> {
  const { view, run, entries } = buildGoalsViewAndRun({ ...input, salespeople: { lookup: fixtureSalespeople(input), selected } });
  const buffer = await buildGoalsWorkbook({
    run: view.run!,
    model: view.model!,
    settings: SETTINGS,
    shipments: run.snapshot!.shipments,
    truckloads: run.snapshot!.truckloads,
    rates: [{ date: TODAY, rate: RATE }],
    exportedAt: new Date("2026-10-14T16:00:00Z"),
    forecast: view.forecast,
    shipmentLines: { access: "read", missing: [], lines: SHIPMENT_LINES },
    revenueByClass: view.revenueByClass,
    creditNotes: run.snapshot!.creditNotes,
    pendingShipments: run.snapshot!.pendingShipments,
    customerRevenue: view.customerRevenue,
    salespeople: view.salespeople!.label,
    allEntries: entries,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  return { view, wb, buffer };
}

/** A counted hand shipment that names no Sage customer and whose reference is a Sage shipment not yet invoiced. */
const typedFor = (shipment: string) =>
  manualEntry({
    entryId: "M91",
    type: "Shipment",
    date: TODAY,
    reference: shipment,
    customer: "Typed by hand, no Sage customer",
    customerCode: null,
    productValue: "10.00",
    freight: "0.00",
    currency: "CAD",
  } as never);

/** Who a customer code belongs to on the fixture roster. */
const ownersOf = (code: string | null | undefined) => ROSTER.state === "ready" ? (ROSTER.customers[(code ?? "").trim().toUpperCase()] ?? []) : [];

/** The figures with a customer, minus what can't follow a filter (last month's revenue) or names it (takeaway, salespeople). */
function figures(view: GoalsView) {
  const model = view.model!;
  return {
    revenue: { ...model.revenue, lastMonthCadCents: undefined },
    truckloads: model.truckloads,
    line1: model.line1,
    coveredThrough: model.coveredThrough,
    daily: model.daily.map((d) => ({ ...d, lastMonthToDateCents: undefined })),
    batches: model.batches,
    sizes: model.sizes,
    entries: model.entries,
    shipments: view.shipments,
    revenueByClass: view.revenueByClass,
    revenueGoal: view.revenueGoal,
    revenueScope: view.revenueScope,
    revenueByBusinessLine: view.revenueByBusinessLine,
    creditNotes: view.creditNotes,
    pendingShipments: view.pendingShipments,
    forecast: view.forecast,
    customerRevenue: view.customerRevenue,
  };
}

describe("the sales request parameter", () => {
  it("reads codes and none, upper-cases codes, drops blanks and repeats, and sorts with none last", () => {
    expect(salesParam(null)).toEqual([]);
    expect(salesParam("")).toEqual([]);
    expect(salesParam(" , ")).toEqual([]);
    expect(salesParam("sm, ggc ,none,GGC,,")).toEqual(["GGC", "SM", NO_SALESPERSON]);
    // A Sage code is upper case, so NONE is a code, never the no-salesperson choice.
    expect(salesParam("NONE")).toEqual(["NONE"]);
    expect(canonicalSales([NO_SALESPERSON, "VA", "GC5"])).toEqual(["GC5", "VA", NO_SALESPERSON]);
  });

  it("refuses what Sage can't hold, and more than 60 codes", () => {
    for (const bad of ["G C", "<b>", "GGC;DROP", "ABCDEFGHIJKLM", "-GGC", "GGC,%27"]) expect(salesParam(bad), bad).toBeNull();
    expect(salesParam(Array.from({ length: 60 }, (_, i) => `S${i}`).join(","))).toHaveLength(60);
    expect(salesParam(Array.from({ length: 61 }, (_, i) => `S${i}`).join(","))).toBeNull();
  });

  it("travels in the page's URL, and the page ignores a malformed one", () => {
    const route = urlToRoute("/?screen=goals&fx=sage&sales=GGC%2CSM%2Cnone");
    expect(route).toEqual({ screen: "goals", fx: "sage", sales: "GGC,SM,none" });
    expect(urlToRoute(routeToUrl(route))).toEqual(route);
    expect(urlToRoute("/?screen=goals&sales=%3Cscript%3E")).toEqual({ screen: "goals" });
  });
});

describe("the lookup", () => {
  it("reads only the five salesperson slots, the customer code and the salesperson's name", () => {
    expect(SALESPERSON_COLUMNS).toEqual([
      ["sage", "ar_customer", ["idcust", "codeslsp1", "codeslsp2", "codeslsp3", "codeslsp4", "codeslsp5"]],
      ["sage", "ar_salesperson", ["codeslsp", "nameempl"]],
    ]);
    for (const column of ["codeslsp1", "codeslsp5", "nameempl", "= ANY($1::text[])"]) expect(CUSTOMER_SALESPEOPLE_SQL).toContain(column);
    expect(CUSTOMER_SALESPEOPLE_SQL).not.toMatch(/pctsasplt|\$2/);
  });

  it("is granted by the one-off script exactly, and by the fresh-install script too", () => {
    /** "GRANT SELECT (a, b) ON schema.table TO …" → { "schema.table": [a, b] }. */
    const grantsIn = (file: string) => {
      const sql = readFileSync(path.join(__dirname, "..", "docs", "modules", "reporting-goals", file), "utf8").replace(/--.*$/gm, "");
      const out: Record<string, string[]> = {};
      for (const m of sql.matchAll(/GRANT\s+SELECT\s*\(([^)]*)\)\s*ON\s+([\w.]+)\s+TO\s+(?:mc_goals_ro|:"role")/gi)) {
        out[m[2]] = [...(out[m[2]] ?? []), ...m[1].split(",").map((c) => c.trim())].sort();
      }
      return out;
    };
    const wanted = Object.fromEntries(SALESPERSON_COLUMNS.map(([schema, table, columns]) => [`${schema}.${table}`, [...columns].sort()]));
    expect(grantsIn("readonly-grants-salespeople.sql")).toEqual(wanted);
    const fresh = grantsIn("readonly-grants.sql");
    for (const [relation, columns] of Object.entries(wanted)) expect(fresh[relation], relation).toEqual(expect.arrayContaining(columns));
    // Never the split percents or the salespeople's commission and sales figures.
    for (const file of ["readonly-grants-salespeople.sql", "readonly-grants.sql"]) {
      const grants = grantsIn(file);
      expect(grants["sage.ar_customer"].some((c) => c.startsWith("pctsasplt")), file).toBe(false);
      expect(grants["sage.ar_salesperson"], file).toEqual(["codeslsp", "nameempl"]);
    }
  });

  it("keeps each customer's salespeople in slot order, once, with their names", () => {
    const lookup = salespersonLookupFromRows([
      { customer: " 1shop11 ", slot: 2, salesperson: "VA ", name: "Vince Alton" },
      { customer: "1SHOP11", slot: 1, salesperson: "vene", name: " Venessa " },
      { customer: "1SHOP11", slot: 3, salesperson: "VENE", name: "Venessa" },
      { customer: "AERO02", slot: 1, salesperson: "GGC", name: null },
    ]);
    expect(lookup).toEqual({
      state: "ready",
      customers: { "1SHOP11": ["VENE", "VA"], AERO02: ["GGC"] },
      names: { VENE: "Venessa", VA: "Vince Alton", GGC: null },
    });
  });

  it("names a pick in words", () => {
    const names = { GGC: "Glenn", SM: "Sam", VA: "Vince Alton", HS: null };
    expect(salespeopleLabel([], names)).toBe("");
    expect(salespeopleLabel(["GGC"], names)).toBe("Glenn (GGC)");
    expect(salespeopleLabel(["GGC", "HS", NO_SALESPERSON], names)).toBe("Glenn (GGC), HS and no salesperson");
    expect(salespeopleLabel(["GGC", "SM", "VA", NO_SALESPERSON], names)).toBe("3 salespeople and no salesperson");
    expect(salespeopleLabel(["GGC", "SM", "VA", "HS"], names)).toBe("4 salespeople");
  });

  it("finds a hand entry's customer: the Sage customer picked, else the truckload customer its name matches, else none", () => {
    const entry = (customer: string | null, customerCode: string | null) => manualEntry({ entryId: "M9", type: "Shipment", customer, customerCode } as never);
    expect(entryCustomerCode(entry("Anyone", " thecar10 "), FTL_CUSTOMERS)).toBe("THECAR10");
    const truckload = FTL_CUSTOMERS[0];
    expect(entryCustomerCode(entry(`${truckload.namePatterns[0]} shipment`, null), FTL_CUSTOMERS)).toBe(truckload.code.toUpperCase());
    expect(entryCustomerCode(entry("Someone new", null), FTL_CUSTOMERS)).toBeNull();
  });

  it("looks up every customer the run names: invoices, truckloads, returns, the estimate, open orders, entries and truckload customers", () => {
    const codes = runCustomerCodes(INPUT);
    expect(codes).toEqual([...codes].sort());
    for (const code of [
      ...SNAPSHOT.shipments.map((s) => s.customerCode),
      ...SNAPSHOT.truckloads.map((t) => t.code),
      ...CREDIT_NOTES.notes.map((n) => n.customerCode),
      ...PENDING.shipments.map((s) => s.customerCode),
      ...FORECAST.data.lines.map((l) => l.customerCode),
      ...FTL_CUSTOMERS.map((c) => c.code),
    ]) {
      if (code) expect(codes, code).toContain(code.trim().toUpperCase());
    }
  });
});

describe("a page narrowed to some salespeople", () => {
  it("is the whole page, unfiltered, with nothing picked, and offers the run's salespeople by name", () => {
    const p = page([]);
    expect(figures(p)).toEqual(figures(WHOLE));
    expect(p.model!.takeaway).toBe(WHOLE.model!.takeaway);
    expect(p.model!.revenue.lastMonthCadCents).toBe(WHOLE.model!.revenue.lastMonthCadCents);
    const s = p.salespeople!;
    expect(s).toMatchObject({ state: "ready", selected: [], label: "", applied: false, everyCustomer: null });
    expect(s.options.map((o) => [o.code, o.name])).toEqual([
      ["AA", "Alpha Rep"],
      ["BB", "Bravo Rep"],
      ["CC", "Charlie Rep"],
    ]);
    const codes = runCustomerCodes(INPUT);
    const count = (code: string) => codes.filter((c) => ownersOf(c).includes(code)).length;
    expect(s.options.map((o) => o.customers)).toEqual([count("AA"), count("BB"), count("CC")]);
    expect(s.unassigned).toBe(codes.filter((c) => ownersOf(c).length === 0).length);
    expect(s.shared).toBe(count("CC"));
    expect(s.unassigned).toBeGreaterThan(0);
  });

  it("gives back the whole page to the cent with every salesperson and none picked; shared customers count once", () => {
    const p = page(ALL_PICKED);
    expect(p.salespeople).toMatchObject({ applied: true, selected: ALL_PICKED, label: "3 salespeople and no salesperson" });
    expect(figures(p)).toEqual(figures(WHOLE));
    expect(p.revenueByClass!.matchesCard).toBe(true);
    // Last month's revenue isn't split by customer: left out, not shown as every customer's.
    expect(p.model!.revenue.lastMonthCadCents).toBeNull();
    expect(p.model!.daily.every((d) => d.lastMonthToDateCents === null)).toBe(true);
    expect(WHOLE.model!.revenue.lastMonthCadCents).not.toBeNull();
  });

  it("keeps only the picked salesperson's customers in every figure with a customer", () => {
    const p = page(["BB"]);
    const mine = (code: string | null | undefined) => ownersOf(code).includes("BB");
    expect(p.shipments.filter((r) => r.source === "Sage").every((r) => mine(r.customerCode))).toBe(true);
    expect(p.shipments.filter((r) => r.source === "Sage")).toHaveLength(SNAPSHOT.shipments.filter((s) => mine(s.customerCode)).length);
    expect(p.model!.truckloads.customers.every((c) => mine(c.code))).toBe(true);
    const forecast = p.forecast!;
    if (forecast.state !== "ready") throw new Error("the fixture's forecast is ready");
    expect(forecast.rows.length).toBeGreaterThan(0);
    expect(forecast.rows.every((r) => mine(r.customerCode))).toBe(true);
    expect(p.customerRevenue!.realized.customers.every((c) => mine(c.customerCode))).toBe(true);
    expect(p.creditNotes!.notes).toBe(CREDIT_NOTES.notes.filter((n) => mine(n.customerCode)).length);
    expect(p.revenueGoal!.pendingShipments).toBe(PENDING.shipments.filter((s) => mine(s.customerCode)).length);
    // The card's month by currency and by day is rebuilt from the kept invoices.
    const kept = SNAPSHOT.shipments.filter((s) => mine(s.customerCode));
    expect(p.model!.revenue.cad.invoices).toBe(kept.filter((s) => s.currency === "CAD").length);
    expect(p.model!.daily.at(-1)!.sageToDateCents).toBe(p.model!.revenue.inSystemCents);
    expect(p.revenueByClass!.matchesCard).toBe(true);
  });

  it("adds up across salespeople with no customer in common: their invoices, returns and open orders make the whole", () => {
    const parts = [["AA"], ["BB"], [NO_SALESPERSON]].map((sel) => page(sel));
    const sum = (pick: (v: GoalsView) => number) => parts.reduce((n, v) => n + pick(v), 0);
    const whole = WHOLE.model!.revenue;
    expect(sum((v) => v.model!.revenue.cad.cents)).toBe(whole.cad.cents);
    expect(sum((v) => v.model!.revenue.usd.cents)).toBe(whole.usd.cents);
    expect(sum((v) => v.model!.revenue.byHandCents)).toBe(whole.byHandCents);
    expect(sum((v) => v.shipments.length)).toBe(WHOLE.shipments.length);
    expect(sum((v) => v.creditNotes!.notes)).toBe(WHOLE.creditNotes!.notes);
    expect(sum((v) => (v.forecast!.state === "ready" ? v.forecast!.rows.length : 0))).toBe(
      WHOLE.forecast!.state === "ready" ? WHOLE.forecast!.rows.length : -1
    );
    // Each page converts its own US dollars once, so the headlines can be a few cents apart from the whole's.
    expect(Math.abs(sum((v) => v.revenueGoal!.goalCadCents) - WHOLE.revenueGoal!.goalCadCents)).toBeLessThanOrEqual(parts.length);
  });

  it("counts a customer with two salespeople under each, and once under both", () => {
    const shared = SNAPSHOT.shipments.filter((s) => ownersOf(s.customerCode).length > 1);
    expect(shared.length).toBeGreaterThan(0);
    const invoices = (v: GoalsView) => new Set(v.shipments.filter((r) => r.source === "Sage").map((r) => r.invoice));
    const aa = invoices(page(["AA"]));
    const cc = invoices(page(["CC"]));
    const both = page(["AA", "CC"]);
    for (const s of shared) {
      expect(aa.has(s.invoice)).toBe(true);
      expect(cc.has(s.invoice)).toBe(true);
    }
    // CC's customers are all AA's too, so picking both is AA's page.
    expect(figures(both)).toEqual(figures(page(["AA"])));
  });

  it("keeps production whole and the revenue's covered-through date and due so far the whole page's", () => {
    // A counted hand shipment for a customer no salesperson on the pick holds still says how far the data reaches.
    const late = manualEntry({
      entryId: "M90",
      type: "Shipment",
      date: TODAY,
      reference: "PO-LATE-1",
      customer: "Someone new",
      customerCode: null,
      productValue: "1000.00",
      freight: "0.00",
      currency: "CAD",
    } as never);
    const input = goalsViewInput([...ENTRIES, late], FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
    const whole = salesGoalsPage([], input);
    const bb = salesGoalsPage(["BB"], input);
    expect(whole.model!.coveredThrough.revenue).toBe(TODAY);
    expect(bb.model!.coveredThrough).toEqual(whole.model!.coveredThrough);
    expect(bb.model!.revenue.dueSoFarCents).toBe(whole.model!.revenue.dueSoFarCents);
    expect(bb.model!.line1).toEqual(whole.model!.line1);
    expect(bb.model!.batches).toEqual(whole.model!.batches);
    expect(bb.model!.sizes).toEqual(whole.model!.sizes);
    // The entry names no Sage customer: it's under none, not BB.
    expect(bb.model!.entries.some((e) => e.entryId === "M90")).toBe(false);
    expect(salesGoalsPage([NO_SALESPERSON], input).model!.entries.some((e) => e.entryId === "M90")).toBe(true);
    // Batch entries are production: every page keeps them.
    const batches = (v: GoalsView) => v.model!.entries.filter((e) => e.type === "Batch").map((e) => e.entryId);
    expect(batches(bb)).toEqual(batches(whole));
  });

  it("leaves a Sage shipment out of the estimate on every page when a hand entry stands for it, whoever the entry was typed for", () => {
    const pending = PENDING.shipments.find((s) => ownersOf(s.customerCode).includes("AA") || ownersOf(s.customerCode).includes("BB"))!;
    const owner = ownersOf(pending.customerCode)[0];
    const typed = manualEntry({
      entryId: "M91",
      type: "Shipment",
      date: TODAY,
      reference: pending.shipment,
      customer: "Typed by hand, no Sage customer",
      customerCode: null,
      productValue: "10.00",
      freight: "0.00",
      currency: "CAD",
    } as never);
    const input = goalsViewInput([...ENTRIES, typed], FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
    const whole = salesGoalsPage([], input);
    const theirs = salesGoalsPage([owner], input);
    expect(whole.revenueGoal!.pendingShipments).toBe(PENDING.shipments.length - 1);
    expect(theirs.revenueGoal!.pendingShipments).toBe(PENDING.shipments.filter((s) => s !== pending && ownersOf(s.customerCode).includes(owner)).length);
    expect(figures(salesGoalsPage(ALL_PICKED, input))).toEqual(figures(whole));
  });

  it("shows every customer, and says why, when the salespeople can't be read", () => {
    for (const lookup of [{ state: "unavailable" }, { state: "waiting_for_access", missing: ["sage.ar_customer.codeslsp1"] }] as SalespersonLookup[]) {
      const p = page(["BB"], lookup);
      expect(figures(p)).toEqual(figures(WHOLE));
      expect(p.salespeople).toMatchObject({ state: lookup.state, selected: ["BB"], applied: false, options: [{ code: "BB", customers: 0 }] });
      const note = renderToStaticMarkup(createElement(SalespeopleNote, { view: p.salespeople! }));
      expect(note).toContain("Not filtered");
      // The filter asked for failed to apply: the red notice (decision 9).
      expect(note).toContain('class="gp-notice hot"');
    }
  });

  it("offers a code asked for that no customer of the run has, so it can be unticked", () => {
    const p = page(["ZZ9"]);
    expect(p.salespeople!.options.find((o) => o.code === "ZZ9")).toEqual({ code: "ZZ9", name: null, customers: 0 });
    expect(p.shipments).toEqual([]);
  });

  it("filters the run's rows and nothing else: production and the hit-rate history stay as stored", () => {
    if (ROSTER.state !== "ready") throw new Error("ready");
    const run = filterRunBySalespeople(INPUT, salespeopleScope(ROSTER, ["BB"]));
    expect(run.snapshot!.batches).toBe(INPUT.snapshot!.batches);
    expect(run.snapshot!.batchHistory).toBe(INPUT.snapshot!.batchHistory);
    expect(run.forecast!.history).toBe(INPUT.forecast!.history);
    expect(run.forecast!.data.aos).toBe(INPUT.forecast!.data.aos);
    expect(run.snapshot!.revenue.every((r) => r.thisMonth)).toBe(true);
    expect(run.snapshot!.daily.every((d) => d.cadLast === "0.00" && d.usdLast === "0.00")).toBe(true);
    // The input is never changed.
    expect(INPUT.snapshot!.shipments).toHaveLength(SNAPSHOT.shipments.length);
  });

  it("returns the narrowed run the workbook's rows come from", () => {
    const { view, run } = buildGoalsViewAndRun({ ...INPUT, salespeople: { lookup: ROSTER, selected: ["BB"] } });
    expect(run.snapshot!.shipments.map((s) => s.invoice)).toEqual(view.shipments.filter((r) => r.source === "Sage").map((r) => r.invoice));
    // Nothing picked: the run as stored.
    const none = buildGoalsViewAndRun({ ...INPUT, salespeople: { lookup: ROSTER, selected: [] } });
    expect(none.run.snapshot).toBe(INPUT.snapshot);
  });
});

describe("the page", () => {
  it("sets the Revenue card against every customer's instead of the goal, and keeps Line 1 every customer's", () => {
    const p = page(["BB"]);
    if (!isReady(p)) throw new Error("ready");
    const html = renderToStaticMarkup(createElement(GoalCards, { page: p }));
    const every = p.salespeople!.everyCustomer!.revenueGoalCadCents!;
    expect(every).toBe(WHOLE.revenueGoal!.goalCadCents);
    expect(html).toContain("for every customer");
    expect(html).toContain("for the customers of Bravo Rep (BB)");
    expect(html).toContain('data-testid="goals-revenue-share"');
    expect(html).toContain('data-testid="goals-line1-every-customer"');
    expect(html).not.toContain("Needed per working day: <b>$");
    // Unfiltered, the card is as it was.
    const plain = renderToStaticMarkup(createElement(GoalCards, { page: WHOLE as never }));
    expect(plain).not.toContain("for every customer");
    expect(plain).toContain("Needed per working day");
  });

  it("ticks what the URL asks for and says what a narrowed page covers", () => {
    const p = page(["BB", NO_SALESPERSON]);
    const picker = renderToStaticMarkup(
      createElement(SalespeoplePicker, { view: p.salespeople!, picked: ["BB", NO_SALESPERSON], waiting: false, failed: false, onPick: () => {}, onRetry: () => {} })
    );
    expect(picker).toContain("Bravo Rep (BB), No salesperson");
    expect((picker.match(/checked=""/g) ?? []).length).toBe(2);
    expect(picker).toContain("Show every customer");
    const note = renderToStaticMarkup(createElement(SalespeopleNote, { view: p.salespeople! }));
    expect(note).toContain("Showing only the customers of Bravo Rep (BB) and no salesperson");
    expect(note).toContain("Line 1 bulk and the batches are every customer’s");
    expect(p.model!.takeaway).toMatch(/^[\d,]+ kg of Line 1 bulk against [\d,]+ kg due so far for every customer\. For Bravo Rep \(BB\) and no salesperson: /);
  });
});

describe("the workbook", () => {
  it("is named for the salespeople and says what it covers; last month's column is blank", async () => {
    expect(workbookFileName(TODAY, "boc", ["BB"])).toBe("PLX goals and production 2026-10-14 (BB).xlsx");
    expect(workbookFileName(TODAY, "sage", ["BB", NO_SALESPERSON])).toBe("PLX goals and production 2026-10-14 (Sage rate) (BB, no salesperson).xlsx");
    expect(workbookFileName(TODAY, "boc", ["A", "B", "C", "D"])).toBe("PLX goals and production 2026-10-14 (4 salespeople).xlsx");
    expect(workbookFileName(TODAY)).toBe("PLX goals and production 2026-10-14.xlsx");

    const { view, run } = buildGoalsViewAndRun({ ...INPUT, salespeople: { lookup: ROSTER, selected: ["BB"] } });
    const buffer = await buildGoalsWorkbook({
      run: view.run!,
      model: view.model!,
      settings: SETTINGS,
      shipments: run.snapshot!.shipments,
      truckloads: run.snapshot!.truckloads,
      rates: [{ date: TODAY, rate: RATE }],
      exportedAt: new Date("2026-10-14T16:00:00Z"),
      forecast: view.forecast,
      shipmentLines: { access: "read", missing: [], lines: SHIPMENT_LINES },
      revenueByClass: view.revenueByClass,
      creditNotes: run.snapshot!.creditNotes,
      pendingShipments: run.snapshot!.pendingShipments,
      customerRevenue: view.customerRevenue,
      salespeople: view.salespeople!.label,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    expect(String(wb.getWorksheet("Read me")!.getCell("A3").value)).toContain("Only the customers of Bravo Rep (BB)");
    expect(String(wb.getWorksheet("Goals")!.getCell("A2").value)).toContain("The targets are the whole month’s, so revenue has no status or pace.");
    const daily = wb.getWorksheet("Daily")!;
    expect(daily.getCell("K1").value).toBe("Last month to date, CAD");
    expect(daily.getCell("K2").value).toBeNull();
    expect(daily.getCell("F2").value).not.toBeNull();
  });

  it("lists every entry on Manual entries, so importing a narrowed workbook removes nothing", async () => {
    const { view, buffer } = await narrowedWorkbook(["BB"]);
    expect(view.model!.entries.length).toBeLessThan(ENTRIES.length);
    const rows = await readEntriesSheet(new Uint8Array(buffer));
    expect(rows).toHaveLength(ENTRIES.length);
    const ctx = { monthStart: monthStart(TODAY), monthEnd: monthEnd(TODAY), filemakerRefs: INPUT.filemakerRefs, sageRefs: INPUT.sageRefs };
    const plan = planImport(rows, ENTRIES, ctx);
    if (!plan.ok) throw new Error("the sheet should read back");
    expect(plan.plan.remove).toEqual([]);
    expect(plan.plan.add).toEqual([]);
  });

  it("leaves out of the estimate the Sage shipments the whole page's hand entries stand for, as the page does", async () => {
    const pending = PENDING.shipments.find((s) => ownersOf(s.customerCode).includes("AA"))!;
    const input = goalsViewInput([...ENTRIES, typedFor(pending.shipment)], FORECAST, SHIPMENT_LINES_SUMMARY, "boc", SNAPSHOT);
    const { view, wb } = await narrowedWorkbook(["AA"], input);
    const classes = wb.getWorksheet("Revenue by class")!;
    let shipments = 0;
    for (let r = 5; r < 5 + view.revenueByClass!.rows.length; r += 1) {
      const n = classes.getCell(r, 14).value;
      if (typeof n === "number") shipments += n;
    }
    expect(shipments).toBe(view.revenueGoal!.pendingShipments);
    const listed: string[] = [];
    const sheet = wb.getWorksheet("Pending shipments")!;
    sheet.eachRow((row) => listed.push(String(row.getCell(1).value ?? "")));
    expect(listed).not.toContain(pending.shipment);
  });

  it("sets no status or pace on a narrowed revenue row: the goal is every customer's", async () => {
    const { wb } = await narrowedWorkbook(["BB"]);
    const goals = wb.getWorksheet("Goals")!;
    expect(goals.getCell("A8").value).toMatch(/^Revenue/);
    expect(goals.getCell("H8").value).toBe("—");
    expect(goals.getCell("I8").value).toBe("—");
    // Line 1 is every customer's, so it keeps its status.
    expect(goals.getCell("H5").value).toMatchObject({ formula: expect.stringContaining("On track") });
  });
});

describe("no comparison with the month's goal on a narrowed page", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

  it("the daily revenue chart drops the target line and due so far", () => {
    const narrowed = page(["BB"]);
    if (!isReady(narrowed) || !isReady(WHOLE)) throw new Error("ready");
    // The summary is the chart's aria-label; the key's labels are text.
    const html = renderToStaticMarkup(createElement(DailyRevenueChart, { page: narrowed }));
    expect(text(html)).not.toContain("Target to date");
    expect(html).not.toContain("due so far");
    expect(html).toContain("for the customers of Bravo Rep (BB)");
    expect(text(renderToStaticMarkup(createElement(DailyRevenueChart, { page: WHOLE })))).toContain("Target to date");
  });

  it("the forecast's numbers say the target and the hit rate are every customer's", () => {
    const narrowed = page(["BB"]);
    if (!isReady(narrowed)) throw new Error("ready");
    const out = text(renderToStaticMarkup(createElement(ForecastSection, { page: narrowed })));
    expect(out).toContain("(all customers)");
    expect(out).toContain("For the customers of Bravo Rep (BB) only. The target and the hit rate are for all customers.");
  });

  it("the takeaway's share is the Revenue card's: the headline against every customer's", () => {
    const narrowed = page(["BB"]);
    const mine = narrowed.revenueGoal!.goalCadCents;
    const every = WHOLE.revenueGoal!.goalCadCents;
    expect(narrowed.model!.takeaway).toContain(`${formatDollars(mine)} of revenue toward the goal, ${Math.round((mine / every) * 100)}% of every customer’s ${formatDollars(every)}`);
  });

  it("says so when Sage changed during the refresh, so the narrowed figures can be off from the unfiltered card", () => {
    const view = { ...page(["BB"]).salespeople!, everyCustomer: { ...page(["BB"]).salespeople!.everyCustomer!, matchesCard: false } };
    expect(renderToStaticMarkup(createElement(SalespeopleNote, { view }))).toContain("Sage changed during this refresh");
    expect(renderToStaticMarkup(createElement(SalespeopleNote, { view: page(["BB"]).salespeople! }))).not.toContain("Sage changed during this refresh");
  });
});
