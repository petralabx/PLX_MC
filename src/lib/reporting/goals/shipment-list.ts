// Goals & Production — the shipments list (TASK-3143): one row per Sage invoice
// shipped this month (the shipments dataset, the invoices the Revenue card adds
// up) and one per counted shipment entered by hand, each with its CAD value and
// the truckload kind of its shipment, plus the list's filters and totals. The
// totals use the Revenue card's own sums (rules.computeGoals), so the whole
// list adds up to revenue.totalCents to the cent, and the kinds come from the
// Truckloads card's helpers, so the list agrees with that card. Pure: the page
// model carries the rows (view.ts) and the browser filters and totals them.
// Each row is keyed by its invoice, so an invoice's lines hang under it
// (shipment-lines.ts, TASK-3144), and the search finds what they hold.

import { convertCents, toCents } from "./money";
import {
  classifyLoad,
  normalizeName,
  truckloadCustomerFor,
  truckloadProductUsdCents,
  type EvaluatedEntry,
  type LoadKind,
} from "./rules";
import { linesSearchText, type InvoiceLines } from "./shipment-lines";
import type { FtlCustomer, FxRate, GoalSettings, IsoDate, ShipmentRow, TruckloadRow } from "./types";

interface RowFields {
  /** Unique in the list: "sage:<invoice>" or "entry:<entry ID>". */
  key: string;
  shipDate: IsoDate;
  /** The Sage invoice number; for a shipment entered by hand, its reference (its entry ID when it has none). */
  invoice: string;
  shipment: string | null;
  orderNo: string | null;
  po: string | null;
  customer: string | null;
  customerCode: string | null;
  currency: string;
  /** Product value, before tax and freight. */
  productCents: number;
  /** Freight and other charges (an entry's freight). */
  otherCents: number;
  /** Net before tax. */
  netCents: number;
  /** A truckload customer's: by Sage code for an invoice, by code or name for an entry, as the Truckloads card matches them. */
  truckloadCustomer: boolean;
  /** Full or partial when the row's shipment is one of this month's loads on the Truckloads card. */
  truckload: LoadKind | null;
}

export type ShipmentListRow =
  | (RowFields & {
      source: "Sage";
      entryId: null;
      /** CAD as invoiced, USD at the revenue rate (half to even); null for other currencies, which are never converted. */
      cadCents: number | null;
    })
  | (RowFields & {
      source: "By hand";
      entryId: string;
      /** The entry's revenue in CAD (product value plus freight; USD at the revenue rate). */
      cadCents: number;
    });

export interface ShipmentListInput {
  /** This month's Sage invoices (the shipments dataset). */
  shipments: readonly ShipmentRow[];
  /** The truckload shipments dataset (this month and last). */
  truckloads: readonly TruckloadRow[];
  /** The model's evaluated entries; the counted shipments are listed. */
  entries: readonly EvaluatedEntry[];
  /** The USD/CAD rate revenue converts at (model.revenue.rate: Bank of Canada, or the fixed Sage rate). */
  rate: string;
  /** The run's Bank of Canada rate (model.truckloads.rate), for the truckload test: never the Sage rate. */
  truckloadRate: string;
  /** Stored rates: a CAD truckload invoice converts at its ship date's rate, as on the card. */
  rates: readonly FxRate[];
  settings: GoalSettings;
  ftlCustomers: readonly FtlCustomer[];
}

/** A truckload shipment as queries/truckloads.ts groups invoices: customer code and shipment number (both trimmed there). */
const loadKey = (code: string | null, shipment: string) => `${code ?? ""}|${shipment}`;

