// Adding up revenue-by-class totals (TASK-3781, TASK-4373). Pure: no roster,
// no I/O, so the "How it adds up" tab (a client component) can add one
// scope's classes exactly the way revenueByClass adds every class for
// byClass.total. revenue-by-class.ts itself stays server-only.

import type { ClassRevenueTotals } from "./revenue-by-class";

export function emptyTotals(): ClassRevenueTotals {
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

export function addOtherReturn(list: ClassRevenueTotals["returns"]["otherCurrencies"], currency: string, notes: number, cents: number): void {
  let found = list.find((c) => c.currency === currency);
  if (!found) list.push((found = { currency, notes: 0, cents: 0 }));
  found.notes += notes;
  found.cents += cents;
}

export function addOther(list: ClassRevenueTotals["otherCurrencies"], currency: string, invoices: number, cents: number): void {
  let found = list.find((c) => c.currency === currency);
  if (!found) list.push((found = { currency, invoices: 0, cents: 0 }));
  found.invoices += invoices;
  found.cents += cents;
}

export const byCurrency = (a: { currency: string }, b: { currency: string }) => a.currency.localeCompare(b.currency);

/** The classes' totals added up, other currencies merged and sorted by code (byClass.total, or one scope's classes). */
export function sumClassTotals(classes: readonly ClassRevenueTotals[]): ClassRevenueTotals {
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
  return total;
}
