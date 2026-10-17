// The workbook's "Shipment lines" sheet (TASK-3144), built from the 2026-10-14
// fixture's page model (M1–M7 entered) and its invoice lines, read back with
// exceljs: its place right after Shipments (the Forecast sheet stays just before
// the import template), the header row in the house style, one row per line in
// the Shipments sheet's invoice order with real dates and exact amounts, and the
// invoices whose lines don't add up named under the rows with both figures. While
// the login can't read the lines, the sheet says why. Then LibreOffice
// recalculates the whole workbook: no formula errors on any sheet (skipped,
// saying why, where soffice isn't installed, as in CI). The rest of the workbook
// is tested in tests/reporting-goals-export.test.ts.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { HEADER_FILL, WORKBOOK_SHEETS, buildGoalsWorkbook, type ShipmentLinesDataset } from "@/lib/reporting/goals";

import { DATASETS, RATE, RUN, SETTINGS, SHIPMENT_LINES, TODAY, goalsPage } from "./reporting-goals-helpers";

const PAGE = goalsPage();
const READ: ShipmentLinesDataset = { access: "read", missing: [], lines: SHIPMENT_LINES };

async function build(
  shipmentLines: ShipmentLinesDataset | null | undefined,
  shipments = DATASETS.shipments
): Promise<{ buffer: Buffer; wb: ExcelJS.Workbook; ws: ExcelJS.Worksheet }> {
  const buffer = await buildGoalsWorkbook({
    run: RUN,
    model: PAGE.model!,
    settings: SETTINGS,
    shipments,
    truckloads: DATASETS.truckloads,
    rates: [{ date: TODAY, rate: RATE }],
    exportedAt: new Date("2026-10-14T14:42:00Z"),
    forecast: PAGE.forecast,
    shipmentLines,
  });
  const wb = await readXlsx(buffer);
  return { buffer, wb, ws: wb.getWorksheet("Shipment lines")! };
}

async function readXlsx(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(bytes).buffer);
  return wb;
}

const formulaOf = (cell: ExcelJS.Cell) =>
  cell.value !== null && typeof cell.value === "object" && "formula" in cell.value ? cell.value.formula : undefined;
const fillOf = (cell: ExcelJS.Cell) => (cell.fill?.type === "pattern" ? cell.fill.fgColor?.argb : undefined);
const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** The row's cells A–L (a blank cell reads as null; exceljs leaves it out of row.values). */
const values = (ws: ExcelJS.Worksheet, row: number) => Array.from({ length: 12 }, (_, i) => ws.getCell(row, i + 1).value);

