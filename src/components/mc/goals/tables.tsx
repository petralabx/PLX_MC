"use client";

// Goals & Production tables and tiles (brief §Screens 5–10): revenue by
// customer class (TASK-3781), truckloads by customer, the entries made by hand,
// batches completed and scheduled by size, the searchable batch list and the
// rules in plain words. Violet (class "hand") marks everything entered by hand;
// entries that no longer count are dimmed.

import { useState } from "react";

import type { BandCount, BandTile, ClassRevenueTotals, EvaluatedEntry, LoadTally } from "@/lib/reporting/goals";

import {
  BATCH_FILTERS,
  DEFAULT_BATCH_SORT,
  STAGE_LABELS,
  amount,
  cents,
  count,
  day,
  decimal,
  dollars,
  filterBatches,
  nextSort,
  oneDecimal,
  plural,
  rate,
  revenueRateLabel,
  sortBatches,
  usd,
  type BatchFilter,
  type BatchSort,
  type BatchSortKey,
  type ReadyPage,
} from "./helpers";

// ─── Revenue by customer class (TASK-3781) ────────────────────────────────

function ClassCells({ t }: { t: ClassRevenueTotals }) {
  return (
    <>
      <td className="num">{count(t.invoices)}</td>
      <td className="num">{amount(t.cad.cents)}</td>
      <td className="num">{amount(t.usd.cents)}</td>
      <td className="num">{amount(t.usd.cadCents)}</td>
      <td className="num hand">{amount(t.byHand.cadCents)}</td>
      <td className="num">{amount(t.totalCadCents)}</td>
    </>
  );
}

const share = (s: number | null) => (s === null ? "—" : `${(s * 100).toFixed(1)}%`);

