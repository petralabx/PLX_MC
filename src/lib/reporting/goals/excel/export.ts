// The Goals & Production workbook (TASK-2898): the report and the import
// template in one .xlsx, built from the page model of one good refresh plus that
// run's Sage invoices, their lines (TASK-3144) and truckload shipments. The ten
// sheets, their order and the "Manual entries" layout come from ./layout.ts,
// shared with the import (TASK-2897). USD revenue is at the page's revenue rate,
// the run's Bank of Canada rate or the fixed Sage rate (TASK-3780).
//
// House rules (brief, "Workbook rules"): Arial 10 throughout and 14-pt bold
// titles; header rows bold on light grey and frozen; everything entered by hand
// in amber; real Excel dates; #,##0 counts and the house dollar format;
// fullCalcOnLoad. Totals and derived values are formulas over the Goals
// assumptions block (rows 11–21) and the detail sheets, so the file
// recalculates by itself. Figures read from FileMaker, Sage and the manual
// entries are values, exactly as the page computed them (to the cent).
//
// No I/O, and the export time is an input, so the workbook's contents depend
// on the inputs alone (exceljs's zip still stamps its entries with the time).
// exceljs loads on the first export (./load-exceljs.ts).

import type ExcelJS from "exceljs";

import { REPORT_TIME_ZONE, monthLabel } from "../calendar";
import { FORECAST_BUCKET_LABELS, type ForecastBucket, type ForecastView } from "../forecast";
import { formatAmount, toCents } from "../money";
import { missingByRelation } from "../queries/read-access";
import type { RevenueByClass } from "../revenue-by-class";
import {
  classifyLoad,
  truckloadProductUsdCents,
  type BatchStage,
  type EvaluatedEntry,
  type GoalsModel,
  type LoadKind,
  type LoadTally,
} from "../rules";
import { invoiceLines, linesMismatch, type InvoiceHeader } from "../shipment-lines";
import type { FxRate, GoalSettings, IsoDate, RefreshRun, ShipmentLinesDataset, ShipmentRow, TruckloadRow } from "../types";
import {
  AMBER_FILL,
  AMBER_FONT,
  COUNT_FORMAT,
  DOLLAR_FORMAT,
  ENTRIES_SHEET,
  ENTRY_COLUMNS,
  ENTRY_CURRENCIES,
  ENTRY_FIRST_ROW,
  ENTRY_HEADER_ROW,
  ENTRY_LAST_FORMATTED_ROW,
  ENTRY_TYPES,
  FONT_NAME,
  FONT_SIZE,
  HEADER_FILL,
  TITLE_SIZE,
  WORKBOOK_SHEETS,
  type EntryColumnKey,
  type WorkbookSheet,
} from "./layout";
import { loadExcelJS } from "./load-exceljs";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface GoalsWorkbookInput {
  /** The good run the model was built from: its id, time, cutoffs and rate. */
  run: RefreshRun;
  model: GoalsModel;
  settings: GoalSettings;
  /** This month's Sage invoices from the run's snapshot (the Shipments sheet). */
  shipments: readonly ShipmentRow[];
  /** The run's truckload shipments, so each invoice is marked Full or Partial as the model counted it. */
  truckloads: readonly TruckloadRow[];
  /** Stored USD/CAD rates: a CAD truckload invoice converts at its ship date's rate, as in the model. */
  rates: readonly FxRate[];
  exportedAt: Date;
  /** The page's revenue forecast (TASK-3151); absent or not ready: the Forecast sheet says why. */
  forecast?: ForecastView | null;
  /** The run's invoice lines (TASK-3144); absent, or not read: the Shipment lines sheet says why. */
  shipmentLines?: ShipmentLinesDataset | null;
  /** The page's revenue by customer class (TASK-3781); absent: the Revenue by class sheet says so. */
  revenueByClass?: RevenueByClass | null;
}

// ─── Fixed cells (the brief's formulas name them: =B13*B11, Goals!$B$17, …) ─

const GOAL_ROW = { header: 4, line1: 5, full: 6, partial: 7, revenue: 8 } as const;

/** The Goals assumptions block. Rows 11–19 are the brief's; 20–21 (working days covered) feed "Due so far". */
const INPUT_ROW = {
  workingDays: 11,
  workingDaysLeft: 12,
  perDay: 13,
  line1MinKg: 14,
  fullMinUsd: 15,
  revenueTarget: 16,
  rate: 17,
  productionCutoff: 18,
  sageCutoff: 19,
  productionCovered: 20,
  revenueCovered: 21,
} as const;

const goalsInput = (row: number) => `Goals!$B$${row}`;

/**
 * `usd` (US dollars) at the rate in Goals!B17 as CAD dollars, rounded to the
 * cent half to even as the page converts (money.convertCents), not with Excel's
 * ROUND (half away from zero): at a rate like 1.25 one amount in four lands on
 * a half cent. Integer arithmetic, exact while |USD cents × rate × 10⁶| < 2⁵³
 * (about US$64 million at 1.4).
 */
export function usdToCadFormula(usd: string): string {
  const n = `(ROUND(${usd}*100,0)*ROUND(${goalsInput(INPUT_ROW.rate)}*1000000,0))`;
  const q = `INT(${n}/1000000)`;
  const r = `(${n}-${q}*1000000)`;
  return `((${q}+IF(${r}*2>1000000,1,IF(${r}*2<1000000,0,IF(ISODD(${q}),1,0))))/100)`;
}

/** A stored rate as text without trailing zeros ("1.421900" → "1.4219"). */
const rateText = (rate: string | null) => (rate === null ? "—" : String(Number(rate)));

/** How the workbook's revenue rate (Goals!B17) is described. */
function revenueRateText(input: GoalsWorkbookInput): string {
  const { model, run } = input;
  return model.revenue.basis === "sage"
    ? `the fixed Sage rate ${rateText(model.revenue.rate)} (report_goal_setting.sage_usd_cad_rate)`
    : `the Bank of Canada rate ${rateText(run.fxRate)} for ${run.fxRateDate ?? "an unknown date"}`;
}

const DATE_FORMAT = "yyyy-mm-dd";
const RATE_FORMAT = "0.0000";
const NOTE_COLOR = "FF595959";

/** Batch stages as the page labels them (components/mc/goals/helpers.ts), grouped in its stage order. */
const STAGE_LABELS: Record<BatchStage, string> = {
  completed: "Completed",
  completed_by_hand: "Completed (by hand)",
  open_past_date: "Open past date",
  scheduled: "Scheduled",
};
const STAGE_ORDER: Record<BatchStage, number> = { completed: 0, completed_by_hand: 1, open_past_date: 2, scheduled: 3 };

const LOAD_LABELS: Record<LoadKind, string> = { full: "Full", partial: "Partial" };

// ─── Cells and styles ───────────────────────────────────────────────────────

interface Look {
  numFmt?: string;
  bold?: boolean;
  /** Entered by hand: amber fill and font. */
  amber?: boolean;
  /** A header cell: bold on light grey (on amber when its column is entered by hand). */
  header?: boolean;
  /** An explanatory note: grey italics. */
  note?: boolean;
  title?: boolean;
}

