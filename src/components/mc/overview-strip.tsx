// OverviewStrip — facts zone (StripFact children) beside the schedule-vs-work zone; props: progress counts, started/target text, subline, factColumns (2 · project, 3 · initiative).
import type { CSSProperties, ReactNode } from "react";
import { CalendarX, ChevronDown, Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { Health } from "@/lib/mc-data";

import { BUCKET_HEALTH } from "./atoms";
import { schedulePace, shortDate, type PaceKey, type SchedulePace } from "./project-overview.helpers";

export interface StripProgress {
  /** Closed (done + cancelled) share of all tasks, 0–100. */
  pct: number;
  total: number;
  done: number;
  cancelled: number;
  /** In flight (doing band). */
  doing: number;
}

const PACE_ICON: Record<PaceKey, typeof Minus> = {
  overdue: CalendarX,
  ahead: TrendingUp,
  behind: TrendingDown,
  on: Minus,
};

function paceLabel(s: SchedulePace): string {
  if (s.pace === "overdue") return `Target passed · ${s.overdueDays}d`;
  if (s.pace === "ahead") return `Ahead · +${s.delta} pts`;
  if (s.pace === "behind") return `Behind · ${s.delta} pts`;
  return "On pace";
}

export function OverviewStrip({
  children,
  progress,
  started,
  target,
  subline,
  factColumns = 2,
}: {
  children: ReactNode;
  progress: StripProgress;
  started: string;
  target: string;
  subline: ReactNode;
  factColumns?: 2 | 3;
}) {
  const today = new Date();
  const sched = schedulePace(progress.pct, started, target, today);
  const rest = Math.max(0, progress.total - progress.done - progress.cancelled - progress.doing);
  const segments = [
    ["done", progress.done],
    ["cancelled", progress.cancelled],
    ["doing", progress.doing],
    ["rest", rest],
  ] as const;
  const PaceIcon = sched ? PACE_ICON[sched.pace] : Minus;
  // The today label sits on the tick; it hides when it would crowd the end labels.
  const showToday = !!sched && sched.pace !== "overdue" && sched.frac >= 0.12 && sched.frac <= 0.84;
  const timeStyle = sched ? ({ "--pct": `${sched.elapsedPct}%`, "--frac": sched.frac } as CSSProperties) : undefined;

  return (
    <div className="pv-strip" data-testid="overview-strip">
      <div className={`pv-strip-in cols-${factColumns}`}>
        <div className="pv-facts">{children}</div>
        <div className="pv-sched">
          <div className="pv-sched-head">
            <span className="num">{progress.pct}%</span>
            <span className="lb">of work closed</span>
            {sched && (
              <>
                <span className="vs">vs</span>
                <span className="num muted">{sched.elapsedPct}%</span>
                <span className="lb">of schedule elapsed</span>
                <span className={`pv-pace ${sched.pace}`} data-testid="pace-chip">
                  <PaceIcon size={11} aria-hidden="true" />
                  {paceLabel(sched)}
                </span>
              </>
            )}
          </div>
          <div className="pv-bars">
            <span className="k">Work</span>
            <span className="pv-workbar" aria-hidden="true">
              {segments.map(([key, n]) =>
                n > 0 ? <span key={key} className={`seg ${key}`} style={{ flexGrow: n }} /> : null
              )}
            </span>
            {sched && (
              <>
                <span className="k">Time</span>
                <span className="pv-timebar" style={timeStyle} aria-hidden="true">
                  <span className="fill" />
                  <span className="tick" />
                </span>
              </>
            )}
          </div>
          {sched && (
            <div className="pv-dates" style={timeStyle}>
              <span>{shortDate(sched.started)} · started</span>
              {showToday && <span className="today">Today · {shortDate(today)}</span>}
              <span>{shortDate(sched.target)} · target</span>
            </div>
          )}
          <div className="pv-subline">{subline}</div>
        </div>
      </div>
    </div>
  );
}

/** One facts-zone cell: mono label over a value. */
export function StripFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pv-fact">
      <span className="k">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}

const HEALTH_OPTIONS: Health[] = ["track", "risk", "off"];

/** Health as an outline-pill <select> (tone border, dot, chevron). */
export function StripHealthSelect({
  value,
  onChange,
  label,
}: {
  value: Health;
  onChange: (health: Health) => void;
  label: string;
}) {
  return (
    <label className={`pv-health-select ${BUCKET_HEALTH[value]?.cls ?? "ok"}`}>
      <select value={value} onChange={(event) => onChange(event.target.value as Health)} aria-label={label}>
        {HEALTH_OPTIONS.map((h) => (
          <option key={h} value={h}>
            {BUCKET_HEALTH[h].label}
          </option>
        ))}
      </select>
      <ChevronDown size={10} className="caret" aria-hidden="true" />
    </label>
  );
}
