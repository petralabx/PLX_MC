// Manual entries and the Excel import (TASK-2897), pure parts: the one
// validation the form, the routes and the import share; reading the
// "Manual entries" sheet (and only it) from a workbook built like the export;
// and the plan an import would apply — additions, changes and removals, each
// with the status it would get. Writes, audit and the routes are covered
// against Postgres in tests/reporting-goals-entries-postgres.test.ts.

import { describe, expect, it } from "vitest";

import {
  changedFields,
  entryValuesOf,
  plainDecimal,
  validateEntry,
  type EntryDraft,
} from "@/lib/reporting/goals/entry-input";
import { ImportFileError, planImport, readEntriesSheet, type SheetRow } from "@/lib/reporting/goals/excel/import";
import { MAX_IMPORT_ROWS } from "@/lib/reporting/goals/excel/layout";
import type { EntryContext } from "@/lib/reporting/goals/rules";

import { ENTRIES, refsOf } from "./reporting-goals-helpers";
import { ENTRY_HEADERS, entriesWorkbook, entryRow, excelDate, type SheetCell } from "./reporting-goals-workbook";

const CTX: EntryContext = {
  monthStart: "2026-10-01",
  monthEnd: "2026-10-31",
  filemakerRefs: refsOf("filemaker"),
  sageRefs: refsOf("sage"),
};

const batch = (over: EntryDraft = {}): EntryDraft => ({ type: "Batch", date: "2026-10-14", reference: "BC-26299Z", kg: "8000", ...over });
const shipment = (over: EntryDraft = {}): EntryDraft => ({
  type: "Shipment",
  date: "2026-10-14",
  reference: "PO-1",
  customer: "A1 American",
  productValue: "24500",
  freight: "1250",
  currency: "USD",
  ...over,
});

function errorsOf(draft: EntryDraft): string[] {
  const result = validateEntry(draft);
  return result.ok ? [] : result.errors.map((e) => `${e.field}: ${e.message}`);
}

