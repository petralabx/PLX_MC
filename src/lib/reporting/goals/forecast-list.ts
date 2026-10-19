// The pieces of the revenue forecast the browser needs (TASK-3177): the bucket,
// class and channel names, the list's filters and its CAD totals. This module
// must never import forecast.ts (or customer-classes.json) at run time: the
// customer roster lives in forecast.ts, and anything the page's client code
// imports ships in the public static bundle. forecast.ts re-exports all of this.

import { normalizeName } from "./rules";
import type { ForecastRow } from "./forecast";

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
