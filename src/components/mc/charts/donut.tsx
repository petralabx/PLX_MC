// charts/donut.tsx — a generic native-SVG donut (NO chart lib; the zero-lib
// stroke-dasharray/offset idiom, same family as the Confidence conic ring in
// atoms.tsx). Arc segments are drawn on a shared-radius <circle>; the center
// <text> shows the total KPI. Each arc is a real focusable <button>-role element
// carrying its own aria-label + <title> (SPEC §3.B.4 a11y). Tokens only — fills
// are the slice's --p-* colorVar; the empty/zero track is --p-grid.
//
// Positioning vs. reveal are separated so the reduced-motion animation is a
// single universal keyframe: each arc is POSITIONED by a per-arc rotate()
// (transform), and the grow-in is a stroke-dashoffset reveal from `dash`
// (hidden) → 0 (shown). The final state (offset 0) is the default OUTSIDE the
// reduced-motion query, so reduced-motion users get the full arc instantly
// (SPEC §3.B.4).

import type { CSSProperties } from "react";

import type { ChartSlice } from "@/lib/mc-data/insights";

import { GRID_COLOR_VAR } from "./chart-tokens";

// Geometry: a fixed viewBox; width="100%" + viewBox keeps the donut responsive
// (no fixed pixel width — SPEC §3.B.4).
const SIZE = 180;
const CENTER = SIZE / 2;
const RADIUS = 70;
const STROKE = 26;
const CIRC = 2 * Math.PI * RADIUS;

export function StatusDonut({
  slices,
  total,
  label,
  onSlice,
}: {
  slices: ChartSlice[];
  total: number;
  label: string;
  onSlice?: (slice: ChartSlice) => void;
}) {
  // Summary label for the whole chart (role="img") — e.g.
  // "Status: 12 To do, 8 In progress, 5 Done".
  const summary = `${label}: ${slices.map((s) => `${s.value} ${s.label}`).join(", ")}`;
  const interactive = !!onSlice;

  // Walk the slices accumulating a fraction so each arc rotates to start where
  // the previous ended. A zero-total donut draws only the neutral track (no
  // NaN paths, no arcs).
  let accFrac = 0;

  return (
    <div className="donut">
      {/* role="img" would mark children presentational, which is invalid when the
          arcs are focusable role="button" filters (axe nested-interactive) — an
          interactive donut is a labelled GROUP of controls, not a static image. */}
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        role={interactive ? "group" : "img"}
        aria-label={summary}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Track ring — always drawn, so a zero-total or partial donut still
            reads as a ring rather than a gap. */}
        <circle
          className="track"
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={GRID_COLOR_VAR}
          strokeWidth={STROKE}
        />
        {total > 0 &&
          slices.map((slice) => {
            if (slice.value <= 0) return null;
            const frac = slice.value / total;
            const dash = frac * CIRC;
            // Position: rotate this arc by its start fraction. -90° puts 0% at
            // 12 o'clock; transform-origin is the circle center (set in CSS).
            const rotateDeg = -90 + accFrac * 360;
            accFrac += frac;
            // dasharray "<dash> <rest>" so exactly this arc's length is painted;
            // --arc-dash feeds the reduced-motion reveal keyframe (from: dash → to: 0).
            const dashArray = `${dash} ${CIRC - dash}`;
            return (
              <circle
                key={slice.key}
                className="arc"
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={slice.colorVar}
                strokeWidth={STROKE}
                strokeLinecap="butt"
                strokeDasharray={dashArray}
                style={
                  {
                    transform: `rotate(${rotateDeg}deg)`,
                    "--arc-dash": String(dash),
                  } as CSSProperties
                }
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={
                  interactive ? `Filter to ${slice.label} — ${slice.value} tasks` : undefined
                }
                onClick={interactive ? () => onSlice(slice) : undefined}
                onKeyDown={
                  interactive
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSlice(slice);
                        }
                      }
                    : undefined
                }
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            );
          })}
        {/* Center KPI — the total. tabular-nums via the .donut .total skin. */}
        <text className="total" x={CENTER} y={CENTER} textAnchor="middle">
          {total}
        </text>
        <text className="total-cap" x={CENTER} y={CENTER + 20} textAnchor="middle">
          tasks
        </text>
      </svg>
    </div>
  );
}
