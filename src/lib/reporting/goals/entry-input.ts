// Manual entries — the one validation shared by the entry form (in the browser
// and again on the server) and the Excel import (TASK-2897). validateEntry
// turns a draft (form text, JSON numbers, or Excel cell values, where dates
// arrive as Date) into the fields Mission Control stores, or into errors a
// person can act on. Money and kg stay exact decimal strings at the database's
// scale (kg 3 places, money 2), so nothing is rounded on the way in. Pure.
//
// Required: Type and Date; kg for a batch; Product value and Currency for a
// shipment. A date in another month is allowed (it gets the computed "Not this
// month" status). Fields of the other type are refused rather than silently
// ignored, so nobody believes a batch's dollar value counted.

import { ENTRY_COLUMNS, ENTRY_CURRENCIES, ENTRY_TYPES } from "./excel/layout";
import type { EntryType, IsoDate, ManualEntry } from "./types";

export type EntryCurrency = (typeof ENTRY_CURRENCIES)[number];

/** The fields a person enters; Entry ID, who and when are recorded by Mission Control. */
export const ENTRY_FIELDS = [
  "type",
  "date",
  "reference",
  "customer",
  "product",
  "kg",
  "productValue",
  "freight",
  "currency",
  "note",
] as const;
export type EntryField = (typeof ENTRY_FIELDS)[number];

/** A valid entry, normalized: trimmed text (blank is null), canonical decimals, canonical type and currency. */
export interface EntryFields {
  type: EntryType;
  date: IsoDate;
  reference: string | null;
  customer: string | null;
  product: string | null;
  /** kg at 3 decimal places, e.g. "10050.000" (batches only). */
  kg: string | null;
  /** Before tax and freight, 2 decimal places (shipments only). */
  productValue: string | null;
  freight: string | null;
  currency: EntryCurrency | null;
  note: string | null;
}

/** Any entry's values in the same canonical form, for comparing (stored entries may predate this validation). */
export type EntryValues = Record<EntryField, string | null>;

/** One draft value: form text, a JSON number, or an Excel cell (a date cell arrives as a Date). */
export type DraftValue = string | number | Date | null | undefined;
export type EntryDraft = Partial<Record<EntryField, DraftValue>>;

export interface FieldError {
  field: EntryField;
  message: string;
}

export type EntryValidation = { ok: true; value: EntryFields } | { ok: false; errors: FieldError[] };

/** Longest text each field takes. */
export const ENTRY_TEXT_LIMITS = { reference: 100, customer: 200, product: 200, note: 1000 } as const;
type TextField = keyof typeof ENTRY_TEXT_LIMITS;

/** Dates outside this range are typing slips (an Excel "14" is 1900-01-14). */
export const ENTRY_DATE_MIN = "2000-01-01";
export const ENTRY_DATE_MAX = "2099-12-31";

/** The largest workbook the import takes (report_manual_import keeps the file, up to 2 MiB). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Each field's name as the workbook's column heading says it ("Product value"). */
export const ENTRY_FIELD_LABELS = Object.fromEntries(
  ENTRY_FIELDS.map((field) => [field, ENTRY_COLUMNS.find((column) => column.key === field)?.header ?? field])
) as Record<EntryField, string>;

const BATCH_ONLY: readonly EntryField[] = ["kg"];
const SHIPMENT_ONLY: readonly EntryField[] = ["customer", "productValue", "freight", "currency"];

// ─── Values ──────────────────────────────────────────────────────────────────

/** Quotes what someone typed back to them, shortened. */
function quoted(value: DraftValue): string {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  return `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”`;
}

function isBlank(value: DraftValue): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

type Amount =
  | { ok: true; value: string; negative: boolean; zero: boolean }
  | { ok: false; reason: "format" | "places" | "size" };

const AMOUNT_TEXT = /^([+-]?)\$?((?:\d{1,3}(?:,\d{3})+)|\d*)(?:\.(\d*))?$/;

/**
 * An exact decimal at `scale` places: "10,050" → "10050.000" (scale 3). Takes
 * text (an optional $ and thousands commas allowed) or a number. Never rounds:
 * more places than `scale` is an error, as is more whole digits than the column holds.
 */