function put(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue, look: Look = {}): void {
  const cell = ws.getCell(row, col);
  cell.value = value;
  const font: Partial<ExcelJS.Font> = { name: FONT_NAME, size: look.title ? TITLE_SIZE : FONT_SIZE };
  if (look.bold || look.header || look.title) font.bold = true;
  if (look.note) font.italic = true;
  if (look.amber) font.color = { argb: AMBER_FONT };
  else if (look.note) font.color = { argb: NOTE_COLOR };
  cell.font = font;
  if (look.amber || look.header) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: look.amber ? AMBER_FILL : HEADER_FILL } };
  if (look.numFmt) cell.numFmt = look.numFmt;
  if (look.header) cell.alignment = { vertical: "top", wrapText: true };
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: readonly { text: string; amber?: boolean }[]): void {
  headers.forEach((h, i) => put(ws, row, i + 1, h.text, { header: true, amber: h.amber }));
}

/** Column widths; the column style makes anything typed later Arial 10 too. */
function columns(ws: ExcelJS.Worksheet, widths: readonly number[]): void {
  ws.columns = widths.map((width) => ({ width, style: { font: { name: FONT_NAME, size: FONT_SIZE } } }));
}

/** Keeps rows 1..`rows` in view while scrolling. */
function freeze(ws: ExcelJS.Worksheet, rows: number): void {
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: rows }];
}

/** A real Excel date (UTC midnight, so the serial is a whole day). */
function excelDate(day: IsoDate | null): Date | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const dollars = (cents: number) => cents / 100;

/** A stored decimal (Postgres numeric as text) as the number it is; blank stays blank. */
function decimal(value: string | null): number | null {
  return value === null || value.trim() === "" ? null : Number(value);
}

const count = (n: number) => n.toLocaleString("en-US");

