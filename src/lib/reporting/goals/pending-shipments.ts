// INTERIM (TASK-3992): shipped, not yet invoiced, by customer class, in CAD.
// An estimate added to the Revenue card until AR invoices the shipment (see
// queries/pending-shipments.ts). Classed by the shipment's own customer, like
// returns, so scope=mfg leaves Exclusive Distribution out. USD converts once
// at the card's rate and is shared across the classes by largest remainder,
// as revenue-by-class.ts does; other currencies aren't counted.

import { customerClassOf } from "./forecast";
import { CUSTOMER_CLASSES, type CustomerClass } from "./forecast-list";
import { allocateConvertedCents, toCents } from "./money";
import { normalizeRef } from "./rules";
import type { PendingShipmentRow } from "./types";

/** Off with GOALS_PENDING_SHIPMENTS=off: the refresh doesn't read them and nothing shows. */
export function pendingShipmentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.GOALS_PENDING_SHIPMENTS ?? "").trim().toLowerCase() !== "off";
}

/** Normalized references of counted manual shipments. Those goods are already on the card. */
export function countedManualShipmentRefs(
  entries: readonly { type: string; counts: boolean; reference: string | null }[],
): Set<string> {
  const refs = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "Shipment" || !entry.counts) continue;
    const ref = normalizeRef(entry.reference);
    if (ref) refs.add(ref);
  }
  return refs;
}

/**
 * Pending Sage rows whose shipment number is already a counted manual entry.
 * Leaving them in the estimate counts the same goods twice (TASK-3992).
 */
export function pendingShipmentsNotEnteredByHand<T extends { shipment: string }>(
  rows: readonly T[],
  countedRefs: ReadonlySet<string>,
): T[] {
  if (countedRefs.size === 0) return [...rows];
  return rows.filter((row) => !countedRefs.has(normalizeRef(row.shipment)));
}

export interface PendingClassTotals {
  shipments: number;
  cadCents: number;
  usdCents: number;
  usdCadCents: number;
  /** cadCents + usdCadCents: what's added to the goal. */
  totalCadCents: number;
}

export interface PendingShipmentsByClass {
  rows: Record<CustomerClass, PendingClassTotals>;
  total: PendingClassTotals;
  otherCurrencies: { currency: string; shipments: number; cents: number }[];
}

const zero = (): PendingClassTotals => ({ shipments: 0, cadCents: 0, usdCents: 0, usdCadCents: 0, totalCadCents: 0 });

export function pendingShipmentsByClass(rows: readonly PendingShipmentRow[], rate: string): PendingShipmentsByClass {
  const byClass = Object.fromEntries(CUSTOMER_CLASSES.map((c) => [c, zero()])) as Record<CustomerClass, PendingClassTotals>;
  const other = new Map<string, { currency: string; shipments: number; cents: number }>();
  for (const s of rows) {
    const cents = toCents(s.productValue);
    const currency = s.currency.trim().toUpperCase();
    if (currency !== "CAD" && currency !== "USD") {
      const o = other.get(currency) ?? { currency, shipments: 0, cents: 0 };
      o.shipments += 1;
      o.cents += cents;
      other.set(currency, o);
      continue;
    }
    const t = byClass[customerClassOf(s.customerCode)];
    t.shipments += 1;
    if (currency === "CAD") t.cadCents += cents;
    else t.usdCents += cents;
  }
  const converted = allocateConvertedCents(CUSTOMER_CLASSES.map((c) => byClass[c].usdCents), rate);
  const total = zero();
  CUSTOMER_CLASSES.forEach((c, i) => {
    const t = byClass[c];
    t.usdCadCents = converted[i] ?? 0;
    t.totalCadCents = t.cadCents + t.usdCadCents;
    total.shipments += t.shipments;
    total.cadCents += t.cadCents;
    total.usdCents += t.usdCents;
    total.usdCadCents += t.usdCadCents;
    total.totalCadCents += t.totalCadCents;
  });
  return { rows: byClass, total, otherCurrencies: [...other.values()] };
}
