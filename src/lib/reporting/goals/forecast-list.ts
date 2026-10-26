// The pieces of the revenue forecast the browser needs (TASK-3177): the bucket,
// class and channel names, the list's filters and its CAD totals, and the four
// numbers worked out over any filtered rows (TASK-3190), the one function the
// server uses for the whole month too. This module must never import
// forecast.ts (or customer-classes.json) at run time: the customer roster lives
// in forecast.ts, and anything the page's client code imports ships in the
// public static bundle. forecast.ts re-exports all of this.

import { prorateCents } from "./money";
import { normalizeName } from "./rules";
import type { ForecastReady, ForecastRow, HitRateMonth } from "./forecast";

// ─── Buckets ────────────────────────────────────────────────────────────────

export const FORECAST_BUCKETS = ["ready", "planned", "late", "not_planned"] as const;
export type ForecastBucket = (typeof FORECAST_BUCKETS)[number];

export const FORECAST_BUCKET_LABELS: Record<ForecastBucket, string> = {
  ready: "Ready",
  planned: "Planned in time",
  late: "Late",
  not_planned: "Not planned",
};

// ─── Customer class and channel ─────────────────────────────────────────────

export const CUSTOMER_CLASSES = ["Exclusive Manufacturing", "Exclusive Distribution", "Mixed", "Unclassified"] as const;
export type CustomerClass = (typeof CUSTOMER_CLASSES)[number];

