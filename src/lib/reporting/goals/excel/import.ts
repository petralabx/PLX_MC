// The "Manual entries" import (TASK-2897): reading the uploaded workbook and
// planning what it would change. readEntriesSheet reads the "Manual entries"
// sheet — and no other — once its header row is exactly the export's
// (layout.ts). planImport works out what replacing the entry list with the
// sheet would do: a row without an Entry ID is added, a row whose Entry ID
// names a current entry changes it when a value differs, and a current entry
// missing from the sheet is removed. "Entered by" and "Dashboard status" are
// ignored (the uploader is recorded; the status is computed). Every row is
// checked with the form's own validation, and any problem stops the whole
// import. Nothing is written here: entries.ts stores the plan and applies it
// on confirm. Server-only (exceljs, loaded only when a workbook is read);
// planImport itself is pure.

import type ExcelJS from "exceljs";

import {
  changedFields,
  entryValuesOf,
  validateEntry,
  type DraftValue,
  type EntryDraft,
  type EntryField,
  type EntryFields,
  type EntryValues,
} from "../entry-input";
import { ENTRY_STATUS_LABELS, entryStatus, type EntryContext } from "../rules";
import type { EntryStatus, ManualEntry } from "../types";
import {
  ENTRIES_SHEET,
  ENTRY_COLUMNS,
  ENTRY_FIRST_ROW,
  ENTRY_HEADER_ROW,
  IGNORED_ON_IMPORT,
  MAX_IMPORT_ROWS,
  type EntryColumnKey,
} from "./layout";

export type ImportFileErrorCode = "unreadable_file" | "missing_sheet" | "header_mismatch" | "too_many_rows";

/** The file as a whole can't be imported (as opposed to rows with mistakes in them). */
export class ImportFileError extends Error {
  constructor(
    public code: ImportFileErrorCode,
    message: string
  ) {
    super(message);
  }
}

/** A problem on one row, worded for the person fixing the sheet. */
export interface RowError {
  row: number;
  field: EntryField | "entryId";
  message: string;
}

export interface SheetRow {
  /** The worksheet row number; entries start on row 2. */
  row: number;
  /** As typed, upper-cased; null when blank (a new entry). */
  entryId: string | null;
  draft: EntryDraft;
  /** Cells with no value to read (#N/A, or a formula that was never calculated). */
  unreadable: Omit<RowError, "row">[];
}

// ─── Reading the sheet ───────────────────────────────────────────────────────

type CellRead = { value: DraftValue } | { unreadable: string };

function readValue(value: ExcelJS.CellValue): CellRead {
  if (value === null || value === undefined) return { value: null };
  if (typeof value === "string" || typeof value === "number") return { value };
  if (typeof value === "boolean") return { value: value ? "TRUE" : "FALSE" };
  if (value instanceof Date) return { value };
  if ("error" in value) return { unreadable: `shows ${value.error}` };
  if ("richText" in value) return { value: value.richText.map((part) => part.text).join("") };
  if ("hyperlink" in value) return { value: value.text };
  return { unreadable: "can’t be read" };
}

/** A cell's value; a formula's is its calculated result (exceljs keeps a calculated 0 only in cell.result). */
function readCell(cell: ExcelJS.Cell): CellRead {
  const value = cell.value;
  if (value !== null && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
    const result = cell.result as ExcelJS.CellValue;
    return result === undefined || result === null ? { unreadable: "is a formula that was never calculated" } : readValue(result);
  }
  return readValue(value);
}

function textOf(read: CellRead): string {
  if (!("value" in read) || read.value === null || read.value === undefined) return "";
  return (read.value instanceof Date ? read.value.toISOString().slice(0, 10) : String(read.value)).trim();
}

/** A, B, … Z, AA, … */
function columnName(column: number): string {
  let name = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const HEADER_HELP = "Keep the header row exactly as Export to Excel writes it.";

function checkHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(ENTRY_HEADER_ROW);
  for (const [index, column] of ENTRY_COLUMNS.entries()) {
    const found = textOf(readCell(header.getCell(index + 1)));
    if (found !== column.header) {
      throw new ImportFileError(
        "header_mismatch",
        `The header row isn’t the export’s: column ${columnName(index + 1)} should be “${column.header}” but ${found ? `is “${found}”` : "is empty"}. ${HEADER_HELP}`
      );
    }
  }
  let extra: { column: number; text: string } | null = null;
  header.eachCell({ includeEmpty: false }, (cell, column) => {
    const text = textOf(readCell(cell));
    if (!extra && column > ENTRY_COLUMNS.length && text) extra = { column, text };
  });
  const added = extra as { column: number; text: string } | null;
  if (added) {
    throw new ImportFileError(
      "header_mismatch",
      `The header row isn’t the export’s: column ${columnName(added.column)} has the heading “${added.text}”, but the export ends at column ${columnName(ENTRY_COLUMNS.length)}. ${HEADER_HELP}`
    );
  }
}

