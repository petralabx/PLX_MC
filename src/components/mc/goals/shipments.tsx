"use client";

// Goals & Production — shipments this month (TASK-3143): every Sage invoice
// shipped this month and every counted shipment entered by hand (amber), with
// the batch list's search box and filter chips, and totals for the rows shown,
// worked out as the Revenue card works out revenue. The page model carries
// the rows; the filter and the totals are pure (lib/reporting/goals/
// shipment-list.ts). What shipped (TASK-3144): each invoice opens to its Sage
// lines, checked against the invoice to the cent (lib/reporting/goals/
// shipment-lines.ts). They are fetched once per run from
// GET /api/reporting/goals/runs/[id]/shipment-lines, not carried in the page
// model, which a busy month's lines would more than double.

import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { InvoiceLines, ShipmentFilter, ShipmentLinesDataset, ShipmentListRow, ShipmentTotals } from "@/lib/reporting/goals";
import { toCents } from "@/lib/reporting/goals/money";
import { filterShipments, shipmentTotals } from "@/lib/reporting/goals/shipment-list";
import { invoiceLines, linesMismatch } from "@/lib/reporting/goals/shipment-lines";

import { amount, cents, count, day, plural, price, rate, type ReadyPage } from "./helpers";

const FILTERS: { key: ShipmentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "truckload", label: "Truckload customers" },
  { key: "full", label: "Full" },
  { key: "partial", label: "Partial" },
  { key: "cad", label: "CAD" },
  { key: "usd", label: "USD" },
  { key: "by_hand", label: "By hand" },
];

const LOAD_LABELS = { full: "Full", partial: "Partial" } as const;

/** The list's columns: the lines toggle, then the invoice's own 14. An opened invoice's lines span them all. */
const COLUMNS = 15;

/** Sage keeps four decimals on quantities ("400", "1,234.5"). */
const quantity = (q: string) => Number(q).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** A code after a name, in the muted code style ("A1TEXT11", "M003"). */
function Code({ value }: { value: string | null }) {
  return value ? (
    <>
      {" "}
      <span className="code">{value}</span>
    </>
  ) : null;
}

/** What an opened invoice shows: its lines checked against it, or why there are none to show. */
export type InvoiceLinesState =
  | { kind: "ready"; invoice: InvoiceLines }
  | { kind: "loading" }
  | { kind: "failed"; message: string; onRetry: () => void }
  | { kind: "waiting"; missing: { relation: string; columns: string[] }[] }
  | { kind: "not_in_run" };

/** The lines under an opened invoice, in its currency, and whether they add up to it (both figures when they don't). */
export function InvoiceLinesPanel({ row, state }: { row: ShipmentListRow; state: InvoiceLinesState }) {
  switch (state.kind) {
    case "not_in_run":
      return <p className="gp-empty">This refresh has no invoice lines yet. They fill in at the next refresh.</p>;
    case "loading":
      return (
        <p className="gp-empty" role="status">
          Loading the invoice’s lines…
        </p>
      );
    case "failed":
      return (
        <div className="gp-failed">
          <p>Couldn’t load the invoice lines: {state.message}</p>
          <button type="button" className="btn ghost sm" onClick={state.onRetry}>
            Retry
          </button>
        </div>
      );
    case "waiting":
      return (
        <div className="gp-notice" role="note">
          <p>
            <b>Item details are waiting for read access to Sage invoice lines.</b> The reporting login can’t read:
          </p>
          <ul>
            {state.missing.map((m) => (
              <li key={m.relation}>
                <span className="code">{m.relation}</span>: {m.columns.join(", ")}
              </li>
            ))}
          </ul>
          <p>
            A database administrator grants it with docs/modules/reporting-goals/readonly-grants-shipment-lines.sql, and the
            next refresh brings the lines in.
          </p>
        </div>
      );
    case "ready":
      return <ReadyLines row={row} invoice={state.invoice} />;
  }
}

