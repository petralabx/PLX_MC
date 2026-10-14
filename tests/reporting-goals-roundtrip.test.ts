// The round-trip guarantee (brief, Import step 6): the workbook Export to Excel
// writes (excel/export.ts), read back by the import (excel/import.ts), plans no
// change at all. A cell changed in Excel is the one change, a cleared row the
// one removal, a typed row the one addition, and a renamed header rejects the
// file. The real writer and reader on the 2026-10-14 fixture: M1–M7 (M006 is
// dated last month), plus a shipment picked from Sage's customer list (its code
// isn't in the sheet) with cents of freight, and a batch weighed to the gram.

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  ENTRIES_SHEET,
  ENTRY_FIRST_ROW,
  ImportFileError,
  buildGoalsWorkbook,
  planImport,
  readEntriesSheet,
  type EntryContext,
  type ImportPlan,
} from "@/lib/reporting/goals";

import { DATASETS, ENTRIES, RATE, RUN, SETTINGS, TODAY, goalsPage, manualEntry, refsOf } from "./reporting-goals-helpers";

const CTX: EntryContext = {
  monthStart: "2026-10-01",
  monthEnd: "2026-10-31",
  filemakerRefs: refsOf("filemaker"),
  sageRefs: refsOf("sage"),
};

const LIVE = [
  ...ENTRIES,
  manualEntry({
    entryId: "M008",
    type: "Shipment",
    date: TODAY,
    customer: "Tiger Hospitality LLC DBA of A1 American",
    customerCode: "A1TEXT11",
    productValue: "19000.00",
    freight: "0.50",
    currency: "USD",
    note: "Picked from the list",
  }),
  manualEntry({ entryId: "M009", type: "Batch", date: TODAY, reference: "BC-26299Q", kg: "7500.250", product: "Hand soap" }),
];

async function exported(): Promise<Buffer> {
  return buildGoalsWorkbook({
    run: RUN,
    model: goalsPage({}, LIVE).model!,
    settings: SETTINGS,
    shipments: DATASETS.shipments,
    truckloads: DATASETS.truckloads,
    rates: [{ date: TODAY, rate: RATE }],
    exportedAt: new Date("2026-10-14T14:42:00Z"),
  });
}

/** The exported file after someone edits its "Manual entries" sheet in Excel and saves it. */
async function edited(edit: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(await exported()).buffer);
  edit(wb.getWorksheet(ENTRIES_SHEET)!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function plan(bytes: Buffer): Promise<ImportPlan> {
  const planned = planImport(await readEntriesSheet(bytes), LIVE, CTX);
  if (!planned.ok) throw new Error(planned.errors.map((e) => `row ${e.row}: ${e.message}`).join("\n"));
  return planned.plan;
}

/** The sheet row an entry was exported on. */
function rowOf(sheet: ExcelJS.Worksheet, entryId: string): ExcelJS.Row {
  for (let r = ENTRY_FIRST_ROW; r <= sheet.rowCount; r += 1) if (sheet.getCell(r, 1).value === entryId) return sheet.getRow(r);
  throw new Error(`${entryId} isn't on the sheet`);
}

describe("export, then import", () => {
  it("an unchanged export plans no change at all", async () => {
    expect(await plan(await exported())).toEqual({ rows: LIVE.length, add: [], change: [], remove: [], unchanged: LIVE.length });
  });

  it("a value changed in Excel is the one change", async () => {
    const result = await plan(await edited((sheet) => (rowOf(sheet, "M007").getCell(8).value = 6000)));
    expect(result.change).toEqual([expect.objectContaining({ entryId: "M007", changed: ["productValue"] })]);
    expect(result.change[0].fields.productValue).toBe("6000.00");
    expect([result.add, result.remove, result.unchanged]).toEqual([[], [], LIVE.length - 1]);
  });

  it("a cleared row is the one removal, and a typed row the one addition", async () => {
    const result = await plan(
      await edited((sheet) => {
        rowOf(sheet, "M003").eachCell({ includeEmpty: true }, (cell) => (cell.value = null));
        const blank = sheet.getRow(ENTRY_FIRST_ROW + LIVE.length);
        blank.getCell(2).value = "Batch";
        blank.getCell(3).value = new Date(Date.UTC(2026, 9, 14));
        blank.getCell(4).value = "BC-26301A";
        blank.getCell(7).value = 9800;
      })
    );
    expect(result.remove.map((r) => r.entryId)).toEqual(["M003"]);
    expect(result.add).toEqual([
      expect.objectContaining({ fields: expect.objectContaining({ type: "Batch", date: TODAY, reference: "BC-26301A", kg: "9800.000" }) }),
    ]);
    expect([result.change, result.unchanged]).toEqual([[], LIVE.length - 1]);
  });

  it("rejects the file when its header row was changed", async () => {
    const bytes = await edited((sheet) => (sheet.getCell(1, 1).value = "ID"));
    await expect(readEntriesSheet(bytes)).rejects.toMatchObject({ code: "header_mismatch" });
    await expect(readEntriesSheet(bytes)).rejects.toBeInstanceOf(ImportFileError);
  });
});
