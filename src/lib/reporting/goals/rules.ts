// Goals & Production business rules — the contract with the business (the
// brief's "Business rules" section, plus the decisions approved in the plan:
// half-to-even cents per converted amount, and the data-is-behind banner counted
// in working days; and, from 2026-10-16, Line 1 bulk kg in place of large
// batches). Pure: no I/O and no clock — `today` is always passed in.
// Every rule is tested against the 2026-10-14 fixtures in
// tests/reporting-goals-rules.test.ts.

import { addDays, eachDay, isWorkingDay, monthEnd, monthLabel, monthStart, workingDaysBetween } from "./calendar";
import { convertCents, formatDollars, invertCents, prorateCents, toCents } from "./money";
import type {
  BatchRow,
  Cutoffs,
  EntryStatus,
  FtlCustomer,
  FxRate,
  GoalSettings,
  IsoDate,
  ManualEntry,
  RevenueRateBasis,
  SnapshotData,
  TruckloadRow,
} from "./types";

// ─── Size bands ─────────────────────────────────────────────────────────────

export const SIZE_BANDS = ["~10,000", "5,000–8,999", "Under 5,000", "Over 11,000"] as const;
export type SizeBand = (typeof SIZE_BANDS)[number];

/** ~10,000 is 9,000–11,000 kg inclusive, so 9,000–9,999 is ~10,000, not 5,000–8,999. */
export function sizeBand(kg: number): SizeBand {
  if (kg >= 9000 && kg <= 11000) return "~10,000";
  if (kg > 11000) return "Over 11,000";
  if (kg >= 5000) return "5,000–8,999";
  return "Under 5,000";
}

/** Batches completed per 20 working days at the current rate. */
export function pacePer20(count: number, workingDaysCovered: number): number | null {
  return workingDaysCovered > 0 ? (count / workingDaysCovered) * 20 : null;
}

export function isQcReleased(statusQc: string | null): boolean {
  return /\breleased\b/i.test(statusQc ?? "");
}

// ─── Matching ───────────────────────────────────────────────────────────────

/** Reference key: case- and space-insensitive (every space, including no-break spaces, removed). */
export function normalizeRef(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

/** Customer-name key: lower case, runs of spaces (including no-break spaces) collapsed. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/** The truckload customer a shipment is for: by Sage code, else by a name fragment. */
export function truckloadCustomerFor(
  shipment: { customer: string | null; customerCode: string | null },
  customers: readonly FtlCustomer[]
): FtlCustomer | null {
  const codes = [shipment.customerCode, shipment.customer].map((v) => (v ?? "").trim().toUpperCase());
  const byCode = customers.find((c) => codes.includes(c.code.toUpperCase()));
  if (byCode) return byCode;
  const name = normalizeName(shipment.customer);
  if (!name) return null;
  return customers.find((c) => c.namePatterns.some((p) => name.includes(normalizeName(p)))) ?? null;
}

export type LoadKind = "full" | "partial";

/** A truckload shipment's product in US cents: its USD product plus any CAD product at its ship date's rate. */
export function truckloadProductUsdCents(
  row: Pick<TruckloadRow, "productUsd" | "productCad" | "shipDate">,
  rates: readonly FxRate[],
  fallbackRate: string
): number {
  const cadCents = toCents(row.productCad);
  return toCents(row.productUsd) + (cadCents === 0 ? 0 : invertCents(cadCents, rateOn(rates, row.shipDate, fallbackRate)));
}

/** A shipment's product value (US$ cents, before tax and freight): full, partial, or never a load (≤ 0). */
export function classifyLoad(productUsdCents: number, settings: GoalSettings): LoadKind | null {
  if (productUsdCents <= 0) return null;
  return productUsdCents >= settings.fullTruckloadMinUsdCents ? "full" : "partial";
}

/** The latest rate on or before `day`, if any. */
export function latestRateOnOrBefore(rates: readonly FxRate[], day: IsoDate): FxRate | null {
  let best: FxRate | null = null;
  for (const r of rates) if (r.date <= day && (!best || r.date > best.date)) best = r;
  return best;
}

/** The day's rate: the latest stored rate on or before `day`, else `fallback`. */
export function rateOn(rates: readonly FxRate[], day: IsoDate, fallback: string): string {
  return latestRateOnOrBefore(rates, day)?.rate ?? fallback;
}

// ─── Manual entries ─────────────────────────────────────────────────────────

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  in_filemaker: "In FileMaker now",
  in_sage: "In Sage now",
  needs_date: "Needs a date",
  not_this_month: "Not this month",
  needs_kg: "Needs kg",
  needs_value: "Needs a value",
  bad_type: "Type must be Batch or Shipment",
  counted: "Counted",
};

