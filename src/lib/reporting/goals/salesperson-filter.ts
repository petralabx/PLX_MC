// The salesperson (account manager) filter (TASK-4277): the page and the
// workbook for the customers of one or more Sage salespeople. A customer
// belongs to every salesperson on its Sage customer record (codeslsp1–5,
// queries/salespeople.ts), so a customer with two counts in full under each,
// and once when both are picked. `none` picks the customers with no
// salesperson, and the shipments entered by hand that name no Sage customer.
//
// The filter narrows the run before the page model is built, so every figure
// that has a customer follows it by the same rules as the whole page: Sage
// invoices, credit notes, the shipped-not-invoiced estimate, truckloads, open
// order lines and the shipments entered by hand. Production (FileMaker batches
// and assembly orders) has no customer and stays whole. The month's revenue by
// currency and by day are rebuilt from the kept invoices; last month's can't
// be split by customer, so a filtered page leaves it out. Pure.

import type { ForecastSnapshot } from "./forecast";
import { centsToDecimal, sumToCents } from "./money";
import { truckloadCustomerFor } from "./rules";
import type { DailyRow, FtlCustomer, ManualEntry, RevenueRow, ShipmentRow, SnapshotData } from "./types";

/** The `sales` value that picks customers without a salesperson. Sage codes are upper case, so it never names one. */
export const NO_SALESPERSON = "none";

/** At most this many codes in one request. */
export const MAX_SALES_CODES = 60;

const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,11}$/;

/** Codes sorted, `none` last: one spelling for each choice, so links and caches agree. */
export function canonicalSales(codes: readonly string[]): string[] {
  const set = new Set(codes);
  const none = set.delete(NO_SALESPERSON);
  return [...[...set].sort(), ...(none ? [NO_SALESPERSON] : [])];
}

/**
 * A request's `sales` (TASK-4277): salesperson codes, comma-separated, and
 * `none`. Absent or blank: every customer ([]). Codes are upper-cased. null
 * when a code isn't one Sage could hold, or there are too many (the routes
 * answer 400).
 */
export function salesParam(value: string | null): string[] | null {
  if (value === null) return [];
  const out = new Set<string>();
  for (const part of value.split(",")) {
    const raw = part.trim();
    if (!raw) continue;
    const code = raw === NO_SALESPERSON ? raw : raw.toUpperCase();
    if (code !== NO_SALESPERSON && !CODE_RE.test(code)) return null;
    out.add(code);
  }
  return out.size > MAX_SALES_CODES ? null : canonicalSales([...out]);
}

/**
 * The codes picked, in words: "Glenn (GGC)", "Glenn (GGC) and Sam (SM)",
 * "4 salespeople and no salesperson" past three. "" when none is picked.
 */
export function salespeopleLabel(selected: readonly string[], names: Readonly<Record<string, string | null>>): string {
  const codes = selected.filter((c) => c !== NO_SALESPERSON);
  const none = codes.length < selected.length ? ["no salesperson"] : [];
  const words = codes.length + none.length > 3 ? [`${codes.length} salespeople`, ...none] : [...codes.map((c) => (names[c] ? `${names[c]} (${c})` : c)), ...none];
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? "");
}

/** A Sage customer code as the lookup keys it: trimmed, upper case; "" for none. */
export function normalizeCustomerCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/**
 * The salespeople on this run's customers (salespeople.ts reads them live).
 * ready: `customers` maps each customer code found in Sage to its salespeople,
 * in slot order (a customer missing from it has none), and `names` names them.
 * waiting_for_access: the login lacks these columns. unavailable: the replica
 * couldn't be read. Only `ready` can filter.
 */
export type SalespersonLookup =
  | { state: "ready"; customers: Record<string, string[]>; names: Record<string, string | null> }
  | { state: "waiting_for_access"; missing: string[] }
  | { state: "unavailable" };

export type ReadySalespersonLookup = Extract<SalespersonLookup, { state: "ready" }>;

/** One row of queries/salespeople.ts. */
export interface SalespersonLookupRow {
  customer: string;
  slot: number;
  salesperson: string;
  name: string | null;
}

export function salespersonLookupFromRows(rows: readonly SalespersonLookupRow[]): ReadySalespersonLookup {
  const customers: Record<string, string[]> = {};
  const names: Record<string, string | null> = {};
  for (const row of [...rows].sort((a, b) => a.slot - b.slot)) {
    const customer = normalizeCustomerCode(row.customer);
    const code = normalizeCustomerCode(row.salesperson);
    if (!customer || !code) continue;
    const own = (customers[customer] ??= []);
    if (!own.includes(code)) own.push(code);
    names[code] ??= row.name?.trim() || null;
  }
  return { state: "ready", customers, names };
}

/**
 * The Sage customer a shipment entered by hand belongs to: the one picked for
 * it, else the truckload customer its name matches (as its class is found,
 * revenue-by-class.ts), else none.
 */
