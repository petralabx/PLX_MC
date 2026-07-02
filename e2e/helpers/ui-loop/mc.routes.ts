// UI-loop route descriptors for MC surfaces (G2/G4 traceability).
// Most MC screens live inside the shell sidebar, not dedicated URLs.
// Gate specs navigate via sidebar labels documented here.

export const mcShellRoutes = [
  { path: "/", name: "inbox", sidebar: "Inbox", testId: "inbox-screen" },
  { path: "/", name: "board", sidebar: "Board", testId: "board-screen" },
  { path: "/", name: "insights", sidebar: "Insights", testId: "insights-screen" },
  { path: "/", name: "ai-spend", sidebar: "AI Spend", testId: "ai-spend-screen" },
  { path: "/", name: "sync-console", sidebar: "Sync", testId: "sync-console-screen" },
  { path: "/", name: "repos", sidebar: "Repos", testId: "repos-screen" },
  { path: "/", name: "skills-directory", sidebar: "Skills directory", testId: "sk-screen" },
  { path: "/", name: "loop-ledgers", sidebar: "Loop ledgers", testId: "ll-screen" },
  { path: "/", name: "governance-sops", sidebar: "SOP guide", testId: "gs-screen" },
  { path: "/", name: "task-detail", sidebar: "Board", testId: "task-detail-screen", note: "Open via board card click" },
  { path: "/", name: "command-palette", sidebar: "", testId: "cmdk", note: "Open via ControlOrMeta+k" },
] as const;

export const mcAuthRoutes = [{ path: "/signin", name: "sign-in", testId: "signin-screen" }] as const;

export { loopLedgersRoutes } from "./loop-ledgers.routes";
