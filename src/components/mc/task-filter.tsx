// TaskFilter — the Outstanding · Needs a human · All segmented switch; props: value, counts (from filterCounts), onChange.
import { Hand } from "lucide-react";

import type { TaskFilterKey } from "./project-overview.helpers";

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
