// Routing contract for Mission Control screens (the prototype's `route`
// object + `nav()` made typed). Screens receive { route, nav } and navigate
// with nav(screen, { bucketId?, taskId? }).

import type { FilterState } from "./work-views.helpers";

export type Screen =
  | "home"
  | "board"
  | "list"
  | "timeline"
  | "mine"
  | "insights"
  | "matrix"
  | "feed"
  | "bucket"
  | "repos"
  | "files"
  | "sync"
  | "intake"
  | "task"
  | "loop-ledgers";

export interface Route {
  screen: Screen;
  bucketId?: string;
  taskId?: string;
  // Module E (SPEC §3.B.3): an Insights chart segment click navigates to the
  // board carrying a FilterState here; WorkViews adopts it on mount/route change
  // through F's sanitizeFilterState. Optional, so all existing nav() sites carry
  // it with zero edits (Nav's `Omit<Route, "screen">` already accepts it).
  filter?: FilterState;
}

export type Nav = (screen: Screen, extra?: Omit<Route, "screen">) => void;

export interface ScreenProps {
  route: Route;
  nav: Nav;
}