export function buildShipmentList(input: ShipmentListInput): ShipmentListRow[] {
  const { rate } = input;
  const codes = new Set(input.ftlCustomers.map((c) => c.code));
  // This month's loads of the configured customers, classified as rules.computeGoals counts them.
  const loads = new Map<string, LoadKind>();
  for (const row of input.truckloads) {
    if (!row.thisMonth || !codes.has(row.code)) continue;
    const kind = classifyLoad(truckloadProductUsdCents(row, input.rates, input.truckloadRate), input.settings);
    if (kind) loads.set(loadKey(row.code, row.shipment), kind);
  }

  const rows = input.shipments.map((s): ShipmentListRow => {
    const netCents = toCents(s.netBeforeTax);
    return {
      key: `sage:${s.invoice}`,
      shipDate: s.shipDate,
      invoice: s.invoice,
      shipment: s.shipment,
      orderNo: s.orderNo,
      po: s.po,
      customer: s.customer,
      customerCode: s.customerCode,
      currency: s.currency,
      productCents: toCents(s.productValue),
      otherCents: toCents(s.otherCharges),
      netCents,
      truckloadCustomer: s.customerCode !== null && codes.has(s.customerCode),
      // An invoice without a shipment number is its own shipment.
      truckload: loads.get(loadKey(s.customerCode, s.shipment ?? `invoice:${s.invoice}`)) ?? null,
      source: "Sage",
      entryId: null,
      cadCents: s.currency === "CAD" ? netCents : s.currency === "USD" ? convertCents(netCents, rate) : null,
    };
  });

  for (const e of input.entries) {
    if (!e.counts || e.type !== "Shipment") continue;
    const productCents = toCents(e.productValue);
    const otherCents = toCents(e.freight);
    rows.push({
      key: `entry:${e.entryId}`,
      // A counted shipment has a date this month and a CAD or USD currency (rules.entryStatus).
      shipDate: e.date as IsoDate,
      invoice: e.reference?.trim() || e.entryId,
      shipment: null,
      orderNo: null,
      po: null,
      customer: e.customer,
      customerCode: e.customerCode,
      currency: e.currency as string,
      productCents,
      otherCents,
      netCents: productCents + otherCents,
      truckloadCustomer: truckloadCustomerFor(e, input.ftlCustomers) !== null,
      truckload: e.truckload?.kind ?? null,
      source: "By hand",
      entryId: e.entryId,
      cadCents: e.revenueCadCents,
    });
  }

  // Ship date, then invoice (the Excel Shipments sheet's order); an entry sits among its day's invoices.
  return rows.sort((a, b) =>
    a.shipDate === b.shipDate ? a.invoice.localeCompare(b.invoice) : a.shipDate < b.shipDate ? -1 : 1
  );
}

// ─── Filters ──────────────────────────────────────────────────────────────

/** The list's single-select filters (the page's chips). */
export type ShipmentFilter = "all" | "truckload" | "full" | "partial" | "cad" | "usd" | "by_hand";

function inFilter(row: ShipmentListRow, filter: ShipmentFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "truckload":
      return row.truckloadCustomer;
    case "full":
      return row.truckload === "full";
    case "partial":
      return row.truckload === "partial";
    case "cad":
      return row.currency === "CAD";
    case "usd":
      return row.currency === "USD";
    case "by_hand":
      return row.source === "By hand";
  }
}

/**
 * The rows in the filter whose customer (name or code), invoice or reference,
 * shipment, order or PO holds the search, ignoring case and spacing; with the
 * run's invoice lines (by row key), an item or charge code or description too.
 */
export function filterShipments(
  rows: readonly ShipmentListRow[],
  opts: { filter: ShipmentFilter; query: string; lines?: ReadonlyMap<string, InvoiceLines> }
): ShipmentListRow[] {
  const needle = normalizeName(opts.query);
  return rows.filter(
    (row) =>
      inFilter(row, opts.filter) &&
      (!needle ||
        normalizeName(
          [row.customer, row.customerCode, row.invoice, row.shipment, row.orderNo, row.po, linesSearchText(opts.lines?.get(row.key))].join(" ")
        ).includes(needle))
  );
}

// ─── Totals ───────────────────────────────────────────────────────────────

export interface ShipmentTotals {
  /** Sage invoices among the rows, every currency. */
  invoices: number;
  /** Shipments entered by hand among the rows. */
  byHand: number;
  cad: { invoices: number; cents: number };
  /** cadCents: the USD subtotal converted once at the rate, as the Revenue card converts it. */
  usd: { invoices: number; cents: number; cadCents: number };
  /** Invoices in other currencies: listed, never converted or added to the CAD total. */
  otherCurrencies: { currency: string; invoices: number; cents: number }[];
  byHandCadCents: number;
  /** cad.cents + usd.cadCents + byHandCadCents — the Revenue card's formula. */
  totalCadCents: number;
}

export function shipmentTotals(rows: readonly ShipmentListRow[], rate: string): ShipmentTotals {
  const cad = { invoices: 0, cents: 0 };
  const usd = { invoices: 0, cents: 0 };
  const other = new Map<string, { currency: string; invoices: number; cents: number }>();
  const otherSum = (currency: string) => {
    const found = other.get(currency);
    if (found) return found;
    const created = { currency, invoices: 0, cents: 0 };
    other.set(currency, created);
    return created;
  };
  let byHand = 0;
  let byHandCadCents = 0;
  for (const row of rows) {
    if (row.source === "By hand") {
      byHand += 1;
      byHandCadCents += row.cadCents;
      continue;
    }
    const sum = row.currency === "CAD" ? cad : row.currency === "USD" ? usd : otherSum(row.currency);
    sum.invoices += 1;
    sum.cents += row.netCents;
  }
  const usdCadCents = convertCents(usd.cents, rate);
  const otherCurrencies = [...other.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  return {
    invoices: cad.invoices + usd.invoices + otherCurrencies.reduce((n, c) => n + c.invoices, 0),
    byHand,
    cad,
    usd: { ...usd, cadCents: usdCadCents },
    otherCurrencies,
    byHandCadCents,
    totalCadCents: cad.cents + usdCadCents + byHandCadCents,
  };
}
