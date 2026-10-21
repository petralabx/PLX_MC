// What shipped (TASK-3144): each Sage invoice's lines under its row in the
// shipments list, against the 2026-10-14 fixture's synthetic invoice lines
// (fixtures/reporting-goals/2026-10-14/shipment-lines.json, derived in Python
// from source.json; see that folder's README). Lines hang under their own
// invoice only; item lines (amount less discount) reconcile with the invoice's
// product value and charges with its other charges, to the cent, and an invoice
// whose lines don't add up says so with both figures; the search finds item
// codes and descriptions; rows entered by hand have no lines; while the login
// can't read Sage's invoice lines the page says what it lacks. The page model
// never carries the lines (they load on demand: the route is in
// tests/reporting-goals-routes.test.ts, the SQL in the Postgres suite).
// Pinned figures come from the fixture's generator, not from this module.

import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isReady } from "@/components/mc/goals/helpers";
import { InvoiceLinesPanel, type InvoiceLinesState } from "@/components/mc/goals/shipments";
import { SHIPMENT_LINE_COLUMNS } from "@/lib/reporting/goals";
import { invoiceLines, shipmentLinesView, type InvoiceLines } from "@/lib/reporting/goals/shipment-lines";
import { filterShipments, type ShipmentFilter, type ShipmentListRow } from "@/lib/reporting/goals/shipment-list";
import type { ShipmentLineRow } from "@/lib/reporting/goals/types";

import { SHIPMENT_LINES, goalsPage } from "./reporting-goals-helpers";

const PAGE = goalsPage();
if (!isReady(PAGE)) throw new Error("fixture page should be ready");
const ROWS = PAGE.shipments;
const BY_ROW = invoiceLines(ROWS, SHIPMENT_LINES);

const rowOf = (invoice: string): ShipmentListRow => {
  const found = ROWS.find((r) => r.invoice === invoice);
  if (!found) throw new Error(`no row ${invoice}`);
  return found;
};
const linesOf = (invoice: string): InvoiceLines => {
  const found = BY_ROW.get(`sage:${invoice}`);
  if (!found) throw new Error(`no lines for ${invoice}`);
  return found;
};
const invoices = (rows: readonly ShipmentListRow[]) => rows.map((r) => r.invoice);

