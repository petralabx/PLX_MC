// The Goals & Production workbook (TASK-2898): the report and the import
// template in one .xlsx, built from the page model of one good refresh plus that
// run's Sage invoices and truckload shipments. The seven sheets, their order and
// the "Manual entries" layout come from ./layout.ts, shared with the import
// (TASK-2897).
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

import { REPORT_TIME_ZONE } from "../calendar";
import {
  classifyLoad,
  truckloadProductUsdCents,
  type BatchStage,
  type EvaluatedEntry,
  type GoalsModel,
  type LoadKind,
  type LoadTally,
} from "../rules";
import type { FxRate, GoalSettings, IsoDate, RefreshRun, ShipmentRow, TruckloadRow } from "../types";
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
}

// ─── Fixed cells (the brief's formulas name them: =B13*B11, Goals!$B$17, …) ─

const GOAL_ROW = { header: 4, large: 5, full: 6, partial: 7, revenue: 8 } as const;

/** The Goals assumptions block. Rows 11–19 are the brief's; 20–21 (working days covered) feed "Due so far". */
const INPUT_ROW = {
  workingDays: 11,
  workingDaysLeft: 12,
  perDay: 13,
  largeMinKg: 14,
  fullMinUsd: 15,
  revenueTarget: 16,
  rate: 17,
  productionCutoff: 18,
  sageCutoff: 19,
  productionCovered: 20,
  revenueCovered: 21,
} as const;

const goalsInput = (row: number) => `Goals!$B$${row}`;

