// Next.js instrumentation hook: starts the in-app sync scheduler when the
// Node server boots. Gated by PLX_MC_SYNC_ENABLED (default off — TOOLS.md
// kill switch); webhooks replace/augment this once a public deploy exists.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSyncScheduler } = await import("@/lib/sync");
  startSyncScheduler();
}