describe("validateEntry", () => {
  it("accepts M1–M7 and stores exact decimals at the column's scale", () => {
    for (const entry of ENTRIES) expect(validateEntry(entry).ok, entry.entryId).toBe(true);
    const m3 = validateEntry(ENTRIES[2]);
    expect(m3).toEqual({
      ok: true,
      value: {
        type: "Shipment",
        date: "2026-10-14",
        reference: "PO0104001",
        customer: "A1 American",
        product: null,
        kg: null,
        productValue: "24500.00",
        freight: "1250.00",
        currency: "USD",
        note: "M3: full load",
      },
    });
    expect(validateEntry(ENTRIES[0])).toMatchObject({ ok: true, value: { kg: "10050.000" } });
  });

  it("trims text, treats blanks as empty, and reads type and currency in any case", () => {
    const result = validateEntry(shipment({ type: " shipment ", currency: "usd", reference: "  PO-1  ", note: "   ", freight: "" }));
    expect(result).toMatchObject({ ok: true, value: { type: "Shipment", currency: "USD", reference: "PO-1", note: null, freight: null } });
  });

  it("says what is missing for each type", () => {
    expect(errorsOf({})).toEqual([
      "type: Type is required: Batch or Shipment.",
      "date: Date is required: the day the batch finished or the shipment left.",
    ]);
    expect(errorsOf(batch({ kg: "" }))).toEqual(["kg: kg is required for a batch."]);
    expect(errorsOf(shipment({ productValue: null, currency: " " }))).toEqual([
      "productValue: Product value is required for a shipment: the value before tax and freight.",
      "currency: Currency is required for a shipment: CAD or USD.",
    ]);
    expect(errorsOf(batch({ type: "Pallet" }))).toEqual(["type: Type must be Batch or Shipment, not “Pallet”."]);
    expect(errorsOf(shipment({ currency: "EUR" }))).toEqual(["currency: Currency must be CAD or USD, not “EUR”."]);
  });

  it("takes real calendar dates and Excel date cells; another month is allowed", () => {
    expect(validateEntry(batch({ date: excelDate("2026-10-13") }))).toMatchObject({ ok: true, value: { date: "2026-10-13" } });
    expect(validateEntry(shipment({ date: "2026-09-30" }))).toMatchObject({ ok: true, value: { date: "2026-09-30" } });
    expect(errorsOf(batch({ date: "2026-02-30" }))).toEqual(["date: Date must be a real date like 2026-10-14, not “2026-02-30”."]);
    expect(errorsOf(batch({ date: "14/10/2026" }))).toEqual(["date: Date must be a real date like 2026-10-14, not “14/10/2026”."]);
    expect(errorsOf(batch({ date: 46309 }))).toEqual(["date: Date must be a date like 2026-10-14. Format the cell as a date."]);
    // "14" typed into a date-formatted cell is 1900-01-14.
    expect(errorsOf(batch({ date: excelDate("1900-01-14") }))).toEqual([
      "date: Date 1900-01-14 is outside 2000–2099. Use a date like 2026-10-14.",
    ]);
  });

  it("reads amounts exactly, never rounding them", () => {
    expect(validateEntry(batch({ kg: "10,050.5" }))).toMatchObject({ ok: true, value: { kg: "10050.500" } });
    expect(validateEntry(shipment({ productValue: "$24,500.10", freight: 0 }))).toMatchObject({
      ok: true,
      value: { productValue: "24500.10", freight: "0.00" },
    });
    // An Excel number cell: 24500.01 is not exactly representable, but it reads back as typed.
    expect(validateEntry(shipment({ productValue: 24500.01 }))).toMatchObject({ ok: true, value: { productValue: "24500.01" } });
    expect(errorsOf(shipment({ productValue: "24500.015" }))).toEqual(["productValue: Product value can have at most 2 decimal places."]);
    expect(errorsOf(batch({ kg: "1.0005" }))).toEqual(["kg: kg can have at most 3 decimal places."]);
    expect(errorsOf(batch({ kg: 0.0000001 }))).toEqual(["kg: kg can have at most 3 decimal places."]);
    expect(errorsOf(batch({ kg: "1e5" }))).toEqual(["kg: kg must be a number like 10050, not “1e5”."]);
    expect(errorsOf(batch({ kg: "10 050" }))).toEqual(["kg: kg must be a number like 10050, not “10 050”."]);
    expect(errorsOf(batch({ kg: "0" }))).toEqual(["kg: kg must be more than 0."]);
    expect(errorsOf(batch({ kg: -5 }))).toEqual(["kg: kg must be more than 0."]);
    expect(errorsOf(shipment({ productValue: "-1" }))).toEqual(["productValue: Product value can’t be negative."]);
    expect(errorsOf(shipment({ freight: "-0.01" }))).toEqual(["freight: Freight can’t be negative."]);
    expect(errorsOf(shipment({ productValue: "1000000000000" }))).toEqual(["productValue: Product value is too large."]);
    expect(validateEntry(shipment({ productValue: "0" }))).toMatchObject({ ok: true, value: { productValue: "0.00" } });
  });

  it("refuses a field of the other type instead of ignoring it", () => {
    expect(errorsOf(batch({ customer: "A1 American", productValue: "100", freight: "abc", currency: "CAD" }))).toEqual([
      "customer: Customer is only for shipments. Clear it, or put it in Note.",
      "productValue: Product value is only for shipments. Clear it, or change Type to Shipment.",
      "freight: Freight is only for shipments. Clear it, or change Type to Shipment.",
      "currency: Currency is only for shipments. Clear it, or change Type to Shipment.",
    ]);
    expect(errorsOf(shipment({ kg: "x" }))).toEqual(["kg: kg is only for batches. Clear it, or change Type to Batch."]);
  });

  it("caps text lengths and catches Excel turning text into dates", () => {
    expect(errorsOf(batch({ reference: "x".repeat(101) }))).toEqual(["reference: Reference is 101 characters; the limit is 100."]);
    expect(errorsOf(batch({ note: "n".repeat(1001) }))).toEqual(["note: Note is 1,001 characters; the limit is 1,000."]);
    expect(validateEntry(batch({ product: "p".repeat(200) })).ok).toBe(true);
    expect(errorsOf(batch({ reference: excelDate("2026-10-14") }))).toEqual([
      "reference: Reference looks like a date. Format the cell as text and type it again.",
    ]);
    expect(validateEntry(batch({ reference: 26286 }))).toMatchObject({ ok: true, value: { reference: "26286" } });
  });
});

describe("comparing entries", () => {
  it("compares stored and typed values in one canonical form", () => {
    const stored = { ...ENTRIES[0], kg: "10050.000" };
    expect(changedFields(entryValuesOf(ENTRIES[0]), entryValuesOf(stored))).toEqual([]);
    const typed = validateEntry({ ...entryValuesOf(stored), kg: "10,050", product: "Other" });
    if (!typed.ok) throw new Error("valid");
    expect(changedFields(entryValuesOf(stored), entryValuesOf(typed.value))).toEqual(["product"]);
  });

  it("shows decimals the way a person types them", () => {
    expect(["10050.000", "24500.50", "0.000", "12", null].map(plainDecimal)).toEqual(["10050", "24500.5", "0", "12", ""]);
  });
});

/** M1–M7 as the export writes them. */
const exported = (): SheetCell[][] => ENTRIES.map((entry) => entryRow(entry));

