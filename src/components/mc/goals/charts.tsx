"use client";

// The page's charts (brief §Screens 4 and 7) over the shared column charts:
// Line 1 bulk kg per day, revenue against the monthly target, and completed
// batches by size for the last three months against this month's pace. Each
// chart has a one-sentence summary for assistive tech and its numbers in a
// table under it (the text alternative), so nothing depends on hovering.
// For some days of the month (TASK-4391) the day-by-day charts and table show
// those days only, with no target and no last month.

import { RunningLines, StackedColumns, type ChartKey, type ColumnAxis } from "../charts";

import { amount, compactDollars, compactKg, count, day, dollars, oneDecimal, wholeKg, type ReadyPage } from "./helpers";

const C = {
  done: "var(--p-accent)",
  hand: "var(--p-warn)",
  scheduled: "var(--p-accent-soft)",
  target: "var(--p-ink-2)",
  lastMonth: "var(--p-muted)",
};

// One colour per size band, in the model's band order; amber stays reserved for entries by hand.
const BAND_COLORS = ["var(--p-accent)", "var(--p-info)", "var(--p-accent-soft)", "var(--p-hot)"];

function dayAxis(page: ReadyPage): ColumnAxis[] {
  return page.model.daily.map((d, i) => {
    const dom = Number(d.day.slice(8));
    // The first day shown is labelled too: some days of the month (TASK-4391) can start mid-month.
    return { key: d.day, label: String(dom), tick: i === 0 || dom % 7 === 1, shaded: !d.isWorkingDay };
  });
}

/** Some days of the month (TASK-4391), or null for the whole month. */
function partialRange(page: ReadyPage) {
  return page.range && !page.range.whole ? page.range : null;
}

function todayMarker(page: ReadyPage) {
  const index = page.model.daily.findIndex((d) => d.isToday);
  return index >= 0 ? { index, label: "Today" } : null;
}

export function DailyLine1Chart({ page }: { page: ReadyPage }) {
  const { model, settings } = page;
  const l1 = model.line1;
  const perDay = count(settings.line1KgPerWorkingDay);
  const range = partialRange(page);
  const keys: ChartKey[] = [
    { label: "Completed (FileMaker)", colorVar: C.done, kind: "bar" },
    { label: "Entered by hand", colorVar: C.hand, kind: "bar" },
    { label: "Still scheduled", colorVar: C.scheduled, kind: "bar" },
    ...(range ? [] : [{ label: `Target: ${perDay} kg a working day`, colorVar: C.target, kind: "dashed" } as const]),
  ];
  // Every open Line 1 batch this month, from today or past its date (the batch list's own sum).
  const stillScheduled = l1.scheduledFromTodayKg + l1.openPastDateKg;
  return (
    <StackedColumns
      summary={`Line 1 bulk kg per day, ${range ? range.label : model.month.label}: ${wholeKg(l1.totalKg)} kg done so far (${wholeKg(l1.inSystemKg)} kg in FileMaker, ${wholeKg(l1.byHandKg)} kg entered by hand) and ${wholeKg(stillScheduled)} kg still scheduled${range ? "" : `, against ${perDay} kg a working day`}. Weekends and holidays are shaded.`}
      axis={dayAxis(page)}
      stacks={model.daily.map((d) => [
        { key: "done", value: d.line1DoneKg, colorVar: C.done },
        { key: "hand", value: d.line1ByHandKg, colorVar: C.hand },
        { key: "scheduled", value: d.line1ScheduledKg, colorVar: C.scheduled },
      ])}
      keys={keys}
      formatY={compactKg}
      target={range ? undefined : { value: settings.line1KgPerWorkingDay, colorVar: C.target }}
      marker={todayMarker(page)}
      readout={(i) => {
        const d = model.daily[i];
        return (
          <>
            <b>{day(d.day)}</b>
            {d.isWorkingDay ? null : <span> · not a working day</span>}
            <span>Completed: {wholeKg(d.line1DoneKg)} kg</span>
            {d.line1ByHandKg > 0 ? <span className="gp-amber">By hand: {wholeKg(d.line1ByHandKg)} kg</span> : null}
            <span>Still scheduled: {wholeKg(d.line1ScheduledKg)} kg</span>
          </>
        );
      }}
    />
  );
}