const DATE_FORMAT = "yyyy-mm-dd";
const RATE_FORMAT = "0.0000";
const PER_DAY_FORMAT = "0.0";
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
    `4. Batch: fill in kg (${count(settings.largeBatchMinKg)} kg or more is a large batch). Shipment: fill in Product value (before tax and freight), Freight, and Currency (CAD or USD).`,
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

  put(ws, R.large, 1, `Large batches (${count(settings.largeBatchMinKg)} kg or more)`);
  put(ws, R.large, 2, { formula: `B${I.perDay}*B${I.workingDays}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.large, 3, { formula: `B${I.perDay}*B${I.productionCovered}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.large, 4, excelDate(model.largeBatches.dueBy), { numFmt: DATE_FORMAT });
  put(ws, R.large, 5, { formula: `Daily!C${daily.total}` }, { numFmt: COUNT_FORMAT });
  put(ws, R.large, 6, { formula: `Daily!D${daily.total}` }, { numFmt: COUNT_FORMAT, amber: true });
  put(ws, R.large, 7, total(R.large), { numFmt: COUNT_FORMAT, bold: true });
  put(ws, R.large, 8, status(R.large));
  put(ws, R.large, 9, needed(R.large), { numFmt: PER_DAY_FORMAT });

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

  // Revenue in the system: CAD plus USD at the rate, rounded to the cent like the model.
  put(ws, R.revenue, 1, "Revenue, CAD (shipped, net before tax)");
  put(ws, R.revenue, 2, { formula: `B${I.revenueTarget}` }, { numFmt: DOLLAR_FORMAT });
  put(ws, R.revenue, 3, { formula: `ROUND(B${I.revenueTarget}*B${I.revenueCovered}/B${I.workingDays},2)` }, { numFmt: DOLLAR_FORMAT });
  put(ws, R.revenue, 4, excelDate(model.revenue.dueBy), { numFmt: DATE_FORMAT });
  put(ws, R.revenue, 5, { formula: `ROUND(Daily!F${daily.total}+Daily!G${daily.total}*B${I.rate},2)` }, { numFmt: DOLLAR_FORMAT });
  put(ws, R.revenue, 6, { formula: `Daily!H${daily.total}` }, { numFmt: DOLLAR_FORMAT, amber: true });
  put(ws, R.revenue, 7, total(R.revenue), { numFmt: DOLLAR_FORMAT, bold: true });
  put(ws, R.revenue, 8, status(R.revenue));
  put(ws, R.revenue, 9, needed(R.revenue), { numFmt: DOLLAR_FORMAT });

  const rateNote =
    run.fxSource === "stored"
      ? `Last stored Bank of Canada rate, for ${run.fxRateDate ?? "an unknown date"}; the refresh couldn’t fetch a newer one`
      : `Bank of Canada daily rate (FXUSDCAD) for ${run.fxRateDate ?? "an unknown date"}`;
  const inputs: [row: number, label: string, value: ExcelJS.CellValue, numFmt: string | undefined, note: string | null][] = [
    [I.workingDays, "Working days this month", model.calendar.workingDays, COUNT_FORMAT, "Monday to Friday, less Ontario public holidays"],
    [I.workingDaysLeft, "Working days left, from today", model.calendar.remaining, COUNT_FORMAT, `${model.today} to ${model.month.end}, today included`],
    [I.perDay, "Large batches per working day (target)", settings.largeBatchesPerWorkingDay, COUNT_FORMAT, "Your goal"],
    [I.largeMinKg, "Large batch minimum, kg", settings.largeBatchMinKg, COUNT_FORMAT, "Your goal"],
    [I.fullMinUsd, "Full truckload minimum, US$ before tax and freight", settings.fullTruckloadMinUsdCents / 100, DOLLAR_FORMAT, "Your goal"],
    [I.revenueTarget, "Revenue target, CAD", settings.revenueTargetCadCents / 100, DOLLAR_FORMAT, "Your goal"],
    [I.rate, "USD/CAD rate", Number(model.revenue.rate), RATE_FORMAT, rateNote],
    [I.productionCutoff, "FileMaker data through", excelDate(model.cutoffs.productionCutoff), DATE_FORMAT, null],
    [I.sageCutoff, "Sage data through", excelDate(model.cutoffs.sageCutoff), DATE_FORMAT, null],
    [
      I.productionCovered,
      "Working days covered, production",
      workingDaysTo(model, model.largeBatches.dueBy),
      COUNT_FORMAT,
      `To ${model.largeBatches.dueBy}: FileMaker’s data, or a later large batch entered by hand`,
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
    { text: "Large batches done (FileMaker)" },
    { text: "Large batches done (by hand)", amber: true },
    { text: "Large batches still scheduled" },
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
    put(ws, r, 3, d.largeDone, { numFmt: COUNT_FORMAT });
    put(ws, r, 4, d.largeByHand, { numFmt: COUNT_FORMAT, amber: true });
    put(ws, r, 5, d.largeScheduled, { numFmt: COUNT_FORMAT });
    put(ws, r, 6, dollars(d.cadCents), { numFmt: DOLLAR_FORMAT });
    put(ws, r, 7, dollars(d.usdCents), { numFmt: DOLLAR_FORMAT });
    put(ws, r, 8, dollars(d.byHandCadCents), { numFmt: DOLLAR_FORMAT, amber: true });
    put(ws, r, 9, { formula: `SUM($F$2:F${r})+SUM($G$2:G${r})*${goalsInput(I.rate)}+SUM($H$2:H${r})` }, { numFmt: DOLLAR_FORMAT });
    put(
      ws,
      r,
      10,
      { formula: `ROUND(${goalsInput(I.revenueTarget)}*COUNTIF($B$2:B${r},"Yes")/${goalsInput(I.workingDays)},2)` },
      { numFmt: DOLLAR_FORMAT }
    );
    // Last month on the same day of the month, at today's rate (its daily figures aren't in the workbook).
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
    { text: `Large (${count(input.settings.largeBatchMinKg)} kg+)` },
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
    put(ws, r, 7, { formula: `IF(E${r}>=${goalsInput(INPUT_ROW.largeMinKg)},"Yes","")` }, { amber });
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
    const kind = classifyLoad(truckloadProductUsdCents(row, input.rates, input.model.revenue.rate), input.settings);
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

// ─── The workbook ───────────────────────────────────────────────────────────

/** The seven-sheet workbook as .xlsx bytes. */
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
  batchSheet(sheets.Batches, input);
  shipmentSheet(sheets.Shipments, input);
  entriesSheet(sheets[ENTRIES_SHEET], input);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