async function sheetRows(rows: SheetCell[][], options?: Parameters<typeof entriesWorkbook>[1]): Promise<SheetRow[]> {
  return readEntriesSheet(await entriesWorkbook(rows, options));
}

async function fileError(bytes: Uint8Array): Promise<ImportFileError> {
  try {
    await readEntriesSheet(bytes);
  } catch (err) {
    if (err instanceof ImportFileError) return err;
    throw err;
  }
  throw new Error("expected an ImportFileError");
}

describe("readEntriesSheet", () => {
  it("reads only the Manual entries rows, skipping the blank formatted ones; dates come back as days", async () => {
    const rows = await sheetRows(exported());
    expect(rows.map((r) => [r.row, r.entryId])).toEqual(ENTRIES.map((e, i) => [i + 2, e.entryId]));
    expect(rows[0].draft).toEqual({
      type: "Batch",
      date: excelDate("2026-10-13"),
      reference: "BC-26286C",
      product: "Terra Pure - Desert Breeze - Shampoo",
      kg: 10050,
      note: "M1: open in FileMaker",
    });
    // "Entered by" and "Dashboard status" are never read.
    expect(rows.every((r) => !("enteredBy" in r.draft) && !("status" in r.draft))).toBe(true);
  });

  it("rejects a header row that differs from the export's, naming the column", async () => {
    const renamed = [...ENTRY_HEADERS];
    renamed[3] = "Ref";
    const error = await fileError(await entriesWorkbook(exported(), { header: renamed }));
    expect(error.code).toBe("header_mismatch");
    expect(error.message).toBe(
      "The header row isn’t the export’s: column D should be “Reference” but is “Ref”. Keep the header row exactly as Export to Excel writes it."
    );
    const extra = await fileError(await entriesWorkbook(exported(), { header: [...ENTRY_HEADERS, "Approved"] }));
    expect(extra.message).toContain("column N has the heading “Approved”, but the export ends at column M");
    const short = await fileError(await entriesWorkbook(exported(), { header: ENTRY_HEADERS.slice(0, 12) }));
    expect(short.message).toContain("column M should be “Dashboard status (not imported)” but is empty");
  });

  it("rejects files that aren't the workbook", async () => {
    expect((await fileError(Buffer.from("Entry ID,Type\nM001,Batch\n"))).code).toBe("unreadable_file");
    const renamed = await fileError(await entriesWorkbook(exported(), { sheetName: "Entries" }));
    expect(renamed.code).toBe("missing_sheet");
    expect(renamed.message).toBe("The workbook has no “Manual entries” sheet. Use the workbook from Export to Excel.");
  });

  it(`takes ${MAX_IMPORT_ROWS.toLocaleString("en-US")} entry rows and refuses one more`, async () => {
    const row = (i: number): SheetCell[] => [null, "Batch", excelDate("2026-10-14"), `BC-${i}`, null, null, 8000];
    const full = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => row(i));
    expect(await sheetRows(full)).toHaveLength(MAX_IMPORT_ROWS);
    const error = await fileError(await entriesWorkbook([...full, row(MAX_IMPORT_ROWS)]));
    expect(error.code).toBe("too_many_rows");
    expect(error.message).toBe("The sheet has 1,001 entry rows; an import can hold at most 1,000.");
  }, 30_000);

  it("reads calculated formulas, rich text and links; flags cells with no value", async () => {
    const [row] = await sheetRows([
      [
        { richText: [{ text: "M00" }, { text: "1" }] },
        "Batch",
        excelDate("2026-10-13"),
        { text: "BC-26286C", hyperlink: "https://example.invalid/b" },
        null,
        null,
        { formula: "10000+50", result: 10050 },
        null,
        null,
        null,
        null,
      ],
      [null, "Shipment", excelDate("2026-10-14"), "PO-2", "K18 Inc", null, null, { error: "#N/A" }, { formula: "1+1" }, "USD"],
    ]);
    expect(row).toMatchObject({ entryId: "M001", draft: { reference: "BC-26286C", kg: 10050 }, unreadable: [] });
    const [, second] = await sheetRows([
      [null, "Batch", excelDate("2026-10-13"), "BC-1", null, null, 9000],
      [null, "Shipment", excelDate("2026-10-14"), "PO-2", "K18 Inc", null, null, { error: "#N/A" }, { formula: "1+1" }, "USD"],
    ]);
    expect(second.unreadable).toEqual([
      { field: "productValue", message: "Product value shows #N/A. Type the value in instead." },
      { field: "freight", message: "Freight is a formula that was never calculated. Type the value in instead." },
    ]);
  });
});

