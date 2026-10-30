// UAT scorecard persistence and its daily pull (TASK-4196): one append-only
// mc_events row per portal read of a week (kind uat.scorecard.snapshot), keyed
// so a clean final read's replay is a no-op and any other read gains a row per
// daily read, except a partial re-read of a week whose clean final read is
// stored, which is dropped; and one uat.scorecard.pull_failed row per week and
// UTC hour a pull fails. No migration: mc_events already has the unique dedup_key index. Uses
// Postgres when configured; otherwise a process-local fallback keeps tests and
// local dev from needing PLX_MC_DATABASE_URL (the ci-scorecard contract).
// Server-only.

import { z } from "zod";

import { appendEvent, eventByDedupKey, eventsByKinds } from "@/lib/compliance/repo";
import { readPortalScorecard } from "@/lib/compliance/uat-portal-read";
import { databaseConfigured } from "@/lib/secrets";

import {
  SNAPSHOT_EVENT_KIND,
  finalReadKey,
  isCleanFinalRead,
  pulledWeeks,
  snapshotDedupKey,
  truncateToHour,
  type PullFailure,
  type StoredSnapshot,
} from "./index";
import { snapshotSchema, type Snapshot } from "./schema";

/**
 * Reads read back at most. With the daily pull a week stores up to 7 open
 * reads and 7 final reads (no partial re-read is stored after its clean final
 * read), so 800 holds the 52 weeks `?weeks=52` shows and the week before them
 * (742). The 58 rows left hold re-runs in other hours, up to 2 rows each. Past
 * that the oldest rows drop first, and a week's clean final read, its newest
 * row, drops last.
 */
export const MAX_SNAPSHOTS = 800;

/** mc_events.actor of every stored read and failed pull: the daily UAT check. */
export const PULL_ACTOR = "mc-uat-drift";

/** The mc_events kind of a daily pull of one week that failed: the week, the message and the time, never ticket text. */
export const PULL_FAILED_EVENT_KIND = "uat.scorecard.pull_failed";

const HOUR_MS = 3_600_000;

/**
 * How far back failed pulls are read. The screen names one only for this week
 * or last week (pulledWeeks), so it was stored at most two Toronto weeks ago,
 * an hour more when summer time ends.
 */
export const PULL_FAILURE_LOOKBACK_MS = 15 * 24 * HOUR_MS;

/**
 * Failed pulls read back at most. The dedup key keeps one per week and UTC
 * hour of the run's start, two weeks a run, and a row is stored up to a run's
 * length after that hour: the 15 days hold rows of 362 key hours.
 */
export const MAX_PULL_FAILURES = 2 * (PULL_FAILURE_LOOKBACK_MS / HOUR_MS + 2);

const pullFailureSchema = z.object({ week: z.string(), message: z.string() });

interface MemoryStore {
  rows: StoredSnapshot[];
  keys: Set<string>;
  seq: number;
  failures: PullFailure[];
}

const globalForScorecard = globalThis as unknown as { __plxUatScorecard?: MemoryStore };

function memory(): MemoryStore {
  globalForScorecard.__plxUatScorecard ??= { rows: [], keys: new Set(), seq: 0, failures: [] };
  return globalForScorecard.__plxUatScorecard;
}

/**
 * Stores one read. `recorded` is false when the same key is already stored,
 * or when it is a partial re-read of a week whose clean final read is stored:
 * that read is the one shown, so the partial one never would be.
 */
export async function recordSnapshot(snapshot: Snapshot): Promise<{ recorded: boolean; seq: string | null }> {
  const dedupKey = snapshotDedupKey(snapshot);
  const settledBy = snapshot.window.complete && !isCleanFinalRead(snapshot) ? finalReadKey(snapshot) : null;
  if (!databaseConfigured()) {
    const store = memory();
    if (store.keys.has(dedupKey) || (settledBy !== null && store.keys.has(settledBy))) return { recorded: false, seq: null };
    store.keys.add(dedupKey);
    store.seq += 1;
    store.rows.push({ seq: String(store.seq), recordedAt: new Date().toISOString(), snapshot });
    return { recorded: true, seq: String(store.seq) };
  }
  if (settledBy !== null && (await eventByDedupKey(settledBy))) return { recorded: false, seq: null };
  const seq = await appendEvent({ kind: SNAPSHOT_EVENT_KIND, actor: PULL_ACTOR, payload: { snapshot }, dedupKey });
  return { recorded: seq !== undefined, seq: seq ?? null };
}