const isBlank = (value: DraftValue) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** One sheet row, or null when every imported column is blank (the export formats empty rows down to row 200). */
function readRow(row: ExcelJS.Row, rowNumber: number): SheetRow | null {
  const draft: EntryDraft = {};
  const unreadable: SheetRow["unreadable"] = [];
  let entryId: string | null = null;
  let blank = true;
  for (const [index, column] of ENTRY_COLUMNS.entries()) {
    const key: EntryColumnKey = column.key;
    if (IGNORED_ON_IMPORT.includes(key)) continue;
    const read = readCell(row.getCell(index + 1));
    if ("unreadable" in read) {
      blank = false;
      unreadable.push({
        field: key as EntryField | "entryId",
        message: `${column.header} ${read.unreadable}. Type the value in instead.`,
      });
      continue;
    }
    if (isBlank(read.value)) continue;
    blank = false;
    if (key === "entryId") entryId = textOf(read).toUpperCase();
    else draft[key as EntryField] = read.value;
  }
  return blank ? null : { row: rowNumber, entryId, draft, unreadable };
}

/**
 * exceljs itself, loaded on first use: it takes about 0.35 s, and every goals
 * route imports this module through the barrel. Node hands a CommonJS package
 * over as `default`, a bundler may hand over its exports directly.
 */
async function loadExcelJS(): Promise<typeof ExcelJS> {
  const mod = await import("exceljs");
  return (mod as { default?: typeof ExcelJS }).default ?? mod;
}

/**
 * The "Manual entries" rows of an uploaded workbook, blank rows skipped. Throws
 * ImportFileError when the file isn't a readable .xlsx, has no such sheet, has
 * a header row that differs from the export's, or holds more than
 * MAX_IMPORT_ROWS entries.
 */
export async function readEntriesSheet(bytes: Uint8Array): Promise<SheetRow[]> {
  const { Workbook } = await loadExcelJS();
  const workbook = new Workbook();
  try {
    // exceljs types its input as ArrayBuffer; at run time it takes a Node Buffer or Uint8Array (JSZip).
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError(
      "unreadable_file",
      "This file isn’t an Excel workbook (.xlsx) that can be read. Use the workbook from Export to Excel."
    );
  }
  const sheet = workbook.getWorksheet(ENTRIES_SHEET);
  if (!sheet) {
    throw new ImportFileError("missing_sheet", `The workbook has no “${ENTRIES_SHEET}” sheet. Use the workbook from Export to Excel.`);
  }
  checkHeader(sheet);
  const rows: SheetRow[] = [];
  let entryRows = 0;
  for (let r = ENTRY_FIRST_ROW; r <= sheet.rowCount; r += 1) {
    const read = readRow(sheet.getRow(r), r);
    if (!read) continue;
    entryRows += 1;
    if (entryRows <= MAX_IMPORT_ROWS) rows.push(read);
  }
  if (entryRows > MAX_IMPORT_ROWS) {
    throw new ImportFileError(
      "too_many_rows",
      `The sheet has ${entryRows.toLocaleString("en-US")} entry rows; an import can hold at most ${MAX_IMPORT_ROWS.toLocaleString("en-US")}.`
    );
  }
  return rows;
}

// ─── Planning ────────────────────────────────────────────────────────────────

interface Evaluated {
  status: EntryStatus;
  statusLabel: string;
}

/** A row without an Entry ID: added, with the next free ID, on confirm. */
export interface PlannedAdd extends Evaluated {
  row: number;
  fields: EntryFields;
}

/** A row whose values differ from the entry it names. */
export interface PlannedChange extends Evaluated {
  row: number;
  entryId: string;
  before: EntryValues;
  fields: EntryFields;
  changed: EntryField[];
}

/** A current entry the sheet no longer has (soft-deleted on confirm); the status is what it has now. */
export interface PlannedRemoval extends Evaluated {
  entryId: string;
  before: EntryValues;
}

export interface ImportPlan {
  /** Entry rows read from the sheet. */
  rows: number;
  add: PlannedAdd[];
  change: PlannedChange[];
  remove: PlannedRemoval[];
  unchanged: number;
}

