// Revenue by business line (Ricardo Savelli, 26 Oct 2026). The Revenue
// headline is product before tax, less returns. This splits that headline
// three ways, and the three add up to it to the cent:
//   Manufacturing — the item code is a finished good in the MRP
//     (silver.finished_products erp_code or code)
//   Services — a service charge such as 3PL, and not a finished good
//   Distribution — every other product
// Accessorial lines (Sage line type 2: freight, lab, other miscellaneous
// charges) stay out, as they do on the headline. A code that is both a
// finished good and a 3PL service counts as Manufacturing.
//
// Shipped-not-invoiced product, when a caller passes it, is split the same
// way and returned beside the headline (`pending`). It is not inside the
// headline figures: this branch's headline does not include that estimate.
// A shipment total with no item lines counts as Distribution.

import { CUSTOMER_CLASSES, type CustomerClass } from "./forecast-list";
import { customerClassOf } from "./forecast";
import { allocateCents, allocateConvertedCents, convertCents, sumToCents, toCents } from "./money";
import { shipmentCustomerClass, type RevenueByClass } from "./revenue-by-class";
import { SCOPE_EXCLUDES, type RevenueScope } from "./revenue-scope";
import { normalizeRef } from "./rules";
import type { ShipmentListRow } from "./shipment-list";
import type { CreditNoteRow, FtlCustomer, ShipmentLineRow, ShipmentLinesSummary } from "./types";

export const BUSINESS_LINES = ["manufacturing", "distribution", "services"] as const;
export type BusinessLine = (typeof BUSINESS_LINES)[number];

export interface BusinessLineAmounts {
  manufacturingCadCents: number;
  distributionCadCents: number;
  servicesCadCents: number;
}

export interface BusinessLineScope {
  /** Invoiced product less returns. Adds up to the Revenue headline. */
  amounts: BusinessLineAmounts;
  /**
   * Shipped, not yet invoiced, split the same way. Zero when that dataset
   * is absent. Not part of the headline on this branch.
   */
  pending: BusinessLineAmounts;
}

export interface RevenueByBusinessLine {
  state: "ready" | "waiting";
  /** Why the split isn't shown. null when ready. */
  waiting: string | null;
  all: BusinessLineScope;
  /** Every customer class but Exclusive Distribution, matching the manufacturing-customers headline. */
  mfg: BusinessLineScope;
  /** Finished-good codes that also match a 3PL service. Counted as Manufacturing. */
  ambiguousCodes: string[];
  /** Invoices with product and no positive item lines. That product is in Distribution. */
  unitemizedInvoices: number;
  /** Credit notes whose invoice has no item lines this month. Shared by the class's product mix, else Distribution. */
  returnsShared: number;
  /** Pending shipments that had no item lines. Their product is in Distribution. */
  pendingWithoutLines: number;
}

export interface PendingProductLine {
  code: string | null;
  description: string | null;
  /** The line's product, in the shipment's currency. */
  amount: string;
  discount?: string;
}

/** One shipped-not-invoiced product amount. `lines` classifies it; without them it is Distribution. */
export interface PendingProduct {
  customerCode: string | null;
  currency: string;
  productValue: string;
  lines?: readonly PendingProductLine[];
}

export interface BusinessLineInput {
  shipments: readonly ShipmentListRow[];
  /** null when this run's lines were not passed in. */
  lines: readonly ShipmentLineRow[] | null;
  /** What the run stored about its lines. null: the run predates them. */
  linesSummary: ShipmentLinesSummary | null;
  /** null: the MRP list could not be read. An empty set was read and matched nothing. */
  finishedGoodCodes: ReadonlySet<string> | null;
  creditNotes: readonly CreditNoteRow[];
  ftlCustomers: readonly FtlCustomer[];
  /** The page's revenue rate (model.revenue.rate). */
  rate: string;
  byClass: RevenueByClass;
  pending?: readonly PendingProduct[];
}

type Parts = Record<BusinessLine, number>;

const zero = (): Parts => ({ manufacturing: 0, distribution: 0, services: 0 });

function add(into: Parts, extra: Parts, sign = 1): void {
  for (const line of BUSINESS_LINES) into[line] += sign * extra[line];
}

function weightSum(parts: Parts): number {
  return BUSINESS_LINES.reduce((n, line) => n + parts[line], 0);
}

