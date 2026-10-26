// The star toggle (TASK-3842): stars or unstars one screen, report, project or
// initiative for the signed-in person (use-stars.ts). A toggle button: its
// name stays "Star <label>" and aria-pressed says whether it is starred.
// Disabled while the stars load.
import { Star } from "lucide-react";

import type { StarKey } from "@/lib/stars";

import type { Stars } from "./use-stars";

export function StarToggle({
  stars,
  starKey,
  label,
  className,
  tabIndex,
}: {
  stars: Stars;
  starKey: StarKey;
  label: string;
  className: string;
  /** -1 in the sidebar: a row's star stays out of the Tab order, and Shift S stars the row. */
  tabIndex?: number;
}) {
  const on = stars.starred(starKey);
  return (
    <button
      type="button"
      className={`${className} star-toggle`}
      aria-label={`Star ${label}`}
      aria-pressed={on}
      title={on ? "Unstar" : stars.full ? "Starred is full: unstar one to add another" : "Star"}
      tabIndex={tabIndex}
      disabled={!stars.ready}
      onClick={() => stars.toggle(starKey)}
    >
      <Star className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />
    </button>
  );
}