export type PlanResult = { ok: true; plan: ImportPlan } | { ok: false; errors: RowError[] };

/** Row errors listed in the rejection (one per line after the first). */
export const LISTED_ROW_ERRORS = 50;

/** The rejection message: what happened on the first line, then "Row 5: …" per problem. */
export function rowErrorsMessage(errors: readonly RowError[]): string {
  const rows = new Set(errors.map((e) => e.row)).size;
  const problems = `${errors.length} problem${errors.length === 1 ? "" : "s"} on ${rows} row${rows === 1 ? "" : "s"}`;
  const lines = errors.slice(0, LISTED_ROW_ERRORS).map((e) => `Row ${e.row}: ${e.message}`);
  const more = errors.length - lines.length;
  return [
    `Nothing was imported: ${problems}. Fix them in the file and upload it again.`,
    ...lines,
    ...(more > 0 ? [`…and ${more} more.`] : []),
  ].join("\n");
}

function evaluate(entry: ManualEntry, ctx: EntryContext): Evaluated {
  const status = entryStatus(entry, ctx);
  return { status, statusLabel: ENTRY_STATUS_LABELS[status] };
}

/** The fields as an entry, so the status rules can judge them. */
function asEntry(entryId: string, fields: EntryFields, like?: ManualEntry): ManualEntry {
  return {
    entryId,
    ...fields,
    customerCode: like?.customerCode ?? null,
    enteredBy: like?.enteredBy ?? "",
    enteredAt: like?.enteredAt ?? "",
    updatedBy: like?.updatedBy ?? "",
    updatedAt: like?.updatedAt ?? "",
    source: like?.source ?? "",
  };
}

/**
 * What importing these rows would do to the current entries, each with the
 * status it would get (`ctx`: the latest refresh's month and references). Any
 * row problem — a value the form would refuse, an unreadable cell, an Entry ID
 * that isn't a current entry or that appears twice — fails the whole plan.
 */
export function planImport(rows: readonly SheetRow[], current: readonly ManualEntry[], ctx: EntryContext): PlanResult {
  const errors: RowError[] = [];
  const byId = new Map(current.map((entry) => [entry.entryId.toUpperCase(), entry]));
  const firstRow = new Map<string, number>();
  const kept = new Set<string>();
  const add: PlannedAdd[] = [];
  const change: PlannedChange[] = [];
  let unchanged = 0;

  for (const sheetRow of rows) {
    const { row } = sheetRow;
    const rowErrors: RowError[] = sheetRow.unreadable.map((problem) => ({ row, ...problem }));
    let target: ManualEntry | null = null;
    if (sheetRow.entryId !== null) {
      const id = sheetRow.entryId;
      const first = firstRow.get(id);
      target = byId.get(id) ?? null;
      if (first !== undefined) {
        rowErrors.push({ row, field: "entryId", message: `Entry ID ${id} is also on row ${first}. Each entry can appear once.` });
      } else {
        firstRow.set(id, row);
        if (!target) {
          rowErrors.push({
            row,
            field: "entryId",
            message: `Entry ID ${id} isn’t one of the current entries (it may have been deleted). Clear it to add this row as a new entry.`,
          });
        }
      }
      if (target) kept.add(target.entryId);
    }
    const reported = new Set(sheetRow.unreadable.map((problem) => problem.field));
    const checked = validateEntry(sheetRow.draft);
    if (!checked.ok) {
      for (const error of checked.errors) if (!reported.has(error.field)) rowErrors.push({ row, ...error });
    }
    if (rowErrors.length > 0 || !checked.ok) {
      errors.push(...rowErrors);
      continue;
    }
    const fields = checked.value;
    if (!target) {
      add.push({ row, fields, ...evaluate(asEntry(`row ${row}`, fields), ctx) });
      continue;
    }
    const before = entryValuesOf(target);
    const changed = changedFields(before, entryValuesOf(fields));
    if (changed.length === 0) unchanged += 1;
    else change.push({ row, entryId: target.entryId, before, fields, changed, ...evaluate(asEntry(target.entryId, fields, target), ctx) });
  }

  if (errors.length > 0) return { ok: false, errors };
  const remove: PlannedRemoval[] = current
    .filter((entry) => !kept.has(entry.entryId))
    .map((entry) => ({ entryId: entry.entryId, before: entryValuesOf(entry), ...evaluate(entry, ctx) }));
  return { ok: true, plan: { rows: rows.length, add, change, remove, unchanged } };
}
