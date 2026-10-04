// EN-007 P1b — Postgres accessors for the compliance gate (schema:
// db/migrations/005_compliance.sql). Internal to the module; the service layer
// (service.ts) is the public server surface. All SQL is parameterized. Mockable
// in tests via vi.mock (see tests/compliance-server.test.ts), mirroring the sync
// repo seam in tests/mc-patch.test.ts — so the service logic is provable without
// a live database.

import { query, type TxQuery } from "@/lib/db";
import { announceGoLiveEventSafe } from "./go-live-announcer";
import type { ActorKind } from "./types";

export type Verdict = "pass" | "block" | "pending";

// ─── Event log (the Second-Brain substrate) ─────────────────────────────────

export interface AppendEventInput {
  kind: string;
  actor: string;
  repo?: string | null;
  taskId?: string | null;
  pr?: string | null;
  payload?: Record<string, unknown>;
  // Optional idempotency key (review S3). When set, a replay of the same logical
  // event is a no-op; NULL keys are unconstrained (see migration 007).
  dedupKey?: string | null;
}

const APPEND_EVENT_SQL = `INSERT INTO mc_events (kind, actor, repo, task_id, pr, payload, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
     RETURNING seq`;

function appendEventParams(e: AppendEventInput): unknown[] {
  return [e.kind, e.actor, e.repo ?? null, e.taskId ?? null, e.pr ?? null, JSON.stringify(e.payload ?? {}), e.dedupKey ?? null];
}

/** Appends one event; resolves to its seq, or undefined when a keyed replay was a no-op. */
export async function appendEvent(e: AppendEventInput): Promise<string | undefined> {
  const rows = await query<{ seq: string }>(APPEND_EVENT_SQL, appendEventParams(e));
  // Replay of a keyed event must not re-announce (Power Automate / webhook retries).
  if (e.dedupKey && rows.length === 0) return undefined;
  await announceGoLiveEventSafe(e);
  return rows[0] ? String(rows[0].seq) : undefined;
}

export interface EventRow {
  seq: string;
  ts: string;
  kind: string;
  actor: string;
  repo: string | null;
  taskId: string | null;
  pr: string | null;
  payload: Record<string, unknown>;
}

// Keyset pagination on the monotonic `seq` — the clean export cursor. Optional
// `kind` filter for a typed consumer (e.g. only gate.* or pr.* events).
/** Newest-first events of the given kinds — evaluation-loop source (TASK-632). */
export async function eventsByKinds(kinds: string[], limit = 5000): Promise<EventRow[]> {
  const rows = await query<{
    seq: string;
    ts: Date;
    kind: string;
    actor: string;
    repo: string | null;
    task_id: string | null;
    pr: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT seq, ts, kind, actor, repo, task_id, pr, payload
       FROM mc_events
      WHERE kind = ANY($1::text[])
      ORDER BY seq DESC LIMIT $2`,
    [kinds, limit]
  );
  return rows.map((r) => ({
    seq: String(r.seq),
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    kind: r.kind,
    actor: r.actor,
    repo: r.repo,
    taskId: r.task_id,
    pr: r.pr,
    payload: r.payload,
  }));
}

/** Timestamp of the newest event of a kind — used for alert deduping. */
export async function latestEventAt(kind: string): Promise<string | null> {
  const rows = await query<{ ts: Date | string }>(
    `SELECT ts FROM mc_events WHERE kind = $1 ORDER BY seq DESC LIMIT 1`,
    [kind]
  );
  const ts = rows[0]?.ts;
  if (!ts) return null;
  return ts instanceof Date ? ts.toISOString() : ts;
}

export async function eventTaskIdByDedupKey(dedupKey: string): Promise<string | null> {
  const rows = await query<{ task_id: string | null }>(
    `SELECT task_id FROM mc_events WHERE dedup_key = $1 LIMIT 1`,
    [dedupKey]
  );
  return rows[0]?.task_id ?? null;
}

/** The event with this dedup key, or null (task-create idempotency, fleet P8b). */
export async function eventByDedupKey(dedupKey: string): Promise<EventRow | null> {
  const rows = await query<{
    seq: string;
    ts: Date | string;
    kind: string;
    actor: string;
    repo: string | null;
    task_id: string | null;
    pr: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT seq, ts, kind, actor, repo, task_id, pr, payload
       FROM mc_events WHERE dedup_key = $1 LIMIT 1`,
    [dedupKey]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    seq: String(r.seq),
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    kind: r.kind,
    actor: r.actor,
    repo: r.repo,
    taskId: r.task_id,
    pr: r.pr,
    payload: r.payload,
  };
}

