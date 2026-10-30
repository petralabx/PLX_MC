"use client";

// UAT scorecard screen (TASK-4196): how the UAT fix loop did each week, from
// the numbers and from users' feedback, against the team's targets. One card
// per area, each metric graded met, near or missed with the calendar week
// before beside it, and the weekly score as a trend. The daily UAT check pulls
// the numbers from the portal (GET /api/uat-scorecard; module contract:
// docs/modules/uat-scorecard/README.md).

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import {
  AREAS,
  NEAR_FACTOR,
  PARENT_TASK,
  PULSE_DROP_FLAG,
  letterOf,
  type Card,
  type PullFailure,
  type ScorecardResponse,
  type ScorecardSource,
  type WeekScore,
} from "@/lib/uat-scorecard";

import { RunningLines, type ChartKey } from "../charts";
import { GRADE_LABELS, scoreLine } from "../ci-scorecard/helpers";
import type { Nav, ScreenProps } from "../route";

import {
  axisLabel,
  dayLabel,
  formatNear,
  formatTarget,
  formatValue,
  loopBoardUrl,
  metLine,
  openWeeks,
  readAtLabel,
  shadedNote,
  soFarLabel,
  trendLabel,
  weekLabel,
  weekName,
  weeklyColumns,
} from "./helpers";

// The overall score is the one line: the areas sit in the table under it (tokens only, no hex).
const OVERALL_COLOR = "var(--p-ink)";

