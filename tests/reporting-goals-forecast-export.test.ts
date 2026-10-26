// The workbook's Forecast sheet (TASK-3151; customer class and item category
// columns, TASK-3177), built from the 2026-10-14 fixture's
// page model (M1–M7 entered) and read back with exceljs: its place before the
// import template, the house styles, the order rows as values and every total
// and number as a formula; then recalculated by LibreOffice — no formula errors
// on any sheet, and the page's four numbers to the cent. That test skips, saying
// why, where soffice isn't installed (CI). The rest of the workbook is tested in
// tests/reporting-goals-export.test.ts.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  COUNT_FORMAT,
  DOLLAR_FORMAT,
  HEADER_FILL,
  WORKBOOK_SHEETS,
  buildGoalsWorkbook,
  type ForecastReady,
  type ForecastView,
} from "@/lib/reporting/goals";
import { usdToCadFormula } from "@/lib/reporting/goals/excel/export";

import { DATASETS, FORECAST, RATE, RUN, SETTINGS, TODAY, goalsPage } from "./reporting-goals-helpers";

const PAGE = goalsPage();
const FORECAST_VIEW = PAGE.forecast as ForecastReady;

/** `forecast` undefined: the workbook built without one (as before TASK-3151). */
async function build(forecast: ForecastView | null | undefined): Promise<{ buffer: Buffer; ws: ExcelJS.Worksheet; wb: ExcelJS.Workbook }> {
  const buffer = await buildGoalsWorkbook({
    run: RUN,
    model: PAGE.model!,
    settings: SETTINGS,
    shipments: DATASETS.shipments,
    truckloads: DATASETS.truckloads,
    rates: [{ date: TODAY, rate: RATE }],
    exportedAt: new Date("2026-10-14T14:42:00Z"),
    forecast,
  });
  const wb = await readXlsx(buffer);
  return { buffer, wb, ws: wb.getWorksheet("Forecast")! };
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

describe("the Forecast sheet", () => {
  it("sits after Shipments and before the import template, under a 14-point title", async () => {
    const { wb, ws } = await build(FORECAST_VIEW);
    expect(WORKBOOK_SHEETS.indexOf("Forecast")).toBe(WORKBOOK_SHEETS.indexOf("Manual entries") - 1);
    expect(wb.worksheets.map((s) => s.name)).toEqual([...WORKBOOK_SHEETS]);
    expect(ws.getCell("A1").value).toBe("Revenue forecast — October 2026");
    expect(ws.getCell("A1").font).toMatchObject({ name: "Arial", size: 14, bold: true });
    expect(String(ws.getCell("A2").value)).toContain("expected to ship by 2026-10-31 (overdue ones included)");
  });

  it("heads the numbers (row 3) and the order rows (row 6, frozen) in bold on grey", async () => {
    const { ws } = await build(FORECAST_VIEW);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
    expect((ws.getRow(3).values as unknown[]).slice(1)).toEqual([
      "Invoiced so far", "Ready", "Planned in time", "Late", "Not planned", "Theoretical", "At risk",
      "Hit rate (average)", "Realistic", "Working days covered", "Working days in the month", "Pace", "Target",
    ]);
    expect((ws.getRow(6).values as unknown[]).slice(1)).toEqual([
      "Expected", "Order", "Line", "Customer code", "Customer", "PO", "Item", "Description", "Still to ship", "Unit", "Unit price",
      "Currency", "Value", "CAD", "Bucket", "Assembly order", "AO scheduled", "AO status", "Bulk batch", "Batch status",
      "Customer class", "Item category",
    ]);
    for (const row of [3, 6]) {
      ws.getRow(row).eachCell((cell) => {
        expect(cell.font?.bold, cell.address).toBe(true);
        expect(fillOf(cell), cell.address).toBe(HEADER_FILL);
      });
    }
  });

  it("works the four numbers out with formulas over the rows and the Goals sheet", async () => {
    const { ws } = await build(FORECAST_VIEW);
    expect(
      Object.fromEntries(["A4", "B4", "C4", "D4", "E4", "F4", "G4", "H4", "I4", "J4", "K4", "L4", "M4"].map((a) => [a, formulaOf(ws.getCell(a))]))
    ).toEqual({
      A4: "Goals!$G$8",
      B4: 'SUMIFS($N$7:$N$24,$O$7:$O$24,"Ready")',
      C4: 'SUMIFS($N$7:$N$24,$O$7:$O$24,"Planned in time")',
      D4: 'SUMIFS($N$7:$N$24,$O$7:$O$24,"Late")',
      E4: 'SUMIFS($N$7:$N$24,$O$7:$O$24,"Not planned")',
      F4: "A4+B4+C4",
      G4: "D4+E4",
      H4: "AVERAGE(E28:E28)",
      I4: 'IF(ISNUMBER(H4),ROUND(A4+(B4+C4)*H4,2),"")',
      J4: "Goals!$B$21",
      K4: "Goals!$B$11",
      L4: 'IF(J4>0,ROUND(A4/J4*K4,2),"")',
      M4: "Goals!$B$16",
    });
    for (const a of ["A4", "B4", "F4", "G4", "I4", "L4", "M4"]) expect(ws.getCell(a).numFmt, a).toBe(DOLLAR_FORMAT);
    expect(ws.getCell("J4").numFmt).toBe(COUNT_FORMAT);
  });

  it("lists the page's rows as values, with CAD converted by formula and each row's bucket", async () => {
    const { ws } = await build(FORECAST_VIEW);
    const rows = FORECAST_VIEW.rows;
    expect(rows).toHaveLength(18);
    rows.forEach((r, i) => {
      const n = 7 + i;
      expect(ws.getCell(`A${n}`).value).toEqual(utcDay(r.expected));
      expect([ws.getCell(`B${n}`).value, ws.getCell(`I${n}`).value, ws.getCell(`L${n}`).value, ws.getCell(`M${n}`).value]).toEqual([
        r.orderNo,
        r.qty,
        r.currency,
        r.valueCents / 100,
      ]);
      expect(formulaOf(ws.getCell(`N${n}`))).toBe(`IF(L${n}="CAD",M${n},IF(L${n}="USD",${usdToCadFormula(`M${n}`)},""))`);
      expect(ws.getCell(`P${n}`).value).toBe(r.ao?.number ?? null);
      expect([ws.getCell(`U${n}`).value, ws.getCell(`V${n}`).value]).toEqual([r.customerClass, r.category]);
    });
    expect(ws.getCell("K10").value).toBe(2.25);
    expect(ws.getCell("O10").value).toBe("Planned in time");
    expect(ws.getCell("Q7").value).toEqual(utcDay("2026-10-06"));
  });

  it("lists the hit rate by month under the rows, then the notes", async () => {
    const { ws } = await build(FORECAST_VIEW);
    expect(ws.getCell("A26").value).toBe("Hit rate by month");
    expect((ws.getRow(28).values as unknown[]).slice(1, 5)).toEqual(["September 2026", "Run #20, 2026-09-01", 1_187_500, 950_000]);
    expect(formulaOf(ws.getCell("E28"))).toBe("D28/C28");
    expect(String(ws.getCell("A30").value)).toContain("2 assembly orders scheduled this month (8,400 pieces) match no open Sage order line");
    expect(String(ws.getCell("A31").value)).toContain("Not converted: EUR 2,100.00 in 1 row.");
  });

  it("ends each row with its customer class and item category, after the columns the formulas read (TASK-3177)", async () => {
    const { ws } = await build(FORECAST_VIEW);
    expect([ws.getCell("U7").value, ws.getCell("V7").value]).toEqual(["Exclusive Manufacturing", "PLABEL"]);
    // Soapbox (SOAP11) isn't on the workbook's class list; FP-1414 has no category in Sage.
    expect(ws.getCell("U10").value).toBe("Unclassified");
    const noCategory = 7 + FORECAST_VIEW.rows.findIndex((r) => r.item === "FP-1414");
    expect([ws.getCell(`G${noCategory}`).value, ws.getCell(`V${noCategory}`).value]).toEqual(["FP-1414", null]);
    // Read: no note about categories, so the rounding note stays the last line.
    expect(String(ws.getCell("A32").value)).toContain("CAD is rounded to the cent half to even, as on the page.");
    // The run counted no assembly order whose FileMaker quantity isn't a number, so there's no note for it (TASK-3791).
    expect(ws.getColumn(1).values.some((v) => String(v).includes("a quantity in FileMaker"))).toBe(false);
  });

  it("writes Sage's space-padded category trimmed in column V, and a blank one as empty (TASK-3189)", async () => {
    const lines = FORECAST.data.lines.map((l, i) => (i === 0 ? { ...l, category: "AMEN  " } : i === 1 ? { ...l, category: "      " } : l));
    const view = goalsPage({}, undefined, { ...FORECAST, data: { ...FORECAST.data, lines } }).forecast as ForecastReady;
    const { ws } = await build(view);
    const vOf = (orderNo: string, item: string) => ws.getCell(`V${7 + view.rows.findIndex((r) => r.orderNo === orderNo && r.item === item)}`).value;
    expect(vOf(lines[0].orderNo, lines[0].item)).toBe("AMEN");
    expect(vOf(lines[1].orderNo, lines[1].item)).toBeNull();
  });

  it("says under the rows when item categories wait for read access, or for the next refresh", async () => {
    const view = (categoryMissing: string[] | null) =>
      goalsPage({}, undefined, { ...FORECAST, data: { ...FORECAST.data, categoryMissing } }).forecast;
    const waiting = await build(view(["sage.oe_order_detail.category"]));
    expect(String(waiting.ws.getCell("A32").value)).toBe(
      "Item category is blank: the reporting login can’t read sage.oe_order_detail.category yet. A database administrator " +
        "grants it by re-running docs/modules/reporting-goals/readonly-grants-forecast.sql."
    );
    expect(String(waiting.ws.getCell("A33").value)).toContain("CAD is rounded to the cent half to even, as on the page.");
    const older = await build(view(null));
    expect(older.ws.getCell("A32").value).toBe("Item categories fill in at the next refresh.");
  });

  it("says under the rows how many assembly orders have a FileMaker quantity that isn't a number (TASK-3791)", async () => {
    const page = goalsPage();
    const forecast = page.forecast?.state === "ready" ? { ...page.forecast, aoQtyUnreadable: 3 } : null;
    const { ws } = await build(forecast);
    expect(ws.getColumn(1).values).toContain(
      "3 assembly orders have a quantity in FileMaker that isn’t a number, so they cover no order line; those lines count as Not planned."
    );
  });

  it("says when Realistic will be measured, and leaves it blank", async () => {
    const page = goalsPage({}, undefined, { ...FORECAST, history: FORECAST.history.filter((p) => p.runId !== 20) });
    const { ws } = await build(page.forecast);
    expect(ws.getCell("H4").value).toBe("Not measured yet");
    expect(String(ws.getCell("A27").value)).toContain("measured from October 2026");
  });

  it("says why when the forecast is waiting for access or isn't in the run", async () => {
    const waiting = await build({ state: "waiting_for_access", missing: [{ relation: "sage.oe_order_header", columns: ["type", "expdate"] }] });
    expect(String(waiting.ws.getCell("A2").value)).toContain("Waiting for read access to Sage orders and FileMaker assembly orders");
    expect(String(waiting.ws.getCell("A2").value)).toContain("sage.oe_order_header (type, expdate)");
    expect(waiting.ws.rowCount).toBe(2);
    for (const state of [{ state: "not_in_run" } as const, undefined]) {
      const none = await build(state);
      expect(none.ws.getCell("A2").value).toBe("This refresh has no forecast yet. It fills in at the next refresh.");
    }
  });
});

// ─── LibreOffice ────────────────────────────────────────────────────────────

const SOFFICE = spawnSync("soffice", ["--version"], { encoding: "utf8" }).status === 0;
const SKIP_REASON = "soffice (LibreOffice) is not installed here, as in CI; run this test where it is";
if (!SOFFICE) console.warn(`[reporting-goals-forecast-export] The LibreOffice recalculation test is skipped: ${SKIP_REASON}.`);
const ERROR_VALUE = /^(#REF!|#VALUE!|#NAME\?|#DIV\/0!|#N\/A|#NUM!|#NULL!|Err:\d+)/;

describe("recalculated by LibreOffice (soffice --headless --convert-to xlsx)", () => {
  it("has no formula errors, and Forecast's numbers are the page's to the cent", async (ctx) => {
    ctx.skip(!SOFFICE, SKIP_REASON);
    const dir = mkdtempSync(path.join(tmpdir(), "plx-goals-forecast-"));
    try {
      writeFileSync(path.join(dir, "forecast.xlsx"), (await build(FORECAST_VIEW)).buffer);
      const out = path.join(dir, "out");
      const run = spawnSync(
        "soffice",
        [`-env:UserInstallation=${pathToFileURL(path.join(dir, "profile")).href}`, "--headless", "--convert-to", "xlsx", "--outdir", out, path.join(dir, "forecast.xlsx")],
        { encoding: "utf8", timeout: 120_000 }
      );
      expect(run.status, run.stderr).toBe(0);
      const wb = await readXlsx(readFileSync(path.join(out, "forecast.xlsx")));
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
      const ws = wb.getWorksheet("Forecast")!;
      const at = (a: string) => Number(ws.getCell(a).result);
      const f = FORECAST_VIEW;
      expect(at("A4")).toBeCloseTo(f.invoicedCents / 100, 6);
      expect([at("B4"), at("C4"), at("D4"), at("E4")].map((v) => v.toFixed(2))).toEqual(
        [f.buckets.ready, f.buckets.planned, f.buckets.late, f.buckets.not_planned].map((b) => (b.cents / 100).toFixed(2))
      );
      expect(at("F4")).toBeCloseTo(527_018.41, 6);
      expect(at("G4")).toBeCloseTo(40_703.25, 6);
      expect(at("H4")).toBeCloseTo(0.8, 12);
      expect(at("I4")).toBeCloseTo(f.realistic!.cents / 100, 6);
      expect(at("L4")).toBeCloseTo(f.pace!.cents / 100, 6);
      expect(at("M4")).toBe(1_000_000);
      // A row in another currency has no CAD and stays out of every total.
      expect(ws.getCell("N13").result ?? "").toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