function amountOf(value: string | number, scale: number, maxWholeDigits: number): Amount {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, reason: "format" };
    if (Math.abs(value) >= 1e15) return { ok: false, reason: "size" };
    text = String(value);
    // Tiny numbers print as 1e-7: write them out so the places check sees them.
    if (/e/i.test(text)) text = value.toFixed(20);
  } else {
    text = value.trim();
  }
  const match = AMOUNT_TEXT.exec(text);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) return { ok: false, reason: "format" };
  const whole = match[2].replace(/,/g, "").replace(/^0+(?=\d)/, "") || "0";
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  if (fraction.length > scale) return { ok: false, reason: "places" };
  if (whole.length > maxWholeDigits) return { ok: false, reason: "size" };
  const zero = /^0+$/.test(`${whole}${fraction}`);
  return { ok: true, value: `${whole}.${fraction.padEnd(scale, "0")}`, negative: match[1] === "-" && !zero, zero };
}

/** A stored decimal in canonical form ("10050" → "10050.000"); anything unparseable is returned as it is. */
function canonicalAmount(value: string | null, scale: number): string | null {
  if (value === null || value.trim() === "") return null;
  const amount = amountOf(value, scale, 15);
  if (!amount.ok) return value;
  return amount.negative ? `-${amount.value}` : amount.value;
}