// ─── Task-create idempotency inside one transaction (fleet P8b) ────────────

/** Holds a lock on this dedup key until the transaction ends. */
export async function lockDedupKeyTx(q: TxQuery, dedupKey: string): Promise<void> {
  await q(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [dedupKey]);
}

/** The event with this dedup key and its age in seconds, or null. */
export async function eventAgeByDedupKeyTx(
  q: TxQuery,
  dedupKey: string
): Promise<{ taskId: string | null; ageSeconds: number } | null> {
  const rows = await q<{ task_id: string | null; age_seconds: number | string }>(
    `SELECT task_id, EXTRACT(EPOCH FROM (now() - ts))::float8 AS age_seconds
       FROM mc_events WHERE dedup_key = $1 LIMIT 1`,
    [dedupKey]
  );
  const r = rows[0];
  return r ? { taskId: r.task_id, ageSeconds: Number(r.age_seconds) } : null;
}

/**
 * appendEvent inside a transaction: resolves to the seq, or undefined when the
 * dedup key exists. It sends no go-live announcement, so use it only for event
 * kinds that the announcer ignores.
 */
export async function appendEventTx(q: TxQuery, e: AppendEventInput): Promise<string | undefined> {
  const rows = await q<{ seq: string }>(APPEND_EVENT_SQL, appendEventParams(e));
  return rows[0] ? String(rows[0].seq) : undefined;
}

export interface AgentReportRow {
  seq: string;
  ts: string;
  payload: Record<string, unknown>;
}

/**
 * Newest-first agent.report events (fleet P8b reader). Keyset pagination on
 * `seq`: pass the last seq of a page as beforeSeq to read the next page.
 */
export async function listAgentReports(f: {
  agentSlug: string | null;
  loopId: string | null;
  beforeSeq: string | null;
  limit: number;
}): Promise<AgentReportRow[]> {
  const rows = await query<{ seq: string; ts: Date | string; payload: Record<string, unknown> }>(
    `SELECT seq, ts, payload
       FROM mc_events
      WHERE kind = 'agent.report'
        AND ($1::text IS NULL OR payload->>'agentSlug' = $1::text)
        AND ($2::text IS NULL OR payload->>'loopId' = $2::text)
        AND ($3::bigint IS NULL OR seq < $3::bigint)
      ORDER BY seq DESC
      LIMIT $4`,
    [f.agentSlug, f.loopId, f.beforeSeq, f.limit]
  );
  return rows.map((r) => ({
    seq: String(r.seq),
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    payload: r.payload,
  }));
}

export async function eventsAfter(afterSeq = 0, limit = 100, kind: string | null = null): Promise<EventRow[]> {
  const rows = await query<{
    seq: string;
    ts: Date;
    kind: string;
    actor: string;
    repo: string | null;
    task_id: string | null;
    pr: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT seq, ts, kind, actor, repo, task_id, pr, payload
       FROM mc_events
      WHERE seq > $1 AND ($3::text IS NULL OR kind = $3)
      ORDER BY seq ASC LIMIT $2`,
    [afterSeq, limit, kind]
  );
  return rows.map((r) => ({
    seq: String(r.seq),
    ts: r.ts.toISOString(),
    kind: r.kind,
    actor: r.actor,
    repo: r.repo,
    taskId: r.task_id,
    pr: r.pr,
    payload: r.payload,
  }));
}

/**
 * Newest-first events for one task (mc_get_task history). `excludeKinds` drops
 * noise such as the agent's own mcp.tool.invoked audit rows.
 */
export async function eventsForTask(
  taskId: string,
  opts: { limit: number; excludeKinds?: string[] }
): Promise<EventRow[]> {
  const rows = await query<{
    seq: string;
    ts: Date;
    kind: string;
    actor: string;
    repo: string | null;
    task_id: string | null;
    pr: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT seq, ts, kind, actor, repo, task_id, pr, payload
       FROM mc_events
      WHERE task_id = $1 AND NOT (kind = ANY($2::text[]))
      ORDER BY seq DESC LIMIT $3`,
    [taskId, opts.excludeKinds ?? [], opts.limit]
  );
  return rows.map((r) => ({
    seq: String(r.seq),
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    kind: r.kind,
    actor: r.actor,
    repo: r.repo,
    taskId: r.task_id,
    pr: r.pr,
    payload: r.payload,
  }));
}

/** Most recent checkout audit door (`mcp` | `compliance`), or null if none. */
export async function latestCheckoutDoor(): Promise<string | null> {
  const rows = await query<{ door: string | null }>(
    `SELECT payload->>'door' AS door
       FROM mc_events
      WHERE kind = 'checkout'
      ORDER BY seq DESC
      LIMIT 1`
  );
  const door = (rows[0]?.door ?? "").trim();
  return door.length > 0 ? door : null;
}