export interface EntryContext {
  monthStart: IsoDate;
  monthEnd: IsoDate;
  /** Normalized display numbers of every Realized FileMaker batch (any date). */
  filemakerRefs: ReadonlySet<string>;
  /** Normalized invoice, shipment, order and PO numbers from the last 120 days of Sage invoices. */
  sageRefs: ReadonlySet<string>;
}

function kgOf(value: string | null): number {
  const kg = Number(value ?? "");
  return Number.isFinite(kg) ? kg : 0;
}

/** kg (3 decimal places at most, as the batch list holds them) as whole grams, so sums of kg never drift. */
function grams(kg: number): number {
  return Math.round(kg * 1000);
}

/** Status of a manual entry; the first match wins (brief: "Status (computed, never stored)"). */
export function entryStatus(entry: ManualEntry, ctx: EntryContext): EntryStatus {
  const ref = normalizeRef(entry.reference);
  if (entry.type === "Batch" && ref && ctx.filemakerRefs.has(ref)) return "in_filemaker";
  if (entry.type === "Shipment" && ref && ctx.sageRefs.has(ref)) return "in_sage";
  if (!entry.date) return "needs_date";
  if (entry.date < ctx.monthStart || entry.date > ctx.monthEnd) return "not_this_month";
  if (entry.type === "Batch") return kgOf(entry.kg) > 0 ? "counted" : "needs_kg";
  if (entry.type === "Shipment") {
    const hasProduct = entry.productValue !== null && entry.productValue.trim() !== "";
    const product = toCents(entry.productValue);
    const currencyOk = entry.currency === "CAD" || entry.currency === "USD";
    return hasProduct && product >= 0 && product + toCents(entry.freight) > 0 && currencyOk
      ? "counted"
      : "needs_value";
  }
  return "bad_type";
}

export interface EvaluatedEntry extends ManualEntry {
  status: EntryStatus;
  statusLabel: string;
  counts: boolean;
  /** A counted batch of at least the Line 1 minimum (assumed to run on Line 1). */
  line1: boolean;
  /** The open FileMaker batch this counted batch entry completes, if its reference matches one. */
  completesBatchId: string | null;
  /** A counted shipment's product value plus freight, in CAD cents. */
  revenueCadCents: number;
  /** A counted shipment to a truckload customer. */
  truckload: { code: string; kind: LoadKind; productUsdCents: number } | null;
}

// ─── Goals ──────────────────────────────────────────────────────────────────

export type GoalStatus = "on_track" | "behind";

export interface GoalsInput {
  /** The Toronto date the snapshot was taken for. */
  today: IsoDate;
  holidays: ReadonlySet<IsoDate>;
  settings: GoalSettings;
  ftlCustomers: readonly FtlCustomer[];
  /** The run's Bank of Canada USD/CAD rate: revenue's unless `revenueRate` is given, and always the truckload test's fallback. */
  rate: string;
  /** USD/CAD for revenue (TASK-3780): the fixed Sage rate on the Sage view; omitted, `rate`. */
  revenueRate?: string;
  /** Which rate `revenueRate` is; omitted, boc. */
  revenueBasis?: RevenueRateBasis;
  /** Stored rate history, for a CAD shipment's own-day rate. */
  rates: readonly FxRate[];
  data: SnapshotData;
  entries: readonly ManualEntry[];
  filemakerRefs: ReadonlySet<string>;
  sageRefs: ReadonlySet<string>;
  /**
   * A page narrowed to some salespeople's customers (TASK-4277) keeps the
   * whole page's revenue covered-through date, so a hand entry of a customer
   * left out still says how far the data reaches, and due so far stays the same.
   */
  revenueCoveredThrough?: IsoDate;
  /** false when last month's revenue can't follow the page (Sage's month totals aren't split by customer): its figures are null. */
  lastMonthRevenue?: boolean;
}