function fromWeights(total: number, weights: Parts): Parts {
  const out = zero();
  if (weightSum(weights) === 0) {
    out.distribution = total;
    return out;
  }
  const allocated = allocateCents(total, BUSINESS_LINES.map((line) => weights[line]));
  BUSINESS_LINES.forEach((line, i) => {
    out[line] = allocated[i];
  });
  return out;
}

export function normalizeItemCode(code: string | null | undefined): string | null {
  const text = (code ?? "").trim().toUpperCase();
  return text || null;
}

/** A 3PL service: item code 3PL or 3PL-… / 3PL_…, or the description contains the token 3PL. */
export function isServiceItem(code: string | null, description: string | null): boolean {
  const normalized = normalizeItemCode(code);
  if (normalized === "3PL" || normalized?.startsWith("3PL-") || normalized?.startsWith("3PL_")) return true;
  return /\b3PL\b/i.test(description ?? "");
}

/**
 * Manufacturing when the code is a finished good; Services when it is a 3PL
 * service and not a finished good; otherwise Distribution. `ambiguous` is a
 * finished good that also matches a 3PL service (Manufacturing wins).
 */
export function businessLineOf(
  code: string | null,
  description: string | null,
  finishedGoods: ReadonlySet<string>,
): { line: BusinessLine; ambiguous: boolean } {
  const normalized = normalizeItemCode(code);
  const finished = normalized !== null && finishedGoods.has(normalized);
  const service = isServiceItem(code, description);
  if (finished) return { line: "manufacturing", ambiguous: service };
  if (service) return { line: "services", ambiguous: false };
  return { line: "distribution", ambiguous: false };
}

function normalizeGoods(codes: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const code of codes) {
    const normalized = normalizeItemCode(code);
    if (normalized) out.add(normalized);
  }
  return out;
}

function toPublic(parts: Parts): BusinessLineAmounts {
  return {
    manufacturingCadCents: parts.manufacturing,
    distributionCadCents: parts.distribution,
    servicesCadCents: parts.services,
  };
}

export function businessLineSum(amounts: BusinessLineAmounts): number {
  return amounts.manufacturingCadCents + amounts.distributionCadCents + amounts.servicesCadCents;
}

export function businessLinePlus(a: BusinessLineAmounts, b: BusinessLineAmounts): BusinessLineAmounts {
  return {
    manufacturingCadCents: a.manufacturingCadCents + b.manufacturingCadCents,
    distributionCadCents: a.distributionCadCents + b.distributionCadCents,
    servicesCadCents: a.servicesCadCents + b.servicesCadCents,
  };
}

interface Group {
  amount: string[];
  discount: string[];
}

function emptyGroups(): Record<BusinessLine, Group> {
  return {
    manufacturing: { amount: [], discount: [] },
    distribution: { amount: [], discount: [] },
    services: { amount: [], discount: [] },
  };
}

function weightsOf(
  lines: readonly { kind?: "item" | "charge"; code: string | null; description: string | null; amount: string; discount?: string }[],
  finished: ReadonlySet<string>,
  ambiguous: Set<string>,
  chargesLeftOut: boolean,
): Parts {
  const groups = emptyGroups();
  for (const line of lines) {
    if (chargesLeftOut && line.kind === "charge") continue;
    const found = businessLineOf(line.code, line.description, finished);
    if (found.ambiguous) {
      const code = normalizeItemCode(line.code);
      if (code) ambiguous.add(code);
    }
    groups[found.line].amount.push(line.amount);
    groups[found.line].discount.push(line.discount ?? "0");
  }
  const weights = zero();
  for (const line of BUSINESS_LINES) {
    const net = sumToCents(groups[line].amount, groups[line].discount);
    weights[line] = net > 0 ? net : 0;
  }
  return weights;
}

function waiting(message: string): RevenueByBusinessLine {
  const empty = { amounts: toPublic(zero()), pending: toPublic(zero()) };
  return {
    state: "waiting",
    waiting: message,
    all: empty,
    mfg: empty,
    ambiguousCodes: [],
    unitemizedInvoices: 0,
    returnsShared: 0,
    pendingWithoutLines: 0,
  };
}

function itemLines(value: unknown): PendingProductLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines: PendingProductLine[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return undefined;
    const record = row as { code?: unknown; description?: unknown; amount?: unknown; discount?: unknown };
    if (typeof record.amount !== "string") return undefined;
    lines.push({
      code: typeof record.code === "string" ? record.code : null,
      description: typeof record.description === "string" ? record.description : null,
      amount: record.amount,
      discount: typeof record.discount === "string" ? record.discount : "0",
    });
  }
  return lines;
}

