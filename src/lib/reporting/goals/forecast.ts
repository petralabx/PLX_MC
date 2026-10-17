// Revenue forecast (TASK-3151): this month's open Sage order lines matched to
// FileMaker's plan through their assembly orders (AOs), every line portion in
// exactly one bucket, and the four numbers against the revenue target. Pure: no
// I/O and no clock (today, the run's rate and the history are passed in).
//
// The link and the AO rules are the portal's Projected Revenue
// (portal/src/lib/inventory/projected-revenue.ts) and AO lifecycle
// (portal/src/lib/inventory/assembly-lifecycle.ts). Every interpretation lives
// in one named function here, or one named SQL fragment in
// queries/forecast-*.ts, so it is one edit after the operator reconciles orders
// against Sage's own screens (README, "Interpretations to confirm").

import { addDays, monthEnd, monthLabel, monthStart } from "./calendar";
import { convertCents, prorateCents, toCents } from "./money";
import { missingByRelation } from "./queries/read-access";
import { normalizeName, type GoalsModel } from "./rules";
import type { ForecastAoRow, ForecastDatasets, ForecastLineRow, GoalSettings, IsoDate } from "./types";

// ─── Buckets ────────────────────────────────────────────────────────────────

export const FORECAST_BUCKETS = ["ready", "planned", "late", "not_planned"] as const;
export type ForecastBucket = (typeof FORECAST_BUCKETS)[number];

export const FORECAST_BUCKET_LABELS: Record<ForecastBucket, string> = {
  ready: "Ready",
  planned: "Planned in time",
  late: "Late",
  not_planned: "Not planned",
};

// ─── The link: Sage ORDNUMBER + ITEM ↔ the AO's order list + item code ──────

/**
 * The portal's "OE Fix" (DAX on ASSEMBLY[oeList_c], MID is 1-indexed):
 * MID(OE,6,1)="0" → LEFT(OE,12), else "OR1000" & MID(OE,6,6).
 */
export function fixOeNumber(oe: string | null | undefined): string {
  const value = (oe ?? "").trim();
  if (!value) return "";
  if (value.charAt(5) === "0") return value.slice(0, 12).trim();
  return `OR1000${value.slice(5, 11)}`.trim();
}

/** Every order number in an AO's free-text list (comma or semicolon separated), OE-Fixed, in order, once each (the portal's oeNumbersFromList). */
export function oeNumbersFromList(list: string | null | undefined): string[] {
  const raw = (list ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts.length > 0 ? parts : [raw]) {
    const fixed = fixOeNumber(part);
    if (fixed && !out.includes(fixed)) out.push(fixed);
  }
  return out;
}

/** The order an AO is linked to: the first in its list, as the portal's Projected Revenue joins. */
export function linkedOrderNumber(list: string | null | undefined): string | null {
  return oeNumbersFromList(list)[0] ?? null;
}

/** The join key: ORDNUMBER-ITEM on the Sage side, OE Fix-BVCODE on the AO side. */
export function orderItemKey(orderNo: string, item: string): string {
  return `${orderNo.trim()}-${item.trim()}`;
}

// ─── FileMaker AO and bulk statuses, and units ──────────────────────────────

export type AoStage = "realized" | "cancelled" | "open";

/** An AO's status as the portal canonicalizes it: Realized or Completed is packed; Cancelled never counts; anything else is open. */
export function aoStage(status: string | null | undefined): AoStage {
  const value = (status ?? "").trim();
  if (/^(real|complet)/i.test(value)) return "realized";
  if (/^cancel/i.test(value)) return "cancelled";
  return "open";
}

/** The AO's bulk batch is made once FileMaker marks it Realized (as the goals count completed batches). */
export function isBulkMade(batchStatus: string | null | undefined): boolean {
  return (batchStatus ?? "").trim().toLowerCase() === "realized";
}

/** A case unit of measure (the portal's isCaseUom). */
export function isCaseUnit(unit: string | null | undefined): boolean {
  const value = (unit ?? "").trim().toUpperCase();
  return value === "CSE" || value === "CS" || value === "CASE";
}

/**
 * An AO's quantity (pieces, in hundredths) in an order line's unit (hundredths):
 * cases when the line is in cases and the AO packs more than one piece a box
 * (the portal's "fmconv > 1" rule), else pieces as they are. Never negative.
 */
