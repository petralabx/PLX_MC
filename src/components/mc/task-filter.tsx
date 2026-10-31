// TaskFilter — the Outstanding · Needs a human · All segmented switch; props: value, counts (from filterCounts), onChange.
import { Hand } from "lucide-react";

import { DUE_FILTERS, type DueFilterKey, type TaskFilterKey } from "./project-overview.helpers";

const SEGMENTS: Array<{ key: TaskFilterKey; long: string; short: string }> = [
  { key: "open", long: "Outstanding", short: "Open" },
  { key: "human", long: "Needs a human", short: "Human" },
  { key: "all", long: "All", short: "All" },
];

export function TaskFilter({
  value,
  counts,
  onChange,
}: {
  value: TaskFilterKey;
  counts: Record<TaskFilterKey, number>;
  onChange: (filter: TaskFilterKey) => void;
}) {
  return (
    <div className="pv-filter" role="group" aria-label="Task filter">
      {SEGMENTS.map((seg) => (
        <button
          type="button"
          key={seg.key}
          className={value === seg.key ? "on" : ""}
          aria-pressed={value === seg.key}
          onClick={() => onChange(seg.key)}
        >
          {seg.key === "human" && <Hand size={11} aria-hidden="true" />}
          <span className="long">{seg.long}</span>
          <span className="short">{seg.short}</span> · {counts[seg.key]}
        </button>
      ))}
    </div>
  );
}

/** The Due control beside the task filter (TASK-4392): one choice, each with its count. */
export function DueFilter({
  value,
  counts,
  onChange,
}: {
  value: DueFilterKey;
  counts: Record<DueFilterKey, number>;
  onChange: (due: DueFilterKey) => void;
}) {
  return (
    <label className={value === "any" ? "pv-duefilter" : "pv-duefilter on"}>
      <span>Due</span>
      <select value={value} onChange={(event) => onChange(event.target.value as DueFilterKey)} data-testid="project-due-filter">
        {DUE_FILTERS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.key === "any" ? f.label : `${f.label} · ${counts[f.key]}`}
          </option>
        ))}
      </select>
    </label>
  );
}
