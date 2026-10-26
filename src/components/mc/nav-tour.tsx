"use client";

// The one-screen tour of the new navigation (TASK-3855). The shell shows it the
// first time a person turns on "Try the new navigation" (nav-zones.ts), until
// they close it: each zone of the sidebar in its order, what sits there, and
// where the switch is to go back. A shell-owned layer (use-layer.ts): Esc and
// Got it close it, focus moves in and then back to the account menu, and Tab
// stays inside. Skinned with the New … modals' .ntm card (mc-authoring.css).
import { useRef } from "react";

import { closeNavTour } from "./nav-zones";
import { useLayer } from "./use-layer";

export interface TourPoint {
  zone: string;
  text: string;
  /** The sidebar labels the text names (tests/mc-nav-switch.test.ts keeps them real). */
  labels: string[];
}

export const TOUR_POINTS: readonly TourPoint[] = [
  { zone: "My work", text: "Home, My tasks and Approvals stay on top.", labels: ["Home", "My tasks", "Approvals"] },
  {
    zone: "Starred",
    text: "Star a project, initiative, report or screen to keep it here, on every device. Press g then its digit to open it.",
    labels: [],
  },
  {
    zone: "Plan",
    text: "All work holds Board, List and Timeline as tabs. Projects opens the project dashboard; every project is listed under it, A to Z.",
    labels: ["All work", "Projects"],
  },
  {
    zone: "Reporting",
    text: "Dashboard, Insights, Goals & production and AI spend.",
    labels: ["Dashboard", "Insights", "Goals & production", "AI spend"],
  },
  {
    zone: "Admin & health",
    text: "Operations, Sync and data, and Engineering, at the foot of the sidebar.",
    labels: ["Operations", "Sync and data", "Engineering"],
  },
  { zone: "Search", text: "⌘K opens on the pages you opened last.", labels: [] },
];

export function NavTour() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const done = () => closeNavTour();
  const { onKeyDown } = useLayer(true, done, panelRef);
  return (
    <div className="ntm-overlay" onClick={done}>
      <div
        ref={panelRef}
        className="ntm nav-tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mc-nav-tour-h"
        data-testid="nav-tour"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="ntm-head">
          <div>
            <span className="kk">New navigation</span>
            <h2 id="mc-nav-tour-h">
              Here is what <em>moved</em>
            </h2>
          </div>
          <button type="button" className="ntm-x" onClick={done} aria-label="Close the tour" title="Close (Esc)">
            ✕
          </button>
        </div>
        <ul className="ntm-body nav-tour-points">
          {TOUR_POINTS.map((point) => (
            <li key={point.zone}>
              <b>{point.zone}</b>
              <span>{point.text}</span>
            </li>
          ))}
        </ul>
        <div className="ntm-foot">
          <span className="ntm-hint">Switch back at any time from the account menu.</span>
          <div className="ntm-acts">
            <button type="button" className="btn ghost" onClick={() => closeNavTour({ switchBack: true })}>
              Switch back
            </button>
            <button type="button" className="btn acc" data-autofocus onClick={done}>
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