export function aoQtyInLineUnit(aoQty: string | null, lineUnit: string | null, unitsPerBox: string | null): number {
  const pieces = Math.max(0, toCents(aoQty));
  const perBox = toCents(unitsPerBox);
  return isCaseUnit(lineUnit) && perBox > 100 ? prorateCents(pieces, 100, perBox) : pieces;
}

/**
 * The approved precedence, first match wins: the AO is packed → Ready; it is
 * scheduled after month end → Late (it can't ship this month, bulk or not);
 * its bulk batch is made → Ready (only packing remains); it is scheduled from
 * today to month end → Planned in time; before today and not done → Late; no
 * AO → Not planned. An AO with no scheduled date isn't on the plan: Not planned.
 */
export function bucketFor(ao: ForecastAoRow | null, today: IsoDate, end: IsoDate): ForecastBucket {
  if (!ao) return "not_planned";
  if (aoStage(ao.status) === "realized") return "ready";
  if (ao.scheduled !== null && ao.scheduled > end) return "late";
  if (isBulkMade(ao.batchStatus)) return "ready";
  if (ao.scheduled === null) return "not_planned";
  return ao.scheduled >= today ? "planned" : "late";
}

// ─── Rows: one per line portion ─────────────────────────────────────────────

export interface ForecastRow {
  key: string;
  orderNo: string;
  lineNo: number | null;
  customerCode: string | null;
  customer: string | null;
  po: string | null;
  item: string;
  description: string | null;
  expected: IsoDate;
  /** Expected before today (still due this month). */
  overdue: boolean;
  /** Still to ship in this portion, in the line's unit. */
  qty: number;
  unit: string | null;
  unitPrice: string;
  currency: string;
  /** Quantity × unit price in the order's currency, cents rounded half to even. */
  valueCents: number;
  /** CAD at the run's rate; null for currencies other than CAD and USD (never converted). */
  cadCents: number | null;
  bucket: ForecastBucket;
  ao: { id: string; number: string; scheduled: IsoDate | null; status: string | null } | null;
  bulk: { batch: string | null; status: string | null } | null;
}

