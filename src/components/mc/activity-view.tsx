"use client";

// Activity screen (/?screen=activity, sidebar: System of record → Repo
// activity) — read-only cross-repo coverage over the fleet registry: last
// activity, open/unstamped PRs, merged PRs no MC task claims (nightly
// backfill), gate block rate, and data freshness (GET /api/activity), plus
// per-runtime agent outcomes (GET /api/agent-metrics). A dash means MC has no
// signal for that repo — never a fabricated zero.

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { RepoActivityReport, RepoActivityRow } from "@/lib/compliance";
import type { AgentOutcomeMetrics } from "@/lib/routing/outcomes";

import {
  fmtAge,
  fmtDuration,
  fmtRate,
  freshnessTone,
  hasActivitySignal,
} from "./activity-view.helpers";

export type ActivityState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: RepoActivityReport };

function ActivityRowView({ row, now }: { row: RepoActivityRow; now?: Date }) {
  const [open, setOpen] = useState(false);
  const unattributed = row.unattributed;
  const degraded = unattributed?.status === "degraded";
  const openItems = row.openPrs?.items ?? [];
  const hasDetail = (unattributed?.items.length ?? 0) > 0 || openItems.length > 0;
  return (
    <div className="repo-row activity-row">
      <button type="button" className="rh" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="glyph">↯</span>
        <span>
          <span className="nm">{row.displayName}</span>
          <span className="lang">
            {row.repo} · last activity {fmtAge(row.lastActivityAt, now)}{" "}
            <span className={`pill ${freshnessTone(row.freshness)}`}>
              <span className="dot" />
              {row.freshness}
            </span>
          </span>
        </span>
        <span className="ct">
          <b>{row.openPrs ? row.openPrs.unstamped : "—"}</b> unstamped /{" "}
          {row.openPrs ? row.openPrs.open : "—"} open
        </span>
        <span className="ct">
          <b>{unattributed && !degraded ? unattributed.count : "—"}</b> unattributed
          {degraded ? ` · degraded · ${unattributed.reason ?? "unknown"}` : ""}
        </span>
        <span className="ct">
          <b>{fmtRate(row.gate.blockRate)}</b> gate blocked · {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="rbody">
          <div className="colempty">
            Gate verdicts: {row.gate.passed} passed · {row.gate.blocked} blocked
            {unattributed?.truncated ? " · backfill page cap hit (older merges not listed)" : ""}
          </div>
          {unattributed?.items.map((item) => (
            <a
              className="ritem"
              key={`u-${item.number}`}
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="id">#{item.number}</span>
              <span>{item.title}</span>
              <span className="pill hot">
                <span className="dot" />
                {item.reason === "no_stamp" ? "no stamp" : "stamp unresolved"}
              </span>
              <span className="id">
                {item.author} · merged {fmtAge(item.mergedAt, now)}
              </span>
            </a>
          ))}
          {openItems.map((item) => (
            <a
              className="ritem"
              key={`o-${item.pr}`}
              href={`https://github.com/${row.repo}/pull/${encodeURIComponent(item.pr)}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="id">#{item.pr}</span>
              <span>{item.title || "(untitled)"}</span>
              <span className={`pill ${item.stamped ? "ok" : "warn"}`}>
                <span className="dot" />
                {item.stamped ? "open · stamped" : "open · unstamped"}
              </span>
              <span className="id">{fmtAge(item.at, now)}</span>
            </a>
          ))}
          {!hasDetail && <div className="colempty">No open or unattributed pull requests.</div>}
        </div>
      )}
    </div>
  );
}

/** Presentational body — one distinct view per state. Exported for the render test. */
export function ActivityBody({
  state,
  onRetry,
  now,
}: {
  state: ActivityState;
  onRetry: () => void;
  now?: Date;
}) {
  if (state.status === "loading") {
    return (
      <div className="ll-loading" aria-label="Loading repo activity">
        Loading repo activity…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="ll-err" role="alert">
        {state.message}{" "}
        <button type="button" className="btn ghost sm" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  const { report } = state;
  if (!hasActivitySignal(report)) {
    return (
      <div className="ll-empty">
        No activity recorded yet for the {report.repos.length} registry repos. MC events arrive
        through the GitHub App webhook and the compliance gate; the nightly backfill of
        unattributed merges stays off until PLX_MC_GITHUB_BACKFILL_ENABLED=1.
      </div>
    );
  }
  return (
    <>
      <div className="bh sec">
        <span className="kk">
          / Registry · {report.repos.length} repos · gate window {report.gateWindowDays}d
        </span>
        <span className="kk">
          Events through {fmtAge(report.events.newestAt, now)}
          {report.events.truncated ? ` · newest ${report.events.sampled} events` : ""} · Backfill{" "}
          {report.backfill.generatedAt
            ? `${fmtAge(report.backfill.generatedAt, now)} (${report.backfill.windowDays ?? "?"}d window)`
            : "never run"}
          {report.backfill.stale && (
            <>
              {" "}
              <span className="pill warn">
                <span className="dot" />
                backfill stale
              </span>
            </>
          )}
        </span>
      </div>
      <div className="repos" data-testid="activity-rows">
        {report.repos.map((row) => (
          <ActivityRowView key={row.repo} row={row} now={now} />
        ))}
      </div>
    </>
  );
}

function AgentOutcomes({
  outcomes,
  error,
}: {
  outcomes: AgentOutcomeMetrics[] | null;
  error: string | null;
}) {
  return (
    <>
      <div className="bh sec">
        <span className="kk">/ Agent outcomes · by runtime</span>
        <span className="kk">checkout → complete</span>
      </div>
      {error && (
        <div className="ll-err" role="alert">
          {error}
        </div>
      )}
      {!error && outcomes === null && (
        <div className="ll-loading" aria-label="Loading agent outcomes">
          Loading agent outcomes…
        </div>
      )}
      {!error && outcomes?.length === 0 && (
        <div className="ll-empty">No agent checkouts recorded yet.</div>
      )}
      {!error && outcomes && outcomes.length > 0 && (
        <div className="repos">
          <div className="repo-row activity-row">
            <div className="rbody">
              {outcomes.map((o) => (
                <div className="ritem" key={o.runtime}>
                  <span className="id">{o.runtime}</span>
                  <span>
                    {o.checkouts} checkouts · {o.completed} completed · success{" "}
                    {fmtRate(o.successRate)} · rework {fmtRate(o.reworkRate)} · median cycle{" "}
                    {fmtDuration(o.medianCycleMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// This screen consumes neither `route` nor `nav`; the registry types it as
// ComponentType<ScreenProps>, which accepts a zero-arg component.
export function ActivityView() {
  const [state, setState] = useState<ActivityState>({ status: "loading" });
  const [outcomes, setOutcomes] = useState<AgentOutcomeMetrics[] | null>(null);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);

  // setState only runs inside promise continuations — never synchronously in
  // the effect body (react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      Promise.all([
        api<RepoActivityReport>("/activity")
          .then((report) => setState({ status: "ready", report }))
          .catch((err: Error) => setState({ status: "error", message: err.message })),
        api<{ outcomes: AgentOutcomeMetrics[] }>("/agent-metrics")
          .then((data) => {
            setOutcomes(data.outcomes);
            setOutcomesError(null);
          })
          .catch((err: Error) => setOutcomesError(err.message)),
      ]),
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  const reload = () => {
    setState({ status: "loading" });
    setOutcomes(null);
    setOutcomesError(null);
    void load();
  };

  return (
    <div className="mc-main" data-testid="activity-screen">
      <div className="ph">
        <div>
          <span className="kk">System of record · fleet coverage</span>
          <h1>
            Repo <em>activity</em>
          </h1>
          <p className="sub">
            Every repo in the fleet registry — when MC last heard from it, open PRs without an MC
            stamp, merged PRs no task claims, and how often the compliance gate blocks. A dash
            means MC has no signal for that repo, not zero.
          </p>
        </div>
        <div className="r">
          <button
            type="button"
            className="btn ghost sm"
            onClick={reload}
            disabled={state.status === "loading"}
          >
            Refresh ↻
          </button>
        </div>
      </div>
      <ActivityBody state={state} onRetry={reload} />
      <AgentOutcomes outcomes={outcomes} error={outcomesError} />
    </div>
  );
}