/** The Revenue card's month by class: the rows add up to the card, to the cent. */
export function RevenueByClassTable({ page }: { page: ReadyPage }) {
  const data = page.revenueByClass;
  if (!data) throw new Error("a ready page model has revenue by class");
  const { unresolvedByHand: loose, total } = data;
  return (
    <>
      <div className="gp-table-wrap" role="region" aria-label="Revenue by customer class" tabIndex={0}>
        <table className="gp-table">
          <thead>
            <tr>
              <th scope="col">Customer class</th>
              <th scope="col" className="num">Invoices</th>
              <th scope="col" className="num">CAD</th>
              <th scope="col" className="num">USD (US$)</th>
              <th scope="col" className="num">USD in CAD</th>
              <th scope="col" className="num hand">By hand, CAD</th>
              <th scope="col" className="num">Total, CAD</th>
              <th scope="col" className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.customerClass}>
                <th scope="row">{r.customerClass}</th>
                <ClassCells t={r} />
                <td className="num">{share(r.share)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <ClassCells t={total} />
              <td className="num">{total.totalCadCents > 0 ? "100%" : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="gp-line">
        US dollars at {revenueRateLabel(page.model.revenue.basis, page)}, converted once for the month as on the Revenue card
        and then shared across the classes, so a class can be a cent off its own US dollars converted alone. A customer
        that isn’t on the list is Unclassified.
        {loose.entries > 0
          ? ` So ${loose.entries === 1 ? "is" : "are"} ${plural(loose.entries, "shipment", "shipments")} entered by hand without a Sage customer (${dollars(loose.cadCents)}).`
          : ""}
      </p>
      {total.otherCurrencies.length > 0 ? (
        <p className="gp-line">
          Not converted:{" "}
          {total.otherCurrencies.map((c) => `${c.currency} ${amount(c.cents)} (${plural(c.invoices, "invoice", "invoices")})`).join(", ")}.
          Only CAD and USD count, as on the Revenue card.
        </p>
      ) : null}
      {!data.matchesCard ? (
        <p className="gp-notice" data-testid="goals-classes-mismatch">
          These invoices add up to {cents(total.totalCadCents)}, not the Revenue card’s {cents(data.cardTotalCents)}:
          Sage changed between two reads of this refresh. The next refresh lines them up.
        </p>
      ) : null}
    </>
  );
}

// ─── Truckloads by customer ───────────────────────────────────────────────

function TallyCells({ t, hand, edge }: { t: LoadTally; hand?: boolean; edge?: boolean }) {
  const cls = hand ? "num hand" : "num";
  return (
    <>
      <td className={edge ? `${cls} grp-edge` : cls}>{count(t.full)}</td>
      <td className={cls}>{count(t.partial)}</td>
      <td className={cls}>{amount(t.productUsdCents)}</td>
    </>
  );
}

const sumTally = (rows: LoadTally[]): LoadTally =>
  rows.reduce(
    (s, t) => ({ full: s.full + t.full, partial: s.partial + t.partial, productUsdCents: s.productUsdCents + t.productUsdCents }),
    { full: 0, partial: 0, productUsdCents: 0 }
  );

export function TruckloadTable({ page }: { page: ReadyPage }) {
  const rows = page.model.truckloads.customers;
  // Some days of the month (TASK-4391): Sage's loads in those days, and no last month.
  const partial = !!page.range && !page.range.whole;
  const sageGroup = partial ? "In these dates" : "This month";
  const head = (group: string, hand?: boolean, edge?: boolean) =>
    ["Full", "Partial", "Product US$"].map((label, i) => (
      <th
        key={label}
        scope="col"
        className={[hand ? "num hand" : "num", edge && i === 0 ? "grp-edge" : ""].filter(Boolean).join(" ")}
      >
        <span className="vh">{group}: </span>
        {label}
      </th>
    ));
  return (
    <div className="gp-table-wrap" role="region" aria-label="Truckloads by customer" tabIndex={0}>
      <table className="gp-table gp-grouped">
        <colgroup>
          <col className="gp-col-name" />
        </colgroup>
        <colgroup>
          <col className="gp-col-num" />
          <col className="gp-col-num" />
          <col className="gp-col-num" />
        </colgroup>
        <colgroup>
          <col className="gp-col-num" />
          <col className="gp-col-num" />
          <col className="gp-col-num" />
        </colgroup>
        {partial ? null : (
          <colgroup>
            <col className="gp-col-num" />
            <col className="gp-col-num" />
            <col className="gp-col-num" />
          </colgroup>
        )}
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>
              Customer
            </th>
            <th scope="colgroup" colSpan={3} className="grp">
              {sageGroup} (Sage)
            </th>
            <th scope="colgroup" colSpan={3} className="grp hand grp-edge">
              Entered by hand
            </th>
            {partial ? null : (
              <th scope="colgroup" colSpan={3} className="grp grp-edge">
                Last month
              </th>
            )}
          </tr>
          <tr>
            {head(sageGroup)}
            {head("By hand", true, true)}
            {partial ? null : head("Last month", false, true)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <th scope="row" className="wrap">
                {r.name} <span className="code">{r.code}</span>
              </th>
              <TallyCells t={r.thisMonth} />
              <TallyCells t={r.byHand} hand edge />
              {partial ? null : <TallyCells t={r.lastMonth} edge />}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <TallyCells t={sumTally(rows.map((r) => r.thisMonth))} />
            <TallyCells t={sumTally(rows.map((r) => r.byHand))} hand edge />
            {partial ? null : <TallyCells t={sumTally(rows.map((r) => r.lastMonth))} edge />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Entries made by hand ─────────────────────────────────────────────────

function loadText(e: EvaluatedEntry): string {
  if (!e.truckload) return "";
  return e.truckload.kind === "full" ? "Full" : "Partial";
}

/** Editors get Edit and Delete on every row (TASK-2897). */
export interface EntryActions {
  onEdit: (entry: EvaluatedEntry) => void;
  onDelete: (entry: EvaluatedEntry) => void;
}

export function EntriesTable({ page, actions }: { page: ReadyPage; actions?: EntryActions }) {
  const entries = page.model.entries;
  if (entries.length === 0) {
    return <p className="gp-empty">No entries by hand. Figures come from FileMaker and Sage only.</p>;
  }
  return (
    <div className="gp-table-wrap" role="region" aria-label="Entries by hand" tabIndex={0}>
      <table className="gp-table">
        <thead>
          <tr>
            <th scope="col">Entry</th>
            <th scope="col">Type</th>
            <th scope="col">Date</th>
            <th scope="col">Reference</th>
            <th scope="col">Customer</th>
            <th scope="col">Product</th>
            <th scope="col" className="num">kg</th>
            <th scope="col" className="num">Product value</th>
            <th scope="col">Currency</th>
            <th scope="col">Truckload</th>
            <th scope="col">Status</th>
            {actions ? (
              <th scope="col">
                <span className="vh">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.entryId} className={e.counts ? "hand" : "hand retired"}>
              <th scope="row" className="code">
                {e.entryId}
              </th>
              <td>{e.type}</td>
              <td>{day(e.date)}</td>
              <td>{e.reference ?? ""}</td>
              <td className="wrap">{e.customer ?? e.customerCode ?? ""}</td>
              <td className="wrap">{e.product ?? ""}</td>
              <td className="num">{decimal(e.kg, 0)}</td>
              <td className="num">{decimal(e.productValue, 2)}</td>
              <td>{e.currency ?? ""}</td>
              <td>{loadText(e)}</td>
              <td>
                {e.statusLabel}
                {e.counts ? null : <span className="vh"> (no longer counts)</span>}
              </td>
              {actions ? (
                <td>
                  <div className="gp-row-actions">
                    <button type="button" className="btn ghost sm" onClick={() => actions.onEdit(e)}>
                      Edit<span className="vh"> {e.entryId}</span>
                    </button>
                    <button type="button" className="btn ghost sm" onClick={() => actions.onDelete(e)}>
                      Delete<span className="vh"> {e.entryId}</span>
                    </button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Batches by size ──────────────────────────────────────────────────────

const bandName = (band: string) => (band === "Total" ? "Total" : `${band} kg`);

/** `pace` false for some days of the month (TASK-4391): the pace per 20 working days is a whole-month comparison. */
export function CompletedTiles({ tiles, pace = true }: { tiles: readonly BandTile[]; pace?: boolean }) {
  return (
    <ul className="gp-tiles">
      {tiles.map((t) => (
        <li key={t.band} className={t.band === "Total" ? "total" : undefined}>
          <span className="k">{bandName(t.band)}</span>
          <span className="v">{count(t.count)}</span>
          {pace ? <span className="s">{t.pacePer20 === null ? "—" : oneDecimal(t.pacePer20)} per 20 working days</span> : null}
          <span className="s">{count(t.kg)} kg</span>
          <span className="s">{count(t.notQcReleased)} not yet QC released</span>
        </li>
      ))}
    </ul>
  );
}

export function ScheduledTiles({ tiles, openPastDate }: { tiles: readonly BandCount[]; openPastDate: number }) {
  return (
    <>
      <ul className="gp-tiles">
        {tiles.map((t) => (
          <li key={t.band} className={t.band === "Total" ? "total" : undefined}>
            <span className="k">{bandName(t.band)}</span>
            <span className="v">{count(t.count)}</span>
            <span className="s">{count(t.kg)} kg planned</span>
          </li>
        ))}
      </ul>
      <p className="gp-line">
        Plus <b>{count(openPastDate)}</b> {openPastDate === 1 ? "batch" : "batches"} of every size still open past
        {openPastDate === 1 ? " its" : " their"} scheduled date.
      </p>
    </>
  );
}

// ─── Batch list ───────────────────────────────────────────────────────────

const COLUMNS: { key: BatchSortKey; label: string; num?: boolean }[] = [
  { key: "batch", label: "Batch" },
  { key: "product", label: "Product" },
  { key: "stage", label: "Stage" },
  { key: "date", label: "Date" },
  { key: "kg", label: "kg", num: true },
  { key: "band", label: "Size" },
  { key: "line", label: "Line" },
  { key: "status", label: "Status" },
];

export function BatchList({ page }: { page: ReadyPage }) {
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [line1Only, setLine1Only] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BatchSort>(DEFAULT_BATCH_SORT);
  const all = page.model.batches;
  const rows = sortBatches(filterBatches(all, { filter, line1Only, query }), sort);
  const minKg = count(page.settings.line1MinKg);

  return (
    <>
      <div className="gp-tools">
        <input
          className="gp-search"
          type="search"
          value={query}
          placeholder="Search by batch, product, line or status"
          aria-label="Search batches"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="gp-seg" role="group" aria-label="Show batches">
          {BATCH_FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} <span className="ct">{count(filterBatches(all, { filter: f.key, line1Only, query: "" }).length)}</span>
            </button>
          ))}
        </div>
        <label className="gp-check">
          <input type="checkbox" checked={line1Only} onChange={(event) => setLine1Only(event.target.checked)} />
          Line 1 only ({minKg} kg or more)
        </label>
      </div>
      <p className="gp-count" role="status">
        Showing {count(rows.length)} of {count(all.length)} batches
      </p>
      <div className="gp-table-wrap tall" role="region" aria-label="Batch list" tabIndex={0}>
        <table className="gp-table sortable">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.num ? "num" : undefined}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  <button type="button" onClick={() => setSort((s) => nextSort(s, c.key))}>
                    {c.label}
                    {sort.key === c.key ? <span aria-hidden="true">{sort.dir === 1 ? " ↑" : " ↓"}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.source === "By hand" ? "hand" : undefined}>
                <th scope="row" className="code">
                  {r.batch}
                </th>
                <td className="wrap">{r.product ?? ""}</td>
                <td>{STAGE_LABELS[r.stage]}</td>
                <td>{day(r.date)}</td>
                <td className="num">{count(r.kg)}</td>
                <td>{r.band}</td>
                <td>{r.line ?? ""}</td>
                <td>{r.statusQc && r.statusQc !== r.status ? `${r.status} · ${r.statusQc}` : r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="gp-empty">No batches match these filters.</p> : null}
      </div>
    </>
  );
}

// ─── The rules in plain words ─────────────────────────────────────────────

export function RulesText({ page }: { page: ReadyPage }) {
  const { settings, model } = page;
  const sage = model.revenue.basis === "sage";
  const customers = model.truckloads.customers.map((c) => c.name);
  const list =
    customers.length > 1 ? `${customers.slice(0, -1).join(", ")} or ${customers[customers.length - 1]}` : customers.join("");
  return (
    <ul>
      <li>
        <b>Working days</b> are Monday to Friday except Ontario’s public holidays; a holiday that falls on a weekend is
        taken the next weekday. {model.month.label} has {count(model.calendar.workingDays)} working days.
      </li>
      <li>
        <b>Line 1 bulk</b> is the kg of every batch of {count(settings.line1MinKg)} kg or more, whatever line FileMaker
        records for it: a batch that size is assumed to run on Line 1. A batch is done when FileMaker marks it Realized
        this month (its actual kg, or planned kg if that is missing); a batch entered by hand counts its own kg. The goal
        is {count(settings.line1KgPerWorkingDay)} kg a working day; “due so far” counts the working days up to the date
        the data covers. On track means done is at least due so far. Needed per day spreads what’s left over the working
        days from today to month end. Open batches are Allocated or Committed with planned kg, scheduled this month.
      </li>
      <li>
        <b>Full truckloads</b> are Sage shipments (all invoices on one shipment number; an invoice without one counts
        on its own) to {list} with{" "}
        {usd(settings.fullTruckloadMinUsdCents)} or more of product, before tax and freight. Smaller shipments to them
        are partial loads. A shipment counts in the month it ships. Canadian dollar product is converted to US dollars
        for this test at the Bank of Canada rate, whichever rate the revenue is shown at.
      </li>
      <li>
        <b>Revenue</b> is the net before tax (product, freight and other charges) of invoices shipped this month. US
        dollars are converted at{" "}
        {sage ? `the fixed Sage rate ${rate(model.revenue.rate)}` : "the Bank of Canada rate"}, or at{" "}
        {sage ? "the Bank of Canada rate" : `the fixed Sage rate${settings.sageUsdCadRate ? ` ${rate(settings.sageUsdCadRate)}` : ""}`}{" "}
        with the switch above the cards, and each amount is rounded to the cent. Returns come off it: this month&apos;s
        Sage credit notes, by the credit note&apos;s date, their product value before tax (credited freight and other
        charges are left out, as charges are). The target is {dollars(settings.revenueTargetCadCents)} a month, spread evenly over its working days.
      </li>
      <li>
        <b>Revenue by customer class</b> splits that revenue by the class of each invoice’s Sage customer, from the
        sales workbook’s customer categories (Vince’s 5 Oct list). A shipment entered by hand takes the class of the
        Sage customer picked for it, else of the truckload customer its name matches; anything else is Unclassified.
      </li>
      <li>
        <b>Shipments this month</b> lists those invoices one by one, and the shipments entered by hand that count. A US
        dollar invoice shows its CAD at the rate; the totals add up the US dollar invoices first and convert them once,
        as the Revenue card does, so they can be a few cents off the CAD column. Full or Partial goes by the invoice’s
        whole shipment, as for full truckloads. Other currencies are listed but not converted or counted. Open an invoice
        for what shipped: its Sage lines, items with their quantity, unit price, amount and discount, and charges such as
        freight. Its item lines less their discounts should come to its product value and its charges to its other
        charges, to the cent; an invoice whose lines don’t is marked, with both figures. The search finds item codes and
        descriptions too.
      </li>
      <li>
        <b>Dates</b>: the page shows the whole month, or some of its days with the Dates switch: month to date, this
        week (Monday to Sunday), the last 7 days, or days you choose, cut to {model.month.label}. Then every figure
        follows the days: invoices and the shipped-not-invoiced estimate by ship date, returns by the credit note’s
        date, batches by their date (a batch finished by hand by the entry’s), and entries by hand by their own date.
        The goals are the whole month’s, so a few days have no status, due so far, pace or last month. The forecast and
        potential revenue are always the whole month’s.
      </li>
      <li>
        <b>Covered through</b> is the later of the latest FileMaker or Sage data and the latest counted entry by hand,
        never past today. The banner at the top appears when either system is more than one working day behind.
      </li>
      <li>
        <b>Entries by hand</b> count until their reference shows up in FileMaker (batches) or in Sage’s last 120 days
        (shipments). Then they stop counting, so nothing is counted twice.
      </li>
      <li>
        <b>Refresh</b> runs every weekday at 6:00 AM Toronto time; Editors can refresh at most every 5 minutes. A refresh
        that fails keeps the last good data on this page.
      </li>
      <li>
        <b>Revenue forecast</b> takes every open Sage order line expected to ship by month end, overdue ones included,
        at the quantity still to ship × its unit price (US dollars at {sage ? "the Sage rate" : "the Bank of Canada rate"}). Each line is matched to
        its FileMaker assembly order by order number and item: Ready when the assembly order is packed or its bulk batch
        is made (unless it’s scheduled after month end), Planned in time when it’s scheduled from today to month end,
        Late when it’s scheduled after month end or past its date, Not planned when there is none. Theoretical is the
        invoiced revenue plus Ready and Planned in time; At risk is Late plus Not planned. Realistic applies the share
        of Ready and Planned in time actually invoiced in the last complete months (up to three, each measured at its
        own Bank of Canada rate); Pace extends the invoiced revenue over the month’s working days. With a customer
        class or item category chosen, the four numbers count only those open orders, and that class’s invoices.
        Invoices aren’t split by item category yet, so with a category the numbers count open orders only.
      </li>
    </ul>
  );
}
