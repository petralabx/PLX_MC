// Screen registry — the shell renders SCREENS[route.screen].
// Each screen lane replaces exactly its own entries (import + map line) and
// touches nothing else in this file; unbuilt screens fall back to ComingSoon.
import type { ComponentType } from "react";

import { InboxView } from "./inbox";
import type { Screen, ScreenProps } from "./route";
import { TaskDetailView } from "./task-detail";
import { WorkViews } from "./work-views";

const SCREEN_TITLES: Record<Screen, string> = {
  home: "Inbox",
  board: "Board",
  list: "List",
  timeline: "Timeline",
  matrix: "Traceability",
  feed: "Agent activity",
  bucket: "Initiative",
  repos: "Repos",
  files: "Files",
  sync: "Sync console",
  task: "Task detail",
};

function comingSoon(screen: Screen): ComponentType<ScreenProps> {
  function ComingSoon() {
    return (
      <div className="mc-main">
        <div className="ph">
          <div>
            <span className="kk">Mission Control</span>
            <h1>{SCREEN_TITLES[screen]}</h1>
            <p className="sub">This screen is part of the build, but isn&apos;t implemented yet.</p>
          </div>
        </div>
        <div className="notbuilt">
          <p className="lead">
            {SCREEN_TITLES[screen]} is rebuilt in a later increment, screen by screen, from the
            design handoff.
          </p>
          <p className="ref">
            spec · docs/product/README.md §6 · docs/product/screenshots/SCREENS.md
          </p>
        </div>
      </div>
    );
  }
  ComingSoon.displayName = `ComingSoon(${screen})`;
  return ComingSoon;
}

export const SCREENS: Record<Screen, ComponentType<ScreenProps>> = {
  home: InboxView,
  board: WorkViews,
  list: WorkViews,
  timeline: WorkViews,
  matrix: comingSoon("matrix"),
  feed: comingSoon("feed"),
  bucket: comingSoon("bucket"),
  repos: comingSoon("repos"),
  files: comingSoon("files"),
  sync: comingSoon("sync"),
  task: TaskDetailView,
};
