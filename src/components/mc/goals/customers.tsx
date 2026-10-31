"use client";

// Goals & Production: revenue by customer (Progress Huddle 2026-10-23). A
// search box over two rankings with weekly columns: potential revenue from
// what production is making for open Sage orders, and this month's invoiced
// revenue. What production makes with no price is counted below, never valued.

import { useState } from "react";

import type { CustomerRanking } from "@/lib/reporting/goals/customer-revenue";
import { searchCustomers } from "@/lib/reporting/goals/customer-search";

import { amount, count, day, dollars, oneDecimal, plural, type ReadyPage } from "./helpers";

function RankingTable({ label, ranking, query, testId }: { label: string; ranking: CustomerRanking; query: string; testId: string }) {
  const rows = searchCustomers(ranking, query);
  const undated = ranking.customers.some((c) => c.undatedCadCents !== 0);
  if (ranking.customers.length === 0) return <p className="gp-line">Nothing yet.</p>;
  return (
    <div className="gp-table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table className="gp-table" data-testid={testId}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Customer</th>
            <th scope="col">Class</th>
            {ranking.weeks.map((w) => (
              <th scope="col" className="num" key={w}>
                Week of {day(w)}
              </th>
            ))}
            {undated ? <th scope="col" className="num">No date</th> : null}
            <th scope="col" className="num">Total, CAD</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={ranking.weeks.length + (undated ? 5 : 4)}>No customer matches “{query.trim()}”.</td>
            </tr>
          ) : (
            rows.map((c) => (
              <tr key={c.key}>
                <td className="num">{ranking.customers.indexOf(c) + 1}</td>
                <th scope="row">
                  {c.customer ?? c.key}
                  {c.customerCode ? ` (${c.customerCode})` : ""}
                </th>
                <td>{c.customerClass}</td>
                {ranking.weeks.map((w) => (
                  <td className="num" key={w}>
                    {c.byWeek[w] ? amount(c.byWeek[w]) : "-"}
                  </td>
                ))}
                {undated ? <td className="num">{c.undatedCadCents ? amount(c.undatedCadCents) : "-"}</td> : null}
                <td className="num">{amount(c.totalCadCents)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <th scope="row" colSpan={2}>
              All customers
            </th>
            {ranking.weeks.map((w) => (
              <td className="num" key={w}>
                {amount(ranking.customers.reduce((n, c) => n + (c.byWeek[w] ?? 0), 0))}
              </td>
            ))}
            {undated ? <td className="num">{amount(ranking.customers.reduce((n, c) => n + c.undatedCadCents, 0))}</td> : null}
            <td className="num">{amount(ranking.totalCadCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function CustomerRevenueSection({ page }: { page: ReadyPage }) {
  const [query, setQuery] = useState("");
  const data = page.customerRevenue;
  if (!data) throw new Error("a ready page model has revenue by customer");
  const { unpriced } = data;
  const batchWeeks = Object.keys(unpriced.batches.byWeek).sort();
  // Some days of the month (TASK-4391): realized follows them; potential stays the month's.
  const range = page.range && !page.range.whole ? page.range : null;
  return (
    <>
      <div className="gp-tools">
        <input
          className="gp-search"
          type="search"
          value={query}
          placeholder="Search by customer name or Sage code"
          aria-label="Search customers"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <h3>Potential: in production for an open order</h3>
      {range ? (
        <p className="gp-line" data-testid="goals-potential-month">
          Potential is the whole month’s, whatever the dates.
        </p>
      ) : null}
      <RankingTable label="Potential revenue by customer" ranking={data.potential} query={query} testId="goals-potential" />
      <p className="gp-line">
        Each assembly order not yet invoiced, priced from its Sage order line and placed in the week it is scheduled.
        {data.packedRows > 0 ? ` ${plural(data.packedRows, "line is", "lines are")} already packed.` : ""}
      </p>
      <ul className="gp-line" data-testid="goals-unpriced">
        <li>
          Unpriced: {plural(unpriced.aos.count, "open assembly order", "open assembly orders")} this month with no open
          order ({count(unpriced.aos.pieces)} pieces).
        </li>
        <li>
          Unpriced: {plural(unpriced.batches.count, "batch", "batches")} with no assembly order yet ({oneDecimal(unpriced.batches.kg)} kg)
          {batchWeeks.length > 0
            ? `, ready to invoice 5 working days after the batch: ${batchWeeks.map((w) => `week of ${day(w)} ${oneDecimal(unpriced.batches.byWeek[w])} kg`).join(", ")}`
            : ""}
          .
        </li>
        {unpriced.otherCurrencyRows > 0 ? (
          <li>Not converted: {plural(unpriced.otherCurrencyRows, "line", "lines")} in a currency other than CAD or USD.</li>
        ) : null}
      </ul>

      <h3>Realized: invoiced {range ? `in ${range.label}` : "this month"}</h3>
      <RankingTable label="Realized revenue by customer" ranking={data.realized} query={query} testId="goals-realized" />
      <p className="gp-line">
        The Revenue card&rsquo;s {range ? "dates" : "month"} by customer and ship week: {dollars(data.realized.totalCadCents)}
        {data.realized.totalCadCents === data.cardTotalCents ? ", the card's total." : `, not the card's ${dollars(data.cardTotalCents)}.`}
      </p>
    </>
  );
}