// ─── Dispatch ledger ─────────────────────────────────────────────────────────

export interface DispatchRow {
  id: string;
  actorKind: ActorKind;
  runtime: string;
  taskId: string;
  accountableHuman: string;
  repo: string;
  revoked: boolean;
  expiresAt: string;
  releasedAt: string | null;
  releasedReason: string | null;
}

export async function insertDispatch(d: {
  id: string;
  actorKind: ActorKind;
  runtime: string;
  taskId: string;
  accountableHuman: string;
  repo: string;
  ttlMinutes: number;
}): Promise<void> {
  await query(
    `INSERT INTO mc_dispatch (id, actor_kind, runtime, task_id, accountable_human, repo, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)
     ON CONFLICT (id) DO NOTHING`,
    [d.id, d.actorKind, d.runtime, d.taskId, d.accountableHuman, d.repo, String(d.ttlMinutes)]
  );
}

type DispatchDbRow = {
  id: string;
  actor_kind: ActorKind;
  runtime: string;
  task_id: string;
  accountable_human: string;
  repo: string;
  revoked: boolean;
  expires_at: Date;
  released_at: Date | null;
  released_reason: string | null;
};

const DISPATCH_COLUMNS =
  "id, actor_kind, runtime, task_id, accountable_human, repo, revoked, expires_at, released_at, released_reason";

function toDispatchRow(r: DispatchDbRow): DispatchRow {
  return {
    id: r.id,
    actorKind: r.actor_kind,
    runtime: r.runtime,
    taskId: r.task_id,
    accountableHuman: r.accountable_human,
    repo: r.repo,
    revoked: r.revoked,
    expiresAt: r.expires_at.toISOString(),
    releasedAt: r.released_at?.toISOString() ?? null,
    releasedReason: r.released_reason ?? null,
  };
}

export async function getDispatch(id: string): Promise<DispatchRow | null> {
  const rows = await query<DispatchDbRow>(
    `SELECT ${DISPATCH_COLUMNS} FROM mc_dispatch WHERE id = $1`,
    [id]
  );
  return rows[0] ? toDispatchRow(rows[0]) : null;
}

/** A task's dispatches whose id ends with `suffix` — resolves a checkoutRef (dsp_…last4). */
export async function findDispatchesBySuffix(taskId: string, suffix: string): Promise<DispatchRow[]> {
  const rows = await query<DispatchDbRow>(
    `SELECT ${DISPATCH_COLUMNS} FROM mc_dispatch
      WHERE task_id = $1 AND right(id, length($2)) = $2
      ORDER BY issued_at DESC`,
    [taskId, suffix]
  );
  return rows.map(toDispatchRow);
}

export interface DispatchListRow extends DispatchRow {
  issuedAt: string;
}

export interface ListDispatchesFilter {
  taskId?: string;
  /** Exact full owner/name slug, case-insensitive. */
  repo?: string;
  /** true = unrevoked, unreleased and unexpired; false = inactive; omitted = both. */
  active?: boolean;
  limit: number;
}

/** Newest-first dispatch (checkout) rows — mc_list_checkouts / mc_get_task. */
export async function listDispatches(f: ListDispatchesFilter): Promise<DispatchListRow[]> {
  const rows = await query<{
    id: string;
    actor_kind: ActorKind;
    runtime: string;
    task_id: string;
    accountable_human: string;
    repo: string;
    revoked: boolean;
    issued_at: Date;
    expires_at: Date;
    released_at: Date | null;
    released_reason: string | null;
  }>(
    `SELECT id, actor_kind, runtime, task_id, accountable_human, repo, revoked, issued_at, expires_at, released_at, released_reason
       FROM mc_dispatch
      WHERE ($1::text IS NULL OR task_id = $1)
        AND ($2::text IS NULL OR lower(repo) = lower($2))
        AND ($3::boolean IS NULL OR (NOT revoked AND released_at IS NULL AND expires_at > now()) = $3)
      ORDER BY issued_at DESC
      LIMIT $4`,
    [f.taskId ?? null, f.repo ?? null, f.active ?? null, f.limit]
  );
  return rows.map((r) => ({
    id: r.id,
    actorKind: r.actor_kind,
    runtime: r.runtime,
    taskId: r.task_id,
    accountableHuman: r.accountable_human,
    repo: r.repo,
    revoked: r.revoked,
    issuedAt: r.issued_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    releasedAt: r.released_at?.toISOString() ?? null,
    releasedReason: r.released_reason ?? null,
  }));
}