describe("lines under their invoices", () => {
  it("hangs every line under its own invoice's row, in Sage's line order, and none under rows entered by hand", () => {
    const sage = ROWS.filter((r) => r.source === "Sage");
    expect(sage).toHaveLength(70);
    expect([...BY_ROW.keys()]).toEqual(sage.map((r) => r.key));
    for (const row of sage) {
      expect(linesOf(row.invoice).lines, row.invoice).toEqual(SHIPMENT_LINES.filter((l) => l.invoice === row.invoice));
    }
    // Every one of the run's 133 lines is under a row; none is lost or shown twice.
    expect([...BY_ROW.values()].reduce((n, v) => n + v.lines.length, 0)).toBe(133);
    // By number, not as text: 128 and 160 come after 96.
    expect(linesOf("IN1000180418").lines.map((l) => l.lineNo)).toEqual([32, 64, 96, 128, 160]);
    // M003 and M007 were entered by hand: they have no lines to open.
    expect(ROWS.filter((r) => r.source === "By hand").map((r) => [r.entryId, BY_ROW.has(r.key)])).toEqual([
      ["M007", false],
      ["M003", false],
    ]);
    // Two invoices have no lines in Sage at all.
    expect([linesOf("IN1000180353").lines, linesOf("IN1000180417").lines]).toEqual([[], []]);
  });

  it("adds up item lines (amount less discount) and charge lines apart", () => {
    // Two items, one carrying the invoice's 12.50 discount, then freight and a fuel surcharge.
    expect(linesOf("IN1000180379").lines.map((l) => [l.kind, l.code])).toEqual([
      ["item", "FP-2006"],
      ["item", "FP-2007"],
      ["charge", "FRT"],
      ["charge", "FUEL"],
    ]);
    expect(linesOf("IN1000180379")).toMatchObject({
      items: { cents: 655_520, invoiceCents: 655_520, agrees: true },
      charges: { cents: 52_442, invoiceCents: 52_442, agrees: true },
      agrees: true,
    });
    // Freight only: no item lines, product value 0.
    expect(linesOf("IN1000180396")).toMatchObject({ items: { cents: 0, invoiceCents: 0 }, charges: { cents: 129_452, invoiceCents: 129_452 }, agrees: true });
  });

  it("agree to the cent on 67 of the 70 invoices: discounts, USD, freight, $0 and no-charge lines included", () => {
    expect(linesOf("IN1000180352")).toMatchObject({ items: { cents: 1_039_320, invoiceCents: rowOf("IN1000180352").productCents }, agrees: true });
    // USD: 15,704.00 − 12.50 + 9,400.00 + 6,302.90 = 31,394.40; freight 1,250.00.
    expect(linesOf("IN1000180398")).toMatchObject({ items: { cents: 3_139_440 }, charges: { cents: 125_000 }, agrees: true });
    // A line discount of 329.55 on an invoice with no invoice discount.
    expect(linesOf("IN1000180407")).toMatchObject({ items: { cents: 3_295_500, invoiceCents: 3_295_500 }, agrees: true });
    // A no-charge line, and a $0 invoice with no lines at all.
    expect(linesOf("IN1000180416")).toMatchObject({ items: { cents: 0 }, charges: { cents: 0 }, agrees: true });
    expect(linesOf("IN1000180417").agrees).toBe(true);
    expect([...BY_ROW.values()].filter((v) => v.agrees)).toHaveLength(67);
  });

  it("flags the three that don't add up, keeping both figures", () => {
    // In the list's order: by ship date (Oct 2, Oct 6, Oct 7), then invoice.
    const off = [...BY_ROW.entries()].filter(([, v]) => !v.agrees).map(([key]) => key);
    expect(off).toEqual(["sage:IN1000180353", "sage:IN1000180370", "sage:IN1000180368"]);
    // No lines at all against 16,588.00 of product.
    expect(linesOf("IN1000180353")).toMatchObject({
      items: { cents: 0, invoiceCents: 1_658_800, agrees: false },
      charges: { cents: 0, invoiceCents: 0, agrees: true },
    });
    // A line that never reached the replica: 4,442.40 of 7,164.80.
    expect(linesOf("IN1000180368")).toMatchObject({ items: { cents: 444_240, invoiceCents: 716_480, agrees: false } });
    // Items agree; the freight line is a dollar short of the invoice's other charges.
    expect(linesOf("IN1000180370")).toMatchObject({
      items: { cents: 24_190, invoiceCents: 24_190, agrees: true },
      charges: { cents: 1_835, invoiceCents: 1_935, agrees: false },
      agrees: false,
    });
  });

  it("adds the lines up exactly before rounding to the cent once", () => {
    // Sage keeps three decimals: two lines of 10.005 are 20.01, though each alone rounds (half to even) to 10.00.
    const row: ShipmentListRow = { ...rowOf("IN1000180352"), key: "sage:IN-EXACT", invoice: "IN-EXACT", productCents: 2001, otherCents: 0 };
    const line = (lineNo: number, amount: string, discount = "0.000"): ShipmentLineRow => ({
      invoice: "IN-EXACT", lineNo, kind: "item", code: "FP-2001", description: null, qty: "1.0000", unit: "EA", unitPrice: amount, amount, discount,
    });
    expect(invoiceLines([row], [line(32, "10.005"), line(64, "10.005")]).get("sage:IN-EXACT")).toMatchObject({ items: { cents: 2001 }, agrees: true });
    // Discounts too: 20.000 less 0.005 twice is 19.99.
    const less = { ...row, productCents: 1999 };
    expect(invoiceLines([less], [line(32, "10.000", "0.005"), line(64, "10.000", "0.005")]).get("sage:IN-EXACT")?.agrees).toBe(true);
  });
});

