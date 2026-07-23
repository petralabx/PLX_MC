// Durable per-entity outbound push retry queue (TASK-622). A transient Graph
// failure (429 / 5xx) defers one entity with exponential backoff — recorded in
// outbound_push_retries — instead of aborting the sweep; the 5-minute cadence
// re-drives due entities. After MAX_PUSH_ATTEMPTS the entity is terminal and
// the caller parks it in the error register (same surface as 4xx rejections).

import { query } from "@/lib/db";
import { GraphError } from "./graph";

export type PushEntityKind = "task" | "risk" | "repo" | "project" | "bucket";

export const MAX_PUSH_ATTEMPTS = 8;

/** First retry waits one cadence (5 min); doubles per attempt, capped at 6 h. */
export const BASE_BACKOFF_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 6 * 60 * 60_000;

/** Transient = worth retrying: throttling or a server-side failure. */
export function isTransientGraphFailure(err: unknown): err is GraphError {
  return err instanceof GraphError && (err.status === 429 || err.status >= 500);
}

/** Pure backoff: exponential on attempts, never earlier than Retry-After. */
export function backoffDelayMs(attempts: number, retryAfterMs?: number): number {
  const exponential = Math.min(
    BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1),
    MAX_BACKOFF_MS
  );
  return Math.max(exponential, retryAfterMs ?? 0);
}

export function pushRetryKey(kind: PushEntityKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Entities whose next attempt is still in the future — the sweep skips these
 * (deferred) instead of hammering a throttled/unavailable Graph.
 */
export async function getDeferredPushSet(now: Date = new Date()): Promise<Set<string>> {
  try {
    const rows = await query<{ entity_kind: PushEntityKind; entity_id: string }>(
      `SELECT entity_kind, entity_id
         FROM outbound_push_retries
        WHERE next_attempt_at > $1`,
      [now.toISOString()]
    );
    return new Set(rows.map((r) => pushRetryKey(r.entity_kind, r.entity_id)));
  } catch (err) {
    // Fail-open: a missing/unreachable retry ledger degrades to the legacy
    // retry-every-tick behavior — it must never block the sweep itself.
    logQueueUnavailable("getDeferredPushSet", err);
    return new Set();
  }
}

export interface PushFailureRecord {
  attempts: number;
  terminal: boolean;
  nextAttemptAt: string;
}

/**
 * Record one transient failure. Returns the updated attempt count, whether the
 * entity is now terminal (caller parks it in the error register), and when the
 * next attempt is due.
 */
export async function recordTransientPushFailure(
  kind: PushEntityKind,
  id: string,
  err: GraphError,
  now: Date = new Date()
): Promise<PushFailureRecord> {
  try {
    return await persistTransientPushFailure(kind, id, err, now);
  } catch (persistErr) {
    // Fail-open: without the ledger the entity simply stays pending and is
    // retried next tick (no backoff memory) — still no sweep abort.
    logQueueUnavailable("recordTransientPushFailure", persistErr);
    return {
      attempts: 1,
      terminal: false,
      nextAttemptAt: new Date(now.getTime() + backoffDelayMs(1, err.retryAfterMs)).toISOString(),
    };
  }
}

async function persistTransientPushFailure(
  kind: PushEntityKind,
  id: string,
  err: GraphError,
  now: Date
): Promise<PushFailureRecord> {
  const rows = await query<{ attempts: number }>(
    `INSERT INTO outbound_push_retries
       (entity_kind, entity_id, attempts, next_attempt_at, last_status, last_error, updated_at)
     VALUES ($1, $2, 1, $3, $4, $5, $6)
     ON CONFLICT (entity_kind, entity_id) DO UPDATE
        SET attempts = outbound_push_retries.attempts + 1,
            last_status = EXCLUDED.last_status,
            last_error = EXCLUDED.last_error,
            updated_at = EXCLUDED.updated_at
     RETURNING attempts`,
    [
      kind,
      id,
      new Date(now.getTime() + backoffDelayMs(1, err.retryAfterMs)).toISOString(),
      err.status,
      err.body.slice(0, 300),
      now.toISOString(),
    ]
  );
  const attempts = rows[0]?.attempts ?? 1;
  const terminal = attempts >= MAX_PUSH_ATTEMPTS;
  const nextAttemptAt = new Date(
    now.getTime() + backoffDelayMs(attempts, err.retryAfterMs)
  ).toISOString();
  if (terminal) {
    await query(
      `DELETE FROM outbound_push_retries WHERE entity_kind = $1 AND entity_id = $2`,
      [kind, id]
    );
  } else if (attempts > 1) {
    await query(
      `UPDATE outbound_push_retries
          SET next_attempt_at = $3
        WHERE entity_kind = $1 AND entity_id = $2`,
      [kind, id, nextAttemptAt]
    );
  }
  return { attempts, terminal, nextAttemptAt };
}

/** Success clears any pending retry state for the entity. Fail-open. */
export async function clearPushRetry(kind: PushEntityKind, id: string): Promise<void> {
  try {
    await query(
      `DELETE FROM outbound_push_retries WHERE entity_kind = $1 AND entity_id = $2`,
      [kind, id]
    );
  } catch (err) {
    logQueueUnavailable("clearPushRetry", err);
  }
}

function logQueueUnavailable(op: string, err: unknown): void {
  console.error(
    "[sync] outbound push retry ledger unavailable in %s (fail-open): %s",
    op,
    err instanceof Error ? err.message : String(err)
  );
}
