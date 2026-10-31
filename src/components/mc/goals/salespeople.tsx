"use client";

// The salesperson (account manager) filter (TASK-4277): pick one or more Sage
// salespeople and the page shows only their customers. The choice lives in the
// URL (`sales=GGC,SM`), and the page model and the workbook are read again for
// it, so every figure agrees. The ticks follow the URL at once; the figures
// follow when their read lands.

import type { SalespeopleView } from "@/lib/reporting/goals";
import { NO_SALESPERSON } from "@/lib/reporting/goals/salesperson-filter";

/** A pick in words, as the summary shows it: "Glenn (GGC)", "No salesperson". */
function pickName(view: SalespeopleView, code: string): string {
  if (code === NO_SALESPERSON) return "No salesperson";
  const name = view.options.find((o) => o.code === code)?.name;
  return name ? `${name} (${code})` : code;
}

const customers = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "customer" : "customers"}`;

export function SalespeoplePicker({
  view,
  picked,
  waiting,
  failed,
  onPick,
  onRetry,
}: {
  view: SalespeopleView;
  /** The codes in the URL: ticked at once, while their figures load. */
  picked: readonly string[];
  /** The figures on screen aren't for `picked` yet. */
  waiting: boolean;
  /** Reading them failed. */
  failed: boolean;
  onPick: (next: string[]) => void;
  onRetry: () => void;
}) {
  const toggle = (code: string) => onPick(picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code]);
  const summary =
    picked.length === 0 ? "All salespeople" : picked.length <= 2 ? picked.map((c) => pickName(view, c)).join(", ") : `${picked.length} picked`;
  return (
    <div className="gp-tools gp-rate" data-testid="goals-salespeople">
      <span id="goals-sales-label">Salespeople</span>
      {view.state === "ready" ? (
        <details className={picked.length > 0 ? "gp-pick on" : "gp-pick"}>
          <summary aria-describedby="goals-sales-label" data-testid="goals-salespeople-summary">
            {summary}
          </summary>
          <fieldset className="gp-pick-menu">
            <legend className="vh">Show only the customers of</legend>
            {view.options.map((o) => (
              <label key={o.code} className="gp-check">
                <input type="checkbox" checked={picked.includes(o.code)} onChange={() => toggle(o.code)} />
                <span>{o.name ?? o.code}</span> <span className="ct">{o.code}</span>
                <span className="n">{customers(o.customers)}</span>
              </label>
            ))}
            <label className="gp-check">
              <input type="checkbox" checked={picked.includes(NO_SALESPERSON)} onChange={() => toggle(NO_SALESPERSON)} />
              <span>No salesperson</span>
              <span className="n">{customers(view.unassigned)}</span>
            </label>
          </fieldset>
        </details>
      ) : (
        <span data-testid="goals-salespeople-waiting">
          {view.state === "waiting_for_access"
            ? `Can’t filter yet: waiting for read access to Sage salespeople (${view.missing.join(", ")}).`
            : "Can’t filter right now: Sage’s salespeople couldn’t be read. Every customer is shown."}
        </span>
      )}
      {picked.length > 0 ? (
        <button type="button" className="btn ghost" data-testid="goals-salespeople-clear" onClick={() => onPick([])}>
          Show every customer
        </button>
      ) : null}
      <span className="gp-rate-status" role="status" data-testid="goals-salespeople-status">
        {waiting ? (failed ? "Couldn’t load the figures for these salespeople. The figures below are still the earlier ones." : "Loading their customers’ figures…") : ""}
      </span>
      {waiting && failed ? (
        <button type="button" className="btn ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** What a narrowed page covers, under the switches: whose customers, what stays whole, and how shared customers count. */
export function SalespeopleNote({ view }: { view: SalespeopleView }) {
  if (!view.applied) {
    return view.selected.length > 0 ? (
      <p className="gp-notice" data-testid="goals-salespeople-note">
        Not filtered: Sage’s salespeople can’t be read right now, so every figure below is every customer’s.
      </p>
    ) : null;
  }
  return (
    <p className="gp-note gp-sales-note" data-testid="goals-salespeople-note">
      Showing only the customers of {view.label}: revenue, returns, shipments, truckloads, entries by hand, revenue by
      customer and the forecast follow the filter. Line 1 bulk and the batches are every customer’s, because FileMaker has no
      salesperson. Last month’s revenue isn’t split by customer, so the daily chart leaves it out.
      {view.shared > 0
        ? ` A customer with more than one salesperson on Sage counts in full under each of them (${customers(view.shared)} this month).`
        : ""}
      {view.everyCustomer && !view.everyCustomer.matchesCard
        ? " Sage changed during this refresh, so these figures follow the invoice list and can be off from the unfiltered Revenue card until the next refresh."
        : ""}
    </p>
  );
}
