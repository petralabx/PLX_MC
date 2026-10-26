// Goals & Production shipments list (TASK-3143) against the 2026-10-14
// fixture: one row per Sage invoice shipped this month plus each counted
// shipment entered by hand, each row's CAD value and truckload kind, the
// filters and the totals. The totals use the Revenue card's own sums, so with
// no filter they equal revenue.totalCents to the cent, and the truckload kinds
// are the Truckloads card's, so the list never disagrees with either card.
// Pinned figures were derived from the fixture without this module.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isReady } from "@/components/mc/goals/helpers";
import { ShipmentList } from "@/components/mc/goals/shipments";
import { centsToDecimal, convertCents } from "@/lib/reporting/goals/money";
import { computeGoals, type GoalsInput } from "@/lib/reporting/goals/rules";
import {
  buildShipmentList,
  filterShipments,
  shipmentTotals,
  type ShipmentFilter,
  type ShipmentListRow,
} from "@/lib/reporting/goals/shipment-list";
import type { ManualEntry, ShipmentRow, TruckloadRow } from "@/lib/reporting/goals/types";
import { buildGoalsView } from "@/lib/reporting/goals/view";

import { DATASETS, ENTRIES, FTL_CUSTOMERS, HOLIDAYS, RATE, SETTINGS, TODAY, goalsInput, goalsPage, manualEntry } from "./reporting-goals-helpers";

const money = (cents: number) => centsToDecimal(cents);

/** The list as the page model builds it: the run's snapshot plus the model's evaluated entries. */
function listFor(input: GoalsInput = goalsInput({ entries: ENTRIES })) {
  const model = computeGoals(input);
  const rows = buildShipmentList({
    shipments: input.data.shipments,
    truckloads: input.data.truckloads,
    entries: model.entries,
    rate: model.revenue.rate,
    truckloadRate: model.truckloads.rate,
    rates: input.rates,
    settings: input.settings,
    ftlCustomers: input.ftlCustomers,
  });
  return { model, rows };
}

const row = (rows: readonly ShipmentListRow[], invoice: string) => {
  const found = rows.find((r) => r.invoice === invoice);
  if (!found) throw new Error(`no row ${invoice}`);
  return found;
};
const invoices = (rows: readonly ShipmentListRow[]) => rows.map((r) => r.invoice);
const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);