/**
 * Stored reads, newest first. Every one was checked on the way in; a row that
 * no longer parses (an older shape) is skipped and logged, so one bad row
 * cannot blank the screen.
 */
export async function listSnapshots(limit = MAX_SNAPSHOTS): Promise<StoredSnapshot[]> {
  if (!databaseConfigured()) return [...memory().rows].reverse().slice(0, limit);
  const rows = await eventsByKinds([SNAPSHOT_EVENT_KIND], limit);
  const out: StoredSnapshot[] = [];
  for (const row of rows) {
    const parsed = snapshotSchema.safeParse((row.payload as { snapshot?: unknown }).snapshot);
    if (!parsed.success) {
      console.error("[uat-scorecard] skipped snapshot event %s: %s", row.seq, parsed.error.issues[0]?.message ?? "invalid");
      continue;
    }
    out.push({ seq: row.seq, recordedAt: row.ts, snapshot: parsed.data });
  }
  return out;
}

/** Test seam: empties the process-local store. */
export function resetMemorySnapshots(): void {
  delete globalForScorecard.__plxUatScorecard;
}

/** Records one failed pull, once per week and UTC hour. It never throws: the pull must still answer. */
async function recordPullFailure(week: string, message: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const dedupKey = `uat-scorecard-pull-failed:${week}|${truncateToHour(at)}`;
  try {
    if (!databaseConfigured()) {
      const store = memory();
      if (store.keys.has(dedupKey)) return;
      store.keys.add(dedupKey);
      // Stamped when stored, as mc_events.ts and each read's recordedAt are, so failures and reads order on one clock.
      store.failures.push({ week, message, at: new Date().toISOString() });
      return;
    }
    await appendEvent({ kind: PULL_FAILED_EVENT_KIND, actor: PULL_ACTOR, payload: { week, message, at }, dedupKey });
  } catch (err) {
    console.error("[uat-scorecard] could not record the failed pull of week %s: %s", week, err instanceof Error ? err.message : "unknown error");
  }
}

/** Failed pulls stored in the PULL_FAILURE_LOOKBACK_MS before `now`, newest first, each with the time it was stored. */
export async function listPullFailures(now = new Date()): Promise<PullFailure[]> {
  const since = new Date(now.getTime() - PULL_FAILURE_LOOKBACK_MS).toISOString();
  if (!databaseConfigured()) {
    const recent = memory().failures.filter((f) => Date.parse(f.at) >= Date.parse(since));
    return recent.reverse().slice(0, MAX_PULL_FAILURES);
  }
  const rows = await eventsByKinds([PULL_FAILED_EVENT_KIND], MAX_PULL_FAILURES, since);
  return rows.flatMap((row) => {
    const parsed = pullFailureSchema.safeParse(row.payload);
    return parsed.success ? [{ ...parsed.data, at: row.ts }] : [];
  });
}

// ─── The daily pull ──────────────────────────────────────────────────────────

export interface WeekPull {
  /** The Monday (Toronto) that starts the week, YYYY-MM-DD. */
  week: string;
  status: "recorded" | "unchanged" | "off" | "error";
  message?: string;
}

export interface ScorecardPull {
  status: "off" | "ok" | "error";
  /** Last week, then this week. */
  weeks: WeekPull[];
}

async function pullWeek(week: string, now: Date): Promise<WeekPull> {
  let pulled: WeekPull;
  try {
    const read = await readPortalScorecard(week, now);
    if (read.status === "off") return { week, status: "off" };
    if (read.status === "error") {
      pulled = { week, status: "error", message: read.message };
    } else {
      const { recorded } = await recordSnapshot(read.snapshot);
      return { week, status: recorded ? "recorded" : "unchanged" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[uat-scorecard] week %s not stored: %s", week, message);
    pulled = { week, status: "error", message };
  }
  await recordPullFailure(week, pulled.message ?? "unknown error", now);
  return pulled;
}

/**
 * The daily UAT check's pull (GET /api/cron/uat-drift): last week, which has
 * closed, then this week so far. Each week reads and stores on its own, so one
 * failing never stops the other, and this never throws. One after the other,
 * so a failure and a stored read keep the order they happened in.
 */
export async function pullScorecardWeeks(now = new Date()): Promise<ScorecardPull> {
  const [lastWeek, thisWeek] = pulledWeeks(now);
  const weeks = [await pullWeek(lastWeek, now), await pullWeek(thisWeek, now)];
  const status = weeks.every((w) => w.status === "off") ? "off" : weeks.some((w) => w.status === "error") ? "error" : "ok";
  return { status, weeks };
}
