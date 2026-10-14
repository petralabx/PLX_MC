// exceljs, loaded on first use by the export and the import (TASK-2898,
// TASK-2897): it takes about 0.35 s to load, and every goals route imports the
// module barrel, so only writing or reading a workbook pays for it. Server-only.

import type ExcelJS from "exceljs";

/** exceljs itself: Node hands a CommonJS package over as `default`, a bundler may hand over its exports directly. */
export async function loadExcelJS(): Promise<typeof ExcelJS> {
  const mod = await import("exceljs");
  return (mod as { default?: typeof ExcelJS }).default ?? mod;
}