describe("readEntriesSheet: calculated cells", () => {
  it("reads a formula that calculated to 0 as 0 (exceljs keeps a cached 0 only in cell.result)", async () => {
    const [row] = await sheetRows([
      [null, "Shipment", excelDate("2026-10-14"), "PO-3", null, null, null, { formula: "50*2", result: 100 }, { formula: "1-1", result: 0 }, "USD"],
    ]);
    expect(row.unreadable).toEqual([]);
    expect(row.draft).toMatchObject({ productValue: 100, freight: 0 });
    expect(validateEntry(row.draft)).toMatchObject({ ok: true, value: { productValue: "100.00", freight: "0.00" } });
  });
});

describe("planImport", () => {
  async function plan(rows: SheetCell[][]) {
    return planImport(await sheetRows(rows), ENTRIES, CTX);
  }

  it("plans nothing for the entries exactly as exported", async () => {
    expect(await plan(exported())).toEqual({ ok: true, plan: { rows: 7, add: [], change: [], remove: [], unchanged: 7 } });
  });

  it("adds rows without an Entry ID, changes rows that differ, removes entries left out — each with its status", async () => {
    const rows = exported();
    const m7 = rows[6];
    m7[7] = 6000; // M007 product value 5,000 → 6,000
    m7[0] = "m007"; // IDs are read in any case
    rows.splice(2, 1); // M003 left out
    rows.push([null, "Batch", excelDate("2026-10-14"), "BC-26299Z", null, "Lavender wash", 8000.5]);
    rows.push([null, "Shipment", excelDate("2026-10-13"), "IN1000180418", "K18 Inc", null, null, 100, null, "CAD"]);
    const result = await plan(rows);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { add, change, remove, unchanged } = result.plan;
    expect(add.map((a) => [a.row, a.fields.reference, a.status, a.statusLabel])).toEqual([
      [8, "BC-26299Z", "counted", "Counted"],
      [9, "IN1000180418", "in_sage", "In Sage now"],
    ]);
    expect(add[0].fields).toMatchObject({ kg: "8000.500", product: "Lavender wash" });
    expect(change).toEqual([
      expect.objectContaining({
        row: 7,
        entryId: "M007",
        changed: ["productValue"],
        status: "counted",
        before: expect.objectContaining({ productValue: "5000.00" }),
        fields: expect.objectContaining({ productValue: "6000.00", currency: "CAD" }),
      }),
    ]);
    expect(remove).toEqual([expect.objectContaining({ entryId: "M003", status: "counted", statusLabel: "Counted" })]);
    expect(unchanged).toBe(5);
  });

  it("keeps the statuses entries have: retired ones are planned too, not dropped", async () => {
    const result = await plan(exported().filter((row) => !["M004", "M005", "M006"].includes(String(row[0]))));
    if (!result.ok) throw new Error("ok");
    expect(result.plan.remove.map((r) => [r.entryId, r.statusLabel])).toEqual([
      ["M004", "In Sage now"],
      ["M005", "In FileMaker now"],
      ["M006", "Not this month"],
    ]);
  });

  it("refuses the whole file for any row problem, listing each with its row", async () => {
    const rows = exported();
    rows[1][6] = 0; // M002 kg 0
    rows[3][0] = "M099"; // not a current entry
    rows[4][0] = "M001"; // M001 again
    rows.push([null, "Shipment", "2026-10-14", "PO-9", null, null, 50, 100, null, "USD"]);
    const result = await plan(rows);
    expect(result).toEqual({
      ok: false,
      errors: [
        { row: 3, field: "kg", message: "kg must be more than 0." },
        {
          row: 5,
          field: "entryId",
          message: "Entry ID M099 isn’t one of the current entries (it may have been deleted). Clear it to add this row as a new entry.",
        },
        { row: 6, field: "entryId", message: "Entry ID M001 is also on row 2. Each entry can appear once." },
        { row: 9, field: "kg", message: "kg is only for batches. Clear it, or change Type to Batch." },
      ],
    });
  });

  it("reports an unreadable cell once, not also as missing", async () => {
    const rows = exported();
    rows[0][6] = { error: "#REF!" };
    const result = await plan(rows);
    expect(result).toEqual({ ok: false, errors: [{ row: 2, field: "kg", message: "kg shows #REF!. Type the value in instead." }] });
  });

  it("an empty sheet removes every entry", async () => {
    const result = await plan([]);
    if (!result.ok) throw new Error("ok");
    expect(result.plan).toMatchObject({ rows: 0, add: [], change: [], unchanged: 0 });
    expect(result.plan.remove.map((r) => r.entryId)).toEqual(ENTRIES.map((e) => e.entryId));
  });
});