function CardView({ card, week }: { card: Card; week: string }) {
  return (
    <section className="cs-card" aria-labelledby={`us-h-${card.id}`}>
      <header className="cs-card-head">
        <h2 id={`us-h-${card.id}`}>{card.label}</h2>
        <span className={`cs-letter cs-l-${card.letter ?? "none"}`}>{scoreLine(card.score, card.letter)}</span>
      </header>
      <p className="cs-met">{metLine(card)}</p>
      <div className="cs-table-wrap" role="region" aria-label={`${card.label} metrics`} tabIndex={0}>
        <table className="cs-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" className="num">
                {week}
              </th>
              <th scope="col">Grade</th>
              <th scope="col" className="num">
                Target
              </th>
              <th scope="col">Previous week</th>
            </tr>
          </thead>
          <tbody>
            {card.metrics.map((m) => {
              const near = formatNear(m);
              return (
                <tr key={m.id}>
                  <th scope="row">
                    <span className="cs-metric">{m.label}</span>
                    <span className="cs-detail">{m.detail}</span>
                  </th>
                  <td className="num" data-label={week}>
                    {formatValue(m.value, m.unit)}
                    {m.basis ? <span className="cs-detail">{m.basis}</span> : null}
                    {m.note ? <span className="cs-note">{m.note}</span> : null}
                  </td>
                  <td data-label="Grade">
                    <span className={`cs-grade cs-g-${m.grade}`}>{GRADE_LABELS[m.grade]}</span>
                  </td>
                  <td className="num" data-label="Target">
                    {formatTarget(m)}
                    {near ? <span className="cs-next">{near}</span> : null}
                  </td>
                  <td className={m.trend ? `cs-t-${m.trend}` : undefined} data-label="Previous week">
                    {trendLabel(m)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrendView({ history }: { history: readonly WeekScore[] }) {
  if (history.length < 2) {
    return <p className="cs-empty">The trend starts once a second week is in.</p>;
  }
  const columns = weeklyColumns(history);
  const overall = columns[columns.length - 1];
  const keys: ChartKey[] = [{ label: "Overall", colorVar: OVERALL_COLOR, kind: "line" }];
  const last = history[history.length - 1];
  return (
    <>
      <RunningLines
        summary={`Weekly UAT scores, ${history.length} weeks to the week of ${weekName(last)}: overall ${last.overall ?? "not graded"} out of 100.${shadedNote(history)}`}
        axis={history.map((w) => ({ key: w.week, label: axisLabel(w), shaded: w.state === "open" }))}
        series={[{ key: overall.key, values: overall.values, colorVar: OVERALL_COLOR }]}
        keys={keys}
        formatY={(v) => String(Math.round(v))}
        readout={(i) => (
          <>
            <b>Week of {weekName(history[i])}</b>
            {columns.map((c) => (
              <span key={c.key}>
                {c.label}: {c.values[i] ?? "—"}
              </span>
            ))}
          </>
        )}
      />
      <details className="cs-data">
        <summary>Weekly scores</summary>
        <div className="cs-table-wrap" role="region" aria-label="Weekly UAT scores" tabIndex={0}>
          <table className="cs-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="num">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((w, i) => (
                <tr key={w.week}>
                  <th scope="row">{weekName(w)}</th>
                  {columns.map((c) => (
                    <td key={c.key} className="num" data-label={c.label}>
                      {c.values[i] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function HowGradingWorks() {
  return (
    <details className="cs-how">
      <summary>How grading works</summary>
      <ul>
        <li>
          Each metric has a target and a direction. Where lower is better, <b>met</b> is at or under the target and{" "}
          <b>near</b> within {NEAR_FACTOR}× a target above zero; a target of 0 has no near band. Where higher is better,{" "}
          <b>met</b> is at or over the target and <b>near</b> at or over the band shown under it. Anything else is{" "}
          <b>missed</b>.
        </li>
        <li>
          The score counts met as 1 and near as a half, out of the graded metrics: A from 90, B from 80, C from 70, D
          from 60, F below. A metric with no data that week is not graded, and the overall score counts every graded
          metric of every area.
        </li>
        <li>
          The portal measures and Mission Control grades. The daily UAT check pulls last week&apos;s final numbers and
          this week so far from the portal at 10:00 UTC. Weeks run Monday to Sunday, Toronto time; bd are Toronto
          business days. Previous week is the calendar week before, when it is stored.
        </li>
        <li>
          Open, stuck and waiting tickets and dead outbox rows are counted when the portal reads them. A closed week
          shows each from its newest read while open that has it. A pulse average {PULSE_DROP_FLAG} or more below the
          round before is flagged.
        </li>
        <li>
          The default targets come from the TASK-4196 design. The team adjusts them in{" "}
          <code>src/lib/uat-scorecard/index.ts</code>, and a change regrades every stored week.
        </li>
      </ul>
    </details>
  );
}

function SourceNotes({ source }: { source: ScorecardSource }) {
  if (!source.portalRead) {
    return (
      <div className="cs-note-box" role="status">
        Portal read is off. Mission Control pulls no new week until <code>PLX_MC_UAT_PORTAL_READ_ENABLED</code> is on.
      </div>
    );
  }
  if (!source.dailyCheck) {
    return (
      <div className="cs-note-box" role="status">
        The daily UAT check is off, so no new week is pulled. It needs <code>PLX_MC_UAT_DRIFT_CRON_ENABLED</code> and{" "}
        <code>CRON_SECRET</code>.
      </div>
    );
  }
  return null;
}

function PullFailureNote({ failure }: { failure: PullFailure }) {
  return (
    <div className="cs-note-box" role="status">
      The last daily pull failed: {failure.message} ({readAtLabel(failure.at)}, week of {dayLabel(failure.week)})
    </div>
  );
}

export type UatScorecardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ScorecardResponse };

/** The screen for one load state; the loader below owns the fetch. */
export function UatScorecardBody({ state, nav }: { state: UatScorecardState; nav: Nav }) {
  const data = state.status === "ready" ? state.data : null;
  const latest = data?.latest ?? null;
  const open = data ? openWeeks(data.history, latest) : [];
  const lastRead = data?.history.at(-1)?.generatedAt ?? null;
  const pulling = data ? data.source.portalRead && data.source.dailyCheck : false;
  return (
    <div className="mc-main cs cs-uat" data-testid="uat-scorecard-screen">
      <div className="ph">
        <div>
          <span className="kk">Reporting · weekly</span>
          <h1>
            UAT <em>scorecard</em>
          </h1>
          <p className="sub">
            How the UAT fix loop did each week, from the numbers and from users&apos; feedback, against the team&apos;s
            targets.
          </p>
        </div>
        {latest ? (
          <div className="r">
            <span className={`cs-letter cs-big cs-l-${latest.letter ?? "none"}`}>
              {scoreLine(latest.overall, latest.letter)}
            </span>
            <span className="count">Week of {weekName(latest)}</span>
            {open.map((w) => (
              <span key={w.week} className="count">
                {soFarLabel(w)}: {scoreLine(w.overall, letterOf(w.overall))}
                {w.readErrors.length > 0 ? ", incomplete" : ""}
                {w.finalReadPending ? ". Its final read is pending." : ""}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="cs-links">
        <a href={loopBoardUrl(data?.source.portalOrigin)} target="_blank" rel="noopener noreferrer">
          Loop board in the portal
        </a>
        <button type="button" onClick={() => nav("task", { taskId: PARENT_TASK })}>
          {PARENT_TASK}, the weekly UAT readout
        </button>
        {lastRead ? <span>Last read from the portal {readAtLabel(lastRead)}</span> : null}
      </p>

      {state.status === "loading" ? (
        <div className="cs-loading" aria-label="Loading the UAT scorecard">
          Loading the UAT scorecard…
        </div>
      ) : null}
      {state.status === "error" ? (
        <div className="cs-err" role="alert">
          {state.message}
        </div>
      ) : null}
      {data ? <SourceNotes source={data.source} /> : null}
      {data?.source.lastPullFailure ? <PullFailureNote failure={data.source.lastPullFailure} /> : null}
      {data && !latest ? (
        <p className="cs-empty">
          No week stored yet.
          {pulling ? " The daily UAT check pulls last week and this week from the portal at 10:00 UTC." : null}
        </p>
      ) : null}
      {data && latest ? (
        <>
          {latest.readErrors.length > 0 ? (
            <div className="cs-note-box" role="status">
              The portal could not read everything for the week of {weekLabel(latest)}, so those numbers show no data:{" "}
              {latest.readErrors.join("; ")}
            </div>
          ) : null}
          {open
            .filter((w) => w.readErrors.length > 0)
            .map((w) => (
              <div key={w.week} className="cs-note-box" role="status">
                {soFarLabel(w)} could not read everything: {w.readErrors.join("; ")}
              </div>
            ))}
          <section className="cs-trend" aria-labelledby="us-h-trend">
            <h2 id="us-h-trend">Score by week</h2>
            <TrendView history={data.history} />
          </section>
          <div className="cs-cards">
            {AREAS.map((area) => {
              const card = latest.cards.find((c) => c.id === area.id);
              const week = latest.state === "open" ? soFarLabel(latest) : `Week of ${axisLabel(latest)}`;
              return card ? <CardView key={card.id} card={card} week={week} /> : null;
            })}
          </div>
          <HowGradingWorks />
        </>
      ) : null}
    </div>
  );
}

export function UatScorecardView({ nav }: ScreenProps) {
  const [state, setState] = useState<UatScorecardState>({ status: "loading" });

  // setState only ever runs inside promise continuations — never in the
  // synchronous body of an effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    void api<ScorecardResponse>("/uat-scorecard?weeks=12")
      .then((data) => {
        setState({ status: "ready", data });
      })
      .catch((err: Error) => {
        setState({ status: "error", message: err.message });
      });
  }, []);

  return <UatScorecardBody state={state} nav={nav} />;
}