describe("the search", () => {
  const find = (query: string, filter: ShipmentFilter = "all") => invoices(filterShipments(ROWS, { filter, query, lines: BY_ROW }));

  it("finds invoices by the item codes and descriptions of their lines", () => {
    expect(find("desert breeze")).toEqual(["IN1000180349", "IN1000180391"]);
    expect(find("  TP-DBS-1l ")).toEqual(["IN1000180349", "IN1000180391"]);
    expect(find("fuel surcharge")).toEqual(["IN1000180379", "IN1000180418"]);
    expect(find("blk-shb")).toEqual(["IN1000180367"]);
    expect(find("no-charge samples")).toEqual(["IN1000180416"]);
    // The chip still narrows it: Luna Inc. is billed in USD, Glencoe in CAD.
    expect(find("desert breeze", "usd")).toEqual(["IN1000180349"]);
    expect(find("desert breeze", "cad")).toEqual(["IN1000180391"]);
  });

  it("finds them only once the lines are there, and everything else as before", () => {
    expect(invoices(filterShipments(ROWS, { filter: "all", query: "desert breeze" }))).toEqual([]);
    expect(find("a1 american")).toEqual(["IN1000180398", "PO0104001"]);
    expect(find("OR1000154102")).toEqual(["IN1000180398"]);
    // Counting the chips never involves the search.
    expect(filterShipments(ROWS, { filter: "all", query: "", lines: BY_ROW })).toHaveLength(72);
  });
});

describe("the page model", () => {
  it("says the run's lines can be read and how many, without carrying them", () => {
    expect(PAGE.shipmentLines).toEqual({ state: "ready", lines: 133 });
    const payload = JSON.stringify(PAGE);
    for (const text of ["Bar soap 100 g", "FP-2006", "Fuel surcharge"]) expect(payload).not.toContain(text);
    // Its source line names the query the lines come from.
    expect(PAGE.sections.shipments).toEqual(["shipments", "truckloads", "shipment-lines"]);
  });

  it("names what the login lacks while it waits for read access, and says when a run predates the lines", () => {
    const missing = ["sage.oe_invoice_header.invuniq", "sage.oe_invoice_detail.invuniq", "sage.oe_invoice_detail.extinvmisc"];
    expect(goalsPage({}, undefined, undefined, { access: "missing", missing, lines: 0 }).shipmentLines).toEqual({
      state: "waiting_for_access",
      missing: [
        { relation: "sage.oe_invoice_header", columns: ["invuniq"] },
        { relation: "sage.oe_invoice_detail", columns: ["invuniq", "extinvmisc"] },
      ],
    });
    expect(goalsPage({}, undefined, undefined, null).shipmentLines).toEqual({ state: "not_in_run" });
    expect(shipmentLinesView(null)).toEqual({ state: "not_in_run" });
  });
});

describe("an opened invoice", () => {
  /** Visible text of the panel, tags dropped and whitespace collapsed. */
  const render = (invoice: string, state?: InvoiceLinesState) =>
    renderToStaticMarkup(createElement(InvoiceLinesPanel, { row: rowOf(invoice), state: state ?? { kind: "ready", invoice: linesOf(invoice) } }))
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

  it("lists its item lines and its charges in the invoice's currency, and says they add up", () => {
    const out = render("IN1000180398");
    expect(out).toContain("Lines of invoice IN1000180398, in USD");
    expect(out).toContain("Type Item or charge Description Quantity shipped Unit Unit price Amount Discount");
    expect(out).toContain("Item FP-2006 Bar soap 100 g 400 CSE 39.26 15,704.00 12.50");
    expect(out).toContain("Item FP-2008 Shower gel 1 L 100 CSE 63.029 6,302.90 0.00");
    expect(out).toContain("Charge FRT Freight 1,250.00");
    expect(out).toContain(
      "These lines add up to the invoice: item lines less their discounts come to its product value, 31,394.40 USD, and charges to its other charges, 1,250.00 USD."
    );
    // A fractional kg quantity keeps its decimals.
    expect(render("IN1000180367")).toContain("Item BLK-SHB-KG Bulk shampoo base 1,234.5 KG 2.10 2,592.45 0.00");
  });

  it("says when its lines don't add up to the invoice, with both figures", () => {
    const short = render("IN1000180368");
    expect(short).toContain("These lines don’t add up to the invoice.");
    expect(short).toContain("Item lines less their discounts come to 4,442.40 CAD; the invoice’s product value is 7,164.80 CAD.");
    expect(short).not.toContain("Charges come to");
    const freight = render("IN1000180370");
    expect(freight).toContain("Charges come to 18.35 CAD; the invoice’s other charges are 19.35 CAD.");
    expect(freight).not.toContain("Item lines less their discounts come to");
    const none = render("IN1000180353");
    expect(none).toContain("Sage has no lines for this invoice.");
    expect(none).toContain("Item lines less their discounts come to 0.00 CAD; the invoice’s product value is 16,588.00 CAD.");
    expect(render("IN1000180417")).toBe("Sage has no lines for this invoice; its product value and other charges are both 0.00 USD.");
  });

  it("while the login can't read Sage's invoice lines, says so where they would open and names what's missing", () => {
    const out = render("IN1000180398", {
      kind: "waiting",
      missing: [
        { relation: "sage.oe_invoice_header", columns: ["invuniq"] },
        { relation: "sage.oe_invoice_detail", columns: ["invuniq", "linenum"] },
      ],
    });
    expect(out).toContain("Item details are waiting for read access to Sage invoice lines.");
    expect(out).toContain("sage.oe_invoice_header : invuniq");
    expect(out).toContain("sage.oe_invoice_detail : invuniq, linenum");
    expect(out).toContain("readonly-grants-shipment-lines.sql");
    expect(render("IN1000180398", { kind: "not_in_run" })).toBe("This refresh has no invoice lines yet. They fill in at the next refresh.");
    expect(render("IN1000180398", { kind: "loading" })).toBe("Loading the invoice’s lines…");
    expect(render("IN1000180398", { kind: "failed", message: "HTTP 500", onRetry: () => {} })).toBe(
      "Couldn’t load the invoice lines: HTTP 500 Retry"
    );
  });
});

