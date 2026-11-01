"use client";

// Revenue forecast (TASK-3151), the last section of Goals & Production: the
// four numbers against the revenue target, the notes behind them, and this
// month's open Sage order lines with bucket chips, customer class and item
// category filters (TASK-3177), a search and CAD totals that follow them (the
// batch list's tools, tables.tsx). The four numbers follow the class and
// category filters too (TASK-3190), worked out by the same function as the
// whole month's; the bucket chips and the search change only the list. Every
// figure comes from the page model (lib/reporting/goals/forecast.ts); this file
// only shows it.

import { useMemo, useState } from "react";

import type { ForecastFilter, ForecastReady, ForecastRow, ForecastView } from "@/lib/reporting/goals";
import { monthLabel } from "@/lib/reporting/goals/calendar";
import {
  CUSTOMER_CLASSES,
  FORECAST_BUCKET_LABELS,
  FORECAST_FILTERS,
  activeCategoryFilter,
  filterForecastRows,
  filteredForecastKpis,
  forecastCadCents,
  forecastCategoryOptions,
  otherCurrencyTotals,
  type ForecastBucket,
  type ForecastCategoryFilter,
  type ForecastClassFilter,
  type ForecastKpiFilter,
  type ForecastKpis,
} from "@/lib/reporting/goals/forecast-list";

import { amount, count, day, dollars, plural, price, type ReadyPage } from "./helpers";

/** Quantities to two places at most ("6,000", "12.5"). */
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Decision 9: Ready is on track (green), Planned in time is information (blue), Late is behind (red), Not planned is at risk (amber). */
const CHIP: Record<ForecastBucket, string> = { ready: "ok", planned: "info", late: "hot", not_planned: "warn" };

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
    <ForecastReadyView
      f={forecast}
      salespeople={page.salespeople?.applied ? page.salespeople.label : null}
      partial={!!page.range && !page.range.whole}
    />
  );
}

/** How the chosen filters read in a sentence: "Exclusive Manufacturing customers", "PLABEL (Manufacturing) items". */
function filterWords(f: ForecastReady, filter: ForecastKpiFilter): { who: string | null; what: string | null } {
  const label = forecastCategoryOptions(f.rows).find((o) => o.key === filter.category)?.label ?? null;
  return {
    who: filter.customerClass === "all" ? null : `${filter.customerClass} customers`,
    what: filter.category === "all" ? null : filter.category === "none" ? "items with no category" : `${label} items`,
  };
}

/**
 * The ready forecast. The class and category filters live here, so the four
 * numbers and the list follow the same ones; with neither chosen the numbers
 * are the page model's whole-month numbers, exactly as before.
 */
function ForecastReadyView({ f, salespeople, partial = false }: { f: ForecastReady; salespeople: string | null; partial?: boolean }) {
  const [customerClass, setCustomerClass] = useState<ForecastClassFilter>("all");
  const [chosenCategory, setCategory] = useState<ForecastCategoryFilter>("all");
  const categoriesRead = f.categoryMissing !== null && f.categoryMissing.length === 0;
  // A refresh can drop the chosen category (or the login can lose access): fall back to All, the way the dropdown shows it.
  const category = activeCategoryFilter(chosenCategory, f.rows, categoriesRead);
  if (category !== chosenCategory) setCategory(category);
  // Worked out again only when the rows or the filters change, not on every refresh-step render.
  const { k, words } = useMemo(() => {
    const filter: ForecastKpiFilter | null = customerClass === "all" && category === "all" ? null : { customerClass, category };
    const kpis: ForecastKpis = filter ? filteredForecastKpis(f, filter) : f;
    return { k: kpis, words: filter ? filterWords(f, filter) : null };
  }, [f, customerClass, category]);

  return (
    <>
      {/* Narrowed to some salespeople (TASK-4277): the rows and invoiced follow them; the target and hit rate don't. */}
      {salespeople ? (
        <p className="gp-line" data-testid="goals-forecast-salespeople">
          For the customers of {salespeople} only. The target and the hit rate are for all customers.
        </p>
      ) : null}
      {/* Some days of the month (TASK-4391): the forecast stays the month's. */}
      {partial ? (
        <p className="gp-line" data-testid="goals-forecast-dates">
          The forecast is the whole month’s, whatever the dates.
        </p>
      ) : null}
      {words ? (
        <p className="gp-line" data-testid="goals-forecast-filtered">
          {words.what
            ? `For ${words.what}${words.who ? ` of ${words.who}` : ""} only. Invoices aren’t split by item category yet, so these count open orders only. The hit rate is for all customers.`
            : `For ${words.who} only. The target and the hit rate are for all customers.`}
        </p>
      ) : null}
      <ForecastNumbers k={k} targetCents={f.targetCents} measuredFrom={f.measuredFrom} filtered={words !== null || salespeople !== null} />
      <ForecastNotes f={f} k={k} words={words} />
      <ForecastList
        rows={f.rows}
        categoryMissing={f.categoryMissing}
        categoriesRead={categoriesRead}
        customerClass={customerClass}
        category={category}
        onClass={setCustomerClass}
        onCategory={setCategory}
      />
    </>
  );
}

