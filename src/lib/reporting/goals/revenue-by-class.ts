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
import { allocateConvertedCents, convertCents, toCents } from "./money";
import { truckloadCustomerFor, type GoalsModel } from "./rules";
import type { ShipmentListRow } from "./shipment-list";
import type { CreditNoteRow, FtlCustomer } from "./types";

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
  /**
   * Freight and other charges inside totalCadCents (TASK-3952): a Sage invoice's
   * other charges (invmisc, the sum of its line type 2 lines) and an entry's
   * freight. CAD as invoiced; USD converted once for the month and shared by
   * largest remainder, as usd.cadCents is; by hand at the revenue rate.
   */
  charges: { cadCents: number; usdCents: number; usdCadCents: number; byHandCadCents: number; totalCadCents: number };
  /**
   * This month's Sage credit notes (TASK-3987), by the note's customer code, as
   * positive amounts: NOT inside totalCadCents (which stays what was invoiced).
   * USD converted once for the month and shared by largest remainder, as
   * usd.cadCents is. productCadCents (items less discount, before tax) comes off
   * the goal; chargesCadCents (credited freight and other charges) never counted
   * toward it. Other currencies are listed, never converted or counted.
   */
  returns: {
    notes: number;
    cad: { notes: number; cents: number; chargesCents: number };
    usd: { notes: number; cents: number; chargesCents: number; cadCents: number; chargesCadCents: number };
    otherCurrencies: { currency: string; notes: number; cents: number }[];
    /** cad.cents + usd.cadCents: the notes' net before tax in CAD. */
    totalCadCents: number;
    /** cad.chargesCents + usd.chargesCadCents. */
    chargesCadCents: number;
    /** totalCadCents less chargesCadCents: what comes off the goal. */
    productCadCents: number;
  };
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
    charges: { cadCents: 0, usdCents: 0, usdCadCents: 0, byHandCadCents: 0, totalCadCents: 0 },
    returns: emptyReturns(),
  };
}

function emptyReturns(): ClassRevenueTotals["returns"] {
  return {
    notes: 0,
    cad: { notes: 0, cents: 0, chargesCents: 0 },
    usd: { notes: 0, cents: 0, chargesCents: 0, cadCents: 0, chargesCadCents: 0 },
    otherCurrencies: [],
    totalCadCents: 0,
    chargesCadCents: 0,
    productCadCents: 0,
  };
}

function addOtherReturn(list: ClassRevenueTotals["returns"]["otherCurrencies"], currency: string, notes: number, cents: number): void {
  let found = list.find((c) => c.currency === currency);
  if (!found) list.push((found = { currency, notes: 0, cents: 0 }));
  found.notes += notes;
  found.cents += cents;
}

