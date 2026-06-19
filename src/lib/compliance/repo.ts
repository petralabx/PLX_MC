// EN-007 P1b — Postgres accessors for the compliance gate (schema:
// db/migrations/005_compliance.sql). Internal to the module; the service layer
// (service.ts) is the public server surface. All SQL is parameterized. Mockable
// in tests via vi.mock (see tests/compliance-server.test.ts), mirroring the sync
// repo seam in tests/mc-patch.test.ts — so the service logic is provable without
// a live database.

import { query } from "@/lib/db";
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

export async function appendEvent(e: AppendEventInput): Promise<void> {
  await query(
    `INSERT INTO mc_events (kind, actor, repo, task_id, pr, payload, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
    [e.kind, e.actor, e.repo ?? null, e.taskId ?? null, e.pr ?? null, JSON.stringify(e.payload ?? {}), e.dedupKey ?? null]
  );
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

export async function getDispatch(id: string): Promise<DispatchRow | null> {
  const rows = await query<{
    id: string;
    actor_kind: ActorKind;
    runtime: string;
    task_id: string;
    accountable_human: string;
    repo: string;
    revoked: boolean;
    expires_at: Date;
  }>(
    `SELECT id, actor_kind, runtime, task_id, accountable_human, repo, revoked, expires_at
       FROM mc_dispatch WHERE id = $1`,
    [id]
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        actorKind: r.actor_kind,
        runtime: r.runtime,
        taskId: r.task_id,
        accountableHuman: r.accountable_human,
        repo: r.repo,
        revoked: r.revoked,
        expiresAt: r.expires_at.toISOString(),
      }
    : null;
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