describe("the Shipment lines sheet", () => {
  it("sits right after Shipments, and the Forecast still sits just before the import template", async () => {
    const { wb } = await build(READ);
    expect(WORKBOOK_SHEETS.indexOf("Shipment lines")).toBe(WORKBOOK_SHEETS.indexOf("Shipments") + 1);
    expect(WORKBOOK_SHEETS.indexOf("Forecast")).toBe(WORKBOOK_SHEETS.indexOf("Manual entries") - 1);
    expect(wb.worksheets.map((s) => s.name)).toEqual([...WORKBOOK_SHEETS]);
  });

  it("heads its columns in bold on grey, frozen, in Arial 10", async () => {
    const { ws } = await build(READ);
    expect(values(ws, 1)).toEqual([
      "Invoice", "Ship date", "Customer", "Line type", "Item or charge", "Description", "Quantity", "Unit", "Unit price", "Amount", "Discount", "Currency",
    ]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    ws.getRow(1).eachCell((cell) => {
      expect(cell.font, cell.address).toMatchObject({ name: "Arial", size: 10, bold: true });
      expect(fillOf(cell), cell.address).toBe(HEADER_FILL);
    });
  });

  it("has one row per line, in the Shipments sheet's order of invoices, each invoice's lines in Sage's order", async () => {
    const { ws } = await build(READ);
    const order = DATASETS.shipments.map((s) => s.invoice);
    const expected = [...SHIPMENT_LINES].sort((a, b) => order.indexOf(a.invoice) - order.indexOf(b.invoice) || (a.lineNo ?? 0) - (b.lineNo ?? 0));
    expect(expected).toHaveLength(133);
    expected.forEach((line, i) => {
      const r = 2 + i;
      expect([ws.getCell(`A${r}`).value, ws.getCell(`E${r}`).value, ws.getCell(`J${r}`).value], `row ${r}`).toEqual([line.invoice, line.code, Number(line.amount)]);
    });
    // Its own row of the first invoice: a dated item line with its discount, in CAD.
    expect(values(ws, 2)).toEqual([
      "IN1000180352", utcDay("2026-10-02"), "The Care Principle / Dina Pugliese Productions Inc.", "Item", "FP-2005", "Body lotion 250 mL", 100, "CSE", 64.52, 6452, 12.5, "CAD",
    ]);
    // A charge: no quantity, unit or unit price.
    const freight = expected.findIndex((l) => l.invoice === "IN1000180398" && l.kind === "charge") + 2;
    // A1 American's billing name keeps its no-break space.
    const a1 = DATASETS.shipments.find((s) => s.invoice === "IN1000180398")!.customer;
    expect(a1).toContain("\u00a0");
    expect(values(ws, freight)).toEqual(["IN1000180398", utcDay("2026-10-09"), a1, "Charge", "FRT", "Freight", null, null, null, 1250, 0, "USD"]);
    // A fractional kg quantity, exactly.
    const kg = expected.findIndex((l) => l.code === "BLK-SHB-KG") + 2;
    expect([ws.getCell(`G${kg}`).value, ws.getCell(`H${kg}`).value, ws.getCell(`J${kg}`).value]).toEqual([1234.5, "KG", 2592.45]);
    // Values, never formulas; the house formats.
    for (let r = 2; r <= 134; r += 1) for (let c = 1; c <= 12; c += 1) expect(formulaOf(ws.getCell(r, c)), `${r}:${c}`).toBeUndefined();
    expect([ws.getCell("B2").numFmt, ws.getCell("G2").numFmt, ws.getCell("I2").numFmt, ws.getCell("J2").numFmt, ws.getCell("K2").numFmt]).toEqual([
      "yyyy-mm-dd", "#,##0.00##", "#,##0.00####", "#,##0.00", "#,##0.00",
    ]);
  });

  it("names the invoices whose lines don't add up, with both figures, under the rows", async () => {
    const { ws } = await build(READ);
    expect(ws.getCell("A135").value).toBeNull();
    expect(values(ws, 136)[0]).toBe("3 invoices’ lines don’t add up to the invoice:");
    // In the Shipments sheet's order: Oct 2, Oct 6, Oct 7.
    expect([137, 138, 139].map((r) => ws.getCell(`A${r}`).value)).toEqual([
      "IN1000180353: Sage has no lines for this invoice. Item lines less their discounts come to 0.00 CAD; the invoice’s product value is 16,588.00 CAD.",
      "IN1000180370: Charges come to 18.35 CAD; the invoice’s other charges are 19.35 CAD.",
      "IN1000180368: Item lines less their discounts come to 4,442.40 CAD; the invoice’s product value is 7,164.80 CAD.",
    ]);
    expect(ws.getCell("A136").font).toMatchObject({ name: "Arial", size: 10, italic: true });
    expect(ws.rowCount).toBe(139);
    // Without those three invoices every one adds up, and it says so. 368 had one line and 370 two: 130 rows.
    const off = ["IN1000180353", "IN1000180368", "IN1000180370"];
    const lines = SHIPMENT_LINES.filter((l) => !off.includes(l.invoice));
    const all = await build({ access: "read", missing: [], lines }, DATASETS.shipments.filter((s) => !off.includes(s.invoice)));
    expect(lines).toHaveLength(130);
    // The month's last invoice (Oct 13) ends the rows.
    expect([all.ws.getCell("A131").value, all.ws.getCell("A132").value]).toEqual(["IN1000180418", null]);
    expect(all.ws.getCell("A133").value).toBe("Every invoice’s lines add up to the invoice, to the cent.");
    expect(all.ws.rowCount).toBe(133);
    // One invoice off (370, without its freight line): the singular.
    const one = await build(
      { access: "read", missing: [], lines: SHIPMENT_LINES.filter((l) => l.invoice !== "IN1000180368" && (l.invoice !== "IN1000180370" || l.kind === "item")) },
      DATASETS.shipments.filter((s) => !["IN1000180353", "IN1000180368"].includes(s.invoice))
    );
    expect(one.ws.getCell(`A${1 + 131 + 2}`).value).toBe("1 invoice’s lines don’t add up to the invoice:");
    expect(one.ws.getCell(`A${1 + 131 + 3}`).value).toBe("IN1000180370: Charges come to 0.00 CAD; the invoice’s other charges are 19.35 CAD.");
  });

  it("says why when the lines are waiting for read access, or the run has none", async () => {
    const waiting = await build({ access: "missing", missing: ["sage.oe_invoice_header.invuniq", "sage.oe_invoice_detail.invdisc"], lines: [] });
    expect(String(waiting.ws.getCell("A1").value)).toBe(
      "Item details are waiting for read access to Sage invoice lines. The reporting login can’t read sage.oe_invoice_header (invuniq); " +
        "sage.oe_invoice_detail (invdisc). A database administrator grants it with docs/modules/reporting-goals/readonly-grants-shipment-lines.sql, " +
        "and the next refresh fills this sheet in."
    );
    expect(waiting.ws.rowCount).toBe(1);
    for (const none of [null, undefined]) {
      const sheet = (await build(none)).ws;
      expect(sheet.getCell("A1").value).toBe("This refresh has no invoice lines yet. They fill in at the next refresh.");
      expect(sheet.getCell("A1").font).toMatchObject({ name: "Arial", size: 10, italic: true });
    }
  });
});

// ─── LibreOffice ────────────────────────────────────────────────────────────

const SOFFICE = spawnSync("soffice", ["--version"], { encoding: "utf8" }).status === 0;
const SKIP_REASON = "soffice (LibreOffice) is not installed here, as in CI; run this test where it is";
if (!SOFFICE) console.warn(`[reporting-goals-shipment-lines-export] The LibreOffice recalculation test is skipped: ${SKIP_REASON}.`);
const ERROR_VALUE = /^(#REF!|#VALUE!|#NAME\?|#DIV\/0!|#N\/A|#NUM!|#NULL!|Err:\d+)/;

describe("recalculated by LibreOffice (soffice --headless --convert-to xlsx)", () => {
  it("has no formula errors on any sheet with the lines in, and keeps every line", async (ctx) => {
    ctx.skip(!SOFFICE, SKIP_REASON);
    const dir = mkdtempSync(path.join(tmpdir(), "plx-goals-lines-"));
    try {
      writeFileSync(path.join(dir, "lines.xlsx"), (await build(READ)).buffer);
      const out = path.join(dir, "out");
      const run = spawnSync(
        "soffice",
        [`-env:UserInstallation=${pathToFileURL(path.join(dir, "profile")).href}`, "--headless", "--convert-to", "xlsx", "--outdir", out, path.join(dir, "lines.xlsx")],
        { encoding: "utf8", timeout: 120_000 }
      );
      expect(run.status, run.stderr).toBe(0);
      const wb = await readXlsx(readFileSync(path.join(out, "lines.xlsx")));
      expect(wb.worksheets.map((s) => s.name)).toEqual([...WORKBOOK_SHEETS]);
      const errors: string[] = [];
      for (const ws of wb.worksheets) {
        ws.eachRow((row) =>
          row.eachCell((cell) => {
            const result: unknown = formulaOf(cell) === undefined ? cell.value : cell.result;
            const error =
              result !== null && typeof result === "object" && "error" in result
                ? String((result as { error: unknown }).error)
                : typeof result === "string" && ERROR_VALUE.test(result)
                  ? result
                  : null;
            if (error) errors.push(`${ws.name}!${cell.address} ${error}`);
          })
        );
      }
      expect(errors).toEqual([]);
      const ws = wb.getWorksheet("Shipment lines")!;
      let sum = 0;
      for (let r = 2; r <= 134; r += 1) sum += Number(ws.getCell(`J${r}`).value);
      expect(sum.toFixed(2)).toBe(SHIPMENT_LINES.reduce((n, l) => n + Number(l.amount), 0).toFixed(2));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
