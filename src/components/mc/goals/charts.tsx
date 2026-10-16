"use client";

// The page's charts (brief §Screens 4 and 7) over the shared column charts:
// Line 1 bulk kg per day, revenue against the monthly target, and completed
// batches by size for the last three months against this month's pace. Each
// chart has a one-sentence summary for assistive tech and its numbers in a
// table under it (the text alternative), so nothing depends on hovering.

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
  return page.model.daily.map((d) => {
    const dom = Number(d.day.slice(8));
    return { key: d.day, label: String(dom), tick: dom === 1 || dom % 7 === 1, shaded: !d.isWorkingDay };
  });
}

function todayMarker(page: ReadyPage) {
  const index = page.model.daily.findIndex((d) => d.isToday);
  return index >= 0 ? { index, label: "Today" } : null;
}

export function DailyLine1Chart({ page }: { page: ReadyPage }) {
  const { model, settings } = page;
  const l1 = model.line1;
  const perDay = count(settings.line1KgPerWorkingDay);
  const keys: ChartKey[] = [
    { label: "Completed (FileMaker)", colorVar: C.done, kind: "bar" },
    { label: "Entered by hand", colorVar: C.hand, kind: "bar" },
    { label: "Still scheduled", colorVar: C.scheduled, kind: "bar" },
    { label: `Target: ${perDay} kg a working day`, colorVar: C.target, kind: "dashed" },
  ];
  // Every open Line 1 batch this month, from today or past its date (the batch list's own sum).
  const stillScheduled = l1.scheduledFromTodayKg + l1.openPastDateKg;
  return (
    <StackedColumns
      summary={`Line 1 bulk kg per day, ${model.month.label}: ${wholeKg(l1.totalKg)} kg done so far (${wholeKg(l1.inSystemKg)} kg in FileMaker, ${wholeKg(l1.byHandKg)} kg entered by hand) and ${wholeKg(stillScheduled)} kg still scheduled, against ${perDay} kg a working day. Weekends and holidays are shaded.`}
      axis={dayAxis(page)}
      stacks={model.daily.map((d) => [
        { key: "done", value: d.line1DoneKg, colorVar: C.done },
        { key: "hand", value: d.line1ByHandKg, colorVar: C.hand },
        { key: "scheduled", value: d.line1ScheduledKg, colorVar: C.scheduled },
      ])}
      keys={keys}
      formatY={compactKg}
      target={{ value: settings.line1KgPerWorkingDay, colorVar: C.target }}
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
  const keys: ChartKey[] = [
    { label: "Sage", colorVar: C.done, kind: "line" },
    { label: "Sage + entered by hand", colorVar: C.hand, kind: "line" },
    { label: "Last month, same day", colorVar: C.lastMonth, kind: "line" },
    { label: "Target to date", colorVar: C.target, kind: "dashed" },
  ];
  return (
    <RunningLines
      summary={`Revenue to date in CAD, ${model.month.label}: ${dollars(rev.inSystemCents)} in Sage and ${dollars(rev.totalCents)} with entries by hand, against ${dollars(rev.dueSoFarCents)} due so far and ${dollars(rev.targetCents)} for the month. Last month reached ${dollars(rev.lastMonthCadCents)}.`}
      axis={dayAxis(page)}
      series={[
        { key: "last-month", values: model.daily.map((d) => d.lastMonthToDateCents), colorVar: C.lastMonth },
        { key: "target", values: model.daily.map((d) => d.targetToDateCents), colorVar: C.target, dashed: true, step: true },
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
            <span>Last month, same day: {dollars(d.lastMonthToDateCents)}</span>
            <span>Target to date: {dollars(d.targetToDateCents)}</span>
          </>
        );
      }}
    />
  );
}

/** The numbers behind both day-by-day charts (their text alternative). */
export function DailyTable({ page }: { page: ReadyPage }) {
  const { model } = page;
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
              <th scope="col" className="num">Target to date</th>
              <th scope="col" className="num">Last month to date</th>
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
                <td className="num">{amount(d.targetToDateCents)}</td>
                <td className="num">{amount(d.lastMonthToDateCents)}</td>
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