export interface CalendarDay {
  day: IsoDate;
  isWorkingDay: boolean;
  /** Working days from the 1st through this day. */
  workingDaysToDate: number;
}

export interface LoadCounts {
  inSystem: number;
  byHand: number;
  total: number;
}

export interface LoadTally {
  full: number;
  partial: number;
  productUsdCents: number;
}

export interface TruckloadCustomerRow {
  code: string;
  name: string;
  thisMonth: LoadTally;
  byHand: LoadTally;
  lastMonth: LoadTally;
}

export interface DailyPoint {
  day: IsoDate;
  isWorkingDay: boolean;
  isToday: boolean;
  isFuture: boolean;
  /** Line 1 bulk kg on this day: completed in FileMaker, entered by hand, and open (planned kg). */
  line1DoneKg: number;
  line1ByHandKg: number;
  line1ScheduledKg: number;
  cadCents: number;
  usdCents: number;
  byHandCadCents: number;
  sageToDateCents: number;
  withHandToDateCents: number;
  targetToDateCents: number;
  /** null when last month's revenue can't follow a salesperson filter (TASK-4277). */
  lastMonthToDateCents: number | null;
}

export type BatchStage = "completed" | "completed_by_hand" | "scheduled" | "open_past_date";

export interface BatchListRow {
  key: string;
  batch: string;
  product: string | null;
  stage: BatchStage;
  status: string;
  statusQc: string | null;
  date: IsoDate;
  kg: number;
  band: SizeBand;
  /** At least the Line 1 minimum, so assumed to run on Line 1 (whatever `line` FileMaker records). */
  line1: boolean;
  line: string | null;
  source: "FileMaker" | "By hand";
  entryId: string | null;
}

export interface BandTile {
  band: SizeBand | "Total";
  count: number;
  kg: number;
  pacePer20: number | null;
  notQcReleased: number;
}

export interface BandCount {
  band: SizeBand | "Total";
  count: number;
  kg: number;
}

export interface HistoryMonth {
  month: IsoDate;
  label: string;
  /** This month's figures are a pace (completed so far ÷ working days covered × the month's working days). */
  projected: boolean;
  counts: Record<SizeBand, number>;
}

export interface GoalsModel {
  today: IsoDate;
  month: { start: IsoDate; end: IsoDate; label: string };
  calendar: { workingDays: number; throughToday: number; remaining: number; days: CalendarDay[] };
  cutoffs: Cutoffs;
  coveredThrough: { production: IsoDate; revenue: IsoDate };
  /** A cutoff is behind when at least one working day lies between it and today. */
  behind: { production: boolean; sage: boolean };
  /** Line 1 bulk, in kg: each figure is a sum over the `batches` rows flagged line1. */
  line1: {
    targetKg: number;
    dueSoFarKg: number;
    dueBy: IsoDate;
    inSystemKg: number;
    byHandKg: number;
    totalKg: number;
    status: GoalStatus;
    neededPerDayKg: number;
    scheduledFromTodayKg: number;
    openPastDateKg: number;
    ifAllRunKg: number;
  };
  truckloads: {
    target: number | null;
    /** The Bank of Canada rate a CAD truckload product converts at when its ship date has no stored rate: never the Sage rate. */
    rate: string;
    full: LoadCounts;
    partial: LoadCounts;
    lastMonth: LoadTally;
    customers: TruckloadCustomerRow[];
  };
  revenue: {
    targetCents: number;
    dueSoFarCents: number;
    dueBy: IsoDate;
    inSystemCents: number;
    byHandCents: number;
    totalCents: number;
    status: GoalStatus;
    neededPerDayCents: number;
    /** The USD/CAD rate revenue converts at: the run's Bank of Canada rate, or the fixed Sage rate (`basis`). */
    rate: string;
    basis: RevenueRateBasis;
    cad: { invoices: number; cents: number };
    usd: { invoices: number; cents: number; cadCents: number };
    /** Currencies other than CAD and USD are not converted; listed so they are never silently dropped. */
    otherCurrencies: { currency: string; invoices: number; cents: number }[];
    /** null when last month's revenue can't follow a salesperson filter (TASK-4277). */
    lastMonthCadCents: number | null;
  };
  daily: DailyPoint[];
  batches: BatchListRow[];
  sizes: {
    workingDaysCovered: number;
    completed: BandTile[];
    scheduledFromToday: BandCount[];
    openPastDate: number;
    history: HistoryMonth[];
  };
  entries: EvaluatedEntry[];
  takeaway: string;
}

