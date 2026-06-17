// Deterministic cadence proof for the in-app sync scheduler (SPEC §3.H). The
// scheduler is DORMANT BY DEFAULT — it starts only when PLX_MC_SYNC_ENABLED
// === "1" (kill switch, TOOLS.md). These tests verify, with fake timers and a
// mocked engine (no DB / no SharePoint / no real clock), that:
//   1. with the flag unset it never sweeps and sets no timer (the load-bearing
//      dormant-by-default guarantee — zero prod/credential impact),
//   2. when enabled it kicks one immediate sweep then one per CADENCE_MS,
//   3. a second startSyncScheduler() does NOT double-schedule (idempotent guard),
//   4. a sweep that throws is swallowed and the cadence survives.
// afterEach restores real timers, clears the interval, deletes the global, and
// restores the prior env value, so no live timer leaks into the rest of the run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the engine so a sweep does no real work: it returns the minimal shape
// the scheduler logs (pushed/pulled/conflicts/pushErrors). No Graph, no DB.
vi.mock("@/lib/sync/engine", () => ({
  runSweep: vi.fn(async () => ({ pushed: 0, pulled: 0, conflicts: 0, pushErrors: 0 })),
}));

import { runSweep } from "@/lib/sync/engine";
import { CADENCE_MS, startSyncScheduler } from "@/lib/sync/scheduler";

const runSweepMock = vi.mocked(runSweep);

// The scheduler stashes its interval handle on globalThis for its idempotent
// guard; mirror that type here so cleanup can clear and delete it.
const schedulerGlobal = globalThis as unknown as {
  __plxMcSyncTimer?: ReturnType<typeof setInterval>;
};

// Capture and restore the ambient flag so this suite is hermetic regardless of
// the invoking shell (mirrors tests/staging-gate.test.ts env discipline).
let priorFlag: string | undefined;

beforeEach(() => {
  priorFlag = process.env.PLX_MC_SYNC_ENABLED;
  delete process.env.PLX_MC_SYNC_ENABLED; // default = OFF for every test
  runSweepMock.mockClear();
});

afterEach(() => {
  // No timer leaks: stop the clock, clear + delete the global the scheduler set,
  // and restore the prior flag so a later test can start the scheduler cleanly.
  vi.useRealTimers();
  if (schedulerGlobal.__plxMcSyncTimer) clearInterval(schedulerGlobal.__plxMcSyncTimer);
  delete schedulerGlobal.__plxMcSyncTimer;
  if (priorFlag === undefined) delete process.env.PLX_MC_SYNC_ENABLED;
  else process.env.PLX_MC_SYNC_ENABLED = priorFlag;
});

describe("startSyncScheduler — dormant by default", () => {
  it("does NOT sweep and sets NO timer when PLX_MC_SYNC_ENABLED is unset", () => {
    // The most important assertion: zero prod/credential impact at the default.
    expect(process.env.PLX_MC_SYNC_ENABLED).toBeUndefined();
    startSyncScheduler();
    expect(runSweepMock).not.toHaveBeenCalled();
    expect(schedulerGlobal.__plxMcSyncTimer).toBeUndefined();
  });

  it('does NOT start for any value other than exactly "1"', () => {
    process.env.PLX_MC_SYNC_ENABLED = "0";
    startSyncScheduler();
    expect(runSweepMock).not.toHaveBeenCalled();
    expect(schedulerGlobal.__plxMcSyncTimer).toBeUndefined();

    process.env.PLX_MC_SYNC_ENABLED = "true"; // truthy but not "1"
    startSyncScheduler();
    expect(runSweepMock).not.toHaveBeenCalled();
    expect(schedulerGlobal.__plxMcSyncTimer).toBeUndefined();
  });
});

describe("startSyncScheduler — enabled cadence (fake timers)", () => {
  beforeEach(() => {
    process.env.PLX_MC_SYNC_ENABLED = "1";
    vi.useFakeTimers();
  });

  it("kicks one immediate sweep, then one per CADENCE_MS", () => {
    startSyncScheduler();
    // Immediate kick (void sweep()) — runSweep is invoked synchronously before
    // its first await, so the call count is reliable without flushing promises.
    expect(runSweepMock).toHaveBeenCalledTimes(1);
    expect(schedulerGlobal.__plxMcSyncTimer).toBeDefined();

    vi.advanceTimersByTime(CADENCE_MS); // second sweep at +5 min
    expect(runSweepMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(CADENCE_MS); // third sweep at +10 min
    expect(runSweepMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT sweep before a full CADENCE_MS has elapsed", () => {
    startSyncScheduler();
    expect(runSweepMock).toHaveBeenCalledTimes(1); // the immediate kick only
    vi.advanceTimersByTime(CADENCE_MS - 1); // one tick short of the interval
    expect(runSweepMock).toHaveBeenCalledTimes(1); // still no scheduled sweep
    vi.advanceTimersByTime(1); // now the interval fires
    expect(runSweepMock).toHaveBeenCalledTimes(2);
  });

  it("is idempotent — a second start does not double-schedule", () => {
    startSyncScheduler();
    const timer = schedulerGlobal.__plxMcSyncTimer;
    expect(runSweepMock).toHaveBeenCalledTimes(1);

    startSyncScheduler(); // guarded by __plxMcSyncTimer — should be a no-op
    expect(schedulerGlobal.__plxMcSyncTimer).toBe(timer); // same handle, not re-set
    expect(runSweepMock).toHaveBeenCalledTimes(1); // no second immediate kick

    // One interval still fires exactly once per CADENCE_MS (not twice).
    vi.advanceTimersByTime(CADENCE_MS);
    expect(runSweepMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the cadence when a sweep fails (the catch swallows it)", async () => {
    // Reject the first (immediate) sweep; the scheduler's try/catch must absorb
    // it and the interval must still fire the next sweep.
    runSweepMock.mockRejectedValueOnce(new Error("transient SharePoint outage"));
    startSyncScheduler();
    expect(runSweepMock).toHaveBeenCalledTimes(1);

    // advanceTimersByTimeAsync flushes the rejected sweep's microtasks so the
    // catch runs (no unhandled rejection) before the next tick fires.
    await vi.advanceTimersByTimeAsync(CADENCE_MS);
    expect(runSweepMock).toHaveBeenCalledTimes(2); // loop survived the failure

    await vi.advanceTimersByTimeAsync(CADENCE_MS);
    expect(runSweepMock).toHaveBeenCalledTimes(3);
  });
});

describe("startSyncScheduler — clean restart after teardown (no leak)", () => {
  it("re-registers exactly one interval after the prior test's cleanup", () => {
    // Proves afterEach truly cleared the global: a fresh enable starts cleanly,
    // registers one timer, and ticks once per CADENCE_MS — not N stacked timers.
    process.env.PLX_MC_SYNC_ENABLED = "1";
    vi.useFakeTimers();
    expect(schedulerGlobal.__plxMcSyncTimer).toBeUndefined(); // cleanup held

    startSyncScheduler();
    expect(runSweepMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CADENCE_MS);
    expect(runSweepMock).toHaveBeenCalledTimes(2); // exactly one interval running
  });
});