export function entryCustomerCode(entry: Pick<ManualEntry, "customer" | "customerCode">, ftlCustomers: readonly FtlCustomer[]): string | null {
  const own = normalizeCustomerCode(entry.customerCode);
  if (own) return own;
  const truckload = truckloadCustomerFor(entry, ftlCustomers);
  return truckload ? normalizeCustomerCode(truckload.code) : null;
}

/** What the filter narrows: the run the page model is built from. */
export interface SalespeopleRun {
  snapshot: SnapshotData | null;
  entries: readonly ManualEntry[];
  ftlCustomers: readonly FtlCustomer[];
  forecast?: ForecastSnapshot | null;
}

/** Every Sage customer this run's figures name, normalized and sorted: the codes to look salespeople up for. */
export function runCustomerCodes(run: SalespeopleRun): string[] {
  const codes = new Set<string>();
  const add = (code: string | null | undefined) => {
    const c = normalizeCustomerCode(code);
    if (c) codes.add(c);
  };
  run.ftlCustomers.forEach((c) => add(c.code));
  run.entries.filter((e) => e.type === "Shipment").forEach((e) => add(entryCustomerCode(e, run.ftlCustomers)));
  const s = run.snapshot;
  if (s) {
    s.shipments.forEach((r) => add(r.customerCode));
    s.truckloads.forEach((r) => add(r.code));
    s.creditNotes?.notes.forEach((r) => add(r.customerCode));
    s.pendingShipments?.shipments.forEach((r) => add(r.customerCode));
  }
  if (run.forecast?.data.access === "read") run.forecast.data.lines.forEach((r) => add(r.customerCode));
  return [...codes].sort();
}

/** Whether a customer is in the picked salespeople's book: any of its salespeople picked, or none and `none` picked. */
export function salespeopleScope(lookup: ReadySalespersonLookup, selected: readonly string[]): (code: string | null | undefined) => boolean {
  const picked = new Set(selected);
  return (code) => {
    const own = lookup.customers[normalizeCustomerCode(code)] ?? [];
    return own.length === 0 ? picked.has(NO_SALESPERSON) : own.some((s) => picked.has(s));
  };
}

/** This month's revenue by currency, as queries/revenue-by-currency.ts adds it up, from the invoices kept (the dates filter too, date-filter.ts). */
export function revenueRowsOf(shipments: readonly ShipmentRow[]): RevenueRow[] {
  const byCurrency = new Map<string, string[]>();
  for (const s of shipments) {
    const nets = byCurrency.get(s.currency) ?? [];
    nets.push(s.netBeforeTax);
    byCurrency.set(s.currency, nets);
  }
  return [...byCurrency.keys()].sort().map((currency) => {
    const nets = byCurrency.get(currency)!;
    return { currency, thisMonth: true, invoices: nets.length, netBeforeTax: centsToDecimal(sumToCents(nets)) };
  });
}

/** This month's revenue by day, as queries/daily.ts adds it up, from the invoices kept. Last month's can't follow the filter. */
export function dailyRowsOf(days: readonly DailyRow[], shipments: readonly ShipmentRow[]): DailyRow[] {
  const byDay = new Map<string, { CAD: string[]; USD: string[] }>();
  for (const s of shipments) {
    if (s.currency !== "CAD" && s.currency !== "USD") continue;
    const day = byDay.get(s.shipDate) ?? { CAD: [], USD: [] };
    day[s.currency].push(s.netBeforeTax);
    byDay.set(s.shipDate, day);
  }
  return days.map((d) => ({
    day: d.day,
    cadThis: centsToDecimal(sumToCents(byDay.get(d.day)?.CAD ?? [])),
    usdThis: centsToDecimal(sumToCents(byDay.get(d.day)?.USD ?? [])),
    cadLast: "0.00",
    usdLast: "0.00",
  }));
}

/** The run narrowed to the customers `keep` accepts; production, the forecast's assembly orders and its history stay whole. */
export function filterRunBySalespeople<T extends SalespeopleRun>(run: T, keep: (code: string | null | undefined) => boolean): T {
  const s = run.snapshot;
  const shipments = s ? s.shipments.filter((r) => keep(r.customerCode)) : [];
  const forecast = run.forecast;
  return {
    ...run,
    ftlCustomers: run.ftlCustomers.filter((c) => keep(c.code)),
    entries: run.entries.filter((e) => e.type !== "Shipment" || keep(entryCustomerCode(e, run.ftlCustomers))),
    snapshot: s && {
      ...s,
      shipments,
      truckloads: s.truckloads.filter((r) => keep(r.code)),
      revenue: revenueRowsOf(shipments),
      daily: dailyRowsOf(s.daily, shipments),
      creditNotes: s.creditNotes && { ...s.creditNotes, notes: s.creditNotes.notes.filter((r) => keep(r.customerCode)) },
      pendingShipments: s.pendingShipments && {
        ...s.pendingShipments,
        shipments: s.pendingShipments.shipments.filter((r) => keep(r.customerCode)),
      },
    },
    forecast: forecast && {
      ...forecast,
      data: { ...forecast.data, lines: forecast.data.lines.filter((r) => keep(r.customerCode)) },
    },
  };
}