function addOther(list: ClassRevenueTotals["otherCurrencies"], currency: string, invoices: number, cents: number): void {
  let found = list.find((c) => c.currency === currency);
  if (!found) list.push((found = { currency, invoices: 0, cents: 0 }));
  found.invoices += invoices;
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
  ftlCustomers: readonly FtlCustomer[],
  creditNotes: readonly CreditNoteRow[] = []
): RevenueByClass {
  const sums = new Map<CustomerClass, ClassRevenueTotals>(CUSTOMER_CLASSES.map((c) => [c, emptyTotals()]));
  const unresolvedByHand = { entries: 0, cadCents: 0 };
  for (const row of rows) {
    const { customerClass, resolved } = classOf(row, ftlCustomers);
    const sum = sums.get(customerClass)!;
    if (row.source === "By hand") {
      sum.byHand.entries += 1;
      sum.byHand.cadCents += row.cadCents;
      sum.charges.byHandCadCents += row.currency === "USD" ? convertCents(row.otherCents, model.revenue.rate) : row.otherCents;
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
      sum.charges.cadCents += row.otherCents;
    } else if (row.currency === "USD") {
      sum.usd.invoices += 1;
      sum.usd.cents += row.netCents;
      sum.charges.usdCents += row.otherCents;
    } else {
      addOther(sum.otherCurrencies, row.currency, 1, row.netCents);
    }
  }

  // Returns (TASK-3987): each credit note by its own customer code.
  for (const note of creditNotes) {
    const ret = sums.get(customerClassOf(note.customerCode))!.returns;
    const net = toCents(note.netBeforeTax);
    const charges = toCents(note.otherCharges);
    ret.notes += 1;
    if (note.currency === "CAD") {
      ret.cad.notes += 1;
      ret.cad.cents += net;
      ret.cad.chargesCents += charges;
    } else if (note.currency === "USD") {
      ret.usd.notes += 1;
      ret.usd.cents += net;
      ret.usd.chargesCents += charges;
    } else {
      addOtherReturn(ret.otherCurrencies, note.currency, 1, net);
    }
  }

  const classes = [...sums.values()];
  const returnsUsdCad = allocateConvertedCents(
    classes.map((c) => c.returns.usd.cents),
    model.revenue.rate
  );
  const returnsChargesUsdCad = allocateConvertedCents(
    classes.map((c) => c.returns.usd.chargesCents),
    model.revenue.rate
  );
  const usdCad = allocateConvertedCents(
    classes.map((c) => c.usd.cents),
    model.revenue.rate
  );
  const chargesUsdCad = allocateConvertedCents(
    classes.map((c) => c.charges.usdCents),
    model.revenue.rate
  );
  classes.forEach((c, i) => {
    c.usd.cadCents = usdCad[i];
    c.charges.usdCadCents = chargesUsdCad[i];
    c.charges.totalCadCents = c.charges.cadCents + c.charges.usdCadCents + c.charges.byHandCadCents;
    c.otherCurrencies.sort(byCurrency);
    c.totalCadCents = c.cad.cents + c.usd.cadCents + c.byHand.cadCents;
    const ret = c.returns;
    ret.usd.cadCents = returnsUsdCad[i];
    ret.usd.chargesCadCents = returnsChargesUsdCad[i];
    ret.otherCurrencies.sort(byCurrency);
    ret.totalCadCents = ret.cad.cents + ret.usd.cadCents;
    ret.chargesCadCents = ret.cad.chargesCents + ret.usd.chargesCadCents;
    ret.productCadCents = ret.totalCadCents - ret.chargesCadCents;
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
    total.charges.cadCents += c.charges.cadCents;
    total.charges.usdCents += c.charges.usdCents;
    total.charges.usdCadCents += c.charges.usdCadCents;
    total.charges.byHandCadCents += c.charges.byHandCadCents;
    total.charges.totalCadCents += c.charges.totalCadCents;
    for (const o of c.otherCurrencies) addOther(total.otherCurrencies, o.currency, o.invoices, o.cents);
    const ret = total.returns;
    ret.notes += c.returns.notes;
    ret.cad.notes += c.returns.cad.notes;
    ret.cad.cents += c.returns.cad.cents;
    ret.cad.chargesCents += c.returns.cad.chargesCents;
    ret.usd.notes += c.returns.usd.notes;
    ret.usd.cents += c.returns.usd.cents;
    ret.usd.chargesCents += c.returns.usd.chargesCents;
    ret.usd.cadCents += c.returns.usd.cadCents;
    ret.usd.chargesCadCents += c.returns.usd.chargesCadCents;
    ret.totalCadCents += c.returns.totalCadCents;
    ret.chargesCadCents += c.returns.chargesCadCents;
    ret.productCadCents += c.returns.productCadCents;
    for (const o of c.returns.otherCurrencies) addOtherReturn(ret.otherCurrencies, o.currency, o.notes, o.cents);
  }
  total.otherCurrencies.sort(byCurrency);
  total.returns.otherCurrencies.sort(byCurrency);

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
