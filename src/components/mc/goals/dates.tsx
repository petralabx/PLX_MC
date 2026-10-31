"use client";

// The dates filter (TASK-4391): show the page for some days of the run's
// month — month to date, this week, the last 7 days or a range of days. The
// choice lives in the URL (`dates=week`), and the page model and the workbook
// are read again for it, so every figure agrees. The picker follows the URL at
// once; the figures follow when their read lands. It opens in the flow like the
// salesperson picker (./salespeople.tsx). The spans it shows are worked out
// here from the run's today, by the same rule the server uses.

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { DatesView } from "@/lib/reporting/goals";
import { monthEnd, monthStart } from "@/lib/reporting/goals/calendar";
import {
  DATES_NAMES,
  datesKey,
  datesTitle,
  isIsoDay,
  resolveDates,
  WHOLE_MONTH,
  type DatesChoice,
  type DatesPreset,
} from "@/lib/reporting/goals/date-filter";

const CHOICES: { key: DatesPreset | "month"; choice: DatesChoice }[] = [
  { key: "month", choice: WHOLE_MONTH },
  { key: "mtd", choice: { kind: "preset", preset: "mtd" } },
  { key: "week", choice: { kind: "preset", preset: "week" } },
  { key: "7d", choice: { kind: "preset", preset: "7d" } },
];

export function DatesPicker({
  today,
  asked,
  waiting,
  failed,
  onPick,
  onRetry,
  stray = false,
}: {
  /** The URL carries a `dates` this page can't read (so it shows the whole month): offer the way to clear it. */
  stray?: boolean;
  /** The run's today, which the presets resolve against. */
  today: string;
  /** The choice in the URL: shown at once, while its figures load. */
  asked: DatesChoice;
  /** The figures on screen aren't for `asked` yet. */
  waiting: boolean;
  /** Reading them failed. */
  failed: boolean;
  onPick: (next: DatesChoice) => void;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const range = resolveDates(asked, today);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const summaryRef = useRef<HTMLElement>(null);
  const key = datesKey(asked);
  const start = monthStart(today);
  const end = monthEnd(today);
  const customOk = isIsoDay(from) && isIsoDay(to) && from <= to;
  const close = () => {
    setOpen(false);
    summaryRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  const showCustom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customOk) return;
    // Every day of the month is the whole month, which never carries `dates`.
    onPick(from <= start && to >= end ? WHOLE_MONTH : { kind: "range", from, to });
  };
  return (
    <div className="gp-tools gp-rate" data-testid="goals-dates">
      <span id="goals-dates-label">Dates</span>
      <details
        className={key ? "gp-pick on" : "gp-pick"}
        open={open}
        onToggle={(event) => {
          const isOpen = event.currentTarget.open;
          if (isOpen && !open) {
            // The custom row opens on the days shown.
            setFrom(range.from);
            setTo(range.to);
          }
          setOpen(isOpen);
        }}
      >
        <summary ref={summaryRef} aria-describedby="goals-dates-label" data-testid="goals-dates-summary">
          {range.whole ? DATES_NAMES.month : datesTitle(range)}
        </summary>
        <div className="gp-pick-menu" onKeyDown={onKeyDown}>
          <div className="gp-pick-head">
            <span id="goals-dates-menu" className="gp-pick-title">
              Show the figures for
            </span>
          </div>
          <fieldset className="gp-pick-list" aria-labelledby="goals-dates-menu">
            {CHOICES.map((c) => {
              const on = (key || "month") === c.key;
              return (
                <label key={c.key} className={on ? "gp-check on" : "gp-check"}>
                  <input type="radio" name="goals-dates" checked={on} onChange={() => onPick(c.choice)} />
                  <span>{DATES_NAMES[c.key]}</span>
                  <span className="n">{resolveDates(c.choice, today).label}</span>
                </label>
              );
            })}
          </fieldset>
          <form className="gp-pick-dates" onSubmit={showCustom} data-testid="goals-dates-custom">
            <label>
              From{" "}
              <input type="date" value={from} min={start} max={end} onChange={(event) => setFrom(event.target.value)} data-testid="goals-dates-from" />
            </label>
            <label>
              To <input type="date" value={to} min={start} max={end} onChange={(event) => setTo(event.target.value)} data-testid="goals-dates-to" />
            </label>
            <button type="submit" className="btn sm" disabled={!customOk} data-testid="goals-dates-apply">
              Show these dates
            </button>
          </form>
          <div className="gp-pick-foot">
            <span>{range.whole ? "The whole month" : `${range.label}`}</span>
            <button type="button" className="btn sm" data-testid="goals-dates-done" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </details>
      {key || stray ? (
        <button type="button" className="btn ghost" data-testid="goals-dates-clear" onClick={() => onPick(WHOLE_MONTH)}>
          Show the whole month
        </button>
      ) : null}
      <span className="gp-rate-status" role="status" data-testid="goals-dates-status">
        {waiting ? (failed ? "Couldn’t load the figures for these dates. The figures below are still the earlier ones." : "Loading the figures for these dates…") : ""}
      </span>
      {waiting && failed ? (
        <button type="button" className="btn ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

const workingDays = (n: number) => `${n.toLocaleString("en-US")} working ${n === 1 ? "day" : "days"}`;

/** What a page for some days covers, under the switches: what follows the dates and what stays the whole month's. */
export function DatesNote({ range, month }: { range: DatesView; month: string }) {
  if (range.outside) {
    return (
      <p className="gp-notice" data-testid="goals-dates-note">
        The dates asked for are outside {month}, so the whole month is shown.
      </p>
    );
  }
  if (range.whole) {
    // Days asked for that cover the whole month once cut to it: say so, or the picker reads "on" with nothing to explain it.
    return range.clamped ? (
      <p className="gp-notice" data-testid="goals-dates-note">
        The dates asked for run past {month} on both sides, so the whole month is shown.
      </p>
    ) : null;
  }
  return (
    <p className="gp-note gp-sales-note" data-testid="goals-dates-note">
      Showing {range.label} only ({workingDays(range.workingDays)}). Figures follow the dates (invoices and the estimate by ship date,
      returns by credit-note date, batches and entries by their own date). The goals are the whole month’s, so there’s no status, due
      so far, pace or last month. The forecast and potential revenue are the whole month’s.
      {range.clamped ? ` The dates asked for run past ${month}, so they stop at its edge.` : ""}
    </p>
  );
}