export function ForecastNumbers({
  k,
  targetCents,
  measuredFrom,
  filtered,
}: {
  k: ForecastKpis;
  targetCents: number;
  measuredFrom: string;
  filtered: boolean;
}) {
  const b = k.buckets;
  // Invoices can't be split by item category: with one chosen, the numbers count open orders only.
  const ordersOnly = k.invoicedCents === null;
  const target = `of ${dollars(targetCents)}${filtered ? " (all customers)" : ""}`;
  const hitRate = k.realistic ? `${(k.realistic.hitRate * 100).toFixed(1)}%` : "";
  return (
    <ul className="gp-tiles" data-testid="goals-forecast-numbers">
      <li>
        <span className="k">Theoretical</span>
        <span className="v">{dollars(k.theoreticalCents)}</span>
        {ordersOnly ? null : <span className="s">{target}</span>}
        <span className="s">
          {ordersOnly
            ? `Open orders only: ready ${dollars(b.ready.cents)} + planned in time ${dollars(b.planned.cents)}`
            : `Invoiced ${dollars(k.invoicedCents ?? 0)} + ready ${dollars(b.ready.cents)} + planned in time ${dollars(b.planned.cents)}`}
        </span>
      </li>
      <li>
        <span className="k">At risk</span>
        <span className="v">{dollars(k.atRiskCents)}</span>
        <span className="s">
          Late {dollars(b.late.cents)} + not planned {dollars(b.not_planned.cents)}
        </span>
        <span className="s">{plural(b.late.rows + b.not_planned.rows, "row", "rows")} in the list</span>
      </li>
      <li>
        <span className="k">Realistic</span>
        <span className="v">{k.realistic ? dollars(k.realistic.cents) : "—"}</span>
        {k.realistic ? (
          <>
            {ordersOnly ? null : <span className="s">{target}</span>}
            <span className="s">
              {ordersOnly ? "Open orders only: (ready + planned in time)" : "Invoiced + (ready + planned in time)"} × {hitRate} hit
              rate{filtered ? " (all customers)" : ""}, measured over {k.realistic.months.map((m) => m.label).join(", ")}
            </span>
          </>
        ) : (
          <span className="s">Measured from {monthLabel(measuredFrom)}, once a full month of forecasts has ended</span>
        )}
      </li>
      <li>
        <span className="k">Pace</span>
        <span className="v">{k.pace ? dollars(k.pace.cents) : "—"}</span>
        {ordersOnly ? null : <span className="s">{target}</span>}
        <span className="s">
          {k.pace
            ? `Invoiced ÷ ${count(k.pace.coveredDays)} working days covered × ${count(k.pace.workingDays)}`
            : ordersOnly
              ? "Needs invoices split by item category (not available yet)"
              : "No working day covered yet"}
        </span>
      </li>
    </ul>
  );
}

export function ForecastNotes({ f, k, words }: { f: ForecastReady; k: ForecastKpis; words: { who: string | null; what: string | null } | null }) {
  // Production with no order behind it has no class or category: the note stays whole-month.
  const { unordered } = f;
  return (
    <>
      <p className="gp-line">
        {!words
          ? `Invoiced so far is the Revenue card’s ${dollars(f.invoicedCents)}: Sage invoices plus shipments entered by hand.`
          : words.what
            ? `Invoiced revenue isn’t in these numbers: Sage invoices can’t be split by item category yet. The Revenue card’s ${dollars(f.invoicedCents)} covers every category.`
            : `Invoiced for ${words.who} is ${dollars(k.invoicedCents ?? 0)} of the Revenue card’s ${dollars(f.invoicedCents)} (Sage invoices plus shipments entered by hand, as in Revenue by customer class).${
                f.invoicedByClassMatchesCard
                  ? ""
                  : " Sage changed between two reads of this refresh, so the classes don’t add up to the card until the next refresh."
              }`}
      </p>
      {f.aoQtyUnreadable ? (
        <p className="gp-notice hot" data-testid="goals-forecast-qty-unreadable">
          {plural(f.aoQtyUnreadable, "assembly order has", "assembly orders have")} a quantity in FileMaker that isn’t a number,
          so {f.aoQtyUnreadable === 1 ? "it covers" : "they cover"} no order line and those lines count as Not planned. Fix the
          quantity in FileMaker and the next refresh picks it up.
        </p>
      ) : null}
      {unordered.count > 0 ? (
        <p className="gp-line" data-testid="goals-forecast-unordered">
          {plural(unordered.count, "assembly order", "assembly orders")} scheduled this month ({count(unordered.pieces)} pieces){" "}
          {unordered.count === 1 ? "has" : "have"} no open Sage order behind {unordered.count === 1 ? "it" : "them"}: production,
          not revenue, so {unordered.count === 1 ? "it isn’t" : "they aren’t"} counted.
        </p>
      ) : null}
      {k.otherCurrencies.length > 0 ? (
        <p className="gp-line">
          Not converted:{" "}
          {k.otherCurrencies.map((c) => `${c.currency} ${amount(c.cents)} (${plural(c.rows, "row", "rows")})`).join(", ")}. Only CAD
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

/** The open order rows: the bucket chips and the search are its own; the class and category filters are the section's (ForecastReadyView). */
function ForecastList({
  rows: all,
  categoryMissing,
  categoriesRead,
  customerClass,
  category,
  onClass,
  onCategory,
}: {
  rows: readonly ForecastRow[];
  categoryMissing: string[] | null;
  categoriesRead: boolean;
  customerClass: ForecastClassFilter;
  category: ForecastCategoryFilter;
  onClass: (value: ForecastClassFilter) => void;
  onCategory: (value: ForecastCategoryFilter) => void;
}) {
  const [filter, setFilter] = useState<ForecastFilter>("all");
  const [query, setQuery] = useState("");
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
          <select value={customerClass} onChange={(event) => onClass(event.target.value as ForecastClassFilter)}>
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
            onChange={(event) => onCategory(event.target.value as ForecastCategoryFilter)}
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
