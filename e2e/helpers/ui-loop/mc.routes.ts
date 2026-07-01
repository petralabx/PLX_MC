// UI-loop route descriptors for MC surfaces (G2/G4 traceability).
// Most MC screens live inside the shell sidebar, not dedicated URLs.
// Gate specs navigate via sidebar labels documented here.

export const mcShellRoutes = [
  { path: "/", name: "inbox", sidebar: "Inbox" },
  { path: "/", name: "overview", sidebar: "Overview" },
  { path: "/", name: "sync-console", sidebar: "Sync" },
  { path: "/", name: "repos", sidebar: "Repos" },
] as const;

export const mcAuthRoutes = [{ path: "/signin", name: "sign-in" }] as const;

export { loopLedgersRoutes } from "./loop-ledgers.routes";