const STAMP = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-14 06:00" in Toronto. */
function torontoStamp(at: Date | string): string {
  const p: Record<string, string> = {};
  for (const part of STAMP.formatToParts(new Date(at))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Working days from the 1st through `through` (0 when it is before the month). */
function workingDaysTo(model: GoalsModel, through: IsoDate): number {
  return model.calendar.days.filter((d) => d.isWorkingDay && d.day <= through).length;
}

function orList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// ─── Read me ────────────────────────────────────────────────────────────────

const EXAMPLE_COLUMNS = ENTRY_COLUMNS.filter((c) => c.key !== "status");

function readMeSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): void {
  const { model, run, settings } = input;
  columns(ws, [16, 12, 12, 16, 22, 30, 10, 14, 10, 10, 34, 14]);
  put(ws, 1, 1, `PLX goals & production — ${model.month.label}`, { title: true });
  put(
    ws,
    2,
    1,
    `Exported ${torontoStamp(input.exportedAt)} (Toronto time) from refresh run #${run.id} of ` +
      `${torontoStamp(run.finishedAt ?? run.startedAt)}. FileMaker data through ${model.cutoffs.productionCutoff ?? "—"}, ` +
      `Sage through ${model.cutoffs.sageCutoff ?? "—"}.`,
    { note: true }
  );
  if (model.revenue.basis === "sage") {
    put(
      ws,
      3,
      1,
      `US dollar revenue is at ${revenueRateText(input)}. Full truckloads are still tested at Bank of Canada rates: a CAD ` +
        `shipment’s own day’s, else ${rateText(model.truckloads.rate)}.`,
      { note: true }
    );
  }
  put(ws, 4, 1, "Colour", { bold: true });
  put(ws, 5, 1, "Amber cells", { amber: true });
  put(ws, 5, 2, "were entered by hand by your team and aren’t in FileMaker or Sage yet. Everything else comes from the system data.");
  put(ws, 7, 1, "How to add or change entries made by hand", { bold: true });
  const customers = orList(model.truckloads.customers.map((c) => c.name));
  const steps = [
    `1. Go to the “${ENTRIES_SHEET}” sheet. Keep its header row; add, change or delete rows below it. Leave Entry ID blank for a new entry; keep it to change one.`,
    "2. Type: Batch for a finished batch that isn’t in FileMaker yet; Shipment for a shipment that isn’t in Sage yet.",
    `   A shipment counts toward revenue (product value plus freight), and toward truckloads when it’s to ${customers}.`,
    "3. Date: the day it finished or shipped, in this month. Reference: the batch number, or the invoice, shipment, order or PO number.",
    "   Once that reference appears in the system data, the report stops counting your entry, so nothing is counted twice.",
    `4. Batch: fill in kg (${count(settings.line1MinKg)} kg or more counts toward Line 1). Shipment: fill in Product value (before tax and freight), Freight, and Currency (CAD or USD).`,
    "5. Save the file. On the Goals & production page, an Editor chooses Import manual entries, uploads it, checks the preview of entries to add, change and remove, and confirms.",
    "   The sheet replaces the current list, so deleting a row removes that entry. “Entered by” and “Dashboard status” aren’t imported; whoever imports is recorded.",
  ];
  steps.forEach((line, i) => put(ws, 8 + i, 1, line));

  const titleRow = 8 + steps.length + 1;
  put(ws, titleRow, 1, "Example rows (format only; not imported)", { bold: true });
  headerRow(ws, titleRow + 1, EXAMPLE_COLUMNS.map((c) => ({ text: c.header })));
  const day = excelDate(model.today);
  const examples: Partial<Record<EntryColumnKey, ExcelJS.CellValue>>[] = [
    { type: "Batch", date: day, reference: "BC-26288Z", product: "Terra Pure - Desert Breeze - Shampoo", kg: 10050, note: "Finished on line 10; FileMaker not updated yet", enteredBy: "J. Smith" },
    { type: "Shipment", date: day, reference: "PO0104001", customer: "A1 American", product: "Hand & body wash", productValue: 24500, freight: 1250, currency: "USD", note: "Truck left today; Sage invoice pending", enteredBy: "J. Smith" },
  ];
  examples.forEach((example, i) => {
    EXAMPLE_COLUMNS.forEach((c, j) => put(ws, titleRow + 2 + i, j + 1, example[c.key] ?? null, { amber: true, numFmt: ENTRY_FORMATS[c.key] }));
  });
}

// ─── Goals ──────────────────────────────────────────────────────────────────

function goalsSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput, daily: { total: number }, trucks: { total: number }): void {
  const { model, settings, run } = input;
  const R = GOAL_ROW;
  const I = INPUT_ROW;
  columns(ws, [40, 16, 14, 12, 14, 14, 14, 12, 22]);
  put(ws, 1, 1, `Goals — ${model.month.label}`, { title: true });
  put(
    ws,
    2,
    1,
    "In system = FileMaker (batches) or Sage (shipments and revenue). By hand = entries made by your team that the system doesn’t have yet (amber).",
    { note: true }
  );
  headerRow(ws, R.header, [
    { text: "Goal" },
    { text: "Target this month" },
    { text: "Due so far" },
    { text: "Due by" },
    { text: "In system" },
    { text: "By hand", amber: true },
    { text: "Total" },
    { text: "Status" },
    { text: "Needed per working day from today" },
  ]);
  freeze(ws, R.header);

  const total = (row: number) => ({ formula: `E${row}+F${row}` });
  const status = (row: number) => ({ formula: `IF(G${row}>=C${row},"On track","Behind")` });
  const needed = (row: number) => ({ formula: `IF($B$${I.workingDaysLeft}>0,MAX(0,B${row}-G${row})/$B$${I.workingDaysLeft},0)` });

  put(ws, R.line1, 1, `Line 1 bulk, kg (batches of ${count(settings.line1MinKg)} kg or more)`);
  put(ws, R.line1, 2, { formula: `B${I.perDay}*B${I.workingDays}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.line1, 3, { formula: `B${I.perDay}*B${I.productionCovered}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.line1, 4, excelDate(model.line1.dueBy), { numFmt: DATE_FORMAT });
  put(ws, R.line1, 5, { formula: `Daily!C${daily.total}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.line1, 6, { formula: `Daily!D${daily.total}` }, { numFmt: COUNT_FORMAT, amber: true });
  put(ws, R.line1, 7, total(R.line1), { numFmt: COUNT_FORMAT, bold: true });
  put(ws, R.line1, 8, status(R.line1));
  put(ws, R.line1, 9, needed(R.line1), { numFmt: COUNT_FORMAT });

  // No status or due-so-far for truckloads, as on the page; the target is a setting (none yet).
  const target = settings.fullTruckloadsPerMonth;
  put(ws, R.full, 1, `Full truckloads (US$${count(settings.fullTruckloadMinUsdCents / 100)} or more before tax and freight)`);
  if (target === null) put(ws, R.full, 2, "No target set", { note: true });
  else put(ws, R.full, 2, target, { numFmt: COUNT_FORMAT });
  put(ws, R.full, 5, { formula: `Truckloads!B${trucks.total}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.full, 6, { formula: `Truckloads!E${trucks.total}` }, { numFmt: COUNT_FORMAT, amber: true });
  put(ws, R.full, 7, total(R.full), { numFmt: COUNT_FORMAT, bold: true });

  put(ws, R.partial, 1, "Partial loads to the same customers");
  put(ws, R.partial, 5, { formula: `Truckloads!C${trucks.total}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.partial, 6, { formula: `Truckloads!F${trucks.total}` }, { numFmt: COUNT_FORMAT, amber: true });
  put(ws, R.partial, 7, total(R.partial), { numFmt: COUNT_FORMAT, bold: true });

  // Revenue in the system: CAD plus USD at the rate, rounded to the cent half to even like the model.
  put(ws, R.revenue, 1, "Revenue, CAD (shipped, net before tax)");
  put(ws, R.revenue, 2, { formula: `B${I.revenueTarget}` }, { numFmt: DOLLAR_FORMAT });
  put(ws, R.revenue, 3, { formula: `ROUND(B${I.revenueTarget}*B${I.revenueCovered}/B${I.workingDays},2)` }, { numFmt: DOLLAR_FORMAT });
  put(ws, R.revenue, 4, excelDate(model.revenue.dueBy), { numFmt: DATE_FORMAT });
  put(ws, R.revenue, 5, { formula: `Daily!F${daily.total}+${usdToCadFormula(`Daily!G${daily.total}`)}` }, { numFmt: DOLLAR_FORMAT });
  put(ws, R.revenue, 6, { formula: `Daily!H${daily.total}` }, { numFmt: DOLLAR_FORMAT, amber: true });
  put(ws, R.revenue, 7, total(R.revenue), { numFmt: DOLLAR_FORMAT, bold: true });
  put(ws, R.revenue, 8, status(R.revenue));
  put(ws, R.revenue, 9, needed(R.revenue), { numFmt: DOLLAR_FORMAT });

  const rateNote =
    model.revenue.basis === "sage"
      ? `Fixed Sage rate (report_goal_setting.sage_usd_cad_rate). Full truckloads are tested at Bank of Canada rates (else ${rateText(model.truckloads.rate)})`
      : run.fxSource === "stored"
        ? `Last stored Bank of Canada rate, for ${run.fxRateDate ?? "an unknown date"}; the refresh couldn’t fetch a newer one`
        : `Bank of Canada daily rate (FXUSDCAD) for ${run.fxRateDate ?? "an unknown date"}`;
  const inputs: [row: number, label: string, value: ExcelJS.CellValue, numFmt: string | undefined, note: string | null][] = [
    [I.workingDays, "Working days this month", model.calendar.workingDays, COUNT_FORMAT, "Monday to Friday, less Ontario public holidays"],
    [I.workingDaysLeft, "Working days left, from today", model.calendar.remaining, COUNT_FORMAT, `${model.today} to ${model.month.end}, today included`],
    [I.perDay, "Line 1 bulk per working day, kg (target)", settings.line1KgPerWorkingDay, COUNT_FORMAT, "Your goal"],
    [I.line1MinKg, "Line 1 minimum batch, kg", settings.line1MinKg, COUNT_FORMAT, "A batch of this many kg or more is assumed to run on Line 1"],
    [I.fullMinUsd, "Full truckload minimum, US$ before tax and freight", settings.fullTruckloadMinUsdCents / 100, DOLLAR_FORMAT, "Your goal"],
    [I.revenueTarget, "Revenue target, CAD", settings.revenueTargetCadCents / 100, DOLLAR_FORMAT, "Your goal"],
    [I.rate, "USD/CAD rate", Number(model.revenue.rate), RATE_FORMAT, rateNote],
    [I.productionCutoff, "FileMaker data through", excelDate(model.cutoffs.productionCutoff), DATE_FORMAT, null],
    [I.sageCutoff, "Sage data through", excelDate(model.cutoffs.sageCutoff), DATE_FORMAT, null],
    [
      I.productionCovered,
      "Working days covered, production",
      workingDaysTo(model, model.line1.dueBy),
      COUNT_FORMAT,
      `To ${model.line1.dueBy}: FileMaker’s data, or a later Line 1 batch entered by hand`,
    ],
    [
      I.revenueCovered,
      "Working days covered, revenue",
      workingDaysTo(model, model.revenue.dueBy),
      COUNT_FORMAT,
      `To ${model.revenue.dueBy}: Sage’s data, or a later shipment entered by hand`,
    ],
  ];
  put(ws, I.workingDays - 1, 1, "Assumptions and inputs", { bold: true });
  for (const [row, label, value, numFmt, note] of inputs) {
    put(ws, row, 1, label);
    put(ws, row, 2, value, { numFmt });
    if (note) put(ws, row, 3, note, { note: true });
  }
}

// ─── Daily ──────────────────────────────────────────────────────────────────

/** One row per day of the month, then the totals row (returned). */
function dailySheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): { total: number } {
  const I = INPUT_ROW;
  columns(ws, [12, 12, 16, 16, 16, 16, 16, 16, 18, 18, 18]);
  headerRow(ws, 1, [
    { text: "Date" },
    { text: "Working day" },
    { text: "Line 1 kg done (FileMaker)" },
    { text: "Line 1 kg done (by hand)", amber: true },
    { text: "Line 1 kg still scheduled" },
    { text: "CAD invoiced (Sage)" },
    { text: "USD invoiced (Sage)" },
    { text: "Revenue by hand, CAD", amber: true },
    { text: "Revenue to date, CAD" },
    { text: "Target to date, CAD" },
    { text: "Last month to date, CAD" },
  ]);
  freeze(ws, 1);
  input.model.daily.forEach((d, i) => {
    const r = 2 + i;
    put(ws, r, 1, excelDate(d.day), { numFmt: DATE_FORMAT });
    put(ws, r, 2, d.isWorkingDay ? "Yes" : "No");
    put(ws, r, 3, d.line1DoneKg, { numFmt: COUNT_FORMAT });
    put(ws, r, 4, d.line1ByHandKg, { numFmt: COUNT_FORMAT, amber: true });
    put(ws, r, 5, d.line1ScheduledKg, { numFmt: COUNT_FORMAT });
    put(ws, r, 6, dollars(d.cadCents), { numFmt: DOLLAR_FORMAT });
    put(ws, r, 7, dollars(d.usdCents), { numFmt: DOLLAR_FORMAT });
    put(ws, r, 8, dollars(d.byHandCadCents), { numFmt: DOLLAR_FORMAT, amber: true });
    put(ws, r, 9, { formula: `SUM($F$2:F${r})+${usdToCadFormula(`SUM($G$2:G${r})`)}+SUM($H$2:H${r})` }, { numFmt: DOLLAR_FORMAT });
    put(
      ws,
      r,
      10,
      { formula: `ROUND(${goalsInput(I.revenueTarget)}*COUNTIF($B$2:B${r},"Yes")/${goalsInput(I.workingDays)},2)` },
      { numFmt: DOLLAR_FORMAT }
    );
    // Last month on the same day of the month, at the revenue rate (its daily figures aren't in the workbook).
    put(ws, r, 11, dollars(d.lastMonthToDateCents), { numFmt: DOLLAR_FORMAT });
  });
  const total = 2 + input.model.daily.length;
  put(ws, total, 1, "Total", { bold: true });
  const sums: [col: string, numFmt: string, amber: boolean][] = [
    ["C", COUNT_FORMAT, false],
    ["D", COUNT_FORMAT, true],
    ["E", COUNT_FORMAT, false],
    ["F", DOLLAR_FORMAT, false],
    ["G", DOLLAR_FORMAT, false],
    ["H", DOLLAR_FORMAT, true],
  ];
  for (const [col, numFmt, amber] of sums) {
    put(ws, total, ws.getColumn(col).number, { formula: `SUM(${col}2:${col}${total - 1})` }, { numFmt, bold: true, amber });
  }
  return { total };
}

// ─── Truckloads ─────────────────────────────────────────────────────────────

/** One row per truckload customer, then the totals row (returned) and a note. */
function truckloadSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): { total: number } {
  const customers = input.model.truckloads.customers;
  columns(ws, [26, 14, 14, 16, 14, 14, 16, 14, 14, 14, 16]);
  headerRow(ws, 1, [
    { text: "Customer" },
    { text: "Full loads (Sage)" },
    { text: "Partial loads (Sage)" },
    { text: "Product US$ (Sage)" },
    { text: "Full loads (by hand)", amber: true },
    { text: "Partial loads (by hand)", amber: true },
    { text: "Product US$ (by hand)", amber: true },
    { text: "Full loads, total" },
    { text: "Full loads last month" },
    { text: "Partial loads last month" },
    { text: "Product US$ last month" },
  ]);
  freeze(ws, 1);
  const tally = (r: number, col: number, t: LoadTally, amber: boolean) => {
    put(ws, r, col, t.full, { numFmt: COUNT_FORMAT, amber });
    put(ws, r, col + 1, t.partial, { numFmt: COUNT_FORMAT, amber });
    put(ws, r, col + 2, dollars(t.productUsdCents), { numFmt: DOLLAR_FORMAT, amber });
  };
  customers.forEach((c, i) => {
    const r = 2 + i;
    put(ws, r, 1, c.name);
    tally(r, 2, c.thisMonth, false);
    tally(r, 5, c.byHand, true);
    put(ws, r, 8, { formula: `B${r}+E${r}` }, { numFmt: COUNT_FORMAT, bold: true });
    tally(r, 9, c.lastMonth, false);
  });
  const total = 2 + customers.length;
  put(ws, total, 1, "All truckload customers", { bold: true });
  for (let col = 2; col <= 11; col += 1) {
    const letter = ws.getColumn(col).letter;
    const money = col === 4 || col === 7 || col === 11;
    // With no customer rows the SUM would cover this row itself, a circular reference.
    put(ws, total, col, customers.length > 0 ? { formula: `SUM(${letter}2:${letter}${total - 1})` } : 0, {
      numFmt: money ? DOLLAR_FORMAT : COUNT_FORMAT,
      bold: true,
      amber: col >= 5 && col <= 7,
    });
  }
  put(
    ws,
    total + 2,
    1,
    `Full load = US$${count(input.settings.fullTruckloadMinUsdCents / 100)} or more of product on one shipment, before tax and freight (Goals!B${INPUT_ROW.fullMinUsd}).`,
    { note: true }
  );
  return { total };
}

// ─── Batches ────────────────────────────────────────────────────────────────

function batchSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): void {
  columns(ws, [13, 44, 18, 12, 10, 13, 12, 13, 18, 11]);
  headerRow(ws, 1, [
    { text: "Batch" },
    { text: "Product" },
    { text: "Stage" },
    { text: "Date" },
    { text: "kg" },
    { text: "Size band" },
    { text: `Line 1 (${count(input.settings.line1MinKg)} kg+)` },
    { text: "Line" },
    { text: "Status" },
    { text: "Source" },
  ]);
  freeze(ws, 1);
  // Grouped by stage; within a stage the model's order (date, then batch) stands.
  const rows = [...input.model.batches].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);
  rows.forEach((b, i) => {
    const r = 2 + i;
    const amber = b.source === "By hand";
    put(ws, r, 1, b.batch, { amber });
    put(ws, r, 2, b.product, { amber });
    put(ws, r, 3, STAGE_LABELS[b.stage], { amber });
    put(ws, r, 4, excelDate(b.date), { amber, numFmt: DATE_FORMAT });
    put(ws, r, 5, b.kg, { amber, numFmt: COUNT_FORMAT });
    put(ws, r, 6, b.band, { amber });
    put(ws, r, 7, { formula: `IF(E${r}>=${goalsInput(INPUT_ROW.line1MinKg)},"Yes","")` }, { amber });
    put(ws, r, 8, b.line, { amber });
    put(ws, r, 9, b.status, { amber });
    put(ws, r, 10, b.source, { amber });
  });
}

// ─── Shipments ──────────────────────────────────────────────────────────────

const shipmentKey = (code: string | null, shipment: string) => `${code ?? ""}|${shipment}`;

/** Full or Partial for each of this month's truckload shipments, by the rule computeGoals counts them with. */
function loadKinds(input: GoalsWorkbookInput): Map<string, LoadKind> {
  const kinds = new Map<string, LoadKind>();
  for (const row of input.truckloads) {
    if (!row.thisMonth) continue;
    // The Bank of Canada rate, as the Truckloads card tests a load, whatever rate revenue is at.
    const kind = classifyLoad(truckloadProductUsdCents(row, input.rates, input.model.truckloads.rate), input.settings);
    if (kind) kinds.set(shipmentKey(row.code, row.shipment), kind);
  }
  return kinds;
}

/** Hand-entered shipments by date (undated last), then entry. */
function byDateThenEntry(a: EvaluatedEntry, b: EvaluatedEntry): number {
  const da = a.date ?? "9999-12-31";
  const db = b.date ?? "9999-12-31";
  return da === db ? a.entryId.localeCompare(b.entryId) : da < db ? -1 : 1;
}

function shipmentSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): void {
  columns(ws, [12, 15, 15, 15, 20, 36, 9, 14, 16, 14, 11, 22, 26]);
  headerRow(ws, 1, [
    { text: "Ship date" },
    { text: "Invoice" },
    { text: "Shipment" },
    { text: "Order" },
    { text: "PO" },
    { text: "Customer" },
    { text: "Currency" },
    { text: "Product value" },
    { text: "Other charges (freight etc.)" },
    { text: "Net before tax" },
    { text: "Truckload" },
    { text: "Source" },
    { text: "Status (entries by hand)" },
  ]);
  freeze(ws, 1);
  const kinds = loadKinds(input);
  let r = 2;
  for (const s of input.shipments) {
    // An invoice without a shipment number is its own shipment (queries/truckloads.ts).
    const kind = kinds.get(shipmentKey(s.customerCode, s.shipment ?? `invoice:${s.invoice}`));
    put(ws, r, 1, excelDate(s.shipDate), { numFmt: DATE_FORMAT });
    put(ws, r, 2, s.invoice);
    put(ws, r, 3, s.shipment);
    put(ws, r, 4, s.orderNo);
    put(ws, r, 5, s.po);
    put(ws, r, 6, s.customer);
    put(ws, r, 7, s.currency);
    put(ws, r, 8, decimal(s.productValue), { numFmt: DOLLAR_FORMAT });
    put(ws, r, 9, decimal(s.otherCharges), { numFmt: DOLLAR_FORMAT });
    put(ws, r, 10, decimal(s.netBeforeTax), { numFmt: DOLLAR_FORMAT });
    put(ws, r, 11, kind ? LOAD_LABELS[kind] : null);
    put(ws, r, 12, "Sage");
    r += 1;
  }
  // Then every shipment entered by hand, counted or not, with its status. Its
  // reference (an invoice, shipment, order or PO number) sits under Invoice.
  const entries = input.model.entries.filter((e) => e.type === "Shipment").sort(byDateThenEntry);
  for (const e of entries) {
    const amber = true;
    put(ws, r, 1, excelDate(e.date), { amber, numFmt: DATE_FORMAT });
    put(ws, r, 2, e.reference, { amber });
    for (const col of [3, 4, 5]) put(ws, r, col, null, { amber });
    put(ws, r, 6, e.customer, { amber });
    put(ws, r, 7, e.currency, { amber });
    put(ws, r, 8, decimal(e.productValue), { amber, numFmt: DOLLAR_FORMAT });
    put(ws, r, 9, decimal(e.freight), { amber, numFmt: DOLLAR_FORMAT });
    put(ws, r, 10, { formula: `H${r}+I${r}` }, { amber, numFmt: DOLLAR_FORMAT });
    put(ws, r, 11, e.truckload ? LOAD_LABELS[e.truckload.kind] : null, { amber });
    put(ws, r, 12, `By hand (${e.entryId})`, { amber });
    put(ws, r, 13, e.statusLabel, { amber });
    r += 1;
  }
}

// ─── Manual entries (the import template) ──────────────────────────────────

const ENTRY_FORMATS: Partial<Record<EntryColumnKey, string>> = {
  date: DATE_FORMAT,
  kg: COUNT_FORMAT,
  productValue: DOLLAR_FORMAT,
  freight: DOLLAR_FORMAT,
};

const ENTRY_VALUES: Record<EntryColumnKey, (e: EvaluatedEntry) => ExcelJS.CellValue> = {
  entryId: (e) => e.entryId,
  type: (e) => e.type,
  date: (e) => excelDate(e.date),
  reference: (e) => e.reference,
  customer: (e) => e.customer,
  product: (e) => e.product,
  kg: (e) => decimal(e.kg),
  productValue: (e) => decimal(e.productValue),
  freight: (e) => decimal(e.freight),
  currency: (e) => e.currency,
  note: (e) => e.note,
  enteredBy: (e) => e.enteredBy,
  status: (e) => e.statusLabel,
};

/** A drop-down list for one column, from the first entry row to `last`. */
function listValidation(ws: ExcelJS.Worksheet, key: EntryColumnKey, label: string, values: readonly string[], last: number): void {
  const letter = ws.getColumn(ENTRY_COLUMNS.findIndex((c) => c.key === key) + 1).letter;
  // On the sheet's range map, not per cell: exceljs merges per-cell rules into
  // overlapping ranges (B10:B200 and B2:B200; it sorts addresses as text). The
  // map is exceljs's runtime API (worksheet.dataValidations), missing from its typings.
  const sheet = ws as ExcelJS.Worksheet & { dataValidations: { add(range: string, rule: ExcelJS.DataValidation): void } };
  sheet.dataValidations.add(`${letter}${ENTRY_FIRST_ROW}:${letter}${last}`, {
    type: "list",
    allowBlank: true,
    formulae: [`"${values.join(",")}"`],
    showErrorMessage: true,
    errorTitle: label,
    error: `${label} must be ${orList(values)}.`,
  });
}

function entriesSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): void {
  const entries = input.model.entries;
  columns(ws, [10, 10, 12, 18, 22, 32, 10, 14, 12, 10, 36, 14, 26]);
  // The import reads only this sheet; the status column is computed, so it is not amber.
  headerRow(ws, ENTRY_HEADER_ROW, ENTRY_COLUMNS.map((c) => ({ text: c.header, amber: c.key !== "status" })));
  freeze(ws, ENTRY_HEADER_ROW);
  // Existing entries in amber, then blank formatted rows, so typed values get the same formats and lists.
  const last = Math.max(ENTRY_LAST_FORMATTED_ROW, ENTRY_FIRST_ROW + entries.length - 1);
  for (let r = ENTRY_FIRST_ROW; r <= last; r += 1) {
    const entry = entries[r - ENTRY_FIRST_ROW] ?? null;
    ENTRY_COLUMNS.forEach((c, i) => {
      put(ws, r, i + 1, entry ? ENTRY_VALUES[c.key](entry) : null, {
        numFmt: ENTRY_FORMATS[c.key],
        amber: entry !== null && c.key !== "status",
      });
    });
  }
  listValidation(ws, "type", "Type", ENTRY_TYPES, last);
  listValidation(ws, "currency", "Currency", ENTRY_CURRENCIES, last);
}

// ─── Forecast (TASK-3151) ───────────────────────────────────────────────────

/** Row 3 heads the four numbers and their parts in row 4; the order rows sit under the header in row 6 (frozen). */
const FORECAST_NUMBER_ROW = 4;
const FORECAST_HEADER_ROW = 6;
const AMOUNT_FORMAT = "#,##0.00";
const PRICE_FORMAT = "#,##0.00####";
const PERCENT_FORMAT = "0.0%";

const FORECAST_NUMBERS = [
  "Invoiced so far",
  "Ready",
  "Planned in time",
  "Late",
  "Not planned",
  "Theoretical",
  "At risk",
  "Hit rate (average)",
  "Realistic",
  "Working days covered",
  "Working days in the month",
  "Pace",
  "Target",
] as const;

const FORECAST_SHEET_COLUMNS = [
  "Expected",
  "Order",
  "Line",
  "Customer code",
  "Customer",
  "PO",
  "Item",
  "Description",
  "Still to ship",
  "Unit",
  "Unit price",
  "Currency",
  "Value",
  "CAD",
  "Bucket",
  "Assembly order",
  "AO scheduled",
  "AO status",
  "Bulk batch",
  "Batch status",
  // Last, so the columns the formulas read keep their letters (TASK-3177).
  "Customer class",
  "Item category",
] as const;

/**
 * The four numbers over the open order rows, as the page shows them. Order
 * figures are values (the page's, to the cent); CAD, the bucket totals and the
 * numbers are formulas over them, the Goals sheet's revenue total, rate,
 * working days and target, and the hit rates by month listed under the rows.
 */
function forecastSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): void {
  const { model } = input;
  const forecast = input.forecast ?? null;
  columns(ws, [12, 15, 7, 11, 30, 14, 12, 28, 12, 7, 12, 9, 14, 14, 16, 12, 12, 11, 12, 11, 22, 12]);
  put(ws, 1, 1, `Revenue forecast — ${model.month.label}`, { title: true });
  if (forecast?.state !== "ready") {
    const why =
      forecast?.state === "waiting_for_access"
        ? "Waiting for read access to Sage orders and FileMaker assembly orders. The reporting login can’t read " +
          `${forecast.missing.map((m) => `${m.relation} (${m.columns.join(", ")})`).join("; ")}. A database administrator grants it ` +
          "with docs/modules/reporting-goals/readonly-grants-forecast.sql, and the next refresh fills this sheet in."
        : "This refresh has no forecast yet. It fills in at the next refresh.";
    put(ws, 2, 1, why, { note: true });
    return;
  }
  put(
    ws,
    2,
    1,
    `Open Sage order lines expected to ship by ${model.month.end} (overdue ones included), at the quantity still to ship × the ` +
      `unit price, matched to FileMaker’s plan through their assembly orders. CAD at the revenue rate (Goals!B${INPUT_ROW.rate}). ` +
      "Theoretical = invoiced + Ready + Planned in time; At risk = Late + Not planned.",
    { note: true }
  );

  const NR = FORECAST_NUMBER_ROW;
  const first = FORECAST_HEADER_ROW + 1;
  const last = first + forecast.rows.length - 1;
  headerRow(ws, NR - 1, FORECAST_NUMBERS.map((text) => ({ text })));
  headerRow(ws, FORECAST_HEADER_ROW, FORECAST_SHEET_COLUMNS.map((text) => ({ text })));
  freeze(ws, FORECAST_HEADER_ROW);

  forecast.rows.forEach((r, i) => {
    const row = first + i;
    put(ws, row, 1, excelDate(r.expected), { numFmt: DATE_FORMAT });
    put(ws, row, 2, r.orderNo);
    put(ws, row, 3, r.lineNo);
    put(ws, row, 4, r.customerCode);
    put(ws, row, 5, r.customer);
    put(ws, row, 6, r.po);
    put(ws, row, 7, r.item);
    put(ws, row, 8, r.description);
    put(ws, row, 9, r.qty, { numFmt: COUNT_FORMAT });
    put(ws, row, 10, r.unit);
    put(ws, row, 11, Number(r.unitPrice), { numFmt: PRICE_FORMAT });
    put(ws, row, 12, r.currency);
    put(ws, row, 13, dollars(r.valueCents), { numFmt: AMOUNT_FORMAT });
    // As the Revenue card converts: USD at the revenue rate, half to even; other currencies never.
    put(ws, row, 14, { formula: `IF(L${row}="CAD",M${row},IF(L${row}="USD",${usdToCadFormula(`M${row}`)},""))` }, { numFmt: AMOUNT_FORMAT });
    put(ws, row, 15, FORECAST_BUCKET_LABELS[r.bucket]);
    put(ws, row, 16, r.ao?.number ?? null);
    put(ws, row, 17, excelDate(r.ao?.scheduled ?? null), { numFmt: DATE_FORMAT });
    put(ws, row, 18, r.ao?.status ?? null);
    put(ws, row, 19, r.bulk?.batch ?? null);
    put(ws, row, 20, r.bulk?.status ?? null);
    put(ws, row, 21, r.customerClass);
    put(ws, row, 22, r.category);
  });

  // With no rows a SUMIFS range would run into the header, so the totals are zeros.
  const bucketTotal = (bucket: ForecastBucket): ExcelJS.CellValue =>
    forecast.rows.length > 0
      ? { formula: `SUMIFS($N$${first}:$N$${last},$O$${first}:$O$${last},"${FORECAST_BUCKET_LABELS[bucket]}")` }
      : 0;
  put(ws, NR, 1, { formula: `Goals!$G$${GOAL_ROW.revenue}` }, { numFmt: DOLLAR_FORMAT });
  (["ready", "planned", "late", "not_planned"] as const).forEach((bucket, i) => put(ws, NR, 2 + i, bucketTotal(bucket), { numFmt: DOLLAR_FORMAT }));
  put(ws, NR, 6, { formula: `A${NR}+B${NR}+C${NR}` }, { numFmt: DOLLAR_FORMAT, bold: true });
  put(ws, NR, 7, { formula: `D${NR}+E${NR}` }, { numFmt: DOLLAR_FORMAT, bold: true });
  put(ws, NR, 9, { formula: `IF(ISNUMBER(H${NR}),ROUND(A${NR}+(B${NR}+C${NR})*H${NR},2),"")` }, { numFmt: DOLLAR_FORMAT, bold: true });
  put(ws, NR, 10, { formula: goalsInput(INPUT_ROW.revenueCovered) }, { numFmt: COUNT_FORMAT });
  put(ws, NR, 11, { formula: goalsInput(INPUT_ROW.workingDays) }, { numFmt: COUNT_FORMAT });
  put(ws, NR, 12, { formula: `IF(J${NR}>0,ROUND(A${NR}/J${NR}*K${NR},2),"")` }, { numFmt: DOLLAR_FORMAT, bold: true });
  put(ws, NR, 13, { formula: goalsInput(INPUT_ROW.revenueTarget) }, { numFmt: DOLLAR_FORMAT });

  // The hit rate by complete month, under the rows; H4 averages it.
  let r = (forecast.rows.length > 0 ? last : FORECAST_HEADER_ROW) + 2;
  put(ws, r, 1, "Hit rate by month", { bold: true });
  const months = forecast.realistic?.months ?? [];
  if (months.length === 0) {
    put(ws, NR, 8, "Not measured yet", { note: true });
    put(ws, r + 1, 1, `Not measured yet: measured from ${monthLabel(forecast.measuredFrom)}, once a full month of forecasts has ended.`, { note: true });
    r += 3;
  } else {
    headerRow(ws, r + 1, [
      { text: "Month" },
      { text: "First run of the month" },
      { text: "Ready + planned in time then" },
      { text: "Sage invoiced in the month after it" },
      { text: "Hit rate (each at that run’s Bank of Canada rate)" },
    ]);
    months.forEach((m, i) => {
      const row = r + 2 + i;
      put(ws, row, 1, m.label);
      put(ws, row, 2, `Run #${m.firstRunId}, ${m.firstRunDay}`);
      put(ws, row, 3, dollars(m.readyPlannedCents), { numFmt: DOLLAR_FORMAT });
      put(ws, row, 4, dollars(m.invoicedAfterCents), { numFmt: DOLLAR_FORMAT });
      put(ws, row, 5, { formula: `D${row}/C${row}` }, { numFmt: PERCENT_FORMAT });
    });
    put(ws, NR, 8, { formula: `AVERAGE(E${r + 2}:E${r + 1 + months.length})` }, { numFmt: PERCENT_FORMAT });
    r += 3 + months.length;
  }
  const { unordered } = forecast;
  if (forecast.aoQtyUnreadable) {
    put(
      ws,
      r++,
      1,
      `${count(forecast.aoQtyUnreadable)} ${forecast.aoQtyUnreadable === 1 ? "assembly order has" : "assembly orders have"} a quantity in ` +
        "FileMaker that isn’t a number, so they cover no order line; those lines count as Not planned.",
      { note: true }
    );
  }
  if (unordered.count > 0) {
    put(
      ws,
      r++,
      1,
      `Production with no order behind it: ${count(unordered.count)} assembly orders scheduled this month (${count(unordered.pieces)} pieces) ` +
        "match no open Sage order line. They aren’t counted as revenue.",
      { note: true }
    );
  }
  for (const c of forecast.otherCurrencies) {
    put(ws, r++, 1, `Not converted: ${c.currency} ${dollars(c.cents).toLocaleString("en-US", { minimumFractionDigits: 2 })} in ${count(c.rows)} ${c.rows === 1 ? "row" : "rows"}. Only CAD and USD count, as on the Revenue card.`, { note: true });
  }
  if (forecast.categoryMissing === null) {
    put(ws, r++, 1, "Item categories fill in at the next refresh.", { note: true });
  } else if (forecast.categoryMissing.length > 0) {
    put(
      ws,
      r++,
      1,
      `Item category is blank: the reporting login can’t read ${forecast.categoryMissing.join(", ")} yet. A database administrator ` +
        "grants it by re-running docs/modules/reporting-goals/readonly-grants-forecast.sql.",
      { note: true }
    );
  }
  put(ws, r, 1, "CAD is rounded to the cent half to even, as on the page.", { note: true });
}

// ─── Shipment lines (TASK-3144) ─────────────────────────────────────────────

const SHIPMENT_LINE_HEADERS = [
  "Invoice",
  "Ship date",
  "Customer",
  "Line type",
  "Item or charge",
  "Description",
  "Quantity",
  "Unit",
  "Unit price",
  "Amount",
  "Discount",
  "Currency",
] as const;
/** Sage keeps four decimals on quantities: at least two shown, up to four. */
const QUANTITY_FORMAT = "#,##0.00##";

/**
 * One row per line of the run's Sage invoices, in the Shipments sheet's order of
 * invoices, each invoice's lines in Sage's order, as values in the invoice's
 * currency (a charge has no quantity, unit or unit price). Under the rows, the
 * invoices whose lines don't add up to them, worded as on the page; or that
 * every one does. Without the lines, the sheet says why.
 */
function shipmentLinesSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): void {
  columns(ws, [15, 12, 36, 10, 16, 36, 12, 8, 13, 14, 12, 9]);
  const data = input.shipmentLines ?? null;
  if (data?.access !== "read") {
    const why =
      data?.access === "missing"
        ? "Item details are waiting for read access to Sage invoice lines. The reporting login can’t read " +
          `${missingByRelation(data.missing).map((m) => `${m.relation} (${m.columns.join(", ")})`).join("; ")}. A database administrator grants it ` +
          "with docs/modules/reporting-goals/readonly-grants-shipment-lines.sql, and the next refresh fills this sheet in."
        : "This refresh has no invoice lines yet. They fill in at the next refresh.";
    put(ws, 1, 1, why, { note: true });
    return;
  }
  headerRow(ws, 1, SHIPMENT_LINE_HEADERS.map((text) => ({ text })));
  freeze(ws, 1);
  const headers = input.shipments.map(
    (s): InvoiceHeader => ({
      key: `sage:${s.invoice}`,
      invoice: s.invoice,
      source: "Sage",
      productCents: toCents(s.productValue),
      otherCents: toCents(s.otherCharges),
    })
  );
  const byInvoice = invoiceLines(headers, data.lines);
  const off: string[] = [];
  let r = 2;
  for (const s of input.shipments) {
    const entry = byInvoice.get(`sage:${s.invoice}`);
    if (!entry) throw new Error(`no lines entry for invoice ${s.invoice}`);
    for (const line of entry.lines) {
      const item = line.kind === "item";
      put(ws, r, 1, s.invoice);
      put(ws, r, 2, excelDate(s.shipDate), { numFmt: DATE_FORMAT });
      put(ws, r, 3, s.customer);
      put(ws, r, 4, item ? "Item" : "Charge");
      put(ws, r, 5, line.code);
      put(ws, r, 6, line.description);
      put(ws, r, 7, item ? decimal(line.qty) : null, { numFmt: QUANTITY_FORMAT });
      put(ws, r, 8, item ? line.unit : null);
      put(ws, r, 9, item ? decimal(line.unitPrice) : null, { numFmt: PRICE_FORMAT });
      put(ws, r, 10, decimal(line.amount), { numFmt: AMOUNT_FORMAT });
      put(ws, r, 11, decimal(line.discount), { numFmt: AMOUNT_FORMAT });
      put(ws, r, 12, s.currency);
      r += 1;
    }
    if (!entry.agrees) {
      off.push(`${s.invoice}: ${entry.lines.length === 0 ? "Sage has no lines for this invoice. " : ""}${linesMismatch(entry, s.currency).join(" ")}`);
    }
  }
  if (input.shipments.length === 0) return;
  r += 1;
  if (off.length === 0) {
    put(ws, r, 1, "Every invoice’s lines add up to the invoice, to the cent.", { note: true });
    return;
  }
  put(ws, r++, 1, `${count(off.length)} ${off.length === 1 ? "invoice’s" : "invoices’"} lines don’t add up to the invoice:`, { note: true });
  for (const text of off) put(ws, r++, 1, text, { note: true });
}

