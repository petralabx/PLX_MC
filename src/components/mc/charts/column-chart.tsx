"use client";

// charts/column-chart.tsx — two native-SVG charts over one column axis (a day
// of the month, or a month): StackedColumns (stacked bars, an optional dashed
// target line) and RunningLines (running totals, solid or dashed, a step line
// for targets). They share one frame: the plot is an SVG stretched to the card
// (preserveAspectRatio="none", non-scaling strokes), while every label is HTML
// positioned in percentages, so text stays legible from 393 px to desktop.
// Shaded columns (weekends, holidays), a marker column ("Today") and a hover
// read-out per column. The frame is role="img" with a one-sentence summary;
// the caller renders the full numbers as a table beside it (text alternative).
// Tokens only: every colour is a var(--p-*) passed in by the caller.

import { useState, type ReactNode } from "react";

export interface ColumnAxis {
  key: string;
  /** Axis label, shown for every column or only on `tick` columns. */
  label: string;
  tick?: boolean;
  /** Greyed band behind the column (weekend, holiday). */
  shaded?: boolean;
}

export interface ChartKey {
  label: string;
  colorVar: string;
  kind: "bar" | "line" | "dashed";
}

interface FrameProps {
  summary: string;
  axis: readonly ColumnAxis[];
  yMax: number;
  yTicks: readonly number[];
  formatY: (value: number) => string;
  /** Index of the column to mark (e.g. today), with its label. */
  marker?: { index: number; label: string } | null;
  keys: readonly ChartKey[];
  /** The hover read-out for one column. */
  readout?: (index: number) => ReactNode;
  children: ReactNode;
}

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const NICE_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];
const ROUND_STEPS = [1, 2, 2.5, 5];

/** A round axis maximum at or above `max`, close enough not to waste the plot; counts up to 6 are exact. */
export function niceMax(max: number, integer = false): number {
  if (!(max > 0)) return 1;
  if (integer && max <= 6) return Math.ceil(max);
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of integer ? NICE_COUNTS : NICE) if (m * exp >= max) return m * exp;
  return 10 * exp;
}

function isRoundStep(step: number, integer: boolean): boolean {
  if (!(step > 0) || (integer && !Number.isInteger(step))) return false;
  const exp = Math.pow(10, Math.floor(Math.log10(step)));
  return ROUND_STEPS.includes(Math.round((step / exp) * 1000) / 1000);
}

/** Ticks from 0 to `max` (inclusive) on a round step (1, 2, 2.5 or 5 × 10ⁿ); counts use whole numbers. */
export function ticksFor(max: number, integer = false): number[] {
  if (integer && max <= 6) return Array.from({ length: max + 1 }, (_, i) => i);
  const count = [4, 5, 6, 3, 2].find((c) => isRoundStep(max / c, integer)) ?? 4;
  return Array.from({ length: count + 1 }, (_, i) => (max * i) / count);
}

const y = (value: number, yMax: number) => 100 - (Math.max(0, value) / yMax) * 100;

