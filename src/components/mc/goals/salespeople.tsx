"use client";

// The salesperson (account manager) filter (TASK-4277): pick one or more Sage
// salespeople and the page shows only their customers. The choice lives in the
// URL (`sales=GGC,SM`), and the page model and the workbook are read again for
// it, so every figure agrees. The ticks follow the URL at once; the figures
// follow when their read lands. The open picker is a list view (TASK-4385): a
// search, Clear, the picked salespeople first, and Done.

import { useRef, useState, type KeyboardEvent } from "react";

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The picks when the list opened go first; ticking while it's open doesn't move a row under the pointer.
  const [first, setFirst] = useState<readonly string[]>([]);
  const summaryRef = useRef<HTMLElement>(null);
  const toggle = (code: string) => onPick(picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code]);
  const summary =
    picked.length === 0 ? "All salespeople" : picked.length <= 2 ? picked.map((c) => pickName(view, c)).join(", ") : `${picked.length} picked`;
  const rows = [
    ...view.options.map((o) => ({ code: o.code, name: o.name ?? o.code, shownCode: o.code, customers: o.customers })),
    { code: NO_SALESPERSON, name: "No salesperson", shownCode: "", customers: view.unassigned },
  ];
  const needle = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.shownCode.toLowerCase().includes(needle))
    .sort((a, b) => Number(first.includes(b.code)) - Number(first.includes(a.code)));
  // Picking every row is every customer, which Clear already gives, so "all shown" is offered only while a search narrows the list.
  const unpickedShown = shown.filter((r) => !picked.includes(r.code)).map((r) => r.code);
  const close = () => {
    setOpen(false);
    summaryRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  return (
    <div className="gp-tools gp-rate" data-testid="goals-salespeople">
      <span id="goals-sales-label">Salespeople</span>
      {view.state === "ready" ? (
        <details
          className={picked.length > 0 ? "gp-pick on" : "gp-pick"}
          open={open}
          onToggle={(event) => {
            const isOpen = event.currentTarget.open;
            if (isOpen && !open) {
              setFirst(picked);
              setQuery("");
            }
            setOpen(isOpen);
          }}
        >
          <summary ref={summaryRef} aria-describedby="goals-sales-label" data-testid="goals-salespeople-summary">
            {summary}
          </summary>
          <div className="gp-pick-menu" onKeyDown={onKeyDown}>
            <div className="gp-pick-head">
              <span id="goals-sales-menu" className="gp-pick-title">
                Show only the customers of
              </span>
              <span className="gp-pick-acts">
                {needle && unpickedShown.length > 0 && shown.length < rows.length ? (
                  <button type="button" className="tl-link" data-testid="goals-salespeople-pick-shown" onClick={() => onPick([...picked, ...unpickedShown])}>
                    Pick all shown
                  </button>
                ) : null}
                <button type="button" className="tl-link" data-testid="goals-salespeople-menu-clear" disabled={picked.length === 0} onClick={() => onPick([])}>
                  Clear
                </button>
              </span>
            </div>
            <input
              type="search"
              className="gp-pick-find"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a salesperson or code"
              aria-label="Find a salesperson or code"
              data-testid="goals-salespeople-search"
            />
            <fieldset className="gp-pick-list" aria-labelledby="goals-sales-menu">
              {shown.map((r) => (
                <label key={r.code} className={picked.includes(r.code) ? "gp-check on" : "gp-check"}>
                  <input type="checkbox" checked={picked.includes(r.code)} onChange={() => toggle(r.code)} />
                  <span>{r.name}</span> {r.shownCode ? <span className="ct">{r.shownCode}</span> : null}
                  <span className="n">{customers(r.customers)}</span>
                </label>
              ))}
              {shown.length === 0 ? <p className="gp-pick-none">No salesperson matches “{query.trim()}”.</p> : null}
            </fieldset>
            <div className="gp-pick-foot">
              <span>{picked.length === 0 ? "Every customer" : `${picked.length} picked`}</span>
              <button type="button" className="btn sm" data-testid="goals-salespeople-done" onClick={close}>
                Done
              </button>
            </div>
          </div>
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
