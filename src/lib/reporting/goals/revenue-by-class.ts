// Revenue by customer class (TASK-3781): the Revenue card's month split by the
// sales workbook's customer classes (customer-classes.json, as the forecast's
// Customer class filter reads it). Built from the shipments list's rows, which
// are the card's invoices one by one plus the counted shipments entered by hand,
// at the page's revenue rate. The month's USD is converted once, as on the card,
// and shared across the classes by largest remainder, so the classes add up to
// the card to the cent. Server-only: it reads the customer roster (forecast.ts),
// which must never reach the browser; the page model carries the result.

import { customerClassOf } from "./forecast";
import { CUSTOMER_CLASSES, type CustomerClass } from "./forecast-list";
import { allocateConvertedCents } from "./money";
import { truckloadCustomerFor, type GoalsModel } from "./rules";
import type { ShipmentListRow } from "./shipment-list";
import type { FtlCustomer } from "./types";

export interface ClassRevenueTotals {
  /** Sage invoices this month, every currency. */
  invoices: number;
  cad: { invoices: number; cents: number };
  /** cadCents: this share of the month's USD, converted once for the month and split by largest remainder. */
  usd: { invoices: number; cents: number; cadCents: number };
  /** Listed, never converted or counted, as on the Revenue card. */
  otherCurrencies: { currency: string; invoices: number; cents: number }[];
  /** Counted shipments entered by hand: product value plus freight in CAD, USD at the revenue rate. */
  byHand: { entries: number; cadCents: number };
  /** cad + usd.cadCents + byHand. */
  totalCadCents: number;
}

export interface ClassRevenueRow extends ClassRevenueTotals {
  customerClass: CustomerClass;
  /** Of the table's total; null when that isn't positive. */
  share: number | null;
}

export interface RevenueByClass {
  /** One row per class, in CUSTOMER_CLASSES order, zero rows included. */
  rows: ClassRevenueRow[];
  total: ClassRevenueTotals;
  /** Shipments entered by hand without a Sage customer that no truckload customer's name matches either: counted as Unclassified. */
  unresolvedByHand: { entries: number; cadCents: number };
  /**
   * Whether the Sage invoices here are the card's to the cent (CAD, USD and
   * other currencies, with their counts). On the reporting MCP path the card's
   * and the list's datasets are two reads, so an invoice that lands between
   * them is in one and not the other until the next refresh.
   */
  matchesCard: boolean;
  /** The Revenue card's total, for the note when they don't match. */
  cardTotalCents: number;
}

function emptyTotals(): ClassRevenueTotals {
  return {
    invoices: 0,
    cad: { invoices: 0, cents: 0 },
    usd: { invoices: 0, cents: 0, cadCents: 0 },
    otherCurrencies: [],
    byHand: { entries: 0, cadCents: 0 },
    totalCadCents: 0,
  };
}

function addOther(list: ClassRevenueTotals["otherCurrencies"], currency: string, cents: number): void {
  let found = list.find((c) => c.currency === currency);
  if (!found) list.push((found = { currency, invoices: 0, cents: 0 }));
  found.invoices += 1;
  found.cents += cents;
}

const byCurrency = (a: { currency: string }, b: { currency: string }) => a.currency.localeCompare(b.currency);

/**
 * A row's class: a Sage invoice's by its customer code; a shipment entered by
 * hand's by the Sage customer picked for it, else by the truckload customer its
 * name matches (as the Truckloads card matches it), else Unclassified.
 */
function classOf(row: ShipmentListRow, ftlCustomers: readonly FtlCustomer[]): { customerClass: CustomerClass; resolved: boolean } {
  if (row.source === "Sage" || row.customerCode) return { customerClass: customerClassOf(row.customerCode), resolved: true };
  const truckload = truckloadCustomerFor(row, ftlCustomers);
  return truckload ? { customerClass: customerClassOf(truckload.code), resolved: true } : { customerClass: "Unclassified", resolved: false };
}

export function revenueByClass(
  rows: readonly ShipmentListRow[],
  model: Pick<GoalsModel, "revenue">,
  ftlCustomers: readonly FtlCustomer[]
): RevenueByClass {
  const sums = new Map<CustomerClass, ClassRevenueTotals>(CUSTOMER_CLASSES.map((c) => [c, emptyTotals()]));
  const unresolvedByHand = { entries: 0, cadCents: 0 };
  for (const row of rows) {
    const { customerClass, resolved } = classOf(row, ftlCustomers);
    const sum = sums.get(customerClass)!;
    if (row.source === "By hand") {
      sum.byHand.entries += 1;
      sum.byHand.cadCents += row.cadCents;
      if (!resolved) {
        unresolvedByHand.entries += 1;
        unresolvedByHand.cadCents += row.cadCents;
      }
      continue;
    }
    sum.invoices += 1;
    if (row.currency === "CAD") {
      sum.cad.invoices += 1;
      sum.cad.cents += row.netCents;
    } else if (row.currency === "USD") {
      sum.usd.invoices += 1;
      sum.usd.cents += row.netCents;
    } else {
      addOther(sum.otherCurrencies, row.currency, row.netCents);
    }
  }

  const classes = [...sums.values()];
  const usdCad = allocateConvertedCents(
    classes.map((c) => c.usd.cents),
    model.revenue.rate
  );
  classes.forEach((c, i) => {
    c.usd.cadCents = usdCad[i];
    c.otherCurrencies.sort(byCurrency);
    c.totalCadCents = c.cad.cents + c.usd.cadCents + c.byHand.cadCents;
  });

  const total = emptyTotals();
  for (const c of classes) {
    total.invoices += c.invoices;
    total.cad.invoices += c.cad.invoices;
    total.cad.cents += c.cad.cents;
    total.usd.invoices += c.usd.invoices;
    total.usd.cents += c.usd.cents;
    total.usd.cadCents += c.usd.cadCents;
    total.byHand.entries += c.byHand.entries;
    total.byHand.cadCents += c.byHand.cadCents;
    total.totalCadCents += c.totalCadCents;
    for (const o of c.otherCurrencies) {
      let found = total.otherCurrencies.find((t) => t.currency === o.currency);
      if (!found) total.otherCurrencies.push((found = { currency: o.currency, invoices: 0, cents: 0 }));
      found.invoices += o.invoices;
      found.cents += o.cents;
    }
  }
  total.otherCurrencies.sort(byCurrency);

  const card = model.revenue;
  const cardOthers = [...card.otherCurrencies].sort(byCurrency);
  const matchesCard =
    total.cad.invoices === card.cad.invoices &&
    total.cad.cents === card.cad.cents &&
    total.usd.invoices === card.usd.invoices &&
    total.usd.cents === card.usd.cents &&
    total.byHand.cadCents === card.byHandCents &&
    total.otherCurrencies.length === cardOthers.length &&
    total.otherCurrencies.every(
      (o, i) => o.currency === cardOthers[i].currency && o.invoices === cardOthers[i].invoices && o.cents === cardOthers[i].cents
    );

  return {
    rows: classes.map((c, i) => ({
      customerClass: CUSTOMER_CLASSES[i],
      ...c,
      share: total.totalCadCents > 0 ? c.totalCadCents / total.totalCadCents : null,
    })),
    total,
    unresolvedByHand,
    matchesCard,
    cardTotalCents: card.totalCents,
  };
}
