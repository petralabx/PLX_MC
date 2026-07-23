// TASK-624 — missed-tick detection: threshold evaluation, deduped alerting,
// fail-open contract for the hosting cron.

import { describe, expect, it, vi } from "vitest";

import {
  checkMissedTick,
  evaluateSweepHealth,
  MISSED_TICK_ALERT_DEDUP_MS,
  MISSED_TICK_THRESHOLD_MS,
} from "@/lib/sync/health";

const NOW = new Date("2026-07-23T12:00:00Z");

function stampsAgo(ms: number): Record<string, Date | null> {
  return { todos: new Date(NOW.getTime() - ms), projects: null };
}

describe("evaluateSweepHealth", () => {
  it("fresh inside the threshold", () => {
    const health = evaluateSweepHealth(stampsAgo(5 * 60_000), NOW);
    expect(health.stale).toBe(false);
    expect(health.ageMs).toBe(5 * 60_000);
  });

  it("stale past the threshold (3 missed 5-min ticks)", () => {
    const health = evaluateSweepHealth(stampsAgo(MISSED_TICK_THRESHOLD_MS + 1), NOW);
    expect(health.stale).toBe(true);
  });

  it("uses the NEWEST register stamp — one live register keeps health fresh", () => {
    const health = evaluateSweepHealth(
      {
        todos: new Date(NOW.getTime() - 2 * 60_000),
        roadmap: new Date(NOW.getTime() - 60 * 60_000),
      },
      NOW
    );
    expect(health.stale).toBe(false);
  });

  it("no completed sweep at all reports stale with null age", () => {
    const health = evaluateSweepHealth({ todos: null }, NOW);
    expect(health).toMatchObject({ stale: true, ageMs: null, lastCompleteAt: null });
  });
});

describe("checkMissedTick", () => {
  it("stale + no recent alert → appends one mc_events row and notifies", async () => {
    const append = vi.fn(async () => {});
    const notify = vi.fn(async () => true);
    const result = await checkMissedTick({
      now: NOW,
      loadCompletions: async () => stampsAgo(30 * 60_000),
      latestAlertAt: async () => null,
      append,
      notify,
    });
    expect(result).toMatchObject({ stale: true, alerted: true });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sync.missed_tick", actor: "scribe" })
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("missed-tick"));
  });

  it("dedupes alerts inside the episode window", async () => {
    const append = vi.fn(async () => {});
    const result = await checkMissedTick({
      now: NOW,
      loadCompletions: async () => stampsAgo(30 * 60_000),
      latestAlertAt: async () =>
        new Date(NOW.getTime() - MISSED_TICK_ALERT_DEDUP_MS / 2).toISOString(),
      append,
      notify: vi.fn(async () => true),
    });
    expect(result).toMatchObject({ stale: true, alerted: false });
    expect(append).not.toHaveBeenCalled();
  });

  it("re-alerts once the dedup window elapses (persistent outage)", async () => {
    const append = vi.fn(async () => {});
    const result = await checkMissedTick({
      now: NOW,
      loadCompletions: async () => stampsAgo(3 * 60 * 60_000),
      latestAlertAt: async () =>
        new Date(NOW.getTime() - MISSED_TICK_ALERT_DEDUP_MS - 1000).toISOString(),
      append,
      notify: vi.fn(async () => true),
    });
    expect(result.alerted).toBe(true);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("fresh sweeps neither alert nor append", async () => {
    const append = vi.fn(async () => {});
    const result = await checkMissedTick({
      now: NOW,
      loadCompletions: async () => stampsAgo(60_000),
      latestAlertAt: async () => null,
      append,
      notify: vi.fn(async () => true),
    });
    expect(result).toMatchObject({ stale: false, alerted: false });
    expect(append).not.toHaveBeenCalled();
  });

  it("fail-open: a loader failure never throws out of the hosting cron", async () => {
    const result = await checkMissedTick({
      now: NOW,
      loadCompletions: async () => {
        throw new Error("db down");
      },
    });
    expect(result).toMatchObject({ stale: false, alerted: false });
  });
});