/** Packed AOs first (their output exists), then by scheduled date (undated first), then id. */
function streamOrder(a: ForecastAoRow, b: ForecastAoRow): number {
  const packed = (x: ForecastAoRow) => (aoStage(x.status) === "realized" ? 0 : 1);
  if (packed(a) !== packed(b)) return packed(a) - packed(b);
  const da = a.scheduled ?? "";
  const db = b.scheduled ?? "";
  if (da !== db) return da < db ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toRow(line: ForecastLineRow, key: string, qtyHundredths: number, ao: ForecastAoRow | null, today: IsoDate, rate: string): ForecastRow {
  const valueCents = convertCents(qtyHundredths, line.unitPrice);
  const cadCents = line.currency === "CAD" ? valueCents : line.currency === "USD" ? convertCents(valueCents, rate) : null;
  return {
    key,
    orderNo: line.orderNo,
    lineNo: line.lineNo,
    customerCode: line.customerCode,
    customer: line.customer,
    po: line.po,
    item: line.item,
    description: line.description,
    expected: line.expected,
    overdue: line.expected < today,
    qty: qtyHundredths / 100,
    unit: line.unit,
    unitPrice: line.unitPrice,
    currency: line.currency,
    valueCents,
    cadCents,
    bucket: bucketFor(ao, today, monthEnd(today)),
    ao: ao ? { id: ao.id, number: ao.ao ?? ao.id, scheduled: ao.scheduled, status: ao.status } : null,
    bulk: ao ? { batch: ao.batch, status: ao.batchStatus } : null,
  };
}

/**
 * Splits every open line across the AOs linked to it. The AOs of one order and
 * item are taken as one stream of output, packed first then by date, each with
 * its own date and quantity. Output beyond what the order's open lines of that
 * item still need (those due later too) is taken from the start of the stream
 * (it most likely shipped already); the rest fills the lines in expected-date
 * order, and what no AO covers is Not planned. Lines come back in the
 * datasets' order, each followed by its portions.
 */
export function forecastRows(data: Pick<ForecastDatasets, "lines" | "aos">, today: IsoDate, rate: string): ForecastRow[] {
  const aosByKey = new Map<string, ForecastAoRow[]>();
  for (const ao of data.aos) {
    if (aoStage(ao.status) === "cancelled") continue;
    const order = linkedOrderNumber(ao.oeList);
    const item = (ao.item ?? "").trim();
    if (!order || !item) continue;
    const key = orderItemKey(order, item);
    aosByKey.set(key, [...(aosByKey.get(key) ?? []), ao]);
  }
  const groups = new Map<string, { line: ForecastLineRow; index: number }[]>();
  data.lines.forEach((line, index) => {
    const key = orderItemKey(line.orderNo, line.item);
    groups.set(key, [...(groups.get(key) ?? []), { line, index }]);
  });

  const rowsByLine: ForecastRow[][] = data.lines.map(() => []);
  for (const [key, lines] of groups) {
    // Lines of one order and item share the first line's unit.
    const unit = lines[0].line.unit;
    const stream = [...(aosByKey.get(key) ?? [])]
      .sort(streamOrder)
      .map((ao) => ({ ao, left: aoQtyInLineUnit(ao.qty, unit, ao.unitsPerBox) }));
    // Due lines first, then the order's later lines of the item (laterQty, the same on each line).
    const need = lines.reduce((n, { line }) => n + toCents(line.qty), 0) + toCents(lines[0].line.laterQty);
    let shipped = Math.max(0, stream.reduce((n, p) => n + p.left, 0) - need);
    for (const portion of stream) {
      const taken = Math.min(portion.left, shipped);
      portion.left -= taken;
      shipped -= taken;
    }
    let at = 0;
    for (const { line, index } of lines) {
      let left = toCents(line.qty);
      const out = rowsByLine[index];
      const keyFor = () => `${line.orderNo}:${index}:${out.length}`;
      while (left > 0 && at < stream.length) {
        const portion = stream[at];
        if (portion.left === 0) {
          at += 1;
          continue;
        }
        const take = Math.min(left, portion.left);
        out.push(toRow(line, keyFor(), take, portion.ao, today, rate));
        left -= take;
        portion.left -= take;
      }
      if (left > 0) out.push(toRow(line, keyFor(), left, null, today, rate));
    }
  }
  return rowsByLine.flat();
}

/** CAD of the rows that convert (CAD and USD). */
export function forecastCadCents(rows: readonly ForecastRow[]): number {
  return rows.reduce((n, row) => n + (row.cadCents ?? 0), 0);
}

/** Rows in other currencies, totalled per currency and never converted (as the Revenue card lists them). */
export function otherCurrencyTotals(rows: readonly ForecastRow[]): { currency: string; cents: number; rows: number }[] {
  const out: { currency: string; cents: number; rows: number }[] = [];
  for (const row of rows) {
    if (row.cadCents !== null) continue;
    let total = out.find((t) => t.currency === row.currency);
    if (!total) out.push((total = { currency: row.currency, cents: 0, rows: 0 }));
    total.cents += row.valueCents;
    total.rows += 1;
  }
  return out;
}

function bucketTotals(rows: readonly ForecastRow[]): Record<ForecastBucket, { cents: number; rows: number }> {
  const totals = Object.fromEntries(FORECAST_BUCKETS.map((b) => [b, { cents: 0, rows: 0 }])) as Record<
    ForecastBucket,
    { cents: number; rows: number }
  >;
  for (const row of rows) {
    totals[row.bucket].rows += 1;
    totals[row.bucket].cents += row.cadCents ?? 0;
  }
  return totals;
}

/** What each run stores (Sage and FileMaker only, no entries by hand): the hit rate is measured from it. */
export interface ForecastSummary {
  lines: number;
  rows: number;
  readyCents: number;
  plannedCents: number;
  lateCents: number;
  notPlannedCents: number;
}

export function forecastSummary(data: Pick<ForecastDatasets, "lines" | "aos">, today: IsoDate, rate: string): ForecastSummary {
  const rows = forecastRows(data, today, rate);
  const totals = bucketTotals(rows);
  return {
    lines: data.lines.length,
    rows: rows.length,
    readyCents: totals.ready.cents,
    plannedCents: totals.planned.cents,
    lateCents: totals.late.cents,
    notPlannedCents: totals.not_planned.cents,
  };
}

/** Open AOs scheduled this month whose order and item match no open Sage order line: production with no order behind it. */
export function productionWithoutOrders(aos: readonly ForecastAoRow[], today: IsoDate): { count: number; pieces: number } {
  const start = monthStart(today);
  const end = monthEnd(today);
  const unordered = aos.filter(
    (ao) => aoStage(ao.status) === "open" && ao.scheduled !== null && ao.scheduled >= start && ao.scheduled <= end && !ao.openOrder
  );
  return { count: unordered.length, pieces: unordered.reduce((n, ao) => n + Math.max(0, toCents(ao.qty)), 0) / 100 };
}

// ─── The hit rate, measured from the stored per-run summaries ───────────────

/** Complete months the hit rate averages over, newest first. */
export const HIT_RATE_MONTHS = 3;

/** One good run, as the loader reads it back: its rate, its forecast summary and its Sage invoices (cents). */
export interface ForecastRunPoint {
  runId: number;
  today: IsoDate;
  rate: string;
  /** Ready + Planned in time at this run (CAD, Sage and FileMaker only); null when the run had no forecast. */
  readyPlannedCents: number | null;
  sage: { cadThisMonth: number; usdThisMonth: number; cadLastMonth: number; usdLastMonth: number };
}

export interface HitRateMonth {
  month: IsoDate;
  label: string;
  /** The month's first good run. */
  firstRunId: number;
  firstRunDay: IsoDate;
  /** The last good run of the month after: its "last month" invoices are the month's, complete. */
  closingRunId: number;
  readyPlannedCents: number;
  /** Sage revenue invoiced in the month after its first run, at that run's rate. */
  invoicedAfterCents: number;
}

/**
 * The good runs on record by month. A month counts when its first good run had
 * a forecast and it isn't the oldest month on record: runs are kept 90 days, so
 * that month's first runs may be gone.
 */
function runsOnRecord(points: readonly ForecastRunPoint[]) {
  const runs = [...points].sort((a, b) => a.runId - b.runId);
  const months = [...new Set(runs.map((p) => monthStart(p.today)))].sort();
  const inMonth = (month: IsoDate) => runs.filter((p) => monthStart(p.today) === month);
  const counts = (month: IsoDate) => {
    const first = inMonth(month)[0];
    return month !== months[0] && first !== undefined && first.readyPlannedCents !== null;
  };
  return { months, inMonth, counts };
}

/**
 * Each complete month's hit rate = Sage revenue invoiced in the month after its
 * first good run ÷ (Ready + Planned in time) at that run. Up to
 * HIT_RATE_MONTHS of the latest measurable months, newest first. A month is
 * skipped unless it counts (runsOnRecord), when its first run had nothing ready
 * or planned, and when there is no run in the month after it to close it.
 */
export function hitRateMonths(points: readonly ForecastRunPoint[], today: IsoDate): HitRateMonth[] {
  const current = monthStart(today);
  const { months, inMonth, counts } = runsOnRecord(points);
  const out: HitRateMonth[] = [];
  for (const month of [...months].reverse()) {
    if (out.length === HIT_RATE_MONTHS) break;
    if (month >= current || !counts(month)) continue;
    const first = inMonth(month)[0];
    if (!first.readyPlannedCents) continue;
    const after = inMonth(monthStart(addDays(monthEnd(month), 1)));
    const closing = after[after.length - 1];
    if (!closing) continue;
    const invoicedAfterCents =
      closing.sage.cadLastMonth -
      first.sage.cadThisMonth +
      convertCents(closing.sage.usdLastMonth - first.sage.usdThisMonth, first.rate);
    out.push({
      month,
      label: monthLabel(month),
      firstRunId: first.runId,
      firstRunDay: first.today,
      closingRunId: closing.runId,
      readyPlannedCents: first.readyPlannedCents,
      invoicedAfterCents,
    });
  }
  return out;
}

// ─── The section's model ────────────────────────────────────────────────────

/** A run's forecast datasets plus every retained good run's point for the hit rate (the loader's read). */
export interface ForecastSnapshot {
  data: ForecastDatasets;
  history: ForecastRunPoint[];
}

export interface ForecastReady {
  state: "ready";
  rows: ForecastRow[];
  targetCents: number;
  /** The Revenue card's figure: Sage invoices at the Bank of Canada rate plus counted shipments entered by hand. */
  invoicedCents: number;
  buckets: Record<ForecastBucket, { cents: number; rows: number }>;
  /** Invoiced + Ready + Planned in time. */
  theoreticalCents: number;
  /** Late + Not planned. */
  atRiskCents: number;
  /** Invoiced + (Ready + Planned in time) × the average hit rate; null until a complete month is measured. */
  realistic: { cents: number; hitRate: number; months: HitRateMonth[] } | null;
  /** The first month the hit rate measures: the first that counts (runsOnRecord), else next month. Shown until one is measured. */
  measuredFrom: IsoDate;
  /** Invoiced ÷ revenue working days covered × working days in the month; null before a day is covered. */
  pace: { cents: number; coveredDays: number; workingDays: number } | null;
  otherCurrencies: { currency: string; cents: number; rows: number }[];
  /** Open AOs scheduled this month with no open order behind them: a note, never revenue. */
  unordered: { count: number; pieces: number };
}

export type ForecastView =
  | { state: "not_in_run" }
  | { state: "waiting_for_access"; missing: { relation: string; columns: string[] }[] }
  | ForecastReady;

export interface ForecastInput {
  /** null: the run predates the forecast (it fills in at the next refresh). */
  snapshot: ForecastSnapshot | null;
  model: GoalsModel;
  settings: GoalSettings;
  /** The run's USD/CAD rate (the Revenue card's). */
  rate: string;
}

export function buildForecast(input: ForecastInput): ForecastView {
  const { snapshot, model, settings, rate } = input;
  if (!snapshot) return { state: "not_in_run" };
  if (snapshot.data.access === "missing") return { state: "waiting_for_access", missing: missingByRelation(snapshot.data.missing) };

  const rows = forecastRows(snapshot.data, model.today, rate);
  const buckets = bucketTotals(rows);
  const invoicedCents = model.revenue.totalCents;
  const readyPlanned = buckets.ready.cents + buckets.planned.cents;

  const months = hitRateMonths(snapshot.history, model.today);
  const terms = months.map((m) => prorateCents(readyPlanned, m.invoicedAfterCents, m.readyPlannedCents));
  const realistic =
    months.length > 0
      ? {
          cents: invoicedCents + prorateCents(terms.reduce((n, t) => n + t, 0), 1, months.length),
          hitRate: months.reduce((n, m) => n + m.invoicedAfterCents / m.readyPlannedCents, 0) / months.length,
          months,
        }
      : null;
  const record = runsOnRecord(snapshot.history);
  const measuredFrom = record.months.find(record.counts) ?? monthStart(addDays(monthEnd(model.today), 1));

  const workingDays = model.calendar.workingDays;
  const coveredDays = model.calendar.days.filter((d) => d.isWorkingDay && d.day <= model.coveredThrough.revenue).length;

  return {
    state: "ready",
    rows,
    targetCents: settings.revenueTargetCadCents,
    invoicedCents,
    buckets,
    theoreticalCents: invoicedCents + readyPlanned,
    atRiskCents: buckets.late.cents + buckets.not_planned.cents,
    realistic,
    measuredFrom,
    pace: coveredDays > 0 ? { cents: prorateCents(invoicedCents, workingDays, coveredDays), coveredDays, workingDays } : null,
    otherCurrencies: otherCurrencyTotals(rows),
    unordered: productionWithoutOrders(snapshot.data.aos, model.today),
  };
}

// ─── The list's chips and search ────────────────────────────────────────────

export type ForecastFilter = "all" | ForecastBucket;

export const FORECAST_FILTERS: { key: ForecastFilter; label: string }[] = [
  { key: "all", label: "All" },
  ...FORECAST_BUCKETS.map((bucket) => ({ key: bucket, label: FORECAST_BUCKET_LABELS[bucket] })),
];

/** Rows in the chosen bucket whose order, customer (name or code), PO, item, description or AO contain the search, ignoring case and spacing. */
export function filterForecastRows(rows: readonly ForecastRow[], opts: { filter: ForecastFilter; query: string }): ForecastRow[] {
  const needle = normalizeName(opts.query);
  return rows.filter(
    (row) =>
      (opts.filter === "all" || row.bucket === opts.filter) &&
      (!needle ||
        normalizeName(
          [row.orderNo, row.customer, row.customerCode, row.po, row.item, row.description, row.ao?.number].filter(Boolean).join(" ")
        ).includes(needle))
  );
}
