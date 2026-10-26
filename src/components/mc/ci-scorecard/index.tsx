"use client";

// CI scorecard screen (TASK-3913): how the CI pipeline did each week against the
// CI redesign's targets. One card per repo and one for the fleet, each metric
// graded met, near or missed against the current phase's target, with the
// previous week beside it, and the weekly scores as a trend. The Monday CI metrics task
// posts the numbers (GET /api/ci-scorecard; module contract:
// docs/modules/ci-scorecard/README.md).

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { NEAR_FACTOR, UNMEASURED_TARGETS, type Card, type Phase, type Scorecard } from "@/lib/ci-scorecard";

import { RunningLines, type ChartKey } from "../charts";

import {
  GRADE_LABELS,
  cardLabel,
  formatTarget,
  formatValue,
  metLine,
  scoreLine,
  trendLabel,
  trendSeries,
  weekLabel,
  windowLabel,
} from "./helpers";

// One token per line; the overall score reads strongest (tokens only, no hex).
const LINE_COLORS = ["var(--p-accent)", "var(--p-info)", "var(--p-accent-soft)", "var(--p-muted)"];
const OVERALL_COLOR = "var(--p-ink)";

function CardView({ card, phase }: { card: Card; phase: Phase }) {
  const label = cardLabel(card.id);
  return (
    <section className="cs-card" aria-labelledby={`cs-h-${card.id}`}>
      <header className="cs-card-head">
        <h2 id={`cs-h-${card.id}`}>{label}</h2>
        <span className={`cs-letter cs-l-${card.letter ?? "none"}`}>{scoreLine(card.score, card.letter)}</span>
      </header>
      <p className="cs-met">{metLine(card, phase)}</p>
      <div className="cs-table-wrap" role="region" aria-label={`${label} metrics`} tabIndex={0}>
        <table className="cs-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" className="num">
                This week
              </th>
              <th scope="col">Grade</th>
              <th scope="col" className="num">
                Target
              </th>
              <th scope="col">Previous week</th>
            </tr>
          </thead>
          <tbody>
            {card.metrics.map((m) => (
              <tr key={m.id}>
                <th scope="row">
                  <span className="cs-metric">{m.label}</span>
                  <span className="cs-detail">{m.detail}</span>
                </th>
                <td className="num">
                  {formatValue(m.value, m.unit)}
                  {m.note ? <span className="cs-note">{m.note}</span> : null}
                </td>
                <td>
                  <span className={`cs-grade cs-g-${m.grade}`}>{GRADE_LABELS[m.grade]}</span>
                </td>
                <td className="num">
                  {formatTarget(m.target, m.unit)}
                  {m.nextTarget !== null ? (
                    <span className="cs-next">Phase 2: {formatTarget(m.nextTarget, m.unit)}</span>
                  ) : null}
                </td>
                <td className={m.trend ? `cs-t-${m.trend}` : undefined}>{trendLabel(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrendView({ data }: { data: Scorecard }) {
  const { history } = data;
  if (history.length < 2) {
    return <p className="cs-empty">The trend starts once a second week is in.</p>;
  }
  const series = trendSeries(history);
  const keys: ChartKey[] = series.map((s, i) => ({
    label: s.label,
    colorVar: s.key === "overall" ? OVERALL_COLOR : LINE_COLORS[i % LINE_COLORS.length],
    kind: "line",
  }));
  const last = history[history.length - 1];
  return (
    <>
      <RunningLines
        summary={`Weekly CI scores, ${history.length} weeks to ${weekLabel(last)}: overall ${last.overall ?? "not graded"} out of 100.`}
        axis={history.map((w) => ({ key: w.windowEnd, label: weekLabel(w) }))}
        series={series.map((s, i) => ({ key: s.key, values: s.values, colorVar: keys[i].colorVar }))}
        keys={keys}
        formatY={(v) => String(Math.round(v))}
        readout={(i) => (
          <>
            <b>Week to {weekLabel(history[i])}</b>
            {series.map((s) => (
              <span key={s.key}>
                {s.label}: {s.values[i] ?? "—"}
              </span>
            ))}
          </>
        )}
      />
      <details className="cs-data">
        <summary>Weekly scores</summary>
        <div className="cs-table-wrap" role="region" aria-label="Weekly CI scores" tabIndex={0}>
          <table className="cs-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((w, i) => (
                <tr key={w.windowEnd}>
                  <th scope="row">{windowLabel(w.windowStart, w.windowEnd)}</th>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {s.values[i] ?? "—"}
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

function HowGradingWorks({ phase }: { phase: Phase }) {
  return (
    <details className="cs-how">
      <summary>How grading works</summary>
      <ul>
        <li>
          Each target is an upper bound from the CI redesign report (section 3.6). Phase {phase} targets grade the
          week. Phase 2 keeps every phase 1 target that it does not tighten.
        </li>
        <li>
          <b>Met</b> is at or under the target. <b>Near</b> is within {NEAR_FACTOR}× a target above zero. Anything
          more is <b>missed</b>, and a target of 0 has no near band.
        </li>
        <li>
          The score counts met as 1 and near as a half, out of the graded metrics: A from 90, B from 80, C from 70, D
          from 60, F below.
        </li>
        <li>
          The numbers come from <code>scripts/ci-audit/weekly_metrics.py</code> in agentic-swarm. The Monday CI
          metrics task (TASK-3866) posts them, one snapshot per week.
        </li>
        <li>
          Not measured yet:{" "}
          {UNMEASURED_TARGETS.map((t) => `${t.label} (phase ${t.phase}: ${t.target})`).join("; ")}.
        </li>
      </ul>
    </details>
  );
}

export type CiScorecardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Scorecard };

/** The screen for one load state; the loader below owns the fetch. */
export function CiScorecardBody({ state }: { state: CiScorecardState }) {
  const data = state.status === "ready" ? state.data : null;
  const latest = data?.latest ?? null;
  return (
    <div className="mc-main cs" data-testid="ci-scorecard-screen">
      <div className="ph">
        <div>
          <span className="kk">Reporting · weekly</span>
          <h1>
            CI <em>scorecard</em>
          </h1>
          <p className="sub">
            How the CI pipeline did each week against the CI redesign&apos;s targets, per repo and for all repos.
          </p>
        </div>
        {latest ? (
          <div className="r">
            <span className={`cs-letter cs-big cs-l-${latest.letter ?? "none"}`}>
              {scoreLine(latest.overall, latest.letter)}
            </span>
            <span className="count">Week of {windowLabel(latest.windowStart, latest.windowEnd)}</span>
          </div>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div className="cs-loading" aria-label="Loading the CI scorecard">
          Loading the CI scorecard…
        </div>
      ) : null}
      {state.status === "error" ? (
        <div className="cs-err" role="alert">
          {state.message}
        </div>
      ) : null}
      {data && !latest ? (
        <p className="cs-empty">No weekly snapshot yet. The Monday CI metrics task posts one each week (TASK-3866).</p>
      ) : null}
      {data && latest ? (
        <>
          {latest.errors.length > 0 ? (
            <div className="cs-note-box" role="status">
              This week&apos;s snapshot could not read everything: {latest.errors.join("; ")}
            </div>
          ) : null}
          <section className="cs-trend" aria-labelledby="cs-h-trend">
            <h2 id="cs-h-trend">Score by week</h2>
            <TrendView data={data} />
          </section>
          <div className="cs-cards">
            {latest.cards.map((c) => (
              <CardView key={c.id} card={c} phase={data.phase} />
            ))}
          </div>
          <HowGradingWorks phase={data.phase} />
        </>
      ) : null}
    </div>
  );
}

export function CiScorecardView() {
  const [state, setState] = useState<CiScorecardState>({ status: "loading" });

  // setState only ever runs inside promise continuations — never in the
  // synchronous body of an effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    void api<Scorecard>("/ci-scorecard?weeks=12")
      .then((data) => {
        setState({ status: "ready", data });
      })
      .catch((err: Error) => {
        setState({ status: "error", message: err.message });
      });
  }, []);

  return <CiScorecardBody state={state} />;
}