/**
 * Pending product on a snapshot, if a refresh stored it (the shipped-not-invoiced
 * dataset). Rows already entered by hand are left out, as that estimate leaves
 * them out. A `lines` array of item amounts is kept; a line count is not.
 */
export function pendingProductsOf(snapshot: object, countedRefs: ReadonlySet<string>): PendingProduct[] {
  const block = (snapshot as { pendingShipments?: unknown }).pendingShipments;
  if (!block || typeof block !== "object") return [];
  const access = (block as { access?: unknown }).access;
  const shipments = (block as { shipments?: unknown }).shipments;
  if (access !== "read" || !Array.isArray(shipments)) return [];
  const out: PendingProduct[] = [];
  for (const row of shipments) {
    if (!row || typeof row !== "object") continue;
    const record = row as { shipment?: unknown; customerCode?: unknown; currency?: unknown; productValue?: unknown; lines?: unknown; itemLines?: unknown };
    if (typeof record.currency !== "string" || typeof record.productValue !== "string") continue;
    const shipment = typeof record.shipment === "string" ? record.shipment : "";
    if (shipment && countedRefs.has(normalizeRef(shipment))) continue;
    out.push({
      customerCode: typeof record.customerCode === "string" ? record.customerCode : null,
      currency: record.currency,
      productValue: record.productValue,
      lines: itemLines(record.itemLines) ?? itemLines(record.lines),
    });
  }
  return out;
}

