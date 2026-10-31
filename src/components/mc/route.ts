// Routing contract for Mission Control screens (the prototype's `route`
// object + `nav()` made typed). Screens receive { route, nav } and navigate
// with nav(screen, { bucketId?, taskId? }).

import { DEFAULT_GOALS_TAB, isGoalsTab, type GoalsTab } from "./goals/tabs";
import type { FilterState } from "./work-views.helpers";

// Runtime list of screens (P3 deep links): the URL parser validates the
// `screen` query param against this, so unknown values fall back to "home".
// The Screen type is derived from it — same union as before, single source.
export const SCREEN_VALUES = [
  "home",
  "dashboard",
  "board",
  "list",
  "timeline",
  "mine",
  "insights",
  "matrix",
  "feed",
  "bucket",
  "project",
  "projects",
  "repos",
  "files",
  "sync",
  "intake",
  "task",
  "loop-ledgers",
  "governance-sops",
  "skills-directory",
  "architecture",
  "brain-ask",
  "ai-spend",
  "ci-scorecard",
  "routing-inbox",
  "approvals",
  "drafts",
  "activity",
  "goals",
  "help",
] as const;

export type Screen = (typeof SCREEN_VALUES)[number];

export interface Route {
  screen: Screen;
  projectId?: string;
  bucketId?: string;
  taskId?: string;
  /** SOP guide deep link: `/?screen=governance-sops&sop=<slug>`. */
  sop?: string;
  /** Architecture diagram deep link: `/?screen=architecture&diagram=context|containers|task-lifecycle`. */
  diagram?: string;
  /** Brain Ask open: `/?screen=brain-ask&node=<id>`. */
  node?: string;
  /** Task evidence section: `/?screen=task&taskId=<id>&focus=evidence`. */
  focus?: "evidence";
  /** One question on the Approvals screen (TASK-3567): `/?screen=approvals&question=<q_id>`. */
  question?: string;
  /** One approval gate on the Approvals screen (TASK-3559): `/?screen=approvals&gate=<apg_id>`. */
  gate?: string;
  /** One draft (Draft Projects, TASK-4071): `/?screen=drafts&draftId=DRF-<n>`. */
  draftId?: string;
  /** One frozen version of that draft: `&version=<n>`, the link Accept writes as the PRD. */
  version?: string;
  /** The New draft form (TASK-4109): `&draftId=new`, or `&draftId=DRF-<n>&edit=1` to edit one. */
  edit?: "1";
  /** Goals & Production revenue at the Sage rate (TASK-3780): `/?screen=goals&fx=sage`; absent = the run's Bank of Canada rate. */
  fx?: "sage";
  /** Goals & Production revenue for manufacturing customers only (every class but Exclusive Distribution): `/?screen=goals&scope=mfg`; absent = all customers. */
  scope?: "mfg";
  /** Goals report section (TASK-4094): `/?screen=goals&tab=shipments`. Absent = Revenue → By class. */
  tab?: GoalsTab;
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

const ENTITY_PARAMS = ["projectId", "bucketId", "taskId", "sop", "diagram", "node", "question", "gate", "draftId", "version"] as const;

// Stable link names that read as another screen (TASK-3559): `?screen=my-tasks`
// is the shareable name for My tasks, whose screen key is "mine".
const SCREEN_ALIASES: ReadonlyMap<string, Screen> = new Map([["my-tasks", "mine"]]);

/** Serialize a Route to a path + query string ("/", "/?screen=board", …). */
export function routeToUrl(route: Route): string {
  const params = new URLSearchParams();
  if (route.screen !== "home") params.set("screen", route.screen);
  for (const key of ENTITY_PARAMS) {
    const value = route[key];
    if (value) params.set(key, value);
  }
  if (route.focus === "evidence") params.set("focus", "evidence");
  if (route.fx === "sage") params.set("fx", "sage");
  if (route.scope === "mfg") params.set("scope", "mfg");
  if (route.tab && route.tab !== DEFAULT_GOALS_TAB) params.set("tab", route.tab);
  if (route.edit === "1") params.set("edit", "1");
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
    raw !== null && (SCREEN_VALUES as readonly string[]).includes(raw)
      ? (raw as Screen)
      : ((raw !== null && SCREEN_ALIASES.get(raw)) || "home");
  const route: Route = { screen };
  for (const key of ENTITY_PARAMS) {
    const value = params.get(key);
    if (value) route[key] = value;
  }
  if (params.get("focus") === "evidence") route.focus = "evidence";
  if (params.get("fx") === "sage") route.fx = "sage";
  if (params.get("scope") === "mfg") route.scope = "mfg";
  const tab = params.get("tab");
  if (isGoalsTab(tab) && tab !== DEFAULT_GOALS_TAB) route.tab = tab;
  if (params.get("edit") === "1") route.edit = "1";
  return route;
}