export function DailyRevenueChart({ page }: { page: ReadyPage }) {
  const { model } = page;
  const rev = model.revenue;
  const past = (d: (typeof model.daily)[number], value: number) => (d.isFuture ? null : value);
  // Narrowed to some salespeople (TASK-4277), last month's revenue isn't split by customer, so its line is left out,
  // and the target is every customer's, so its line is too, as the Revenue card drops its status.
  const lastMonth = rev.lastMonthCadCents;
  const narrowed = page.salespeople?.applied ? page.salespeople : null;
  // Some days of the month (TASK-4391): no target either, as the cards drop their status (last month is already null).
  const range = partialRange(page);
  const noTarget = !!narrowed || !!range;
  const keys: ChartKey[] = [
    { label: "Sage", colorVar: C.done, kind: "line" },
    { label: "Sage + entered by hand", colorVar: C.hand, kind: "line" },
    ...(lastMonth === null ? [] : [{ label: "Last month, same day", colorVar: C.lastMonth, kind: "line" } as const]),
    ...(noTarget ? [] : [{ label: "Target to date", colorVar: C.target, kind: "dashed" } as const]),
  ];
  return (
    <RunningLines
      summary={`Revenue to date in CAD, ${range ? range.label : model.month.label}: ${dollars(rev.inSystemCents)} in Sage and ${dollars(rev.totalCents)} with entries by hand${narrowed ? `, for the customers of ${narrowed.label}.` : range ? "." : `, against ${dollars(rev.dueSoFarCents)} due so far and ${dollars(rev.targetCents)} for the month.`}${lastMonth === null ? "" : ` Last month reached ${dollars(lastMonth)}.`}`}
      axis={dayAxis(page)}
      series={[
        ...(lastMonth === null ? [] : [{ key: "last-month", values: model.daily.map((d) => d.lastMonthToDateCents), colorVar: C.lastMonth }]),
        ...(noTarget ? [] : [{ key: "target", values: model.daily.map((d) => d.targetToDateCents), colorVar: C.target, dashed: true, step: true }]),
        { key: "with-hand", values: model.daily.map((d) => past(d, d.withHandToDateCents)), colorVar: C.hand },
        { key: "sage", values: model.daily.map((d) => past(d, d.sageToDateCents)), colorVar: C.done },
      ]}
      keys={keys}
      formatY={compactDollars}
      marker={todayMarker(page)}
      readout={(i) => {
        const d = model.daily[i];
        return (
          <>
            <b>{day(d.day)}</b>
            {d.isFuture ? null : <span>Sage: {dollars(d.sageToDateCents)}</span>}
            {d.isFuture ? null : <span className="gp-amber">With entries by hand: {dollars(d.withHandToDateCents)}</span>}
            {d.lastMonthToDateCents === null ? null : <span>Last month, same day: {dollars(d.lastMonthToDateCents)}</span>}
            {noTarget ? null : <span>Target to date: {dollars(d.targetToDateCents)}</span>}
          </>
        );
      }}
    />
  );
}