/** "10050.000" → "10050", "24500.50" → "24500.5": a decimal as a person would type it. */
export function plainDecimal(value: string | null | undefined): string {
  if (!value) return "";
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(iso: string): boolean {
  const match = ISO_DATE.exec(iso);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function validateEntry(draft: EntryDraft): EntryValidation {
  const errors: FieldError[] = [];
  const fail = (field: EntryField, message: string) => errors.push({ field, message });
  const failed = (field: EntryField) => errors.some((e) => e.field === field);
  const label = (field: EntryField) => ENTRY_FIELD_LABELS[field];

  /** Trimmed text, null when blank; a date in a text field is refused (Excel turns "10-14" into a date). */
  const textOf = (field: EntryField): string | null => {
    const value = draft[field];
    if (isBlank(value)) return null;
    if (value instanceof Date) {
      fail(field, `${label(field)} looks like a date. Format the cell as text and type it again.`);
      return null;
    }
    return String(value).trim();
  };

  // Type
  const typeText = textOf("type");
  const type = ENTRY_TYPES.find((t) => t.toLowerCase() === typeText?.toLowerCase()) ?? null;
  if (typeText === null) {
    if (!failed("type")) fail("type", "Type is required: Batch or Shipment.");
  } else if (!type) {
    fail("type", `Type must be Batch or Shipment, not ${quoted(typeText)}.`);
  }

  /** A filled-in field the type doesn't use: say so, instead of checking its format. */
  const wrongType = (field: EntryField): boolean => {
    if (isBlank(draft[field])) return false;
    if (type === "Batch" && SHIPMENT_ONLY.includes(field)) {
      fail(
        field,
        field === "customer"
          ? "Customer is only for shipments. Clear it, or put it in Note."
          : `${label(field)} is only for shipments. Clear it, or change Type to Shipment.`
      );
      return true;
    }
    if (type === "Shipment" && BATCH_ONLY.includes(field)) {
      fail(field, `${label(field)} is only for batches. Clear it, or change Type to Batch.`);
      return true;
    }
    return false;
  };

  // Date
  let date: IsoDate | null = null;
  const rawDate = draft.date;
  if (isBlank(rawDate)) {
    fail("date", "Date is required: the day the batch finished or the shipment left.");
  } else if (rawDate instanceof Date) {
    // Excel date cells are UTC midnights (exceljs), so the calendar day is the UTC date.
    if (Number.isNaN(rawDate.getTime())) fail("date", "Date must be a real date like 2026-10-14.");
    else date = rawDate.toISOString().slice(0, 10);
  } else if (typeof rawDate === "number") {
    fail("date", "Date must be a date like 2026-10-14. Format the cell as a date.");
  } else {
    const text = String(rawDate).trim();
    if (isRealDate(text)) date = text;
    else fail("date", `Date must be a real date like 2026-10-14, not ${quoted(text)}.`);
  }
  if (date !== null && (date < ENTRY_DATE_MIN || date > ENTRY_DATE_MAX)) {
    fail("date", `Date ${date} is outside 2000–2099. Use a date like 2026-10-14.`);
    date = null;
  }

  // Text
  const texts = {} as Record<TextField, string | null>;
  for (const field of Object.keys(ENTRY_TEXT_LIMITS) as TextField[]) {
    const value = wrongType(field) ? null : textOf(field);
    const limit = ENTRY_TEXT_LIMITS[field];
    if (value !== null && value.length > limit) {
      fail(field, `${label(field)} is ${value.length.toLocaleString("en-US")} characters; the limit is ${limit.toLocaleString("en-US")}.`);
    }
    texts[field] = value;
  }

  // Amounts
  const amount = (field: "kg" | "productValue" | "freight"): string | null => {
    const value = draft[field];
    if (isBlank(value) || wrongType(field)) return null;
    const name = label(field);
    if (value instanceof Date) {
      fail(field, `${name} must be a number, not a date.`);
      return null;
    }
    const kg = field === "kg";
    const parsed = amountOf(value as string | number, kg ? 3 : 2, kg ? 11 : 12);
    if (!parsed.ok) {
      if (parsed.reason === "places") fail(field, `${name} can have at most ${kg ? 3 : 2} decimal places.`);
      else if (parsed.reason === "size") fail(field, `${name} is too large.`);
      else fail(field, `${name} must be ${kg ? "a number like 10050" : "an amount like 24500.00"}, not ${quoted(value)}.`);
      return null;
    }
    if (kg && (parsed.negative || parsed.zero)) {
      fail(field, "kg must be more than 0.");
      return null;
    }
    if (parsed.negative) {
      fail(field, `${name} can’t be negative.`);
      return null;
    }
    return parsed.value;
  };
  const kg = amount("kg");
  const productValue = amount("productValue");
  const freight = amount("freight");

  // Currency
  const currencyText = wrongType("currency") ? null : textOf("currency");
  const currency = ENTRY_CURRENCIES.find((c) => c === currencyText?.toUpperCase()) ?? null;
  if (currencyText !== null && !currency) fail("currency", `Currency must be CAD or USD, not ${quoted(currencyText)}.`);

  // What each type needs
  if (type === "Batch" && kg === null && !failed("kg")) fail("kg", "kg is required for a batch.");
  if (type === "Shipment") {
    if (productValue === null && !failed("productValue")) {
      fail("productValue", "Product value is required for a shipment: the value before tax and freight.");
    }
    if (currency === null && !failed("currency")) fail("currency", "Currency is required for a shipment: CAD or USD.");
  }

  if (errors.length > 0 || !type || !date) {
    const order = (e: FieldError) => ENTRY_FIELDS.indexOf(e.field);
    return { ok: false, errors: [...errors].sort((a, b) => order(a) - order(b)) };
  }
  return {
    ok: true,
    value: {
      type,
      date,
      reference: texts.reference,
      customer: texts.customer,
      product: texts.product,
      kg,
      productValue,
      freight,
      currency,
      note: texts.note,
    },
  };
}

// ─── Comparing ───────────────────────────────────────────────────────────────

/** A stored entry's values in canonical form (decimals at the column's scale). */
export function entryValuesOf(entry: ManualEntry | EntryFields): EntryValues {
  const text = (value: string | null | undefined) => (value === null || value === undefined || value.trim() === "" ? null : value.trim());
  return {
    type: entry.type,
    date: entry.date,
    reference: text(entry.reference),
    customer: text(entry.customer),
    product: text(entry.product),
    kg: canonicalAmount(entry.kg, 3),
    productValue: canonicalAmount(entry.productValue, 2),
    freight: canonicalAmount(entry.freight, 2),
    currency: entry.currency,
    note: text(entry.note),
  };
}

/** The fields whose values differ, in field order. */
export function changedFields(before: EntryValues, after: EntryValues): EntryField[] {
  return ENTRY_FIELDS.filter((field) => before[field] !== after[field]);
}