export function countedShipmentRefs(
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

interface ClassBucket {
  cad: Parts;
  usd: Parts;
  hand: Parts;
  returnsCad: Parts;
  returnsUsd: Parts;
  /** Invoiced product weights (CAD and USD native) for sharing a return that has no lines. */
  mix: Parts;
}

function emptyBucket(): ClassBucket {
  return { cad: zero(), usd: zero(), hand: zero(), returnsCad: zero(), returnsUsd: zero(), mix: zero() };
}

function scopeOf(byClass: ReadonlyMap<CustomerClass, Parts>, pending: ReadonlyMap<CustomerClass, Parts>, scope: RevenueScope): BusinessLineScope {
  const excluded = SCOPE_EXCLUDES[scope];
  const amounts = zero();
  const pendingParts = zero();
  for (const customerClass of CUSTOMER_CLASSES) {
    if (excluded.includes(customerClass)) continue;
    add(amounts, byClass.get(customerClass) ?? zero());
    add(pendingParts, pending.get(customerClass) ?? zero());
  }
  return { amounts: toPublic(amounts), pending: toPublic(pendingParts) };
}

export function revenueByBusinessLine(input: BusinessLineInput): RevenueByBusinessLine {
  const summary = input.linesSummary;
  if (!summary) return waiting("Invoice lines aren’t in this refresh yet.");
  if (summary.access !== "read") {
    return waiting(`Invoice lines can’t be read yet (needs ${summary.missing.join(", ")}).`);
  }
  if (!input.lines) return waiting("Invoice lines aren’t loaded.");
  if (!input.finishedGoodCodes) return waiting("The MRP finished-good list can’t be read yet.");

  const finished = normalizeGoods(input.finishedGoodCodes);
  const ambiguous = new Set<string>();
  let unitemizedInvoices = 0;
  let returnsShared = 0;
  let pendingWithoutLines = 0;

  const byInvoice = new Map<string, ShipmentLineRow[]>();
  for (const line of input.lines) {
    const own = byInvoice.get(line.invoice);
    if (own) own.push(line);
    else byInvoice.set(line.invoice, [line]);
  }
  const invoiceWeights = new Map<string, Parts>();

  const buckets = new Map<CustomerClass, ClassBucket>(CUSTOMER_CLASSES.map((c) => [c, emptyBucket()]));
  for (const row of input.shipments) {
    const bucket = buckets.get(shipmentCustomerClass(row, input.ftlCustomers).customerClass)!;
    if (row.source === "By hand") {
      const freightCad = row.currency === "USD" ? convertCents(row.otherCents, input.rate) : row.otherCents;
      const product = row.cadCents - freightCad;
      const service = isServiceItem(null, `${row.customer ?? ""} ${row.invoice}`);
      add(bucket.hand, service ? { manufacturing: 0, distribution: 0, services: product } : { manufacturing: 0, distribution: product, services: 0 });
      continue;
    }
    if (row.currency !== "CAD" && row.currency !== "USD") continue;
    const product = row.netCents - row.otherCents;
    const weights = weightsOf(byInvoice.get(row.invoice) ?? [], finished, ambiguous, true);
    invoiceWeights.set(row.invoice, weights);
    if (weightSum(weights) === 0 && product !== 0) unitemizedInvoices += 1;
    const split = fromWeights(product, weights);
    add(row.currency === "CAD" ? bucket.cad : bucket.usd, split);
    add(bucket.mix, split);
  }

  for (const note of input.creditNotes) {
    if (note.currency !== "CAD" && note.currency !== "USD") continue;
    const bucket = buckets.get(customerClassOf(note.customerCode))!;
    const product = toCents(note.netBeforeTax) - toCents(note.otherCharges);
    const own = note.invoice ? invoiceWeights.get(note.invoice) : undefined;
    let weights = own && weightSum(own) > 0 ? own : null;
    if (!weights) {
      if (product !== 0) returnsShared += 1;
      weights = weightSum(bucket.mix) > 0 ? bucket.mix : null;
    }
    const split = weights ? fromWeights(product, weights) : fromWeights(product, zero());
    add(note.currency === "CAD" ? bucket.returnsCad : bucket.returnsUsd, split);
  }

  const classAmounts = new Map<CustomerClass, Parts>();
  for (const customerClass of CUSTOMER_CLASSES) {
    const bucket = buckets.get(customerClass)!;
    const row = input.byClass.rows.find((r) => r.customerClass === customerClass);
    const usdCad = fromWeights((row?.usd.cadCents ?? 0) - (row?.charges.usdCadCents ?? 0), bucket.usd);
    const returnsUsdCad = fromWeights((row?.returns.usd.cadCents ?? 0) - (row?.returns.usd.chargesCadCents ?? 0), bucket.returnsUsd);
    const amounts = zero();
    add(amounts, bucket.cad);
    add(amounts, usdCad);
    add(amounts, bucket.hand);
    add(amounts, bucket.returnsCad, -1);
    add(amounts, returnsUsdCad, -1);
    classAmounts.set(customerClass, amounts);
  }

  const pendingByClass = pendingAmounts(input.pending ?? [], finished, ambiguous, input.rate, (n) => {
    pendingWithoutLines += n;
  });

  return {
    state: "ready",
    waiting: null,
    all: scopeOf(classAmounts, pendingByClass, "all"),
    mfg: scopeOf(classAmounts, pendingByClass, "mfg"),
    ambiguousCodes: [...ambiguous].sort(),
    unitemizedInvoices,
    returnsShared,
    pendingWithoutLines,
  };
}

function pendingAmounts(
  pending: readonly PendingProduct[],
  finished: ReadonlySet<string>,
  ambiguous: Set<string>,
  rate: string,
  countUnitemized: (n: number) => void,
): Map<CustomerClass, Parts> {
  const cad = new Map<CustomerClass, Parts>(CUSTOMER_CLASSES.map((c) => [c, zero()]));
  const usd = new Map<CustomerClass, Parts>(CUSTOMER_CLASSES.map((c) => [c, zero()]));
  for (const row of pending) {
    const currency = row.currency.trim().toUpperCase();
    if (currency !== "CAD" && currency !== "USD") continue;
    const bucket = currency === "CAD" ? cad : usd;
    const parts = bucket.get(customerClassOf(row.customerCode))!;
    const hasLines = (row.lines?.length ?? 0) > 0;
    if (!hasLines) countUnitemized(1);
    const weights = hasLines ? weightsOf(row.lines ?? [], finished, ambiguous, false) : zero();
    add(parts, fromWeights(toCents(row.productValue), weights));
  }
  const usdCad = allocateConvertedCents(
    CUSTOMER_CLASSES.map((c) => weightSum(usd.get(c)!)),
    rate,
  );
  const out = new Map<CustomerClass, Parts>();
  CUSTOMER_CLASSES.forEach((customerClass, i) => {
    const amounts = zero();
    add(amounts, cad.get(customerClass)!);
    add(amounts, fromWeights(usdCad[i] ?? 0, usd.get(customerClass)!));
    out.set(customerClass, amounts);
  });
  return out;
}