describe("read access", () => {
  /** "GRANT SELECT (a, b) ON schema.table TO mc_goals_ro" → { "schema.table": [a, b] } (quotes dropped). */
  function grantsIn(file: string): Record<string, string[]> {
    const sql = readFileSync(path.join(__dirname, "..", "docs", "modules", "reporting-goals", file), "utf8").replace(/--.*$/gm, "");
    const out: Record<string, string[]> = {};
    for (const m of sql.matchAll(/GRANT\s+SELECT\s*\(([^)]*)\)\s*ON\s+([\w.]+)\s+TO\s+(?:mc_goals_ro|:"role")/gi)) {
      out[m[2]] = [...(out[m[2]] ?? []), ...m[1].split(",").map((c) => c.trim().replace(/"/g, ""))];
    }
    return out;
  }
  const sorted = (grants: Record<string, readonly string[]>) => Object.fromEntries(Object.entries(grants).map(([k, v]) => [k, [...v].sort()]));
  const wanted = sorted(Object.fromEntries(SHIPMENT_LINE_COLUMNS.map(([schema, table, columns]) => [`${schema}.${table}`, columns])));

  it("lists exactly the columns the query reads: the header's join key, number and ship date, and eleven detail columns", () => {
    expect(wanted).toEqual({
      "sage.oe_invoice_header": ["invnumber", "invuniq", "shipdate"],
      "sage.oe_invoice_detail": ["desc", "extinvmisc", "invdisc", "invunit", "invuniq", "item", "linenum", "linetype", "misccharge", "qtyshipped", "unitprice"].sort(),
    });
  });

  it("the one-off script for the existing login grants the new ones; the header's number and ship date it already has", () => {
    const already = grantsIn("readonly-grants.sql")["sage.oe_invoice_header"];
    expect(already).toEqual(expect.arrayContaining(["invnumber", "shipdate"]));
    expect(sorted(grantsIn("readonly-grants-shipment-lines.sql"))).toEqual({
      "sage.oe_invoice_header": ["invuniq"],
      "sage.oe_invoice_detail": wanted["sage.oe_invoice_detail"],
    });
  });

  it("the fresh-install script grants every one of them", () => {
    const grants = grantsIn("readonly-grants.sql");
    for (const [relation, columns] of Object.entries(wanted)) expect(grants[relation], relation).toEqual(expect.arrayContaining(columns));
    // Sage's costs stay unreadable.
    expect(grants["sage.oe_invoice_detail"]).not.toEqual(expect.arrayContaining(["unitcost"]));
  });
});
