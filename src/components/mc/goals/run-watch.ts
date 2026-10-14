// Follows one refresh run until it finishes: GET /api/reporting/goals/runs/<id>
// every RUN_POLL_MS, one request at a time, reporting each step. Free of React
// and the DOM so the cadence is testable with fake timers (like the
// Dashboard's in-flight poller).

import type { RefreshRun } from "@/lib/reporting/goals";

export const RUN_POLL_MS = 2_000;
/** Consecutive failed polls before giving up (a blip should not end the watch). */
export const RUN_POLL_FAILURES = 3;

export interface RunWatchDeps {
  load: (id: number) => Promise<RefreshRun>;
  /** Every poll while the run is still going. */
  onStep: (run: RefreshRun) => void;
  /** The run finished: succeeded or failed. */
  onDone: (run: RefreshRun) => void;
  /** The run could not be read RUN_POLL_FAILURES times in a row. */
  onLost: (message: string) => void;
}

export function watchRun(runId: number, deps: RunWatchDeps): { stop: () => void } {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const run = await deps.load(runId);
      if (stopped) return;
      failures = 0;
      if (run.status === "running") {
        deps.onStep(run);
        timer = setTimeout(() => void tick(), RUN_POLL_MS);
      } else {
        deps.onDone(run);
      }
    } catch (err) {
      if (stopped) return;
      failures += 1;
      if (failures >= RUN_POLL_FAILURES) deps.onLost(err instanceof Error ? err.message : String(err));
      else timer = setTimeout(() => void tick(), RUN_POLL_MS);
    }
  };

  timer = setTimeout(() => void tick(), RUN_POLL_MS);
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