export const CHANNELS = ["Manufacturing", "Distribution"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The workbook's manufacturing categories; every other category is Distribution. */
export const MANUFACTURING_CATEGORIES: readonly string[] = [
  "BIOPH", "BRANDS", "CROWN", "LIQUID", "LSRVCA", "PHAD", "PLABEL", "MFGLBR", "MFGOHE", "MFGPKG", "MFGRM",
];

/** A Sage item category's channel; null when the line has no category. */
export function channelOf(category: string | null): Channel | null {
  if (!category) return null;
  return MANUFACTURING_CATEGORIES.includes(category) ? "Manufacturing" : "Distribution";
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

// ─── The list's chips and search ────────────────────────────────────────────

export type ForecastFilter = "all" | ForecastBucket;

export const FORECAST_FILTERS: { key: ForecastFilter; label: string }[] = [
  { key: "all", label: "All" },
  ...FORECAST_BUCKETS.map((bucket) => ({ key: bucket, label: FORECAST_BUCKET_LABELS[bucket] })),
];

/** The class filter: every class, or one. */
export type ForecastClassFilter = "all" | CustomerClass;

/** The category filter: every row, a channel, one Sage category, or the rows with none. */
export type ForecastCategoryFilter = "all" | `channel:${Channel}` | `category:${string}` | "none";

export interface ForecastListFilters {
  filter: ForecastFilter;
  query: string;
  customerClass?: ForecastClassFilter;
  category?: ForecastCategoryFilter;
}

function matchesCategory(row: ForecastRow, category: ForecastCategoryFilter): boolean {
  if (category === "all") return true;
  if (category === "none") return row.category === null;
  if (category.startsWith("channel:")) return row.channel === category.slice("channel:".length);
  return row.category === category.slice("category:".length);
}

/** The category filter's choices for these rows: both channels, then each category present (A to Z), then None when a row has none. */
export function forecastCategoryOptions(rows: readonly ForecastRow[]): { key: ForecastCategoryFilter; label: string }[] {
  const categories = [...new Set(rows.flatMap((row) => (row.category ? [row.category] : [])))].sort();
  return [
    { key: "all", label: "All categories" },
    ...CHANNELS.map((channel) => ({ key: `channel:${channel}` as const, label: channel })),
    ...categories.map((category) => ({ key: `category:${category}` as const, label: `${category} (${channelOf(category)})` })),
    ...(rows.some((row) => row.category === null) ? [{ key: "none" as const, label: "No category" }] : []),
  ];
}

/**
 * The category filter to apply: the one the person chose while it is still one of
 * the choices and the login can read categories, otherwise All. A refresh can drop
 * the chosen category (or the access can lapse); without this the dropdown would
 * fall back to "All categories" while the rows and totals stayed filtered to
 * nothing.
 */
export function activeCategoryFilter(
  chosen: ForecastCategoryFilter,
  rows: readonly ForecastRow[],
  categoriesRead: boolean
): ForecastCategoryFilter {
  if (chosen === "all" || !categoriesRead) return "all";
  return forecastCategoryOptions(rows).some((option) => option.key === chosen) ? chosen : "all";
}

/**
 * Rows in the chosen bucket, customer class and category whose order, customer
 * (name or code), PO, item, description, category or AO contain the search,
 * ignoring case and spacing.
 */
export function filterForecastRows(rows: readonly ForecastRow[], opts: ForecastListFilters): ForecastRow[] {
  const needle = normalizeName(opts.query);
  const customerClass = opts.customerClass ?? "all";
  const category = opts.category ?? "all";
  return rows.filter(
    (row) =>
      (opts.filter === "all" || row.bucket === opts.filter) &&
      (customerClass === "all" || row.customerClass === customerClass) &&
      matchesCategory(row, category) &&
      (!needle ||
        normalizeName(
          [row.orderNo, row.customer, row.customerCode, row.po, row.item, row.description, row.category, row.ao?.number]
            .filter(Boolean)
            .join(" ")
        ).includes(needle))
  );
}

// ─── The four numbers (TASK-3190) ───────────────────────────────────────────

export type ForecastBucketTotals = Record<ForecastBucket, { cents: number; rows: number }>;

/** CAD and row count per bucket; rows in other currencies count as rows with 0 CAD. */
export function bucketTotals(rows: readonly ForecastRow[]): ForecastBucketTotals {
  const totals = Object.fromEntries(FORECAST_BUCKETS.map((b) => [b, { cents: 0, rows: 0 }])) as ForecastBucketTotals;
  for (const row of rows) {
    totals[row.bucket].rows += 1;
    totals[row.bucket].cents += row.cadCents ?? 0;
  }
  return totals;
}

/** What the four numbers need besides the rows and the invoiced revenue: whole-month figures, never filtered. */
export interface ForecastKpiBasis {
  /** The complete months the hit rate averages over (hitRateMonths, newest first); empty until one is measured. */
  months: HitRateMonth[];
  /** Working days the revenue covers so far, and in the month. */
  coveredDays: number;
  workingDays: number;
}

export interface ForecastKpis {
  buckets: ForecastBucketTotals;
  /** The invoiced revenue the numbers include; null when it can't be split the way the rows are (by item category). */
  invoicedCents: number | null;
  /** Invoiced + Ready + Planned in time (just the orders when invoiced is null). */
  theoreticalCents: number;
  /** Late + Not planned. */
  atRiskCents: number;
  /** Invoiced + (Ready + Planned in time) × the average hit rate; null until a complete month is measured. */
  realistic: { cents: number; hitRate: number; months: HitRateMonth[] } | null;
  /** Invoiced ÷ revenue working days covered × working days in the month; null before a day is covered, or when invoiced is null. */
  pace: { cents: number; coveredDays: number; workingDays: number } | null;
  otherCurrencies: { currency: string; cents: number; rows: number }[];
}

export function forecastKpis(rows: readonly ForecastRow[], invoicedCents: number | null, basis: ForecastKpiBasis): ForecastKpis {
  const buckets = bucketTotals(rows);
  const readyPlanned = buckets.ready.cents + buckets.planned.cents;
  const invoiced = invoicedCents ?? 0;
  const { months, coveredDays, workingDays } = basis;
  const terms = months.map((m) => prorateCents(readyPlanned, m.invoicedAfterCents, m.readyPlannedCents));
  return {
    buckets,
    invoicedCents,
    theoreticalCents: invoiced + readyPlanned,
    atRiskCents: buckets.late.cents + buckets.not_planned.cents,
    realistic:
      months.length > 0
        ? {
            cents: invoiced + prorateCents(terms.reduce((n, t) => n + t, 0), 1, months.length),
            hitRate: months.reduce((n, m) => n + m.invoicedAfterCents / m.readyPlannedCents, 0) / months.length,
            months,
          }
        : null,
    pace:
      invoicedCents !== null && coveredDays > 0
        ? { cents: prorateCents(invoicedCents, workingDays, coveredDays), coveredDays, workingDays }
        : null,
    otherCurrencies: otherCurrencyTotals(rows),
  };
}

/** The class and category filters the four numbers follow (the bucket chips and the search change only the list). */
export interface ForecastKpiFilter {
  customerClass: ForecastClassFilter;
  /** The active category filter (activeCategoryFilter), never just the one chosen. */
  category: ForecastCategoryFilter;
}

/**
 * The four numbers over the rows the class and category filters keep. Invoiced
 * follows the class (the Revenue by customer class table's total); invoices
 * can't be split by item category, so with a category it is null. With neither
 * filter this is the whole month's numbers exactly.
 */
export function filteredForecastKpis(
  f: Pick<ForecastReady, "rows" | "invoicedCents" | "invoicedByClass" | "kpiBasis">,
  filter: ForecastKpiFilter
): ForecastKpis {
  const rows = filterForecastRows(f.rows, { filter: "all", query: "", ...filter });
  const invoiced =
    filter.category !== "all"
      ? null
      : filter.customerClass === "all"
        ? f.invoicedCents
        : (f.invoicedByClass?.[filter.customerClass] ?? null);
  return forecastKpis(rows, invoiced, f.kpiBasis);
}