describe("rows on 2026-10-14 with M1–M7", () => {
  const { model, rows } = listFor();

  it("lists the 70 Sage invoices and the two counted shipments by hand, by ship date then invoice", () => {
    const counted = model.entries.filter((e) => e.counts && e.type === "Shipment");
    expect(counted.map((e) => e.entryId)).toEqual(["M003", "M007"]);
    expect(rows).toHaveLength(DATASETS.shipments.length + counted.length);
    expect(rows).toHaveLength(72);
    // The fixture is in the query's order (ship date, invoice); the Sage rows keep it.
    expect(invoices(rows.filter((r) => r.source === "Sage"))).toEqual(DATASETS.shipments.map((s) => s.invoice));
    for (let i = 1; i < rows.length; i += 1) {
      const [a, b] = [rows[i - 1], rows[i]];
      expect(a.shipDate < b.shipDate || (a.shipDate === b.shipDate && a.invoice.localeCompare(b.invoice) <= 0), `${a.invoice} before ${b.invoice}`).toBe(true);
    }
    // Both entries are dated Oct 14, after Sage's last invoice (Oct 13): INV-PENDING-7 sorts before PO0104001.
    expect(rows.slice(-2).map((r) => r.entryId)).toEqual(["M007", "M003"]);
    // M004 is in Sage now and M006 is not this month: neither is listed.
    expect(rows.filter((r) => r.source === "By hand").map((r) => r.entryId)).toEqual(["M007", "M003"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("keeps a CAD invoice's net as its CAD and converts a USD invoice's net at the run's rate", () => {
    expect(row(rows, "IN1000180352")).toMatchObject({
      source: "Sage",
      shipDate: "2026-10-02",
      shipment: "SH1000085448",
      orderNo: "OR1000152228",
      po: "TCP0160",
      customer: "The Care Principle / Dina Pugliese Productions Inc.",
      customerCode: "THECAR10",
      currency: "CAD",
      netCents: 1_039_320,
      cadCents: 1_039_320,
      truckload: null,
      truckloadCustomer: false,
      entryId: null,
    });
    const a1 = row(rows, "IN1000180398");
    expect(a1).toMatchObject({ currency: "USD", productCents: 3_139_440, otherCents: 125_000, netCents: 3_264_440 });
    expect(money(a1.cadCents!)).toBe("46417.07");
    for (const r of rows.filter((x) => x.source === "Sage")) {
      if (r.currency === "CAD") expect(r.cadCents, r.invoice).toBe(r.netCents);
      if (r.currency === "USD") expect(r.cadCents, r.invoice).toBe(convertCents(r.netCents, RATE));
    }
    expect(rows.filter((r) => r.currency === "CAD" && r.source === "Sage")).toHaveLength(57);
    expect(rows.filter((r) => r.currency === "USD" && r.source === "Sage")).toHaveLength(13);
  });

  it("lists a shipment by hand under its reference, with freight as other charges and its entry's CAD and load", () => {
    const m3 = model.entries.find((e) => e.entryId === "M003")!;
    expect(row(rows, "PO0104001")).toMatchObject({
      key: "entry:M003",
      source: "By hand",
      entryId: "M003",
      shipDate: TODAY,
      shipment: null,
      orderNo: null,
      po: null,
      customer: "A1 American",
      currency: "USD",
      productCents: 2_450_000,
      otherCents: 125_000,
      netCents: 2_575_000,
      cadCents: m3.revenueCadCents,
      truckload: "full",
      truckloadCustomer: true,
    });
    expect(money(m3.revenueCadCents)).toBe("36613.92");
    expect(row(rows, "INV-PENDING-7")).toMatchObject({
      entryId: "M007",
      customer: "Sahajan Inc.",
      currency: "CAD",
      productCents: 500_000,
      otherCents: 0,
      netCents: 500_000,
      cadCents: 500_000,
      truckload: null,
      truckloadCustomer: false,
    });
  });

  it("falls back to the entry ID when a shipment by hand has no reference", () => {
    const entry = manualEntry({ entryId: "M009", type: "Shipment", date: TODAY, customer: "Luna Inc", productValue: "100", currency: "CAD" });
    const { rows: withEntry } = listFor(goalsInput({ entries: [entry] }));
    expect(withEntry.at(-1)).toMatchObject({ invoice: "M009", entryId: "M009", cadCents: 10_000 });
  });

  it("never converts an invoice in another currency, and leaves it out of the CAD total", () => {
    const eur: ShipmentRow = {
      ...DATASETS.shipments[0],
      invoice: "IN1000180500",
      shipment: "SH1000085600",
      currency: "EUR",
      productValue: "1000.00",
      otherCharges: "0.00",
      netBeforeTax: "1000.00",
    };
    const input = goalsInput({
      entries: ENTRIES,
      data: {
        ...DATASETS,
        shipments: [...DATASETS.shipments, eur],
        revenue: [...DATASETS.revenue, { currency: "EUR", thisMonth: true, invoices: 1, netBeforeTax: "1000.00" }],
      },
    });
    const { model: withEur, rows: eurRows } = listFor(input);
    expect(row(eurRows, "IN1000180500")).toMatchObject({ currency: "EUR", netCents: 100_000, cadCents: null });
    const totals = shipmentTotals(eurRows, RATE);
    expect(totals.otherCurrencies).toEqual([{ currency: "EUR", invoices: 1, cents: 100_000 }]);
    expect(totals.otherCurrencies).toEqual(withEur.revenue.otherCurrencies);
    expect(totals.invoices).toBe(71);
    expect(totals.totalCadCents).toBe(withEur.revenue.totalCents);
    expect(totals.totalCadCents).toBe(shipmentTotals(rows, RATE).totalCadCents);
  });
});

describe("totals", () => {
  it("add up to the Revenue card's total with no filter, with entries by hand and without", () => {
    const { model, rows } = listFor();
    const totals = shipmentTotals(rows, RATE);
    expect(totals.invoices).toBe(70);
    expect(totals.byHand).toBe(2);
    expect(totals.cad).toEqual(model.revenue.cad);
    expect(totals.usd).toEqual(model.revenue.usd);
    expect(money(totals.usd.cadCents)).toBe("245176.45");
    expect(totals.byHandCadCents).toBe(model.revenue.byHandCents);
    expect(money(totals.byHandCadCents)).toBe("41613.92");
    expect(totals.otherCurrencies).toEqual([]);
    expect(totals.totalCadCents).toBe(model.revenue.totalCents);
    expect(money(totals.totalCadCents)).toBe("408628.08");

    const plain = listFor(goalsInput());
    expect(plain.rows).toHaveLength(70);
    expect(shipmentTotals(plain.rows, RATE).totalCadCents).toBe(plain.model.revenue.totalCents);
    expect(money(plain.model.revenue.totalCents)).toBe("367014.16");
  });

  it("convert the USD subtotal once, as the Revenue card does, so it can be a few cents off the CAD column", () => {
    const { rows } = listFor();
    const usdRows = rows.filter((r) => r.source === "Sage" && r.currency === "USD");
    // Each invoice rounded on its own adds up to a cent more than the subtotal converted once.
    expect(money(sum(usdRows.map((r) => r.cadCents!)))).toBe("245176.46");
    expect(money(shipmentTotals(rows, RATE).usd.cadCents)).toBe("245176.45");
  });
});

describe("filters", () => {
  const { model, rows } = listFor();
  const only = (filter: ShipmentFilter, query = "") => filterShipments(rows, { filter, query });

  it("counts each chip's rows", () => {
    const filters: ShipmentFilter[] = ["all", "truckload", "full", "partial", "cad", "usd", "by_hand"];
    expect(Object.fromEntries(filters.map((f) => [f, only(f).length]))).toEqual({
      all: 72,
      truckload: 3,
      full: 3,
      partial: 0,
      cad: 58,
      usd: 14,
      by_hand: 2,
    });
    expect(invoices(only("truckload"))).toEqual(["IN1000180398", "IN1000180399", "PO0104001"]);
    expect(invoices(only("full"))).toEqual(["IN1000180398", "IN1000180399", "PO0104001"]);
    expect(only("cad").every((r) => r.currency === "CAD")).toBe(true);
    expect(only("usd").every((r) => r.currency === "USD")).toBe(true);
    expect(only("by_hand").map((r) => r.entryId)).toEqual(["M007", "M003"]);
  });

  it("totals the rows shown, by the Revenue card's formula", () => {
    const cad = shipmentTotals(only("cad"), RATE);
    expect(cad).toMatchObject({ invoices: 57, byHand: 1, cad: model.revenue.cad, usd: { invoices: 0, cents: 0, cadCents: 0 }, byHandCadCents: 500_000 });
    expect(money(cad.totalCadCents)).toBe("126837.71");

    const usd = shipmentTotals(only("usd"), RATE);
    expect(usd).toMatchObject({ invoices: 13, byHand: 1, cad: { invoices: 0, cents: 0 }, usd: model.revenue.usd, byHandCadCents: 3_661_392 });
    expect(money(usd.totalCadCents)).toBe("281790.37");

    const byHand = shipmentTotals(only("by_hand"), RATE);
    expect(byHand).toMatchObject({ invoices: 0, byHand: 2, totalCadCents: model.revenue.byHandCents });

    const full = shipmentTotals(only("full"), RATE);
    expect(full.usd).toEqual({ invoices: 2, cents: 5_765_432, cadCents: convertCents(5_765_432, RATE) });
    expect(full.totalCadCents).toBe(convertCents(5_765_432, RATE) + 3_661_392);

    const none = shipmentTotals(only("partial"), RATE);
    expect(none).toMatchObject({ invoices: 0, byHand: 0, totalCadCents: 0 });

    // System data only: the CAD chip's total is the CAD subtotal.
    const plain = listFor(goalsInput());
    const plainCad = shipmentTotals(filterShipments(plain.rows, { filter: "cad", query: "" }), RATE);
    expect(plainCad.totalCadCents).toBe(plainCad.cad.cents);
    expect(money(plainCad.totalCadCents)).toBe("121837.71");
  });

  it("searches customers by name or code, invoice, shipment, order and PO numbers and references by hand", () => {
    expect(invoices(only("all", "a1 american"))).toEqual(["IN1000180398", "PO0104001"]);
    // Sage's name has a no-break space between LLC and DBA.
    expect(invoices(only("all", "LLC DBA"))).toEqual(["IN1000180398"]);
    expect(only("all", "remcod10")).toHaveLength(8);
    expect(only("all", "  REMCODA  ")).toHaveLength(8);
    expect(invoices(only("all", "sh1000085508"))).toEqual(["IN1000180398"]);
    expect(invoices(only("all", "OR1000154102"))).toEqual(["IN1000180398"]);
    expect(invoices(only("all", "tcp0160"))).toEqual(["IN1000180352"]);
    expect(invoices(only("all", "in1000180418"))).toEqual(["IN1000180418"]);
    expect(invoices(only("all", "inv-pending"))).toEqual(["INV-PENDING-7"]);
    expect(only("all", "nothing like this")).toEqual([]);
    // The search narrows the chosen chip.
    expect(only("usd", "remco")).toHaveLength(8);
    expect(only("cad", "remco")).toEqual([]);
  });
});

describe("truckload kinds agree with Truckloads by customer", () => {
  /** Distinct shipments of a kind in the list, keyed as queries/truckloads.ts groups invoices. */
  function shipmentsOf(rows: readonly ShipmentListRow[], kind: "full" | "partial") {
    const sage = new Set(
      rows.filter((r) => r.source === "Sage" && r.truckload === kind).map((r) => `${r.customerCode}|${r.shipment ?? `invoice:${r.invoice}`}`)
    );
    return { inSystem: sage.size, byHand: rows.filter((r) => r.source === "By hand" && r.truckload === kind).length };
  }

  it("on 2026-10-14: the two full loads in Sage and M003 by hand", () => {
    const { model, rows } = listFor();
    expect(shipmentsOf(rows, "full")).toEqual({ inSystem: model.truckloads.full.inSystem, byHand: model.truckloads.full.byHand });
    expect(shipmentsOf(rows, "full")).toEqual({ inSystem: 2, byHand: 1 });
    expect(shipmentsOf(rows, "partial")).toEqual({ inSystem: model.truckloads.partial.inSystem, byHand: model.truckloads.partial.byHand });
  });

  it("on a month with partial loads, a load only full when its invoices are summed, invoices without a shipment number, a CAD load and a freight-only invoice", () => {
    const invoice = (fields: Partial<ShipmentRow> & Pick<ShipmentRow, "invoice" | "customerCode" | "currency" | "productValue">): ShipmentRow => ({
      shipment: null,
      orderNo: null,
      po: null,
      customer: null,
      shipDate: "2026-10-06",
      otherCharges: "0.00",
      netBeforeTax: fields.productValue,
      ...fields,
    });
    const load = (code: string, shipment: string, productUsd: string, productCad = "0.00", thisMonth = true): TruckloadRow => ({
      code,
      shipment,
      shipDate: thisMonth ? "2026-10-06" : "2026-09-29",
      productUsd,
      productCad,
      thisMonth,
    });
    const shipments: ShipmentRow[] = [
      // One shipment, two invoices: US$19,000 together is a full load, neither invoice alone.
      invoice({ invoice: "IN-P1A", customerCode: "PETSUP10", shipment: "SH-P1", currency: "USD", productValue: "10000.00" }),
      invoice({ invoice: "IN-P1B", customerCode: "PETSUP10", shipment: "SH-P1", currency: "USD", productValue: "9000.00" }),
      invoice({ invoice: "IN-P2", customerCode: "PETSUP10", shipment: "SH-P2", currency: "USD", productValue: "5000.00" }),
      // No shipment numbers: each invoice is its own shipment, never merged.
      invoice({ invoice: "IN-S3", customerCode: "SOAP11", currency: "USD", productValue: "20000.00" }),
      invoice({ invoice: "IN-S4", customerCode: "SOAP11", currency: "USD", productValue: "1000.00" }),
      // CA$30,000 at 1.4219 is US$21,098.53: full.
      invoice({ invoice: "IN-C5", customerCode: "1SHOP11", shipment: "SH-C5", currency: "CAD", productValue: "30000.00" }),
      // Freight only: revenue, never a load (the query's HAVING drops it).
      invoice({ invoice: "IN-F6", customerCode: "DIVE11", shipment: "SH-F6", currency: "USD", productValue: "0.00", otherCharges: "500.00", netBeforeTax: "500.00" }),
      invoice({ invoice: "IN-O7", customerCode: "OTHER10", shipment: "SH-O7", currency: "USD", productValue: "50000.00" }),
      // The rest of a shipment whose first invoice shipped last month: counted last month.
      invoice({ invoice: "IN-X8", customerCode: "PETSUP10", shipment: "SH-X8", currency: "USD", productValue: "20000.00" }),
      // A customer taken off the truckload list after the refresh: the card skips its row.
      invoice({ invoice: "IN-Z9", customerCode: "OLD11", shipment: "SH-Z9", currency: "USD", productValue: "30000.00" }),
    ];
    const truckloads: TruckloadRow[] = [
      load("PETSUP10", "SH-P1", "19000.00"),
      load("PETSUP10", "SH-P2", "5000.00"),
      load("SOAP11", "invoice:IN-S3", "20000.00"),
      load("SOAP11", "invoice:IN-S4", "1000.00"),
      load("1SHOP11", "SH-C5", "0.00", "30000.00"),
      load("PETSUP10", "SH-X8", "38000.00", "0.00", false),
      load("OLD11", "SH-Z9", "30000.00"),
    ];
    const hand = (entryId: string, fields: Partial<ManualEntry>): ManualEntry =>
      manualEntry({ entryId, type: "Shipment", date: "2026-10-07", currency: "USD", ...fields });
    const entries = [
      hand("M101", { reference: "PSP-1007", customer: "Pet Supplies Plus", productValue: "5000" }),
      hand("M102", { reference: "SOAP-1007", customer: "Soapbox", productValue: "0", freight: "300" }),
      hand("M103", { reference: "A1-1007", customer: "A1 American", productValue: "18000" }),
    ];
    const { model, rows } = listFor(goalsInput({ data: { ...DATASETS, shipments, truckloads }, entries }));

    const kinds = Object.fromEntries(rows.map((r) => [r.invoice, [r.truckload, r.truckloadCustomer]]));
    expect(kinds).toEqual({
      "IN-P1A": ["full", true],
      "IN-P1B": ["full", true],
      "IN-P2": ["partial", true],
      "IN-S3": ["full", true],
      "IN-S4": ["partial", true],
      "IN-C5": ["full", true],
      "IN-F6": [null, true],
      "IN-O7": [null, false],
      "IN-X8": [null, true],
      "IN-Z9": [null, false],
      "PSP-1007": ["partial", true],
      "SOAP-1007": [null, true],
      "A1-1007": ["full", true],
    });
    expect(model.truckloads.full).toEqual({ inSystem: 3, byHand: 1, total: 4 });
    expect(model.truckloads.partial).toEqual({ inSystem: 2, byHand: 1, total: 3 });
    for (const kind of ["full", "partial"] as const) {
      expect(shipmentsOf(rows, kind), kind).toEqual({ inSystem: model.truckloads[kind].inSystem, byHand: model.truckloads[kind].byHand });
    }
    expect(filterShipments(rows, { filter: "truckload", query: "" })).toHaveLength(11);
  });
});

describe("the page model and the section", () => {
  const page = goalsPage();
  if (!isReady(page)) throw new Error("fixture page should be ready");

  it("carries the list built from the same snapshot and entries as the model", () => {
    expect(page.shipments).toEqual(listFor().rows);
    expect(shipmentTotals(page.shipments, page.model.revenue.rate).totalCadCents).toBe(page.model.revenue.totalCents);
    // Its source line names the datasets it is built from (the truckload kinds come from truckloads, what shipped from shipment-lines).
    expect(page.sections.shipments).toEqual(["shipments", "truckloads", "shipment-lines"]);
    const empty = buildGoalsView({
      configured: true,
      run: null,
      latestRun: null,
      snapshot: null,
      entries: ENTRIES,
      filemakerRefs: new Set(),
      sageRefs: new Set(),
      settings: SETTINGS,
      ftlCustomers: FTL_CUSTOMERS,
      holidays: HOLIDAYS,
      rates: [],
    });
    expect(empty.shipments).toEqual([]);
  });

  it("renders every row, the ones by hand in amber, chips with counts and the totals", () => {
    const markup = renderToStaticMarkup(createElement(ShipmentList, { page }));
    const text = markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    expect(text).toContain("Showing 72 of 72 shipments");
    for (const chip of ["All 72", "Truckload customers 3", "Full 3", "Partial 0", "CAD 58", "USD 14", "By hand 2"]) expect(text).toContain(chip);
    expect(markup).toContain('aria-pressed="true"');
    const body = markup.slice(markup.indexOf("<tbody>"), markup.indexOf("</tbody>"));
    expect(body.match(/<tr/g)).toHaveLength(72);
    expect(body.match(/<tr class="hand">/g)).toHaveLength(2);
    expect(text).toContain(
      "Oct 9 IN1000180398 SH1000085508 OR1000154102 PO0101005 /0103435 Tiger Hospitality LLC DBA of A1 American A1TEXT11 USD 31,394.40 1,250.00 32,644.40 1.4219 46,417.07 Full Sage"
    );
    expect(text).toContain("Oct 14 PO0104001 A1 American USD 24,500.00 1,250.00 25,750.00 1.4219 36,613.92 Full By hand M003");
    expect(text).toContain("Oct 2 IN1000180352 SH1000085448 OR1000152228 TCP0160 The Care Principle / Dina Pugliese Productions Inc. THECAR10 CAD 10,393.20 0.00 10,393.20 — 10,393.20 Sage");
    // The totals are a table of their own under the list, each figure beside its label.
    const totals = text.slice(text.indexOf("Totals for the shipments shown"));
    expect(totals).toContain(
      "Totals for the shipments shown CAD 57 CAD invoices 121,837.71 13 USD invoices: US$172,428.76 at 1.4219, converted once 245,176.45 2 entered by hand 41,613.92 Total: 70 invoices and 2 by hand 408,628.08"
    );
    expect(markup).toContain('aria-label="Shipment totals"');
    expect(totals).toContain("The USD subtotal is converted once at the rate, as on the Revenue card");
  });
});
