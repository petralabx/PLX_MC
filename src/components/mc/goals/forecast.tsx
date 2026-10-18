"use client";

// Revenue forecast (TASK-3151), the last section of Goals & Production: the
// four numbers against the revenue target, the notes behind them, and this
// month's open Sage order lines with bucket chips, customer class and item
// category filters (TASK-3177), a search and CAD totals that follow them (the
// batch list's tools, tables.tsx). The filters change the list, never the four
// numbers. Every figure comes from the
// page model (lib/reporting/goals/forecast.ts); this file only shows it.

import { useState } from "react";

import type { ForecastFilter, ForecastReady, ForecastRow, ForecastView } from "@/lib/reporting/goals";
import { monthLabel } from "@/lib/reporting/goals/calendar";
import {
  CUSTOMER_CLASSES,
  FORECAST_BUCKET_LABELS,
  FORECAST_FILTERS,
  activeCategoryFilter,
  filterForecastRows,
  forecastCadCents,
  forecastCategoryOptions,
  otherCurrencyTotals,
  type ForecastBucket,
  type ForecastCategoryFilter,
  type ForecastClassFilter,
} from "@/lib/reporting/goals/forecast";

import { amount, count, day, dollars, price, type ReadyPage } from "./helpers";

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
/** Quantities to two places at most ("6,000", "12.5"). */
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Ready reads as done, Planned in time as on the way, Late and Not planned as at risk (never amber: that means "by hand"). */
const CHIP: Record<ForecastBucket, string> = { ready: "ok", planned: "info", late: "hot", not_planned: "hot" };

export function ForecastSection({ page }: { page: ReadyPage }) {
  const forecast: ForecastView | null = page.forecast;
  if (!forecast || forecast.state === "not_in_run") {
    return <p className="gp-empty">This refresh has no forecast yet. It fills in at the next refresh.</p>;
  }
  if (forecast.state === "waiting_for_access") {
    return (
      <div className="gp-notice" role="note" data-testid="goals-forecast-waiting">
        <p>
          <b>Waiting for read access to Sage orders and FileMaker assembly orders.</b> The reporting login can’t read yet:
        </p>
        <ul>
          {forecast.missing.map((m) => (
            <li key={m.relation}>
              <span className="code">{m.relation}</span>: {m.columns.join(", ")}
            </li>
          ))}
        </ul>
        <p>
          A database administrator grants it with docs/modules/reporting-goals/readonly-grants-forecast.sql, and the next
          refresh fills the forecast in. Everything else on this page refreshes as usual.
        </p>
      </div>
    );
  }
  return (
    <>
      <ForecastNumbers f={forecast} />
      <ForecastNotes f={forecast} />
      <ForecastList rows={forecast.rows} categoryMissing={forecast.categoryMissing} />
    </>
  );
}

function ForecastNumbers({ f }: { f: ForecastReady }) {
  const b = f.buckets;
  const target = `of ${dollars(f.targetCents)}`;
  const hitRate = f.realistic ? `${(f.realistic.hitRate * 100).toFixed(1)}%` : "";
  return (
    <ul className="gp-tiles" data-testid="goals-forecast-numbers">
      <li>
        <span className="k">Theoretical</span>
        <span className="v">{dollars(f.theoreticalCents)}</span>
        <span className="s">{target}</span>
        <span className="s">
          Invoiced {dollars(f.invoicedCents)} + ready {dollars(b.ready.cents)} + planned in time {dollars(b.planned.cents)}
        </span>
      </li>
      <li>
        <span className="k">At risk</span>
        <span className="v">{dollars(f.atRiskCents)}</span>
        <span className="s">
          Late {dollars(b.late.cents)} + not planned {dollars(b.not_planned.cents)}
        </span>
        <span className="s">{plural(b.late.rows + b.not_planned.rows, "row", "rows")} in the list</span>
      </li>
      <li>
        <span className="k">Realistic</span>
        <span className="v">{f.realistic ? dollars(f.realistic.cents) : "—"}</span>
        {f.realistic ? (
          <>
            <span className="s">{target}</span>
            <span className="s">
              Invoiced + (ready + planned in time) × {hitRate} hit rate, measured over{" "}
              {f.realistic.months.map((m) => m.label).join(", ")}
            </span>
          </>
        ) : (
          <span className="s">Measured from {monthLabel(f.measuredFrom)}, once a full month of forecasts has ended</span>
        )}
      </li>
      <li>
        <span className="k">Pace</span>
        <span className="v">{f.pace ? dollars(f.pace.cents) : "—"}</span>
        <span className="s">{target}</span>
        <span className="s">
          {f.pace
            ? `Invoiced ÷ ${count(f.pace.coveredDays)} working days covered × ${count(f.pace.workingDays)}`
            : "No working day covered yet"}
        </span>
      </li>
    </ul>
  );
}

function ForecastNotes({ f }: { f: ForecastReady }) {
  const { unordered } = f;
  return (
    <>
      <p className="gp-line">
        Invoiced so far is the Revenue card’s {dollars(f.invoicedCents)}: Sage invoices plus shipments entered by hand.
      </p>
      {unordered.count > 0 ? (
        <p className="gp-line" data-testid="goals-forecast-unordered">
          {plural(unordered.count, "assembly order", "assembly orders")} scheduled this month ({count(unordered.pieces)} pieces){" "}
          {unordered.count === 1 ? "has" : "have"} no open Sage order behind {unordered.count === 1 ? "it" : "them"}: production,
          not revenue, so {unordered.count === 1 ? "it isn’t" : "they aren’t"} counted.
        </p>
      ) : null}
      {f.otherCurrencies.length > 0 ? (
        <p className="gp-line">
          Not converted:{" "}
          {f.otherCurrencies.map((c) => `${c.currency} ${amount(c.cents)} (${plural(c.rows, "row", "rows")})`).join(", ")}. Only CAD
          and USD count, as on the Revenue card.
        </p>
      ) : null}
    </>
  );
}

