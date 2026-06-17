// In-app sweep scheduler: the 5-minute delta-poll cadence (spec §1) running
// inside the Next.js server process — one less moving part until webhooks
// force a public deploy. Kill switch (TOOLS.md): PLX_MC_SYNC_ENABLED must be
// "1" or the engine never starts; default is OFF.

import { runSweep } from "./engine";

// Exported for test visibility only (the cadence test advances fake timers by
// exactly this interval — see tests/sync-scheduler.test.ts); no behavior change.
export const CADENCE_MS = 5 * 60 * 1000;

const globalForScheduler = globalThis as unknown as { __plxMcSyncTimer?: ReturnType<typeof setInterval> };

export function syncEnabled(): boolean {
  return process.env.PLX_MC_SYNC_ENABLED === "1";
}

export function startSyncScheduler(): void {
  if (!syncEnabled()) {
    console.log("[sync] scheduler disabled (PLX_MC_SYNC_ENABLED != 1)");
    return;
  }
  if (globalForScheduler.__plxMcSyncTimer) return;

  const sweep = async () => {
    try {
      const result = await runSweep();
      console.log(
        `[sync] sweep ok — pushed=${result.pushed} pulled=${result.pulled} conflicts=${result.conflicts} errors=${result.pushErrors}`
      );
    } catch (err) {
      // Fail visible but keep the cadence; the next sweep retries.
      console.error(`[sync] sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  globalForScheduler.__plxMcSyncTimer = setInterval(sweep, CADENCE_MS);
  console.log(`[sync] scheduler started — sweeping every ${CADENCE_MS / 60000} min`);
  void sweep();
}
