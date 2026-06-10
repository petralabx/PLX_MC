// Routing contract for Mission Control screens (the prototype's `route`
// object + `nav()` made typed). Screens receive { route, nav } and navigate
// with nav(screen, { bucketId?, taskId? }).

export type Screen =
  | "home"
  | "board"
  | "list"
  | "timeline"
  | "matrix"
  | "feed"
  | "bucket"
  | "repos"
  | "files"
  | "sync"
  | "task";

export interface Route {
  screen: Screen;
  bucketId?: string;
  taskId?: string;
}

export type Nav = (screen: Screen, extra?: Omit<Route, "screen">) => void;

export interface ScreenProps {
  route: Route;
  nav: Nav;
}