function aoText(row: ForecastRow): string {
  if (!row.ao) return "—";
  return [row.ao.number, row.ao.scheduled ? day(row.ao.scheduled) : "no date", row.ao.status].filter(Boolean).join(" · ");
}

function ForecastList({ rows: all, categoryMissing }: { rows: readonly ForecastRow[]; categoryMissing: string[] | null }) {
  const [filter, setFilter] = useState<ForecastFilter>("all");
  const [customerClass, setCustomerClass] = useState<ForecastClassFilter>("all");
  const [chosenCategory, setCategory] = useState<ForecastCategoryFilter>("all");
  const [query, setQuery] = useState("");
  const categoriesRead = categoryMissing !== null && categoryMissing.length === 0;
  // A refresh can drop the chosen category (or the login can lose access): fall back to All, the way the dropdown shows it.
  const category = activeCategoryFilter(chosenCategory, all, categoriesRead);
  if (category !== chosenCategory) setCategory(category);
  const rows = filterForecastRows(all, { filter, query, customerClass, category });
  const cad = forecastCadCents(rows);
  const others = otherCurrencyTotals(rows);
  const othersText = others.length > 0 ? ` (and ${others.map((c) => `${c.currency} ${amount(c.cents)}`).join(", ")}, not converted)` : "";
  // The chips count the rows the class and category filters keep, before the search.
  const chipCount = (key: ForecastFilter) => filterForecastRows(all, { filter: key, query: "", customerClass, category }).length;

  return (
    <>
      <div className="gp-tools">
        <input
          className="gp-search"
          type="search"
          value={query}
          placeholder="Search by order, customer, PO, item or AO"
          aria-label="Search open orders"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="gp-select">
          Customer class
          <select value={customerClass} onChange={(event) => setCustomerClass(event.target.value as ForecastClassFilter)}>
            <option value="all">All classes</option>
            {CUSTOMER_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c} ({count(filterForecastRows(all, { filter: "all", query: "", customerClass: c, category }).length)})
              </option>
            ))}
          </select>
        </label>
        <label className="gp-select">
          Item category
          <select
            value={category}
            disabled={!categoriesRead}
            onChange={(event) => setCategory(event.target.value as ForecastCategoryFilter)}
          >
            {forecastCategoryOptions(all).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
                {o.key === "all" ? "" : ` (${count(filterForecastRows(all, { filter: "all", query: "", customerClass, category: o.key }).length)})`}
              </option>
            ))}
          </select>
        </label>
        <div className="gp-seg" role="group" aria-label="Show open orders">
          {FORECAST_FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label} <span className="ct">{count(chipCount(f.key))}</span>
            </button>
          ))}
        </div>
      </div>
      {categoryMissing === null ? (
        <p className="gp-line" data-testid="goals-forecast-category-waiting">
          Item categories fill in at the next refresh.
        </p>
      ) : categoryMissing.length > 0 ? (
        <p className="gp-line" data-testid="goals-forecast-category-waiting">
          The item category filter waits for read access to {categoryMissing.join(", ")}. A database administrator grants it by
          re-running docs/modules/reporting-goals/readonly-grants-forecast.sql.
        </p>
      ) : null}
      <p className="gp-count" role="status">
        Showing {count(rows.length)} of {count(all.length)} rows · {amount(cad)} CAD{othersText}
      </p>
      <div className="gp-table-wrap tall" role="region" aria-label="Open orders this month" tabIndex={0}>
        <table className="gp-table">
          <thead>
            <tr>
              <th scope="col">Expected</th>
              <th scope="col">Order</th>
              <th scope="col">Customer</th>
              <th scope="col">Class</th>
              <th scope="col">PO</th>
              <th scope="col">Item</th>
              <th scope="col">Category</th>
              <th scope="col">Description</th>
              <th scope="col" className="num">Still to ship</th>
              <th scope="col" className="num">Unit price</th>
              <th scope="col" className="num">Value</th>
              <th scope="col" className="num">CAD</th>
              <th scope="col">Bucket</th>
              <th scope="col">Assembly order</th>
              <th scope="col">Bulk batch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {day(r.expected)}
                  {r.overdue ? " (overdue)" : ""}
                </td>
                <th scope="row" className="code">
                  {r.orderNo}
                </th>
                <td className="wrap">
                  {r.customer ?? ""} <span className="code">{r.customerCode ?? ""}</span>
                </td>
                <td>{r.customerClass}</td>
                <td>{r.po ?? ""}</td>
                <td className="code">{r.item}</td>
                <td className="code">{r.category ?? "—"}</td>
                <td className="wrap">{r.description ?? ""}</td>
                <td className="num">
                  {qty(r.qty)} {r.unit ?? ""}
                </td>
                <td className="num">
                  {price(r.unitPrice)} {r.currency}
                </td>
                <td className="num">
                  {amount(r.valueCents)} {r.currency}
                </td>
                <td className="num">{r.cadCents === null ? "not converted" : amount(r.cadCents)}</td>
                <td>
                  <span className={`pv-chip ${CHIP[r.bucket]}`}>{FORECAST_BUCKET_LABELS[r.bucket]}</span>
                </td>
                <td>{aoText(r)}</td>
                <td>{r.bulk?.batch ? `${r.bulk.batch} · ${r.bulk.status ?? "no status"}` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={11}>
                Total shown, CAD
              </th>
              <td className="num">{amount(cad)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 ? <p className="gp-empty">No open orders match these filters.</p> : null}
      </div>
    </>
  );
}