// ─── Revenue by customer class (TASK-3781) ──────────────────────────────────

const CLASS_HEADER_ROW = 4;

/**
 * The Revenue card's month by customer class, as the page's table shows it:
 * the classes' figures are the page's values (USD in CAD is the month's USD
 * converted once and shared by largest remainder); totals, shares and the check
 * against the Goals sheet are formulas.
 */
function revenueByClassSheet(ws: ExcelJS.Worksheet, input: GoalsWorkbookInput): void {
  const { model } = input;
  const data = input.revenueByClass ?? null;
  columns(ws, [26, 12, 16, 18, 16, 18, 16, 10]);
  put(ws, 1, 1, `Revenue by customer class — ${model.month.label}`, { title: true });
  if (!data) {
    put(ws, 2, 1, "Revenue by customer class isn’t in this export.", { note: true });
    return;
  }
  put(
    ws,
    2,
    1,
    "Classes are the sales workbook’s customer categories (Vince’s 5 Oct list), matched by Sage customer code; a customer " +
      `not on it is Unclassified. USD is at ${revenueRateText(input)}: the page’s figures as exported, which don’t follow an ` +
      `edit to Goals!B${INPUT_ROW.rate}.`,
    { note: true }
  );
  headerRow(ws, CLASS_HEADER_ROW, [
    { text: "Customer class" },
    { text: "Invoices (Sage)" },
    { text: "CAD invoiced (Sage)" },
    { text: "USD invoiced, US$ (Sage)" },
    { text: "USD in CAD" },
    { text: "Revenue by hand, CAD", amber: true },
    { text: "Total, CAD" },
    { text: "Share" },
  ]);
  freeze(ws, CLASS_HEADER_ROW);
  const first = CLASS_HEADER_ROW + 1;
  const total = first + data.rows.length;
  data.rows.forEach((c, i) => {
    const r = first + i;
    put(ws, r, 1, c.customerClass);
    put(ws, r, 2, c.invoices, { numFmt: COUNT_FORMAT });
    put(ws, r, 3, dollars(c.cad.cents), { numFmt: AMOUNT_FORMAT });
    put(ws, r, 4, dollars(c.usd.cents), { numFmt: AMOUNT_FORMAT });
    put(ws, r, 5, dollars(c.usd.cadCents), { numFmt: AMOUNT_FORMAT });
    put(ws, r, 6, dollars(c.byHand.cadCents), { numFmt: AMOUNT_FORMAT, amber: true });
    put(ws, r, 7, { formula: `C${r}+E${r}+F${r}` }, { numFmt: AMOUNT_FORMAT, bold: true });
    put(ws, r, 8, { formula: `IF($G$${total}>0,G${r}/$G$${total},"")` }, { numFmt: PERCENT_FORMAT });
  });
  put(ws, total, 1, "All classes", { bold: true });
  for (let col = 2; col <= 7; col += 1) {
    const letter = ws.getColumn(col).letter;
    put(ws, total, col, { formula: `SUM(${letter}${first}:${letter}${total - 1})` }, {
      numFmt: col === 2 ? COUNT_FORMAT : AMOUNT_FORMAT,
      bold: true,
      amber: col === 6,
    });
  }
  // Manufacturing customers (the page's `scope=mfg` line): every class but Exclusive Distribution, as a formula on the rows above.
  const distribution = data.rows.findIndex((c) => c.customerClass === "Exclusive Distribution");
  put(ws, total + 1, 1, "Manufacturing customers (all but Exclusive Distribution)");
  put(ws, total + 1, 7, { formula: distribution >= 0 ? `G${total}-G${first + distribution}` : `G${total}` }, { numFmt: AMOUNT_FORMAT });
  let r = total + 2;
  // The card as the page shows it, which the table checks itself against (Goals!G8 adds up the Daily sheet instead).
  put(ws, r, 1, "Revenue card (on the page)");
  put(ws, r, 7, dollars(data.cardTotalCents), { numFmt: AMOUNT_FORMAT });
  put(ws, r + 1, 1, "Difference");
  put(ws, r + 1, 7, { formula: `G${r}-G${total}` }, { numFmt: AMOUNT_FORMAT });
  r += 3;
  const notes = [
    "USD is converted once for the month, as on the Revenue card, then shared across the classes by largest remainder, so a " +
      "class can be a cent off its own USD converted alone.",
  ];
  if (data.unresolvedByHand.entries > 0) {
    notes.push(
      `Unclassified includes ${count(data.unresolvedByHand.entries)} ${data.unresolvedByHand.entries === 1 ? "shipment" : "shipments"} ` +
        `entered by hand without a Sage customer (${formatAmount(data.unresolvedByHand.cadCents)} CAD).`
    );
  }
  for (const c of data.total.otherCurrencies) {
    notes.push(
      `Not converted: ${c.currency} ${formatAmount(c.cents)} in ${count(c.invoices)} ` +
        `${c.invoices === 1 ? "invoice" : "invoices"}. Only CAD and USD count, as on the Revenue card.`
    );
  }
  if (!data.matchesCard) {
    notes.push(
      "These invoices don’t match the Revenue card’s exactly: Sage changed between two reads of this refresh. The next refresh lines them up."
    );
  }
  for (const text of notes) put(ws, r++, 1, text, { note: true });
}

// ─── The workbook ───────────────────────────────────────────────────────────

/** The ten-sheet workbook as .xlsx bytes. */
export async function buildGoalsWorkbook(input: GoalsWorkbookInput): Promise<Buffer> {
  const { Workbook } = await loadExcelJS();
  const wb = new Workbook();
  wb.creator = "PLX Mission Control";
  wb.created = input.exportedAt;
  wb.modified = input.exportedAt;
  wb.calcProperties.fullCalcOnLoad = true;
  const sheets = {} as Record<WorkbookSheet, ExcelJS.Worksheet>;
  for (const name of WORKBOOK_SHEETS) sheets[name] = wb.addWorksheet(name);

  readMeSheet(sheets["Read me"], input);
  const daily = dailySheet(sheets.Daily, input);
  const trucks = truckloadSheet(sheets.Truckloads, input);
  goalsSheet(sheets.Goals, input, daily, trucks);
  revenueByClassSheet(sheets["Revenue by class"], input);
  batchSheet(sheets.Batches, input);
  shipmentSheet(sheets.Shipments, input);
  shipmentLinesSheet(sheets["Shipment lines"], input);
  forecastSheet(sheets.Forecast, input);
  entriesSheet(sheets[ENTRIES_SHEET], input);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