function isOpen(batch: BatchRow): boolean {
  return batch.status === "Allocated" || batch.status === "Committed";
}

/** The later of a system cutoff and the latest counted entry date, never past today. */
export function coveredThrough(
  cutoff: IsoDate | null,
  entryDates: readonly IsoDate[],
  start: IsoDate,
  today: IsoDate
): IsoDate {
  let through = cutoff ?? addDays(start, -1);
  for (const day of entryDates) if (day > through) through = day;
  return through > today ? today : through;
}

/** True when at least one working day lies strictly between the cutoff and today. */
export function isBehind(cutoff: IsoDate | null, today: IsoDate, holidays: ReadonlySet<IsoDate>): boolean {
  if (!cutoff) return true;
  return workingDaysBetween(addDays(cutoff, 1), addDays(today, -1), holidays) > 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Whole kg with thousands separators ("91,702"). */
function wholeKg(kg: number): string {
  return Math.round(kg).toLocaleString("en-US");
}

function emptyTally(): LoadTally {
  return { full: 0, partial: 0, productUsdCents: 0 };
}

function tally(t: LoadTally, kind: LoadKind, productUsdCents: number): void {
  t[kind] += 1;
  t.productUsdCents += productUsdCents;
}

function emptyBandCounts(): Record<SizeBand, number> {
  return { "~10,000": 0, "5,000–8,999": 0, "Under 5,000": 0, "Over 11,000": 0 };
}

function emptyStageGrams(): Record<BatchStage, number> {
  return { completed: 0, completed_by_hand: 0, scheduled: 0, open_past_date: 0 };
}

export function computeGoals(input: GoalsInput): GoalsModel {
  const { today, holidays, settings, data, rate } = input;
  const revenueRate = input.revenueRate ?? rate;
  const start = monthStart(today);
  const end = monthEnd(today);
  const days = eachDay(start, end);

  let workingDaysToDate = 0;
  const calendarDays: CalendarDay[] = days.map((day) => {
    const working = isWorkingDay(day, holidays);
    if (working) workingDaysToDate += 1;
    return { day, isWorkingDay: working, workingDaysToDate };
  });
  const workingDays = workingDaysToDate;
  const throughToday = workingDaysBetween(start, today, holidays);
  const remaining = workingDaysBetween(today, end, holidays);

  // ── Manual entries: status and effect ──
  const openBatchesByRef = new Map<string, BatchRow>();
  for (const batch of data.batches) {
    if (isOpen(batch)) openBatchesByRef.set(normalizeRef(batch.batch), batch);
  }
  const ctx: EntryContext = {
    monthStart: start,
    monthEnd: end,
    filemakerRefs: input.filemakerRefs,
    sageRefs: input.sageRefs,
  };
  const completedByEntry = new Map<string, EvaluatedEntry>();
  const entries: EvaluatedEntry[] = input.entries.map((entry) => {
    const status = entryStatus(entry, ctx);
    const counts = status === "counted";
    const evaluated: EvaluatedEntry = {
      ...entry,
      status,
      statusLabel: ENTRY_STATUS_LABELS[status],
      counts,
      line1: false,
      completesBatchId: null,
      revenueCadCents: 0,
      truckload: null,
    };
    if (!counts) return evaluated;
    if (entry.type === "Batch") {
      evaluated.line1 = kgOf(entry.kg) >= settings.line1MinKg;
      const open = openBatchesByRef.get(normalizeRef(entry.reference));
      if (open && !completedByEntry.has(open.id)) {
        evaluated.completesBatchId = open.id;
        completedByEntry.set(open.id, evaluated);
      }
    } else {
      const valueCents = toCents(entry.productValue) + toCents(entry.freight);
      evaluated.revenueCadCents = entry.currency === "USD" ? convertCents(valueCents, revenueRate) : valueCents;
      const customer = truckloadCustomerFor(entry, input.ftlCustomers);
      if (customer) {
        const productCents = toCents(entry.productValue);
        const productUsdCents =
          entry.currency === "USD"
            ? productCents
            : invertCents(productCents, rateOn(input.rates, entry.date ?? today, rate));
        const kind = classifyLoad(productUsdCents, settings);
        if (kind) evaluated.truckload = { code: customer.code, kind, productUsdCents };
      }
    }
    return evaluated;
  });
  const counted = entries.filter((e) => e.counts);
  const countedLine1Batches = counted.filter((e) => e.type === "Batch" && e.line1);
  const countedShipments = counted.filter((e) => e.type === "Shipment");

  // ── Covered-through and freshness ──
  const productionThrough = coveredThrough(
    data.cutoffs.productionCutoff,
    countedLine1Batches.map((e) => e.date as IsoDate),
    start,
    today
  );
  const revenueThrough =
    input.revenueCoveredThrough ??
    coveredThrough(
      data.cutoffs.sageCutoff,
      countedShipments.map((e) => e.date as IsoDate),
      start,
      today
    );
  const productionCovered = workingDaysBetween(start, productionThrough, holidays);
  const revenueCovered = workingDaysBetween(start, revenueThrough, holidays);

  // ── Truckloads ──
  const tallies = new Map<string, TruckloadCustomerRow>();
  for (const c of [...input.ftlCustomers].sort((a, b) => a.sortOrder - b.sortOrder)) {
    tallies.set(c.code, { code: c.code, name: c.displayName, thisMonth: emptyTally(), byHand: emptyTally(), lastMonth: emptyTally() });
  }
  for (const row of data.truckloads) {
    const customer = tallies.get(row.code);
    if (!customer) continue;
    const productUsdCents = truckloadProductUsdCents(row, input.rates, rate);
    const kind = classifyLoad(productUsdCents, settings);
    if (kind) tally(row.thisMonth ? customer.thisMonth : customer.lastMonth, kind, productUsdCents);
  }
  for (const entry of countedShipments) {
    if (entry.truckload) tally(tallies.get(entry.truckload.code)!.byHand, entry.truckload.kind, entry.truckload.productUsdCents);
  }
  const truckCustomers = [...tallies.values()];
  const sum = (pick: (row: TruckloadCustomerRow) => number) => truckCustomers.reduce((n, row) => n + pick(row), 0);
  const fullInSystem = sum((r) => r.thisMonth.full);
  const fullByHand = sum((r) => r.byHand.full);
  const partialInSystem = sum((r) => r.thisMonth.partial);
  const partialByHand = sum((r) => r.byHand.partial);

  // ── Revenue ──
  const revenueRow = (currency: string, thisMonth: boolean) =>
    data.revenue.find((r) => r.currency === currency && r.thisMonth === thisMonth);
  const cad = revenueRow("CAD", true);
  const usd = revenueRow("USD", true);
  const cadCents = toCents(cad?.netBeforeTax);
  const usdCents = toCents(usd?.netBeforeTax);
  const usdCadCents = convertCents(usdCents, revenueRate);
  const inSystemCents = cadCents + usdCadCents;
  const byHandCents = countedShipments.reduce((n, e) => n + e.revenueCadCents, 0);
  const totalCents = inSystemCents + byHandCents;
  const targetCents = settings.revenueTargetCadCents;
  const dueSoFarCents = prorateCents(targetCents, revenueCovered, workingDays);
  const lastMonth = input.lastMonthRevenue ?? true;
  const lastMonthCadCents = lastMonth
    ? toCents(revenueRow("CAD", false)?.netBeforeTax) + convertCents(toCents(revenueRow("USD", false)?.netBeforeTax), revenueRate)
    : null;

  // ── Batch list: FileMaker rows, with hand entries merged in ──
  const batches: BatchListRow[] = data.batches.map((b) => {
    const entry = completedByEntry.get(b.id);
    if (entry) {
      const kg = kgOf(entry.kg);
      return {
        key: `fm:${b.id}`,
        batch: b.batch,
        product: b.product ?? entry.product,
        stage: "completed_by_hand",
        status: "Completed (by hand)",
        statusQc: null,
        date: entry.date as IsoDate,
        kg,
        band: sizeBand(kg),
        line1: kg >= settings.line1MinKg,
        line: b.line,
        source: "By hand",
        entryId: entry.entryId,
      };
    }
    const kg = Number(b.kg);
    const stage: BatchStage = !isOpen(b) ? "completed" : b.date >= today ? "scheduled" : "open_past_date";
    return {
      key: `fm:${b.id}`,
      batch: b.batch,
      product: b.product,
      stage,
      status: stage === "completed" ? (b.statusQc ?? "Completed") : b.status,
      statusQc: b.statusQc,
      date: b.date,
      kg,
      band: sizeBand(kg),
      line1: kg >= settings.line1MinKg,
      line: b.line,
      source: "FileMaker",
      entryId: null,
    };
  });
  for (const e of counted) {
    if (e.type !== "Batch" || e.completesBatchId) continue;
    const kg = kgOf(e.kg);
    batches.push({
      key: `entry:${e.entryId}`,
      batch: e.reference?.trim() || e.entryId,
      product: e.product,
      stage: "completed_by_hand",
      status: "Completed (by hand)",
      statusQc: null,
      date: e.date as IsoDate,
      kg,
      band: sizeBand(kg),
      line1: kg >= settings.line1MinKg,
      line: null,
      source: "By hand",
      entryId: e.entryId,
    });
  }
  batches.sort((a, b) => (a.date === b.date ? a.batch.localeCompare(b.batch) : a.date < b.date ? -1 : 1));

  // ── Line 1 bulk: sums over the batch list in whole grams, so the card, the chart and the list agree ──
  const line1Days = new Map<IsoDate, Record<BatchStage, number>>();
  const line1Grams = emptyStageGrams();
  for (const b of batches) {
    if (!b.line1) continue;
    const g = grams(b.kg);
    const onDay = line1Days.get(b.date) ?? emptyStageGrams();
    onDay[b.stage] += g;
    line1Days.set(b.date, onDay);
    line1Grams[b.stage] += g;
  }
  const line1Total = line1Grams.completed + line1Grams.completed_by_hand;
  const line1Open = line1Grams.scheduled + line1Grams.open_past_date;
  const line1PerDay = grams(settings.line1KgPerWorkingDay);
  const line1Target = line1PerDay * workingDays;
  const line1DueSoFar = line1PerDay * productionCovered;

  // ── Day by day ──
  const dailyByDay = new Map(data.daily.map((row) => [row.day, row]));
  const byHandRevenue = new Map<IsoDate, number>();
  for (const e of countedShipments) {
    byHandRevenue.set(e.date as IsoDate, (byHandRevenue.get(e.date as IsoDate) ?? 0) + e.revenueCadCents);
  }
  let cumCad = 0;
  let cumUsd = 0;
  let cumCadLast = 0;
  let cumUsdLast = 0;
  let cumByHand = 0;
  const daily: DailyPoint[] = calendarDays.map(({ day, isWorkingDay: working, workingDaysToDate: wdToDate }) => {
    const row = dailyByDay.get(day);
    const line1 = line1Days.get(day) ?? emptyStageGrams();
    const dayCad = toCents(row?.cadThis);
    const dayUsd = toCents(row?.usdThis);
    const dayByHand = byHandRevenue.get(day) ?? 0;
    cumCad += dayCad;
    cumUsd += dayUsd;
    cumCadLast += toCents(row?.cadLast);
    cumUsdLast += toCents(row?.usdLast);
    cumByHand += dayByHand;
    const sageToDateCents = cumCad + convertCents(cumUsd, revenueRate);
    return {
      day,
      isWorkingDay: working,
      isToday: day === today,
      isFuture: day > today,
      line1DoneKg: line1.completed / 1000,
      line1ByHandKg: line1.completed_by_hand / 1000,
      line1ScheduledKg: (line1.scheduled + line1.open_past_date) / 1000,
      cadCents: dayCad,
      usdCents: dayUsd,
      byHandCadCents: dayByHand,
      sageToDateCents,
      withHandToDateCents: sageToDateCents + cumByHand,
      targetToDateCents: prorateCents(targetCents, wdToDate, workingDays),
      lastMonthToDateCents: lastMonth ? cumCadLast + convertCents(cumUsdLast, revenueRate) : null,
    };
  });

  // ── Size bands ──
  const completedTiles = new Map<SizeBand | "Total", BandTile>();
  for (const band of [...SIZE_BANDS, "Total" as const]) {
    completedTiles.set(band, { band, count: 0, kg: 0, pacePer20: null, notQcReleased: 0 });
  }
  for (const b of batches) {
    if (b.stage !== "completed") continue;
    for (const key of [b.band, "Total" as const]) {
      const tile = completedTiles.get(key)!;
      tile.count += 1;
      tile.kg += b.kg;
      if (!isQcReleased(b.statusQc)) tile.notQcReleased += 1;
    }
  }
  for (const tile of completedTiles.values()) tile.pacePer20 = pacePer20(tile.count, productionCovered);

  const scheduled = new Map<SizeBand | "Total", BandCount>();
  for (const band of [...SIZE_BANDS, "Total" as const]) scheduled.set(band, { band, count: 0, kg: 0 });
  for (const b of batches) {
    if (b.stage !== "scheduled") continue;
    for (const key of [b.band, "Total" as const]) {
      const tile = scheduled.get(key)!;
      tile.count += 1;
      tile.kg += b.kg;
    }
  }

  const history: HistoryMonth[] = [];
  for (let back = 3; back >= 1; back -= 1) {
    let month = start;
    for (let i = 0; i < back; i += 1) month = monthStart(addDays(month, -1));
    const counts = emptyBandCounts();
    for (const h of data.batchHistory) if (monthStart(h.date) === month) counts[sizeBand(Number(h.kg))] += 1;
    history.push({ month, label: monthLabel(month), projected: false, counts });
  }
  const pace = emptyBandCounts();
  for (const band of SIZE_BANDS) {
    const soFar = completedTiles.get(band)!.count;
    pace[band] = productionCovered > 0 ? (soFar / productionCovered) * workingDays : soFar;
  }
  history.push({ month: start, label: monthLabel(start), projected: true, counts: pace });

  const model: GoalsModel = {
    today,
    month: { start, end, label: monthLabel(start) },
    calendar: { workingDays, throughToday, remaining, days: calendarDays },
    cutoffs: data.cutoffs,
    coveredThrough: { production: productionThrough, revenue: revenueThrough },
    behind: {
      production: isBehind(data.cutoffs.productionCutoff, today, holidays),
      sage: isBehind(data.cutoffs.sageCutoff, today, holidays),
    },
    line1: {
      targetKg: line1Target / 1000,
      dueSoFarKg: line1DueSoFar / 1000,
      dueBy: productionThrough,
      inSystemKg: line1Grams.completed / 1000,
      byHandKg: line1Grams.completed_by_hand / 1000,
      totalKg: line1Total / 1000,
      status: line1Total >= line1DueSoFar ? "on_track" : "behind",
      neededPerDayKg: remaining > 0 ? Math.max(0, line1Target - line1Total) / remaining / 1000 : 0,
      scheduledFromTodayKg: line1Grams.scheduled / 1000,
      openPastDateKg: line1Grams.open_past_date / 1000,
      ifAllRunKg: (line1Total + line1Open) / 1000,
    },
    truckloads: {
      target: settings.fullTruckloadsPerMonth,
      rate,
      full: { inSystem: fullInSystem, byHand: fullByHand, total: fullInSystem + fullByHand },
      partial: { inSystem: partialInSystem, byHand: partialByHand, total: partialInSystem + partialByHand },
      lastMonth: {
        full: sum((r) => r.lastMonth.full),
        partial: sum((r) => r.lastMonth.partial),
        productUsdCents: sum((r) => r.lastMonth.productUsdCents),
      },
      customers: truckCustomers,
    },
    revenue: {
      targetCents,
      dueSoFarCents,
      dueBy: revenueThrough,
      inSystemCents,
      byHandCents,
      totalCents,
      status: totalCents >= dueSoFarCents ? "on_track" : "behind",
      neededPerDayCents: remaining > 0 ? prorateCents(Math.max(0, targetCents - totalCents), 1, remaining) : 0,
      rate: revenueRate,
      basis: input.revenueBasis ?? "boc",
      cad: { invoices: cad?.invoices ?? 0, cents: cadCents },
      usd: { invoices: usd?.invoices ?? 0, cents: usdCents, cadCents: usdCadCents },
      otherCurrencies: data.revenue
        .filter((r) => r.thisMonth && r.currency !== "CAD" && r.currency !== "USD")
        .map((r) => ({ currency: r.currency, invoices: r.invoices, cents: toCents(r.netBeforeTax) })),
      lastMonthCadCents,
    },
    daily,
    batches,
    sizes: {
      workingDaysCovered: productionCovered,
      completed: [...completedTiles.values()],
      scheduledFromToday: [...scheduled.values()],
      openPastDate: batches.filter((b) => b.stage === "open_past_date").length,
      history,
    },
    entries,
    takeaway: "",
  };
  model.takeaway = takeaway(model);
  return model;
}

/** One sentence built from the numbers (no model involved). */
export function takeaway(model: GoalsModel): string {
  const { line1, truckloads, revenue } = model;
  return (
    `${wholeKg(line1.totalKg)} kg of Line 1 bulk against ${wholeKg(line1.dueSoFarKg)} kg due so far, ` +
    `${plural(truckloads.full.total, "full truckload", "full truckloads")}, and ` +
    `${formatDollars(revenue.totalCents)} of the ${formatDollars(revenue.dueSoFarCents)} revenue due so far.`
  );
}

/**
 * The takeaway of a page narrowed to some salespeople's customers (TASK-4277):
 * Line 1 stays every customer's (production has no salesperson), and their
 * revenue is set against every customer's instead of the month's goal.
 */
export function salespeopleTakeaway(model: GoalsModel, who: string, everyCustomerCents: number): string {
  const { line1, truckloads, revenue } = model;
  const share =
    everyCustomerCents > 0 ? `, ${Math.round((revenue.totalCents / everyCustomerCents) * 100)}% of every customer’s ${formatDollars(everyCustomerCents)}` : "";
  return (
    `${wholeKg(line1.totalKg)} kg of Line 1 bulk against ${wholeKg(line1.dueSoFarKg)} kg due so far for every customer. ` +
    `${who}: ${plural(truckloads.full.total, "full truckload", "full truckloads")} and ${formatDollars(revenue.totalCents)} of revenue${share}.`
  );
}