function ReadyLines({ row, invoice }: { row: ShipmentListRow; invoice: InvoiceLines }) {
  const currency = row.currency;
  const off = linesMismatch(invoice, currency);
  if (invoice.lines.length === 0 && off.length === 0) {
    return (
      <p className="gp-empty">
        Sage has no lines for this invoice; its product value and other charges are both {amount(0)} {currency}.
      </p>
    );
  }
  return (
    <div className="gp-lines-panel">
      {invoice.lines.length === 0 ? (
        <p className="gp-empty">Sage has no lines for this invoice.</p>
      ) : (
        <div className="gp-lines-scroll" role="region" aria-label={`Lines of invoice ${row.invoice}`} tabIndex={0}>
          <table className="gp-lines">
            <caption>
              Lines of invoice {row.invoice}, in {currency}
            </caption>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Item or charge</th>
                <th scope="col">Description</th>
                <th scope="col" className="num">
                  Quantity shipped
                </th>
                <th scope="col">Unit</th>
                <th scope="col" className="num">
                  Unit price
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col" className="num">
                  Discount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => {
                const item = l.kind === "item";
                const discount = toCents(l.discount);
                return (
                  <tr key={`${l.lineNo ?? "x"}:${i}`} className={item ? undefined : "charge"}>
                    <td>{item ? "Item" : "Charge"}</td>
                    <th scope="row" className="code">
                      {l.code ?? ""}
                    </th>
                    <td className="wrap">{l.description ?? ""}</td>
                    <td className="num">{item ? quantity(l.qty) : ""}</td>
                    <td>{item ? (l.unit ?? "") : ""}</td>
                    <td className="num">{item ? price(l.unitPrice) : ""}</td>
                    <td className="num">{amount(toCents(l.amount))}</td>
                    {/* A charge's own discount is shown when it has one, never deducted (lib/reporting/goals/shipment-lines.ts). */}
                    <td className="num">{item || discount !== 0 ? amount(discount) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {off.length > 0 ? (
        <div className="gp-alert" role="note">
          <p>These lines don’t add up to the invoice.</p>
          <ul>
            {off.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="gp-line">
          These lines add up to the invoice: item lines less their discounts come to its product value,{" "}
          {amount(invoice.items.cents)} {currency}, and charges to its other charges, {amount(invoice.charges.cents)} {currency}.
        </p>
      )}
    </div>
  );
}

function ShipmentRow({
  row,
  usdRate,
  lines,
  open,
  onToggle,
}: {
  row: ShipmentListRow;
  usdRate: string;
  /** null for a shipment entered by hand: it has no Sage lines to open. */
  lines: InvoiceLinesState | null;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `goals-lines-${row.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const off = lines?.kind === "ready" && !lines.invoice.agrees;
  return (
    <>
      <tr className={row.source === "By hand" ? "hand" : undefined}>
        <td className="gp-open">
          {lines ? (
            <button
              type="button"
              className="gp-expand"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={onToggle}
            >
              <span className="vh">Lines of invoice {row.invoice}</span>
            </button>
          ) : null}
        </td>
        <td>{day(row.shipDate)}</td>
        <th scope="row" className="code">
          {row.invoice}
          {off ? (
            <>
              {" "}
              <span className="pv-chip hot">Lines don’t add up</span>
            </>
          ) : null}
        </th>
        <td className="code">{row.shipment ?? ""}</td>
        <td className="code">{row.orderNo ?? ""}</td>
        <td>{row.po ?? ""}</td>
        <td className="wrap">
          {row.customer ?? ""}
          <Code value={row.customerCode} />
        </td>
        <td>{row.currency}</td>
        <td className="num">{amount(row.productCents)}</td>
        <td className="num">{amount(row.otherCents)}</td>
        <td className="num">{amount(row.netCents)}</td>
        <td className="num">{row.currency === "USD" ? usdRate : "—"}</td>
        <td className="num">{row.cadCents === null ? "—" : amount(row.cadCents)}</td>
        <td>{row.truckload ? LOAD_LABELS[row.truckload] : ""}</td>
        <td>
          {row.source}
          <Code value={row.entryId} />
        </td>
      </tr>
      {open && lines ? (
        <tr className="gp-lines-row">
          <td colSpan={COLUMNS} id={panelId}>
            <div className="gp-lines-view">
              <InvoiceLinesPanel row={row} state={lines} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Totals for the rows shown, by the Revenue card's formula: each currency's
 * subtotal (USD added up, then converted once), what was entered by hand, and
 * the total. A small table of its own, so every figure stays beside its label
 * at any width, however far the list is scrolled.
 */
function TotalsTable({ totals, usdRate }: { totals: ShipmentTotals; usdRate: string }) {
  const { cad, usd, otherCurrencies, invoices, byHand } = totals;
  const what = [
    invoices > 0 || byHand === 0 ? plural(invoices, "invoice", "invoices") : null,
    byHand > 0 ? `${count(byHand)} by hand` : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return (
    <div className="gp-table-wrap narrow" role="region" aria-label="Shipment totals" tabIndex={0}>
      <table className="gp-table">
        <thead>
          <tr>
            <th scope="col">Totals for the shipments shown</th>
            <th scope="col" className="num">
              CAD
            </th>
          </tr>
        </thead>
        <tbody>
          {cad.invoices > 0 ? (
            <tr>
              <th scope="row" className="wrap">
                {plural(cad.invoices, "CAD invoice", "CAD invoices")}
              </th>
              <td className="num">{amount(cad.cents)}</td>
            </tr>
          ) : null}
          {usd.invoices > 0 ? (
            <tr>
              <th scope="row" className="wrap">
                {plural(usd.invoices, "USD invoice", "USD invoices")}: US{cents(usd.cents)} at {usdRate}, converted once
              </th>
              <td className="num">{amount(usd.cadCents)}</td>
            </tr>
          ) : null}
          {otherCurrencies.map((c) => (
            <tr key={c.currency}>
              <th scope="row" className="wrap">
                {plural(c.invoices, `${c.currency} invoice`, `${c.currency} invoices`)}: {amount(c.cents)} {c.currency}, not
                converted
              </th>
              <td className="num">—</td>
            </tr>
          ))}
          {byHand > 0 ? (
            <tr className="hand">
              <th scope="row" className="wrap">
                {count(byHand)} entered by hand
              </th>
              <td className="num">{amount(totals.byHandCadCents)}</td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="wrap">
              Total: {what}
            </th>
            <td className="num">{amount(totals.totalCadCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The run's invoice lines as fetched, keyed by run so a newer run never shows an older one's. */
type Fetched = { runId: number; lines: ShipmentLinesDataset["lines"] } | { runId: number; error: string };

/** Fetches the run's invoice lines once, when the page model says it has them; Retry fetches them again. */
function useRunLines(page: ReadyPage): { fetched: Fetched | null; retry: () => void } {
  const runId = page.run.id;
  const wanted = page.shipmentLines?.state === "ready";
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api<ShipmentLinesDataset>(`/reporting/goals/runs/${runId}/shipment-lines`)
      .then((data) => {
        if (live) setFetched({ runId, lines: data.lines });
      })
      .catch((err: Error) => {
        if (live) setFetched({ runId, error: err.message });
      });
    return () => {
      live = false;
    };
  }, [runId, wanted, attempt]);
  return {
    fetched: fetched?.runId === runId ? fetched : null,
    retry: () => {
      setFetched(null);
      setAttempt((n) => n + 1);
    },
  };
}

/** The line above the list that says how the invoices' lines stand: always visible once they're in, never silent. */
function LinesNote({ page, fetched, byRow, onRetry }: { page: ReadyPage; fetched: Fetched | null; byRow: Map<string, InvoiceLines> | null; onRetry: () => void }) {
  const view = page.shipmentLines;
  if (!view || view.state === "not_in_run") {
    return <p className="gp-line">This refresh has no invoice lines yet. They fill in at the next refresh.</p>;
  }
  if (view.state === "waiting_for_access") {
    return (
      <p className="gp-line" data-testid="goals-lines-note">
        Item details are waiting for read access to Sage invoice lines. Open an invoice to see what the reporting login
        can’t read yet.
      </p>
    );
  }
  if (fetched && "error" in fetched) {
    return (
      <div className="gp-failed" data-testid="goals-lines-note">
        <p>Couldn’t load the invoice lines: {fetched.error}</p>
        <button type="button" className="btn ghost sm" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (!byRow) return null;
  const off = [...byRow.values()].filter((v) => !v.agrees).length;
  return (
    <p className={off > 0 ? "gp-notice" : "gp-line"} data-testid="goals-lines-note">
      {off > 0
        ? `${plural(off, "invoice’s", "invoices’")} lines don’t add up to the invoice. They’re marked “Lines don’t add up”; open one to see both figures.`
        : "Open an invoice to see what shipped. Every invoice’s lines add up to it, to the cent."}
    </p>
  );
}

export function ShipmentList({ page }: { page: ReadyPage }) {
  const [filter, setFilter] = useState<ShipmentFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const { fetched, retry } = useRunLines(page);
  const all = page.shipments;
  const byRow = useMemo(() => (fetched && "lines" in fetched ? invoiceLines(all, fetched.lines) : null), [fetched, all]);
  const rows = filterShipments(all, { filter, query, lines: byRow ?? undefined });
  const usdRate = page.model.revenue.rate;
  const rateText = rate(usdRate);
  const view = page.shipmentLines;
  const loading = view?.state === "ready" && !fetched;

  const linesOf = (row: ShipmentListRow): InvoiceLinesState | null => {
    if (row.source !== "Sage") return null;
    if (!view || view.state === "not_in_run") return { kind: "not_in_run" };
    if (view.state === "waiting_for_access") return { kind: "waiting", missing: view.missing };
    if (!fetched) return { kind: "loading" };
    if ("error" in fetched) return { kind: "failed", message: fetched.error, onRetry: retry };
    const invoice = byRow?.get(row.key);
    // invoiceLines gives every Sage row an entry: a missing one is a bug, so it fails the section, never hides.
    if (!invoice) throw new Error(`no lines entry for ${row.key}`);
    return { kind: "ready", invoice };
  };
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="gp-tools">
        <input
          className="gp-search"
          type="search"
          value={query}
          placeholder="Search by customer, invoice, shipment, order, PO or item"
          aria-label="Search shipments"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="gp-seg" role="group" aria-label="Show shipments">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} <span className="ct">{count(filterShipments(all, { filter: f.key, query: "" }).length)}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="gp-count" role="status">
        Showing {count(rows.length)} of {count(all.length)} shipments
        {query.trim() && loading ? " (item lines are still loading)" : ""}
      </p>
      <LinesNote page={page} fetched={fetched} byRow={byRow} onRetry={retry} />
      <div className="gp-table-wrap tall shipments" role="region" aria-label="Shipment list" tabIndex={0}>
        <table className="gp-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="vh">Lines</span>
              </th>
              <th scope="col">Ship date</th>
              <th scope="col">Invoice</th>
              <th scope="col">Shipment</th>
              <th scope="col">Order</th>
              <th scope="col">PO</th>
              <th scope="col">Customer</th>
              <th scope="col">Currency</th>
              <th scope="col" className="num">
                Product value
              </th>
              <th scope="col" className="num">
                Other charges
              </th>
              <th scope="col" className="num">
                Net before tax
              </th>
              <th scope="col" className="num">
                Rate
              </th>
              <th scope="col" className="num">
                CAD
              </th>
              <th scope="col">Truckload</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ShipmentRow key={r.key} row={r} usdRate={rateText} lines={linesOf(r)} open={open.has(r.key)} onToggle={() => toggle(r.key)} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="gp-empty">{all.length === 0 ? (page.range && !page.range.whole ? "No shipments in these dates." : "No shipments this month yet.") : "No shipments match these filters."}</p>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <>
          <TotalsTable totals={shipmentTotals(rows, usdRate)} usdRate={rateText} />
          <p className="gp-line">
            The USD subtotal is converted once at the rate, as on the Revenue card, so it can differ from adding up the
            CAD column by a few cents. Invoices in other currencies are listed but left out of the CAD total.
          </p>
        </>
      ) : null}
    </>
  );
}
