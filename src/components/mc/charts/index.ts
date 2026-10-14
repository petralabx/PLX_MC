// charts/ barrel — the native-SVG primitives + the shared ChartSlice type
// (SPEC §3.B.1). Import the charts through here, not the internal files (module
// boundary, CLAUDE.md). ChartSlice is re-exported from the aggregator so the
// charts and the screen share one slice contract (type-only — no runtime cycle).

export { StatusDonut } from "./donut";
export { CategoryBar } from "./bar";
export { StatusLegend } from "./legend";
export { RunningLines, StackedColumns, niceMax, ticksFor } from "./column-chart";
export type { ChartKey, ColumnAxis, LineSeries, StackSegment } from "./column-chart";
export type { ChartSlice } from "@/lib/mc-data/insights";