/** Release and audit atomically; a repeated close is a no-op. */
export async function releaseDispatches(
  ids: string[],
  input: { repo: string; pr: number; reason: "merged" | "closed" }
): Promise<void> {
  await query(
    `WITH released AS (
       UPDATE mc_dispatch SET released_at = now(), released_reason = $4
        WHERE id = ANY($1::text[]) AND lower(repo) = lower($2)
          AND NOT revoked AND released_at IS NULL
        RETURNING id, runtime, repo, task_id
     )
     INSERT INTO mc_events (kind, actor, repo, task_id, pr, payload)
     SELECT 'checkout.released', runtime, repo, task_id, $3,
            jsonb_build_object('checkoutId', id, 'reason', $4::text) FROM released`,
    [ids, input.repo, String(input.pr), input.reason]
  );
}

/** PR reopen undoes a merge/close release only; a manual release (mc_release_checkout) stays. */
export async function unreleaseDispatches(ids: string[], input: { repo: string }): Promise<void> {
  await query(
    `UPDATE mc_dispatch SET released_at = NULL, released_reason = NULL
      WHERE id = ANY($1::text[]) AND lower(repo) = lower($2) AND NOT revoked
        AND released_reason IN ('merged', 'closed')`,
    [ids, input.repo]
  );
}

/**
 * Manual release (mc_release_checkout): set released_at/released_reason and
 * append checkout.released in one statement. Null = nothing changed (the
 * lease is already released or revoked), so a repeat writes no second event.
 */
export async function releaseDispatchManually(input: {
  id: string;
  releasedReason: string;
  actor: string;
  payload: Record<string, unknown>;
}): Promise<{ releasedAt: string; eventSeq: string } | null> {
  const rows = await query<{ released_at: Date; seq: string }>(
    `WITH released AS (
       UPDATE mc_dispatch SET released_at = now(), released_reason = $2
        WHERE id = $1 AND NOT revoked AND released_at IS NULL
        RETURNING repo, task_id, released_at
     ), evt AS (
       INSERT INTO mc_events (kind, actor, repo, task_id, payload)
       SELECT 'checkout.released', $3, repo, task_id, $4::jsonb FROM released
       RETURNING seq
     )
     SELECT released.released_at, evt.seq FROM released, evt`,
    [input.id, input.releasedReason, input.actor, JSON.stringify(input.payload)]
  );
  const r = rows[0];
  return r ? { releasedAt: r.released_at.toISOString(), eventSeq: String(r.seq) } : null;
}

// ─── Compliance check ledger ─────────────────────────────────────────────────

export async function recordCheck(c: {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  taskId: string | null;
  actorKind: ActorKind;
  verdict: Verdict;
  reasons: string[];
}): Promise<void> {
  await query(
    `INSERT INTO mc_compliance_check
       (id, repo, pr_number, head_sha, task_id, actor_kind, verdict, reasons, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $7 = 'pending' THEN NULL ELSE now() END)
     ON CONFLICT (id) DO UPDATE
       SET verdict = $7,
           reasons = $8,
           resolved_at = CASE WHEN $7 = 'pending' THEN NULL ELSE now() END`,
    [c.id, c.repo, c.prNumber, c.headSha, c.taskId ?? null, c.actorKind, c.verdict, JSON.stringify(c.reasons)]
  );
}

// ─── Reconciliation queue (fail-closed; replays on recovery, P2) ─────────────

export type ReconcileKind = "verify" | "ingest";

export interface ReconcileRow {
  id: string;
  kind: ReconcileKind;
  payload: Record<string, unknown>;
  attempts: number;
}

export async function enqueueReconcile(kind: ReconcileKind, payload: Record<string, unknown>): Promise<void> {
  await query(`INSERT INTO mc_reconcile_queue (kind, payload) VALUES ($1, $2)`, [kind, JSON.stringify(payload)]);
}

export async function pendingReconcile(limit = 100): Promise<ReconcileRow[]> {
  const rows = await query<{ id: string; kind: ReconcileKind; payload: Record<string, unknown>; attempts: number }>(
    `SELECT id, kind, payload, attempts FROM mc_reconcile_queue
      WHERE resolved_at IS NULL ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ id: String(r.id), kind: r.kind, payload: r.payload, attempts: r.attempts }));
}

export async function resolveReconcile(id: string): Promise<void> {
  await query(`UPDATE mc_reconcile_queue SET resolved_at = now() WHERE id = $1`, [id]);
}

export async function bumpReconcileAttempt(id: string, error: string): Promise<void> {
  await query(`UPDATE mc_reconcile_queue SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [id, error]);
}
