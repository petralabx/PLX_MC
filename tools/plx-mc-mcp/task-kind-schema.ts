// Task kind taxonomy shared by the web app (src/lib/tasks/kind.ts) and the
// operator-local stdio client. Dependency-free so the tool-only install resolves it.
export const TASK_KINDS = [
  "code", "admin-setup", "human-test", "decision", "blocked-external", "needs-review",
] as const;
