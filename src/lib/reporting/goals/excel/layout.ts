// The Goals & Production workbook contract shared by the export (TASK-2898)
// and the import (TASK-2897): sheet names and order, the file name, the
// "Manual entries" sheet the import reads, and the house styles. Taken from
// the prototype workbook (PLX goals and production 2026-10-14.xlsx). Pure.

import type { IsoDate } from "../types";

/** Sheets, in order. */
export const WORKBOOK_SHEETS = ["Read me", "Goals", "Daily", "Truckloads", "Batches", "Shipments", "Shipment lines", "Forecast", "Manual entries"] as const;
export type WorkbookSheet = (typeof WORKBOOK_SHEETS)[number];

/** "PLX goals and production 2026-10-14.xlsx". */
export function workbookFileName(today: IsoDate): string {
  return `PLX goals and production ${today}.xlsx`;
}

// ─── The "Manual entries" sheet (the import template) ──────────────────────

export const ENTRIES_SHEET: WorkbookSheet = "Manual entries";

/** Columns A–M in order. The import rejects a file whose header row differs. */
export const ENTRY_COLUMNS = [
  { key: "entryId", header: "Entry ID" },
  { key: "type", header: "Type" },
  { key: "date", header: "Date" },
  { key: "reference", header: "Reference" },
  { key: "customer", header: "Customer" },
  { key: "product", header: "Product" },
  { key: "kg", header: "kg" },
  { key: "productValue", header: "Product value" },
  { key: "freight", header: "Freight" },
  { key: "currency", header: "Currency" },
  { key: "note", header: "Note" },
  { key: "enteredBy", header: "Entered by" },
  { key: "status", header: "Dashboard status (not imported)" },
] as const;
export type EntryColumnKey = (typeof ENTRY_COLUMNS)[number]["key"];

/** Columns the import ignores: the status is computed, and the uploader is recorded instead of "Entered by". */
export const IGNORED_ON_IMPORT: readonly EntryColumnKey[] = ["enteredBy", "status"];

export const ENTRY_HEADER_ROW = 1;
export const ENTRY_FIRST_ROW = 2;
/** The export formats (and validates) blank rows down to here. */
export const ENTRY_LAST_FORMATTED_ROW = 200;
/** The import refuses files with more entry rows than this. */
export const MAX_IMPORT_ROWS = 1000;

export const ENTRY_TYPES = ["Batch", "Shipment"] as const;
export const ENTRY_CURRENCIES = ["CAD", "USD"] as const;

// ─── House styles (ARGB) ────────────────────────────────────────────────────

export const FONT_NAME = "Arial";
export const FONT_SIZE = 10;
export const TITLE_SIZE = 14;
/** Header rows: bold on light grey, frozen below. */
export const HEADER_FILL = "FFE7E6E6";
/** Everything entered by hand, and the "Manual entries" headers. */
export const AMBER_FILL = "FFFFF2CC";
export const AMBER_FONT = "FF7F6000";

export const COUNT_FORMAT = "#,##0";
export const DOLLAR_FORMAT = '"$"#,##0;("$"#,##0);"-"';
