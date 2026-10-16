"use client";

// Goals & Production — shipments this month (TASK-3143): every Sage invoice
// shipped this month and every counted shipment entered by hand (amber), with
// the batch list's search box and filter chips, and totals for the rows shown,
// worked out as the Revenue card works out revenue. The page model carries
// the rows; the filter and the totals are pure (lib/reporting/goals/
// shipment-list.ts). Each row renders through ShipmentRow, where an invoice's
// lines can later open under it.

import { useState } from "react";

import type { ShipmentFilter, ShipmentListRow, ShipmentTotals } from "@/lib/reporting/goals";
import { filterShipments, shipmentTotals } from "@/lib/reporting/goals/shipment-list";

import { amount, cents, count, day, rate, type ReadyPage } from "./helpers";

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

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** A code after a name, in the muted code style ("A1TEXT11", "M003"). */
function Code({ value }: { value: string | null }) {
  return value ? (
    <>
      {" "}
      <span className="code">{value}</span>
    </>
  ) : null;
}

function ShipmentRow({ row, usdRate }: { row: ShipmentListRow; usdRate: string }) {
  return (
    <tr className={row.source === "By hand" ? "hand" : undefined}>
      <td>{day(row.shipDate)}</td>
      <th scope="row" className="code">
        {row.invoice}
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

export function ShipmentList({ page }: { page: ReadyPage }) {
  const [filter, setFilter] = useState<ShipmentFilter>("all");
  const [query, setQuery] = useState("");
  const all = page.shipments;
  const rows = filterShipments(all, { filter, query });
  const usdRate = page.model.revenue.rate;
  const rateText = rate(usdRate);

  return (
    <>
      <div className="gp-tools">
        <input
          className="gp-search"
          type="search"
          value={query}
          placeholder="Search by customer, invoice, shipment, order or PO"
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
      </p>
      <div className="gp-table-wrap tall" role="region" aria-label="Shipment list" tabIndex={0}>
        <table className="gp-table">
          <thead>
            <tr>
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
              <ShipmentRow key={r.key} row={r} usdRate={rateText} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="gp-empty">{all.length === 0 ? "No shipments this month yet." : "No shipments match these filters."}</p>
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
