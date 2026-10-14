// Workbooks for the Goals & Production import tests (TASK-2897), built with
// exceljs from the shared layout (excel/layout.ts) the way the export writes
// them: every sheet in order, the "Manual entries" header on row 1, entries
// from row 2 with real date cells and plain numbers, then blank formatted rows
// down to row 200. Used by the unit, Postgres and browser specs.
// Not a test file (no .test.ts).

import ExcelJS from "exceljs";

import { ENTRIES_SHEET, ENTRY_COLUMNS, ENTRY_LAST_FORMATTED_ROW, WORKBOOK_SHEETS } from "@/lib/reporting/goals/excel/layout";
import type { ManualEntry } from "@/lib/reporting/goals/types";

export type SheetCell = ExcelJS.CellValue;

export const ENTRY_HEADERS: string[] = ENTRY_COLUMNS.map((column) => column.header);

/** A date cell as the export writes it (UTC midnight; exceljs reads it back the same way). */
export const excelDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const num = (value: string | null) => (value === null ? null : Number(value));

/** One entry as a sheet row: A–M, with the dashboard status in M (the import ignores it, and "Entered by"). */
export function entryRow(entry: ManualEntry, status = "Counted"): SheetCell[] {
  return [
    entry.entryId,
    entry.type,
    entry.date ? excelDate(entry.date) : null,
    entry.reference,
    entry.customer,
    entry.product,
    num(entry.kg),
    num(entry.productValue),
    num(entry.freight),
    entry.currency,
    entry.note,
    entry.enteredBy,
    status,
  ];
}

export interface WorkbookOptions {
  /** Row 1 of the sheet; defaults to the export's headers. */
  header?: SheetCell[];
  /** Defaults to "Manual entries". */
  sheetName?: string;
}

/** The workbook as .xlsx bytes. */
export async function entriesWorkbook(rows: SheetCell[][], options: WorkbookOptions = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const name of WORKBOOK_SHEETS) {
    if (name === ENTRIES_SHEET) continue;
    // Look-alike content elsewhere must never be imported.
    const other = workbook.addWorksheet(name);
    other.addRow(ENTRY_HEADERS);
    other.addRow(["M900", "Batch", excelDate("2026-10-01"), "BC-OTHER-SHEET", null, null, 9999]);
  }
  const sheet = workbook.addWorksheet(options.sheetName ?? ENTRIES_SHEET);
  sheet.addRow(options.header ?? ENTRY_HEADERS);
  for (const row of rows) sheet.addRow(row);
  sheet.getColumn(3).numFmt = "yyyy-mm-dd";
  sheet.getColumn(7).numFmt = "#,##0";
  for (const column of [8, 9]) sheet.getColumn(column).numFmt = '"$"#,##0.00';
  // The export formats blank rows down to row 200: styled, no values.
  for (let r = rows.length + 2; r <= ENTRY_LAST_FORMATTED_ROW; r += 1) {
    sheet.getCell(r, 3).numFmt = "yyyy-mm-dd";
    sheet.getCell(r, 2).font = { name: "Arial", size: 10 };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
