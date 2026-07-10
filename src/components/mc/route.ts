// Routing contract for Mission Control screens (the prototype's `route`
// object + `nav()` made typed). Screens receive { route, nav } and navigate
// with nav(screen, { bucketId?, taskId? }).

import type { FilterState } from "./work-views.helpers";

// Runtime list of screens (P3 deep links): the URL parser validates the
// `screen` query param against this, so unknown values fall back to "home".
// The Screen type is derived from it — same union as before, single source.
export const SCREEN_VALUES = [
  "home",
  "board",
  "list",
  "timeline",
  "mine",
  "insights",
  "matrix",
  "feed",
  "bucket",
  "project",
  "repos",
  "files",
  "sync",
  "intake",
  "task",
  "loop-ledgers",
  "governance-sops",
  "skills-directory",
  "ai-spend",
] as const;

export type Screen = (typeof SCREEN_VALUES)[number];

export interface Route {
  screen: Screen;
  projectId?: string;
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

// ── Route ⇄ URL (P3 deep links) ──────────────────────────────────────────────
// The whole app lives on "/" (a single client shell), so routes serialize to
// query params on that path: `/?screen=task&taskId=TASK-221`. "home" is the
// default and serializes to a bare "/". The transient `filter` field is NOT
// serialized (see NOTES.md in the phase artifacts): it is a complex nested
// object carried by one Insights → Board hand-off, not a shareable location.

const ENTITY_PARAMS = ["projectId", "bucketId", "taskId"] as const;

/** Serialize a Route to a path + query string ("/", "/?screen=board", …). */
export function routeToUrl(route: Route): string {
  const params = new URLSearchParams();
  if (route.screen !== "home") params.set("screen", route.screen);
  for (const key of ENTITY_PARAMS) {
    const value = route[key];
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

/**
 * Parse a URL (full href, path + query, or a bare `location.search` string
 * starting with "?") back into a Route. Anything unknown or malformed falls
 * back to `{ screen: "home" }` — a garbage URL must never crash the shell.
 */
export function urlToRoute(url: string): Route {
  const idx = url.indexOf("?");
  const params = new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
  const raw = params.get("screen");
  const screen: Screen =
    raw !== null && (SCREEN_VALUES as readonly string[]).includes(raw) ? (raw as Screen) : "home";
  const route: Route = { screen };
  for (const key of ENTITY_PARAMS) {
    const value = params.get(key);
    if (value) route[key] = value;
  }
  return route;
}
