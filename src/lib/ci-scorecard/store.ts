// CI scorecard persistence (TASK-3913): one append-only mc_events row per weekly
// snapshot (kind ci.scorecard.snapshot), keyed on its window, so a replay is a
// no-op and needs no migration. Uses Postgres when configured; otherwise a
// process-local fallback keeps tests and local dev from needing
// PLX_MC_DATABASE_URL (the stars and vendor-spend contract). Server-only.

import { appendEvent, eventsByKinds } from "@/lib/compliance/repo";
import { databaseConfigured } from "@/lib/secrets";

import { SNAPSHOT_EVENT_KIND, snapshotDedupKey, type StoredSnapshot } from "./index";
import { snapshotSchema, type Snapshot } from "./schema";

/** Snapshots read back at most: three years of weeks, with room for re-runs. */
export const MAX_SNAPSHOTS = 200;

export interface RecordSnapshotInput {
  snapshot: Snapshot;
  /** The reporting runtime (mc_events.actor). */
  actor: string;
  repo: string | null;
  operator: string;
  servicePrincipalId: string;
}

interface MemoryStore {
  rows: StoredSnapshot[];
  keys: Set<string>;
  seq: number;
}

const globalForScorecard = globalThis as unknown as { __plxCiScorecard?: MemoryStore };

function memory(): MemoryStore {
  globalForScorecard.__plxCiScorecard ??= { rows: [], keys: new Set(), seq: 0 };
  return globalForScorecard.__plxCiScorecard;
}

/** Stores one snapshot. `recorded` is false when the same window is already stored. */
export async function recordSnapshot(input: RecordSnapshotInput): Promise<{ recorded: boolean; seq: string | null }> {
  const dedupKey = snapshotDedupKey(input.snapshot);
  if (!databaseConfigured()) {
    const store = memory();
    if (store.keys.has(dedupKey)) return { recorded: false, seq: null };
    store.keys.add(dedupKey);
    store.seq += 1;
    store.rows.push({ seq: String(store.seq), recordedAt: new Date().toISOString(), snapshot: input.snapshot });
    return { recorded: true, seq: String(store.seq) };
  }
  const seq = await appendEvent({
    kind: SNAPSHOT_EVENT_KIND,
    actor: input.actor,
    repo: input.repo,
    payload: { snapshot: input.snapshot, operator: input.operator, servicePrincipalId: input.servicePrincipalId },
    dedupKey,
  });
  return { recorded: seq !== undefined, seq: seq ?? null };
}

/**
 * Stored snapshots, newest first. Every one was checked on the way in; a row
 * that no longer parses (an older shape) is skipped and logged, so one bad row
 * cannot blank the screen.
 */
export async function listSnapshots(limit = MAX_SNAPSHOTS): Promise<StoredSnapshot[]> {
  if (!databaseConfigured()) return [...memory().rows].reverse().slice(0, limit);
  const rows = await eventsByKinds([SNAPSHOT_EVENT_KIND], limit);
  const out: StoredSnapshot[] = [];
  for (const row of rows) {
    const parsed = snapshotSchema.safeParse((row.payload as { snapshot?: unknown }).snapshot);
    if (!parsed.success) {
      console.error("[ci-scorecard] skipped snapshot event %s: %s", row.seq, parsed.error.issues[0]?.message ?? "invalid");
      continue;
    }
    out.push({ seq: row.seq, recordedAt: row.ts, snapshot: parsed.data });
  }
  return out;
}

/** Test seam: empties the process-local store. */
export function resetMemorySnapshots(): void {
  delete globalForScorecard.__plxCiScorecard;
}