/** The numbers behind both day-by-day charts (their text alternative). */
export function DailyTable({ page }: { page: ReadyPage }) {
  const { model } = page;
  // Some days of the month (TASK-4391): the month's target and last month have no column.
  const monthly = !partialRange(page);
  return (
    <details className="gp-data">
      <summary>Day-by-day numbers</summary>
      <div className="gp-table-wrap" role="region" aria-label="Day-by-day numbers" tabIndex={0}>
        <table className="gp-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Working day</th>
              <th scope="col" className="num">Line 1 kg done</th>
              <th scope="col" className="num hand">Line 1 kg by hand</th>
              <th scope="col" className="num">Line 1 kg scheduled</th>
              <th scope="col" className="num">CAD invoiced</th>
              <th scope="col" className="num">USD invoiced</th>
              <th scope="col" className="num hand">By hand (CAD)</th>
              <th scope="col" className="num">Sage to date (CAD)</th>
              <th scope="col" className="num hand">With entries (CAD)</th>
              {monthly ? (
                <>
                  <th scope="col" className="num">Target to date</th>
                  <th scope="col" className="num">Last month to date</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {model.daily.map((d) => (
              <tr key={d.day} className={d.isToday ? "today" : undefined}>
                <th scope="row">{day(d.day)}</th>
                <td>{d.isWorkingDay ? "Yes" : "No"}</td>
                <td className="num">{wholeKg(d.line1DoneKg)}</td>
                <td className="num hand">{wholeKg(d.line1ByHandKg)}</td>
                <td className="num">{wholeKg(d.line1ScheduledKg)}</td>
                <td className="num">{amount(d.cadCents)}</td>
                <td className="num">{amount(d.usdCents)}</td>
                <td className="num hand">{amount(d.byHandCadCents)}</td>
                <td className="num">{d.isFuture ? "—" : amount(d.sageToDateCents)}</td>
                <td className="num hand">{d.isFuture ? "—" : amount(d.withHandToDateCents)}</td>
                {monthly ? (
                  <>
                    <td className="num">{amount(d.targetToDateCents)}</td>
                    <td className="num">{d.lastMonthToDateCents === null ? "—" : amount(d.lastMonthToDateCents)}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function SizeHistoryChart({ page }: { page: ReadyPage }) {
  const { history } = page.model.sizes;
  const bands = page.model.sizes.completed.flatMap((t) => (t.band === "Total" ? [] : [t.band]));
  const projected = new Set(history.flatMap((m, i) => (m.projected ? [i] : [])));
  const label = (m: (typeof history)[number]) => `${m.label.split(" ")[0].slice(0, 3)}${m.projected ? " (pace)" : ""}`;
  const total = (m: (typeof history)[number]) => bands.reduce((n, b) => n + m.counts[b], 0);
  return (
    <>
      <StackedColumns
        summary={`Completed batches by size: ${history
          .map((m) => `${m.label}${m.projected ? " (this month's pace)" : ""} ${count(Math.round(total(m)))}`)
          .join(", ")}.`}
        axis={history.map((m) => ({ key: m.month, label: label(m) }))}
        stacks={history.map((m) =>
          bands.map((b, i) => ({ key: b, value: m.counts[b], colorVar: BAND_COLORS[i] }))
        )}
        keys={bands.map((b, i) => ({ label: `${b} kg`, colorVar: BAND_COLORS[i], kind: "bar" as const }))}
        faded={projected}
        readout={(i) => {
          const m = history[i];
          return (
            <>
              <b>
                {m.label}
                {m.projected ? " · pace" : ""}
              </b>
              {bands.map((b) => (
                <span key={b}>
                  {b} kg: {m.projected ? oneDecimal(m.counts[b]) : count(m.counts[b])}
                </span>
              ))}
            </>
          );
        }}
      />
      <details className="gp-data">
        <summary>Monthly numbers</summary>
        <div className="gp-table-wrap" role="region" aria-label="Completed batches by size and month" tabIndex={0}>
          <table className="gp-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                {bands.map((b) => (
                  <th key={b} scope="col" className="num">
                    {b} kg
                  </th>
                ))}
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((m) => (
                <tr key={m.month}>
                  <th scope="row">
                    {m.label}
                    {m.projected ? " (pace)" : ""}
                  </th>
                  {bands.map((b) => (
                    <td key={b} className="num">
                      {m.projected ? oneDecimal(m.counts[b]) : count(m.counts[b])}
                    </td>
                  ))}
                  <td className="num">{m.projected ? oneDecimal(total(m)) : count(total(m))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
