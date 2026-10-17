// Goals & Production — what shipped (TASK-3144): each Sage invoice's lines under
// its row in the shipments list (shipment-list.ts), checked against the invoice
// to the cent. Item lines, less their discounts, must come to the invoice's
// product value (invitmtot − invdiscamt) and its charges to its other charges
// (invmisc). An invoice whose lines don't is flagged with both figures, never
// hidden. Pure: the refresh stores the lines (queries/shipment-lines.ts), the
// page model says only whether the run has them (view.ts; a busy month's lines
// would more than double its payload), and the page fetches one run's lines on
// demand (GET /api/reporting/goals/runs/[id]/shipment-lines) to build these. The
// workbook's "Shipment lines" sheet words a mismatch the same way.

import { formatAmount, sumToCents } from "./money";
import { missingByRelation } from "./queries/read-access";
import type { ShipmentListRow } from "./shipment-list";
import type { ShipmentLineRow, ShipmentLinesSummary } from "./types";

/** What the page model says about the run's invoice lines; the lines themselves load on demand. */
export type ShipmentLinesView =
  | { state: "not_in_run" }
  | { state: "waiting_for_access"; missing: { relation: string; columns: string[] }[] }
  | { state: "ready"; lines: number };

/** From the run's stored summary; null: the run was stored before the lines existed (they fill in at the next refresh). */
export function shipmentLinesView(summary: ShipmentLinesSummary | null): ShipmentLinesView {
  if (!summary) return { state: "not_in_run" };
  if (summary.access === "missing") return { state: "waiting_for_access", missing: missingByRelation(summary.missing) };
  return { state: "ready", lines: summary.lines };
}

/** One side of an invoice's check, in cents of the invoice's currency: what its lines come to against what the invoice says. */
export interface LinesCheck {
  cents: number;
  invoiceCents: number;
  agrees: boolean;
}

/** An invoice's lines, in Sage's order, checked against the invoice. */
export interface InvoiceLines {
  lines: ShipmentLineRow[];
  /** Item lines' amounts less their discounts, against the product value. */
  items: LinesCheck;
  /** Charges' amounts (freight and other miscellaneous charges), against the other charges. */
  charges: LinesCheck;
  /** Both sides agree to the cent. */
  agrees: boolean;
}

/** What the check reads of a list row (the workbook makes these from the run's invoices). */
export type InvoiceHeader = Pick<ShipmentListRow, "key" | "invoice" | "source" | "productCents" | "otherCents">;

const check = (cents: number, invoiceCents: number): LinesCheck => ({ cents, invoiceCents, agrees: cents === invoiceCents });

/**
 * Every Sage row's lines, by the row's key ("sage:<invoice>"), in the rows'
 * order; rows entered by hand have none. An invoice's lines are added up exactly
 * (Sage keeps three decimals) and rounded to the cent once.
 */
export function invoiceLines(rows: readonly InvoiceHeader[], lines: readonly ShipmentLineRow[]): Map<string, InvoiceLines> {
  const byInvoice = new Map<string, ShipmentLineRow[]>();
  for (const line of lines) {
    const own = byInvoice.get(line.invoice);
    if (own) own.push(line);
    else byInvoice.set(line.invoice, [line]);
  }
  const out = new Map<string, InvoiceLines>();
  for (const row of rows) {
    if (row.source !== "Sage") continue;
    const own = byInvoice.get(row.invoice) ?? [];
    const items = own.filter((l) => l.kind === "item");
    const charges = own.filter((l) => l.kind === "charge");
    const itemCheck = check(sumToCents(items.map((l) => l.amount), items.map((l) => l.discount)), row.productCents);
    // A charge's own discount is shown but never deducted: O/E discounts its items, not its charges.
    const chargeCheck = check(sumToCents(charges.map((l) => l.amount)), row.otherCents);
    out.set(row.key, { lines: own, items: itemCheck, charges: chargeCheck, agrees: itemCheck.agrees && chargeCheck.agrees });
  }
  return out;
}

/** How an invoice's lines don't add up to it, both figures in each sentence; none when they agree. */
export function linesMismatch(entry: InvoiceLines, currency: string): string[] {
  const money = (cents: number) => `${formatAmount(cents)} ${currency}`;
  const out: string[] = [];
  if (!entry.items.agrees) {
    out.push(`Item lines less their discounts come to ${money(entry.items.cents)}; the invoice’s product value is ${money(entry.items.invoiceCents)}.`);
  }
  if (!entry.charges.agrees) {
    out.push(`Charges come to ${money(entry.charges.cents)}; the invoice’s other charges are ${money(entry.charges.invoiceCents)}.`);
  }
  return out;
}

/** What the list's search matches in an invoice's lines: each line's code and description. */
export function linesSearchText(entry: InvoiceLines | undefined): string {
  return (entry?.lines ?? []).map((l) => `${l.code ?? ""} ${l.description ?? ""}`).join(" ");
}