function ChartFrame({ summary, axis, yMax, yTicks, formatY, marker, keys, readout, children }: FrameProps) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(axis.length, 1);
  const centre = (i: number) => `${((i + 0.5) / n) * 100}%`;
  return (
    <div className="colchart">
      <div className="colchart-body">
        <div className="colchart-y" aria-hidden="true">
          {yTicks.map((t) => (
            <span key={t} style={{ bottom: `${(t / yMax) * 100}%` }}>
              {formatY(t)}
            </span>
          ))}
        </div>
        <div
          className="colchart-plot"
          role="img"
          aria-label={summary}
          // A touch "leaves" as the finger lifts: keep a tapped read-out until the next tap.
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setHover(null);
          }}
        >
          <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {axis.map((col, i) =>
              col.shaded ? <rect key={col.key} className="shade" x={i} y={0} width={1} height={100} /> : null
            )}
            {yTicks.map((t) => (
              <line key={t} className="grid" x1={0} x2={n} y1={y(t, yMax)} y2={y(t, yMax)} />
            ))}
            {children}
            {marker ? (
              <line className="marker" x1={marker.index + 0.5} x2={marker.index + 0.5} y1={0} y2={100} />
            ) : null}
            {readout
              ? axis.map((col, i) => (
                  <rect
                    key={col.key}
                    className="hit"
                    x={i}
                    y={0}
                    width={1}
                    height={100}
                    onPointerEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                  />
                ))
              : null}
          </svg>
          {marker ? (
            <span className="colchart-marker" style={{ left: centre(marker.index) }} aria-hidden="true">
              {marker.label}
            </span>
          ) : null}
          {readout && hover !== null ? (
            <div
              className={`colchart-tip${hover >= n / 2 ? " left" : ""}`}
              style={{ left: centre(hover) }}
              aria-hidden="true"
            >
              {readout(hover)}
            </div>
          ) : null}
        </div>
        <div className="colchart-x" aria-hidden="true">
          {axis.map((col, i) =>
            col.tick === false ? null : (
              <span key={col.key} style={{ left: centre(i) }}>
                {col.label}
              </span>
            )
          )}
        </div>
      </div>
      <ul className="colchart-keys">
        {keys.map((k) => (
          <li key={k.label}>
            <span className={`sw ${k.kind}`} style={{ color: k.colorVar, background: k.kind === "bar" ? k.colorVar : undefined }} aria-hidden="true" />
            {k.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface StackSegment {
  key: string;
  value: number;
  colorVar: string;
}

export function StackedColumns({
  summary,
  axis,
  stacks,
  keys,
  formatY = (v) => v.toLocaleString("en-US"),
  target,
  marker,
  faded,
  readout,
}: {
  summary: string;
  axis: readonly ColumnAxis[];
  /** One stack per axis column, bottom segment first. */
  stacks: readonly (readonly StackSegment[])[];
  keys: readonly ChartKey[];
  formatY?: (value: number) => string;
  /** A dashed horizontal target line. */
  target?: { value: number; colorVar: string } | null;
  marker?: { index: number; label: string } | null;
  /** Columns drawn lighter (e.g. a projected month). */
  faded?: ReadonlySet<number>;
  readout?: (index: number) => ReactNode;
}) {
  const tallest = Math.max(0, ...stacks.map((s) => s.reduce((sum, seg) => sum + Math.max(0, seg.value), 0)), target?.value ?? 0);
  const integer = stacks.every((s) => s.every((seg) => Number.isInteger(seg.value)));
  const yMax = niceMax(tallest, integer);
  const n = axis.length;
  return (
    <ChartFrame
      summary={summary}
      axis={axis}
      yMax={yMax}
      yTicks={ticksFor(yMax, integer)}
      formatY={formatY}
      marker={marker}
      keys={keys}
      readout={readout}
    >
      {stacks.map((stack, i) => {
        let base = 0;
        return (
          <g key={axis[i]?.key ?? i} className={faded?.has(i) ? "faded" : undefined}>
            {stack.map((seg) => {
              if (seg.value <= 0) return null;
              const top = base + seg.value;
              const height = y(base, yMax) - y(top, yMax);
              // A surface-coloured edge keeps stacked segments apart, whatever their colours.
              // A sliver (under 2% of the plot) keeps its fill instead, so the edge never hides it.
              const edge = height >= 2 ? { stroke: "var(--p-paper)", strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" as const } : null;
              const rect = (
                <rect key={seg.key} x={i + 0.15} width={0.7} y={y(top, yMax)} height={height} fill={seg.colorVar} {...edge} />
              );
              base = top;
              return rect;
            })}
          </g>
        );
      })}
      {target ? (
        <line
          className="dashed"
          x1={0}
          x2={n}
          y1={y(target.value, yMax)}
          y2={y(target.value, yMax)}
          stroke={target.colorVar}
        />
      ) : null}
    </ChartFrame>
  );
}

export interface LineSeries {
  key: string;
  /** One value per axis column; null leaves a gap (e.g. days still to come). */
  values: readonly (number | null)[];
  colorVar: string;
  dashed?: boolean;
  /** Draw as steps (flat across each column) instead of joining column centres. */
  step?: boolean;
}

function linePoints(series: LineSeries, yMax: number): string[] {
  const runs: string[] = [];
  let current: string[] = [];
  const close = () => {
    // A polyline with one point paints nothing (e.g. Sage on the 1st of the
    // month): draw it as a short flat segment across its column instead.
    if (current.length === 1) {
      const [x, yy] = current[0].split(",").map(Number);
      current = [`${x - 0.3},${yy}`, `${x + 0.3},${yy}`];
    }
    if (current.length) runs.push(current.join(" "));
    current = [];
  };
  series.values.forEach((value, i) => {
    if (value === null) {
      close();
      return;
    }
    const yy = y(value, yMax);
    if (series.step) current.push(`${i},${yy}`, `${i + 1},${yy}`);
    else current.push(`${i + 0.5},${yy}`);
  });
  close();
  return runs;
}

export function RunningLines({
  summary,
  axis,
  series,
  keys,
  formatY = (v) => v.toLocaleString("en-US"),
  marker,
  readout,
}: {
  summary: string;
  axis: readonly ColumnAxis[];
  series: readonly LineSeries[];
  keys: readonly ChartKey[];
  formatY?: (value: number) => string;
  marker?: { index: number; label: string } | null;
  readout?: (index: number) => ReactNode;
}) {
  const highest = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const yMax = niceMax(highest);
  return (
    <ChartFrame
      summary={summary}
      axis={axis}
      yMax={yMax}
      yTicks={ticksFor(yMax)}
      formatY={formatY}
      marker={marker}
      keys={keys}
      readout={readout}
    >
      {series.map((s) =>
        linePoints(s, yMax).map((points, r) => (
          <polyline
            key={`${s.key}-${r}`}
            className={s.dashed ? "line dashed" : "line"}
            points={points}
            stroke={s.colorVar}
            fill="none"
          />
        ))
      )}
    </ChartFrame>
  );
}
