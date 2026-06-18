"use client";

// Insights view (SPEC §3.B / Module E) — a native-SVG, current-state read over
// allTasks(): a status donut + total KPI, an overdue KPI, and by-Initiative,
// by-Assignee, by-Priority bars, all driven by the pure buildInsights aggregator.
// Every status/priority/assignee segment is click-to-filter: the click writes a
// FilterState into route.filter and navigates to the board, where WorkViews
// adopts it through F's sanitizeFilterState (the F↔E trust boundary, §3.B.3).
// Workspace-wide (no incoming filter), like the board's default.

import { useMemo } from "react";

import { useMcVersion } from "@/lib/mc-data/hooks";
import { INSIGHTS_TODAY_DAY, buildInsights } from "@/lib/mc-data/insights";
import type { ChartSlice } from "@/lib/mc-data/insights";
import { allBuckets, allTasks } from "@/lib/mc-data/store";

import { CategoryBar, StatusDonut, StatusLegend } from "./charts";
import type { ScreenProps } from "./route";

export function InsightsView({ nav }: ScreenProps) {
  // Re-aggregate after any store mutation (a drag/inline edit on the board flows
  // straight through to these counts). buildInsights is pure + deterministic and
  // uses the injected INSIGHTS_TODAY_DAY grid cursor — never a live clock (§1.1).
  const version = useMcVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildInsights(allTasks(), INSIGHTS_TODAY_DAY, allBuckets()), [version]);

  // STATUS / PRIORITY / ASSIGNEE apply a FilterState and navigate; BUCKET is a
  // board AXIS, not a FilterState facet, so it navigates by route param.
  // OVERDUE/TOTAL KPIs are display-only in Cycle-2 (see SPEC §3.B.5). This
  // comment is the documented asymmetry — do NOT fork the filter contract with a
  // `bucket` facet.
  const onSlice = (kind: "status" | "priority" | "assignee" | "bucket", slice: ChartSlice) => {
    if (kind === "bucket") {
      nav("board", { bucketId: slice.key }); // board axis, not a filter
      return;
    }
    if (slice.filter) nav("board", { filter: slice.filter }); // sanitized on adopt by WorkViews
  };

  return (
    <div className="mc-main">
      <div className="ph" style={{ paddingBottom: 14 }}>
        <div>
          <span className="kk">Insights</span>
          <h1>
            A read on the <em>work</em>
          </h1>
          <p className="sub">
            Current-state breakdowns across every initiative — click any segment to drill into the board.
          </p>
        </div>
      </div>

      {/* With zero tasks the KPIs/donut/bars would render as a silent wall of 0s
          (reads as a failed load, not a "no data" state). Insights is workspace-
          wide with no incoming filter, so an empty workspace is genuinely "no
          tasks yet" — show a calm message + a path back, mirroring the board's
          .empty block, and render the data surfaces only when there's data. */}
      {model.total === 0 ? (
        <div className="empty">
          <h3>Nothing to chart yet</h3>
          <p>Insights breaks down the work across every initiative. Once there are tasks, the status donut and breakdown bars appear here.</p>
          <div className="acts">
            <button type="button" className="btn ghost" onClick={() => nav("board")}>
              Go to the board
            </button>
          </div>
        </div>
      ) : (
      <div className="insights">
        {/* KPI strip — Total · Overdue · Unassigned · Blocked. KPIs that map cleanly
            to a facet are clickable; Total/Overdue are display-only in Cycle-2
            (overdue needs G's due-range to express as a filter — SPEC §3.B.5). */}
        <div className="kpis">
          <div className="kpi">
            <span className="v">{model.total}</span>
            <span className="k">Total tasks</span>
          </div>
          <div className={`kpi${model.overdue > 0 ? " hot" : ""}`}>
            <span className="v">{model.overdue}</span>
            <span className="k">Overdue</span>
          </div>
          <button
            type="button"
            className="kpi clickable"
            disabled={model.unassigned === 0}
            aria-label={model.unassigned > 0 ? `Filter to unassigned — ${model.unassigned} tasks` : undefined}
            onClick={() => {
              const slice = model.byAssignee.find((s) => s.key === "unassigned");
              if (slice) onSlice("assignee", slice);
            }}
          >
            <span className="v">{model.unassigned}</span>
            <span className="k">Unassigned</span>
          </button>
          <div className={`kpi${model.blocked > 0 ? " warn" : ""}`}>
            <span className="v">{model.blocked}</span>
            <span className="k">Blocked</span>
          </div>
        </div>

        <div className="chartgrid">
          <div className="chartcard donutcard">
            <div className="chartcard-title">Status</div>
            <div className="donutwrap">
              <StatusDonut
                slices={model.byStatus}
                total={model.total}
                label="Status"
                onSlice={(slice) => onSlice("status", slice)}
              />
              <StatusLegend slices={model.byStatus} onSlice={(slice) => onSlice("status", slice)} />
            </div>
          </div>

          <div className="chartcard">
            <CategoryBar
              title="By initiative"
              slices={model.byBucket}
              onSlice={(slice) => onSlice("bucket", slice)}
            />
          </div>

          <div className="chartcard">
            <CategoryBar
              title="By assignee"
              slices={model.byAssignee}
              onSlice={(slice) => onSlice("assignee", slice)}
            />
          </div>

          <div className="chartcard">
            <CategoryBar
              title="By priority"
              slices={model.byPriority}
              onSlice={(slice) => onSlice("priority", slice)}
            />
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
