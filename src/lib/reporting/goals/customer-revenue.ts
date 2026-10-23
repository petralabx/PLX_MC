// Goals & Production: revenue by customer (Progress Huddle 2026-10-23). Two
// rankings, each a row per customer with weekly columns (weeks start Monday):
//
// - Potential: what production is making for an open Sage order. Each forecast
//   portion with an assembly order (open or packed, not yet invoiced) is priced
//   from its linked Sage order line and dated by the AO's scheduled date.
//   FileMaker's realized date isn't readable yet, so the scheduled date stands in.
// - Realized: this month's invoiced revenue (the Revenue card), by customer.
//
// What production makes with no price is counted, never valued: open AOs with
// no open order, and this month's batches no AO packs from yet. A batch is
// dated 5 working days after its completed (or scheduled) date.
// No price list is read (ic_pricp has no grant). Pure, money in exact cents.

import { addDays, isoWeekday, isWorkingDay } from "./calendar";
import { aoStage, customerClassOf, productionWithoutOrders, type CustomerClass, type ForecastRow } from "./forecast";
import { allocateConvertedCents } from "./money";
import type { ShipmentListRow } from "./shipment-list";
import type { BatchRow, ForecastAoRow, IsoDate } from "./types";

/** Working days from a batch's date to when its product can be invoiced. */
export const BATCH_LEAD_WORKING_DAYS = 5;

export interface CustomerRevenueRow {
  /** The Sage customer code, else the name, else "(no customer)". */
  key: string;
  customerCode: string | null;
  customer: string | null;
  customerClass: CustomerClass;
  totalCadCents: number;
  /** CAD cents by the Monday of each week. */
  byWeek: Record<IsoDate, number>;
  /** CAD cents with no date (an AO without a scheduled date). */
  undatedCadCents: number;
  rows: number;
}

export interface CustomerRanking {
  /** Largest first, then by key. */
  customers: CustomerRevenueRow[];
  /** Every week with an amount, oldest first. */
  weeks: IsoDate[];
  totalCadCents: number;
}

export interface UnpricedProduction {
  /** Open AOs scheduled this month with no open Sage order behind them. */
  aos: { count: number; pieces: number };
  /** This month's batches no AO packs from yet, by the week they could be invoiced. */
  batches: { count: number; kg: number; byWeek: Record<IsoDate, number> };
  /** Potential portions in a currency other than CAD or USD (never converted). */
  otherCurrencyRows: number;
}

export interface CustomerRevenue {
  potential: CustomerRanking;
  /** AO portions already packed (included in potential). */
  packedRows: number;
  unpriced: UnpricedProduction;
  realized: CustomerRanking;
  /** The Revenue card's total; realized adds up to it, to the cent. */
  cardTotalCents: number;
}

export interface CustomerRevenueInput {
  today: IsoDate;
  holidays: ReadonlySet<IsoDate>;
  /** The forecast's rows (forecast.ts), already in CAD at the revenue rate; empty when the run has no forecast. */
  forecastRows: readonly ForecastRow[];
  /** The run's stored AOs; empty when the run has no forecast. */
  aos: readonly ForecastAoRow[];
  batches: readonly BatchRow[];
  shipments: readonly ShipmentListRow[];
  /** The revenue rate (model.revenue.rate). */
  rate: string;
  cardTotalCents: number;
}

/** The Monday on or before a day. */
export function weekOf(day: IsoDate): IsoDate {
  return addDays(day, 1 - isoWeekday(day));
}

/** The working day `n` working days after `day` (weekends and holidays skipped). */
export function addWorkingDays(day: IsoDate, n: number, holidays: ReadonlySet<IsoDate>): IsoDate {
  let d = day;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (isWorkingDay(d, holidays)) left -= 1;
  }
  return d;
}

const customerKey = (code: string | null, name: string | null) => code?.trim() || name?.trim().toLowerCase() || "(no customer)";

class Ranker {
  private map = new Map<string, CustomerRevenueRow>();
  add(code: string | null, name: string | null, cls: CustomerClass, cents: number, day: IsoDate | null) {
    const key = customerKey(code, name);
    let row = this.map.get(key);
    if (!row) {
      row = { key, customerCode: code, customer: name, customerClass: cls, totalCadCents: 0, byWeek: {}, undatedCadCents: 0, rows: 0 };
      this.map.set(key, row);
    }
    row.customer ??= name;
    row.totalCadCents += cents;
    row.rows += 1;
    if (day === null) row.undatedCadCents += cents;
    else {
      const w = weekOf(day);
      row.byWeek[w] = (row.byWeek[w] ?? 0) + cents;
    }
  }
  done(): CustomerRanking {
    const customers = [...this.map.values()].sort((a, b) => b.totalCadCents - a.totalCadCents || (a.key < b.key ? -1 : 1));
    const weeks = [...new Set(customers.flatMap((c) => Object.keys(c.byWeek)))].sort();
    return { customers, weeks, totalCadCents: customers.reduce((n, c) => n + c.totalCadCents, 0) };
  }
}

export function customerRevenue(input: CustomerRevenueInput): CustomerRevenue {
  const potential = new Ranker();
  let packedRows = 0;
  let otherCurrencyRows = 0;
  for (const r of input.forecastRows) {
    if (!r.ao || aoStage(r.ao.status) === "cancelled") continue;
    if (r.cadCents === null) {
      otherCurrencyRows += 1;
      continue;
    }
    if (aoStage(r.ao.status) === "realized") packedRows += 1;
    potential.add(r.customerCode, r.customer, r.customerClass, r.cadCents, r.ao.scheduled);
  }

  const packed = new Set(input.aos.filter((a) => aoStage(a.status) !== "cancelled" && a.batch).map((a) => a.batch!.trim()));
  const batches = { count: 0, kg: 0, byWeek: {} as Record<IsoDate, number> };
  for (const b of input.batches) {
    if (packed.has(b.batch.trim())) continue;
    const kg = Number(b.kg) || 0;
    const week = weekOf(addWorkingDays(b.date, BATCH_LEAD_WORKING_DAYS, input.holidays));
    batches.count += 1;
    batches.kg += kg;
    batches.byWeek[week] = (batches.byWeek[week] ?? 0) + kg;
  }

  // Realized: CAD as invoiced, entries as entered, and USD converted once for the month
  // and shared across customers, as the Revenue card and the class table do.
  const realized = new Ranker();
  const usd = input.shipments.filter((s) => s.source === "Sage" && s.currency === "USD");
  const usdCad = allocateConvertedCents(
    usd.map((s) => s.netCents),
    input.rate
  );
  const usdIndex = new Map(usd.map((s, i) => [s.key, usdCad[i]]));
  for (const s of input.shipments) {
    const cents = s.source === "By hand" ? s.cadCents : s.currency === "CAD" ? s.netCents : usdIndex.get(s.key);
    if (cents === undefined) continue;
    realized.add(s.customerCode, s.customer, customerClassOf(s.customerCode), cents, s.shipDate);
  }

  return {
    potential: potential.done(),
    packedRows,
    unpriced: { aos: productionWithoutOrders(input.aos, input.today), batches, otherCurrencyRows },
    realized: realized.done(),
    cardTotalCents: input.cardTotalCents,
  };
}

export { searchCustomers } from "./customer-search";
