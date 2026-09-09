// Postgres accessors for the sync engine's state (schema: db/migrations/).
// The entity payload (jsonb `data`) keeps the canonical TS shape including
// its SyncRef; the relational sync columns are updated in the same statement
// so there is exactly one write path and no drift.

import { query, withTransaction, type TxQuery } from "@/lib/db";
import type {
  AuditRow,
  Bucket,
  Comment,
  Project,
  Repo,
  RepoRequest,
  RepoRequestStatus,
  RepoVisibility,
  SpConflict,
  SpError,
  SyncState,
  Task,
} from "@/lib/mc-data/types";
import type {
  EntityData,
  EntityType,
  FieldAttribution,
  SyncConflictSubject,
} from "./mapping";
import { CONFLICT_LIST_KEY_FOR, LIST_KEY_FOR, numericTaskId } from "./mapping";

export interface EntityRow {
  entity_type: EntityType;
  id: string;
  data: EntityData;
  sync_state: SyncState;
  sp_item_id: string | null;
  dirty_fields: string[];
  field_attribution: Record<string, FieldAttribution>;
}

// UTC render of the prototype's timestamp format (SOUL: store/compare UTC).
export function stamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} · ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// ─── Entities ────────────────────────────────────────────────────────────────

function parseAttribution(raw: unknown): Record<string, FieldAttribution> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, FieldAttribution> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const src = (v as FieldAttribution).source;
    const at = (v as FieldAttribution).at;
    if ((src === "human" || src === "service" || src === "unknown") && typeof at === "string") {
      out[k] = {
        source: src,
        at,
        actorId: typeof (v as FieldAttribution).actorId === "string" ? (v as FieldAttribution).actorId : undefined,
      };
    }
  }
  return out;
}

export async function entityCount(): Promise<number> {
  const rows = await query<{ n: string }>("SELECT count(*) AS n FROM entities");
  return Number(rows[0].n);
}

export async function getEntities(type?: EntityType): Promise<EntityRow[]> {
  const rows = await query<{
    entity_type: EntityType;
    id: string;
    data: EntityData;
    sync_state: SyncState;
    sp_item_id: string | null;
    dirty_fields: string[];
    field_attribution: unknown;
  }>(
    `SELECT entity_type, id, data, sync_state, sp_item_id, dirty_fields,
            COALESCE(field_attribution, '{}'::jsonb) AS field_attribution
       FROM entities
      WHERE $1::text IS NULL OR entity_type = $1
      ORDER BY id`,
    [type ?? null]
  );
  return rows.map((r) => ({
    entity_type: r.entity_type,
    id: r.id,
    data: r.data,
    sync_state: r.sync_state,
    sp_item_id: r.sp_item_id,
    dirty_fields: r.dirty_fields,
    field_attribution: parseAttribution(r.field_attribution),
  }));
}

export async function getEntity(type: EntityType, id: string): Promise<EntityRow | null> {
  const rows = await query<{
    entity_type: EntityType;
    id: string;
    data: EntityData;
    sync_state: SyncState;
    sp_item_id: string | null;
    dirty_fields: string[];
    field_attribution: unknown;
  }>(
    `SELECT entity_type, id, data, sync_state, sp_item_id, dirty_fields,
            COALESCE(field_attribution, '{}'::jsonb) AS field_attribution
       FROM entities WHERE entity_type = $1 AND id = $2`,
    [type, id]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    entity_type: r.entity_type,
    id: r.id,
    data: r.data,
    sync_state: r.sync_state,
    sp_item_id: r.sp_item_id,
    dirty_fields: r.dirty_fields,
    field_attribution: parseAttribution(r.field_attribution),
  };
}

export async function insertEntity(
  type: EntityType,
  id: string,
  data: EntityData,
  syncState: SyncState,
  dirtyFields: string[]
): Promise<void> {
  await query(
    `INSERT INTO entities (entity_type, id, data, sync_state, sync_ts, dirty_fields)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (entity_type, id) DO NOTHING`,
    [type, id, JSON.stringify(data), syncState, JSON.stringify(dirtyFields)]
  );
}

// Apply a data patch and sync bookkeeping atomically. `data.sync` is kept in
// step with the relational columns inside the same UPDATE.
export async function updateEntity(
  type: EntityType,
  id: string,
  opts: {
    patch?: EntityData;
    syncState?: SyncState;
    spItemId?: string;
    dirtyFields?: string[];
    fieldAttribution?: Record<string, FieldAttribution>;
    syncExtras?: Record<string, string | undefined>; // wsVal / spVal / reason
  }
): Promise<void> {
  const row = await getEntity(type, id);
  if (!row) return;
  const data = { ...row.data, ...(opts.patch ?? {}) };
  const prevSync = (row.data.sync ?? {}) as Record<string, unknown>;
  const nextState = opts.syncState ?? row.sync_state;
  const sync: Record<string, unknown> = {
    ...prevSync,
    state: nextState,
    ts: stamp(),
  };
  delete sync.wsVal;
  delete sync.spVal;
  delete sync.reason;
  for (const [k, v] of Object.entries(opts.syncExtras ?? {})) {
    if (v !== undefined) sync[k] = v;
  }
  data.sync = sync;

  let attribution = { ...row.field_attribution };
  if (opts.fieldAttribution) {
    attribution = { ...attribution, ...opts.fieldAttribution };
  }
  // Default any newly-dirty field without attribution to unknown (ambiguous → manual).
  if (opts.dirtyFields) {
    const nowIso = new Date().toISOString();
    for (const f of opts.dirtyFields) {
      if (!attribution[f]) attribution[f] = { source: "unknown", at: nowIso };
    }
    // Drop attribution for fields no longer dirty.
    for (const key of Object.keys(attribution)) {
      if (!opts.dirtyFields.includes(key)) delete attribution[key];
    }
  }

  await query(
    `UPDATE entities
        SET data = $3,
            sync_state = $4,
            sync_ts = now(),
            sp_item_id = COALESCE($5, sp_item_id),
            dirty_fields = COALESCE($6, dirty_fields),
            field_attribution = COALESCE($7, field_attribution),
            updated_at = now()
      WHERE entity_type = $1 AND id = $2`,
    [
      type,
      id,
      JSON.stringify(data),
      nextState,
      opts.spItemId ?? null,
      opts.dirtyFields ? JSON.stringify(opts.dirtyFields) : null,
      opts.dirtyFields || opts.fieldAttribution ? JSON.stringify(attribution) : null,
    ]
  );
}

// ─── Delta links ─────────────────────────────────────────────────────────────

export async function getDeltaLink(listKey: string): Promise<string | null> {
  const rows = await query<{ delta_link: string }>(
    "SELECT delta_link FROM delta_links WHERE list_key = $1",
    [listKey]
  );
  return rows[0]?.delta_link ?? null;
}

export async function saveDeltaLink(listKey: string, deltaLink: string): Promise<void> {
  await query(
    `INSERT INTO delta_links (list_key, delta_link, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (list_key) DO UPDATE SET delta_link = $2, updated_at = now()`,
    [listKey, deltaLink]
  );
}

/** Stamp a complete successful inbound delta for a register (P4 freshness). */
export async function markRegisterInboundComplete(
  listKey: string,
  at: Date = new Date()
): Promise<void> {
  await query(
    `INSERT INTO sync_register_freshness (list_key, last_complete_inbound_at, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (list_key) DO UPDATE
       SET last_complete_inbound_at = EXCLUDED.last_complete_inbound_at,
           updated_at = now()`,
    [listKey, at.toISOString()]
  );
}

export async function getRegisterInboundCompletions(): Promise<Record<string, Date | null>> {
  const rows = await query<{ list_key: string; last_complete_inbound_at: Date }>(
    `SELECT list_key, last_complete_inbound_at FROM sync_register_freshness`
  );
  const out: Record<string, Date | null> = {};
  for (const r of rows) out[r.list_key] = r.last_complete_inbound_at;
  return out;
}

export type BoringGateOutcome = "green" | "reset";

export interface BoringGateRow {
  tickStreak: number;
  requiredN: number;
  gateMet: boolean;
  lastEvalAt: string | null;
  lastOutcome: BoringGateOutcome | null;
  lastResetReason: string | null;
  updatedAt: string | null;
}

type BoringGateDbRow = {
  tick_streak: number;
  required_n: number;
  gate_met: boolean;
  last_eval_at: Date | null;
  last_outcome: string | null;
  last_reset_reason: string | null;
  updated_at: Date | null;
};

function toBoringGateRow(r: BoringGateDbRow): BoringGateRow {
  const outcome =
    r.last_outcome === "green" || r.last_outcome === "reset" ? r.last_outcome : null;
  return {
    tickStreak: r.tick_streak,
    requiredN: r.required_n,
    gateMet: r.gate_met,
    lastEvalAt: r.last_eval_at ? r.last_eval_at.toISOString() : null,
    lastOutcome: outcome,
    lastResetReason: r.last_reset_reason,
    updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

/** Singleton mirror-is-boring streak row (021). */
export async function getBoringGateRow(): Promise<BoringGateRow | null> {
  const rows = await query<BoringGateDbRow>(
    `SELECT tick_streak, required_n, gate_met, last_eval_at, last_outcome,
            last_reset_reason, updated_at
       FROM sync_boring_gate WHERE id = 1`
  );
  return rows[0] ? toBoringGateRow(rows[0]) : null;
}

export async function upsertBoringGateRow(
  row: Omit<BoringGateRow, "updatedAt">
): Promise<BoringGateRow> {
  const rows = await query<BoringGateDbRow>(
    `INSERT INTO sync_boring_gate (
       id, tick_streak, required_n, gate_met, last_eval_at, last_outcome,
       last_reset_reason, updated_at
     ) VALUES (1, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       tick_streak = EXCLUDED.tick_streak,
       required_n = EXCLUDED.required_n,
       gate_met = EXCLUDED.gate_met,
       last_eval_at = EXCLUDED.last_eval_at,
       last_outcome = EXCLUDED.last_outcome,
       last_reset_reason = EXCLUDED.last_reset_reason,
       updated_at = now()
     RETURNING tick_streak, required_n, gate_met, last_eval_at, last_outcome,
               last_reset_reason, updated_at`,
    [
      row.tickStreak,
      row.requiredN,
      row.gateMet,
      row.lastEvalAt,
      row.lastOutcome,
      row.lastResetReason,
    ]
  );
  return toBoringGateRow(rows[0]!);
}

/**
 * Advance mc_task_id_seq above an adopted TASK-* id without ever moving
 * backward (P4 / 018 contract).
 */
export async function reconcileTaskIdSequence(adoptedTaskId: string): Promise<void> {
  const n = numericTaskId(adoptedTaskId);
  if (n == null || n < 1) return;
  await query(
    `SELECT setval(
       'mc_task_id_seq',
       GREATEST(
         $1::bigint,
         CASE WHEN is_called THEN last_value ELSE last_value - 1 END
       ),
       true
     )
     FROM mc_task_id_seq`,
    [n]
  );
}

export type TransactionRunner = <T>(fn: (q: TxQuery) => Promise<T>) => Promise<T>;

/**
 * Atomically adopt an unknown SharePoint Task, bind its item id, and advance
 * the global Task allocator. The same TxQuery owns every statement; callers
 * must not split insertion and sequence reconciliation.
 */
export async function insertAdoptedTask(
  task: Task,
  spItemId: string,
  runTransaction: TransactionRunner = withTransaction
): Promise<boolean> {
  const imported = numericTaskId(task.id);
  if (imported == null || imported < 1) {
    throw new Error(`invalid adopted Task id ${task.id}`);
  }
  return runTransaction(async (q) => {
    const inserted = await q<{ id: string }>(
      `INSERT INTO entities (
         entity_type, id, data, sync_state, sync_ts, sp_item_id,
         dirty_fields, field_attribution
       )
       VALUES ('task', $1, $2, 'synced', now(), $3, '[]'::jsonb, '{}'::jsonb)
       ON CONFLICT (entity_type, id) DO NOTHING
       RETURNING id`,
      [task.id, JSON.stringify(task), spItemId]
    );
    if (!inserted[0]) return false;

    // GREATEST makes reconciliation monotonic. PostgreSQL serializes sequence
    // state changes; the next allocator observes at least imported + 1.
    await q(
      `SELECT setval(
         'mc_task_id_seq',
         GREATEST(
           $1::bigint,
           CASE WHEN is_called THEN last_value ELSE last_value - 1 END
         ),
         true
       )
       FROM mc_task_id_seq`,
      [imported]
    );
    return true;
  });
}

// The last-sweep heartbeat. Every sweep re-stamps each list's delta cursor
// (saveDeltaLink above), so max(updated_at) is "when a sweep last ran" —
// independent of whether that sweep wrote an audit row. The snapshot uses this
// for the "Last sync" indicator so it advances even on no-op sweeps (the engine
// no longer audits idle sweeps).
export async function lastSweepAt(): Promise<string | null> {
  const rows = await query<{ updated_at: Date | null }>(
    "SELECT max(updated_at) AS updated_at FROM delta_links"
  );
  return rows[0]?.updated_at ? stamp(rows[0].updated_at) : null;
}

// ─── Conflicts ───────────────────────────────────────────────────────────────

interface ConflictRow {
  id: string;
  list_key: string;
  entity_type: SyncConflictSubject;
  entity_id: string;
  field: string;
  mc_val: string | null;
  sp_val: string | null;
  detected_at: Date;
  detected_by: string;
  note: string;
}

const toConflict = (r: ConflictRow): SpConflict => ({
  id: r.id,
  list: r.list_key,
  entity:
    r.entity_type === "task"
      ? "Task"
      : r.entity_type === "risk"
        ? "Risk"
        : r.entity_type === "bucket"
          ? "Bucket"
          : r.entity_type === "project"
            ? "Project"
            : "File",
  entityId: r.entity_id,
  field: r.field,
  mcVal: r.mc_val ?? "—",
  spVal: r.sp_val ?? "—",
  detected: stamp(r.detected_at).split(" · ")[1] ?? "",
  by: r.detected_by,
  note: r.note,
});

/** Open conflict row plus raw SQL fields Ledger needs (cf-* id, entityType, detected_at). */
export type ListedConflict = SpConflict & {
  entityType: SyncConflictSubject;
  mc_val: string | null;
  sp_val: string | null;
  detected_at: string;
};

function isoDetectedAt(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const toListedConflict = (r: ConflictRow): ListedConflict => ({
  ...toConflict(r),
  entityType: r.entity_type,
  mc_val: r.mc_val,
  sp_val: r.sp_val,
  detected_at: isoDetectedAt(r.detected_at),
});

async function loadOpenConflictRows(): Promise<ConflictRow[]> {
  return query<ConflictRow>(
    `SELECT id, list_key, entity_type, entity_id, field, mc_val, sp_val,
            detected_at, detected_by, note
       FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY detected_at`
  );
}

export async function openConflicts(): Promise<SpConflict[]> {
  return (await loadOpenConflictRows()).map(toConflict);
}

export async function listOpenConflicts(): Promise<ListedConflict[]> {
  return (await loadOpenConflictRows()).map(toListedConflict);
}

export async function getConflict(
  id: string
): Promise<(SpConflict & { entityType: SyncConflictSubject }) | null> {
  const rows = await query<ConflictRow>(
    `SELECT id, list_key, entity_type, entity_id, field, mc_val, sp_val,
            detected_at, detected_by, note
       FROM sync_conflicts WHERE id = $1 AND resolved_at IS NULL`,
    [id]
  );
  return rows[0] ? { ...toConflict(rows[0]), entityType: rows[0].entity_type } : null;
}

export async function insertConflict(c: {
  id: string;
  entityType: SyncConflictSubject;
  entityId: string;
  field: string;
  mcVal: string;
  spVal: string;
  by: string;
  note: string;
}): Promise<void> {
  await query(
    `INSERT INTO sync_conflicts (id, list_key, entity_type, entity_id, field, mc_val, sp_val, detected_by, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      c.id,
      CONFLICT_LIST_KEY_FOR[c.entityType],
      c.entityType,
      c.entityId,
      c.field,
      c.mcVal,
      c.spVal,
      c.by,
      c.note,
    ]
  );
}

export async function resolveConflictRow(id: string, winner: "mc" | "sp"): Promise<void> {
  await query("UPDATE sync_conflicts SET resolved_at = now(), winner = $2 WHERE id = $1", [id, winner]);
}

// ─── Push errors ─────────────────────────────────────────────────────────────

interface ErrorRow {
  id: string;
  list_key: string;
  entity_type: EntityType;
  entity_id: string;
  field: string;
  value: string | null;
  reason: string;
}

const toError = (r: ErrorRow): SpError => ({
  id: r.id,
  list: r.list_key,
  entity: r.entity_type === "task" ? "Task" : r.entity_type === "risk" ? "Risk" : "File",
  entityId: r.entity_id,
  field: r.field,
  value: r.value ?? "—",
  reason: r.reason,
});

export async function openErrors(): Promise<SpError[]> {
  const rows = await query<ErrorRow>(
    `SELECT id, list_key, entity_type, entity_id, field, value, reason
       FROM sync_push_errors WHERE resolved_at IS NULL ORDER BY created_at`
  );
  return rows.map(toError);
}

export async function getError(id: string): Promise<(SpError & { entityType: EntityType }) | null> {
  const rows = await query<ErrorRow>(
    `SELECT id, list_key, entity_type, entity_id, field, value, reason
       FROM sync_push_errors WHERE id = $1 AND resolved_at IS NULL`,
    [id]
  );
  return rows[0] ? { ...toError(rows[0]), entityType: rows[0].entity_type } : null;
}

export async function insertPushError(e: {
  id: string;
  entityType: EntityType;
  entityId: string;
  field: string;
  value: string;
  reason: string;
}): Promise<void> {
  await query(
    `INSERT INTO sync_push_errors (id, list_key, entity_type, entity_id, field, value, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [e.id, LIST_KEY_FOR[e.entityType], e.entityType, e.entityId, e.field, e.value, e.reason]
  );
}

export async function resolveErrorRow(id: string): Promise<void> {
  await query("UPDATE sync_push_errors SET resolved_at = now() WHERE id = $1", [id]);
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export async function appendAudit(actor: string, body: string, state: SyncState): Promise<void> {
  await query("INSERT INTO sync_audit_log (actor, body, state) VALUES ($1, $2, $3)", [actor, body, state]);
}

export async function auditRows(limit = 100): Promise<AuditRow[]> {
  const rows = await query<{ ts: Date; actor: string; body: string; state: SyncState }>(
    "SELECT ts, actor, body, state FROM sync_audit_log ORDER BY ts DESC, id DESC LIMIT $1",
    [limit]
  );
  return rows.map((r) => ({ ts: stamp(r.ts), actor: r.actor, body: r.body, state: r.state }));
}

// ─── Counts ──────────────────────────────────────────────────────────────────

export interface ListCounts {
  synced: number;
  pending: number;
  conflict: number;
  error: number;
}

export async function countsByList(): Promise<Record<string, ListCounts>> {
  const rows = await query<{ entity_type: EntityType; sync_state: SyncState; n: string }>(
    "SELECT entity_type, sync_state, count(*) AS n FROM entities GROUP BY entity_type, sync_state"
  );
  const out: Record<string, ListCounts> = {};
  for (const r of rows) {
    const key = LIST_KEY_FOR[r.entity_type];
    out[key] ??= { synced: 0, pending: 0, conflict: 0, error: 0 };
    out[key][r.sync_state] += Number(r.n);
  }
  // Repo Registry (EN-002 / Item 2) is a separate table; surface its live counts
  // under the same `reporegistry` list key the UI reads.
  const repoRows = await query<{ sync_state: SyncState; n: string }>(
    "SELECT sync_state, count(*) AS n FROM repos GROUP BY sync_state"
  );
  for (const r of repoRows) {
    out.reporegistry ??= { synced: 0, pending: 0, conflict: 0, error: 0 };
    out.reporegistry[r.sync_state] += Number(r.n);
  }
  return out;
}

// ─── Bucket comments (EN-001 / Item 4 — app-only, never pushed to SharePoint) ─

interface BucketCommentRow {
  bucket_id: string;
  id: string;
  author: string;
  body: string;
  mentions: unknown;
  ts: string;
  edited_ts: string | null;
}

const toComment = (r: BucketCommentRow): Comment => ({
  id: r.id,
  author: r.author,
  body: r.body,
  ts: r.ts,
  mentions: Array.isArray(r.mentions) ? (r.mentions as string[]) : [],
  ...(r.edited_ts ? { editedTs: r.edited_ts } : {}),
});

// All bucket threads, grouped by bucket id and ordered by their stored position.
export async function bucketCommentsByBucket(): Promise<Record<string, Comment[]>> {
  const rows = await query<BucketCommentRow>(
    `SELECT bucket_id, id, author, body, mentions, ts, edited_ts
       FROM bucket_comments ORDER BY bucket_id, position`
  );
  const out: Record<string, Comment[]> = {};
  for (const r of rows) (out[r.bucket_id] ??= []).push(toComment(r));
  return out;
}

// Replace a bucket's whole thread atomically (mirrors the task-comment "send the
// whole array" round-trip). delete-by-bucket (always a WHERE) + re-insert in
// array order, in one transaction. Returns the stored comments.
export async function replaceBucketComments(bucketId: string, comments: Comment[]): Promise<Comment[]> {
  await withTransaction(async (q) => {
    await q("DELETE FROM bucket_comments WHERE bucket_id = $1", [bucketId]);
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      await q(
        `INSERT INTO bucket_comments (bucket_id, id, position, author, body, mentions, ts, edited_ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [bucketId, c.id, i, c.author, c.body, JSON.stringify(c.mentions ?? []), c.ts, c.editedTs ?? null]
      );
    }
  });
  return comments;
}

// ─── Repo registry + request queue (EN-002 / Item 2) ─────────────────────────

interface RepoRow {
  id: string;
  name: string;
  lang: string;
  def_branch: string;
  owner: string;
  visibility: RepoVisibility;
  scope: string;
  sync_state: SyncState;
  sp_item_id: string | null;
}

export interface RepoWithSync extends Repo {
  syncState: SyncState;
  spItemId: string | null;
}

const toRepoWithSync = (r: RepoRow): RepoWithSync => ({
  id: r.id,
  name: r.name,
  lang: r.lang,
  def: r.def_branch,
  owner: r.owner,
  visibility: r.visibility,
  scope: r.scope,
  syncState: r.sync_state,
  spItemId: r.sp_item_id,
});

export async function getRepos(): Promise<RepoWithSync[]> {
  const rows = await query<RepoRow>(
    `SELECT id, name, lang, def_branch, owner, visibility, scope, sync_state, sp_item_id
       FROM repos ORDER BY id`
  );
  return rows.map(toRepoWithSync);
}

// Idempotent seed of the canonical registry from the REPOS fixture — never
// disturbs an existing row (ON CONFLICT DO NOTHING), so an approved repo or a
// sync-state change is preserved across boots.
export async function seedRepos(repos: Repo[]): Promise<void> {
  for (const r of repos) {
    await query(
      `INSERT INTO repos (id, name, lang, def_branch, owner, visibility, scope, sync_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.name, r.lang, r.def, r.owner, r.visibility, r.scope]
    );
  }
}

// Upsert a registry repo (an approval) — registry edits re-queue the push-only
// SharePoint mirror (sync_state -> pending), preserving the prior sp_item_id.
export async function upsertRepo(r: Repo): Promise<void> {
  await query(
    `INSERT INTO repos (id, name, lang, def_branch, owner, visibility, scope, sync_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     ON CONFLICT (id) DO UPDATE SET
       name = $2, lang = $3, def_branch = $4, owner = $5,
       visibility = $6, scope = $7, sync_state = 'pending', updated_at = now()`,
    [r.id, r.name, r.lang, r.def, r.owner, r.visibility, r.scope]
  );
}

export async function setRepoSync(id: string, syncState: SyncState, spItemId?: string): Promise<void> {
  await query(
    `UPDATE repos SET sync_state = $2, sp_item_id = COALESCE($3, sp_item_id), updated_at = now()
      WHERE id = $1`,
    [id, syncState, spItemId ?? null]
  );
}

interface RepoRequestRow {
  id: string;
  name: string;
  owner: string;
  lang: string | null;
  visibility: RepoVisibility | null;
  scope: string | null;
  def_branch: string | null;
  requested_by: string;
  requested_ts: string;
  status: RepoRequestStatus;
  verified: boolean;
  note: string | null;
  decided_by: string | null;
  decided_ts: string | null;
}

const toRepoRequest = (r: RepoRequestRow): RepoRequest => ({
  id: r.id,
  name: r.name,
  owner: r.owner,
  lang: r.lang ?? undefined,
  visibility: r.visibility ?? undefined,
  scope: r.scope ?? undefined,
  def: r.def_branch ?? undefined,
  requestedBy: r.requested_by,
  requestedTs: r.requested_ts,
  status: r.status,
  verified: r.verified,
  note: r.note ?? undefined,
  decidedBy: r.decided_by ?? undefined,
  decidedTs: r.decided_ts ?? undefined,
});

export async function getRepoRequests(): Promise<RepoRequest[]> {
  const rows = await query<RepoRequestRow>(
    `SELECT id, name, owner, lang, visibility, scope, def_branch, requested_by,
            requested_ts, status, verified, note, decided_by, decided_ts
       FROM repo_requests ORDER BY created_at DESC`
  );
  return rows.map(toRepoRequest);
}

// Upsert the full request row (create, post-validation verify, and decision all
// mirror through here — idempotent on id).
export async function upsertRepoRequest(req: RepoRequest): Promise<void> {
  await query(
    `INSERT INTO repo_requests
       (id, name, owner, lang, visibility, scope, def_branch, requested_by,
        requested_ts, status, verified, note, decided_by, decided_ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       name = $2, owner = $3, lang = $4, visibility = $5, scope = $6, def_branch = $7,
       status = $10, verified = $11, note = $12, decided_by = $13, decided_ts = $14,
       updated_at = now()`,
    [
      req.id,
      req.name,
      req.owner,
      req.lang ?? null,
      req.visibility ?? null,
      req.scope ?? null,
      req.def ?? null,
      req.requestedBy,
      req.requestedTs,
      req.status,
      req.verified,
      req.note ?? null,
      req.decidedBy ?? null,
      req.decidedTs ?? null,
    ]
  );
}

// ─── Buckets / initiatives (EN-005) ──────────────────────────────────────────

interface BucketRow {
  id: string;
  data: Bucket;
  project_id: string | null;
}

export async function getBuckets(): Promise<Bucket[]> {
  const rows = await query<BucketRow>("SELECT id, data, project_id FROM buckets ORDER BY created_at, id");
  // The relational FK is authoritative for the parent (the 011 backfill set it
  // without rewriting jsonb) — fold it into the shape when data.project is unset.
  return rows.map((r) => (r.data.project === undefined ? { ...r.data, project: r.project_id } : r.data));
}

// Idempotent seed of the fixture buckets — never disturbs an existing/edited row
// (ON CONFLICT DO NOTHING), so a fresh DB gets the 8 initiatives and any edits
// persist across boots. The relational project_id FK is written from the fixture's
// `project` so the jsonb and the FK never disagree on a fresh seed.
export async function seedBuckets(buckets: Bucket[]): Promise<void> {
  for (const b of buckets) {
    await query(
      `INSERT INTO buckets (id, data, sync_state, project_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [b.id, JSON.stringify(b), b.sync?.state ?? "pending", b.project ?? null]
    );
  }
}

// Upsert a bucket (create or edit). An edit re-queues the Roadmap mirror
// (sync_state -> pending), preserving the prior sp_item_id. The relational
// project_id FK moves with data.project in the same statement (one write path).
// `dirtyFields` (when provided) replaces the dirty set used for inbound conflict
// detection on Gantt fields.
export async function upsertBucket(b: Bucket, dirtyFields?: string[]): Promise<void> {
  if (dirtyFields) {
    await query(
      `INSERT INTO buckets (id, data, sync_state, project_id, dirty_fields) VALUES ($1, $2, 'pending', $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = $2, sync_state = 'pending', project_id = $3, dirty_fields = $4::jsonb, updated_at = now()`,
      [b.id, JSON.stringify(b), b.project ?? null, JSON.stringify(dirtyFields)]
    );
    return;
  }
  await query(
    `INSERT INTO buckets (id, data, sync_state, project_id) VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (id) DO UPDATE SET data = $2, sync_state = 'pending', project_id = $3, updated_at = now()`,
    [b.id, JSON.stringify(b), b.project ?? null]
  );
}

export interface BucketWithSync {
  bucket: Bucket;
  syncState: SyncState;
  spItemId: string | null;
  dirtyFields: string[];
  /** Present after migration 019; omit/empty means unknown attribution. */
  fieldAttribution?: Record<string, FieldAttribution>;
}

export async function getBucketRows(): Promise<BucketWithSync[]> {
  const rows = await query<{
    id: string;
    data: Bucket;
    sync_state: SyncState;
    sp_item_id: string | null;
    project_id: string | null;
    dirty_fields: string[] | null;
    field_attribution: unknown;
  }>(
    `SELECT id, data, sync_state, sp_item_id, project_id, dirty_fields,
            COALESCE(field_attribution, '{}'::jsonb) AS field_attribution
       FROM buckets ORDER BY created_at, id`
  );
  return rows.map((r) => ({
    bucket: r.data.project === undefined ? { ...r.data, project: r.project_id } : r.data,
    syncState: r.sync_state,
    spItemId: r.sp_item_id,
    dirtyFields: Array.isArray(r.dirty_fields) ? r.dirty_fields : [],
    fieldAttribution: parseAttribution(r.field_attribution),
  }));
}

export async function getBucketBySpItemId(spItemId: string): Promise<BucketWithSync | null> {
  const rows = await query<{
    id: string;
    data: Bucket;
    sync_state: SyncState;
    sp_item_id: string | null;
    project_id: string | null;
    dirty_fields: string[] | null;
    field_attribution: unknown;
  }>(
    `SELECT id, data, sync_state, sp_item_id, project_id, dirty_fields,
            COALESCE(field_attribution, '{}'::jsonb) AS field_attribution
       FROM buckets WHERE sp_item_id = $1 LIMIT 1`,
    [spItemId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    bucket: r.data.project === undefined ? { ...r.data, project: r.project_id } : r.data,
    syncState: r.sync_state,
    spItemId: r.sp_item_id,
    dirtyFields: Array.isArray(r.dirty_fields) ? r.dirty_fields : [],
    fieldAttribution: parseAttribution(r.field_attribution),
  };
}

export async function updateBucket(
  id: string,
  opts: {
    patch?: Partial<Bucket>;
    syncState?: SyncState;
    dirtyFields?: string[];
    fieldAttribution?: Record<string, FieldAttribution>;
    spItemId?: string;
  }
): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  let n = 2;
  if (opts.patch && Object.keys(opts.patch).length > 0) {
    sets.push(`data = data || $${n}::jsonb`);
    params.push(JSON.stringify(opts.patch));
    n += 1;
  }
  if (opts.syncState) {
    sets.push(`sync_state = $${n}`);
    params.push(opts.syncState);
    n += 1;
  }
  if (opts.dirtyFields) {
    sets.push(`dirty_fields = $${n}::jsonb`);
    params.push(JSON.stringify(opts.dirtyFields));
    n += 1;
  }
  if (opts.fieldAttribution) {
    sets.push(`field_attribution = $${n}::jsonb`);
    params.push(JSON.stringify(opts.fieldAttribution));
    n += 1;
  }
  if (opts.spItemId !== undefined) {
    sets.push(`sp_item_id = $${n}`);
    params.push(opts.spItemId);
    n += 1;
  }
  await query(`UPDATE buckets SET ${sets.join(", ")} WHERE id = $1`, params);
}

export async function setBucketSync(
  id: string,
  syncState: SyncState,
  opts: { spItemId?: string; spRef?: string } = {}
): Promise<void> {
  await query(
    `UPDATE buckets
        SET sync_state = $2,
            sp_item_id = COALESCE($3, sp_item_id),
            dirty_fields = '[]'::jsonb,
            data = jsonb_set(data, '{sync}', data->'sync' || $4::jsonb),
            updated_at = now()
      WHERE id = $1`,
    [
      id,
      syncState,
      opts.spItemId ?? null,
      JSON.stringify({ state: syncState, ts: stamp(), ...(opts.spRef ? { sp: opts.spRef } : {}) }),
    ]
  );
}

// ─── Projects (P2 — the optional parent above buckets) ───────────────────────

interface ProjectRow {
  id: string;
  data: Project;
}

export async function getProjects(): Promise<Project[]> {
  const rows = await query<ProjectRow>("SELECT id, data FROM projects ORDER BY created_at, id");
  return rows.map((r) => r.data);
}

// Projects with their sync bookkeeping (for the push-only Projects mirror —
// the same shape the repo-registry push consumes).
export interface ProjectWithSync {
  project: Project;
  syncState: SyncState;
  spItemId: string | null;
  dirtyFields: string[];
  fieldAttribution?: Record<string, FieldAttribution>;
}

export async function getProjectRows(): Promise<ProjectWithSync[]> {
  const rows = await query<{
    id: string;
    data: Project;
    sync_state: SyncState;
    sp_item_id: string | null;
    dirty_fields: string[] | null;
    field_attribution: unknown;
  }>(
    `SELECT id, data, sync_state, sp_item_id,
            COALESCE(dirty_fields, '[]'::jsonb) AS dirty_fields,
            COALESCE(field_attribution, '{}'::jsonb) AS field_attribution
       FROM projects ORDER BY created_at, id`
  );
  return rows.map((r) => ({
    project: r.data,
    syncState: r.sync_state,
    spItemId: r.sp_item_id,
    dirtyFields: Array.isArray(r.dirty_fields) ? r.dirty_fields : [],
    fieldAttribution: parseAttribution(r.field_attribution),
  }));
}

// Idempotent seed of the fixture projects — mirrors seedBuckets (never disturbs an
// existing/edited row), so a fresh DB gets the umbrella project and edits persist.
export async function seedProjects(projects: Project[]): Promise<void> {
  for (const p of projects) {
    await query(
      `INSERT INTO projects (id, data, sync_state) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, JSON.stringify(p), p.sync?.state ?? "pending"]
    );
  }
}

// Upsert a project (create or edit). An edit re-queues the push-only Projects
// mirror (sync_state -> pending), preserving the prior sp_item_id.
export async function upsertProject(p: Project): Promise<void> {
  await query(
    `INSERT INTO projects (id, data, sync_state) VALUES ($1, $2, 'pending')
     ON CONFLICT (id) DO UPDATE SET data = $2, sync_state = 'pending', updated_at = now()`,
    [p.id, JSON.stringify(p)]
  );
}

// Record a push outcome for a project: relational sync columns AND the jsonb
// data.sync ref move together in one statement (one write path, no drift).
export async function setProjectSync(
  id: string,
  syncState: SyncState,
  opts: { spItemId?: string; spRef?: string } = {}
): Promise<void> {
  await query(
    `UPDATE projects
        SET sync_state = $2,
            sp_item_id = COALESCE($3, sp_item_id),
            dirty_fields = CASE WHEN $2 = 'synced' THEN '[]'::jsonb ELSE dirty_fields END,
            data = jsonb_set(data, '{sync}', data->'sync' || $4::jsonb),
            updated_at = now()
      WHERE id = $1`,
    [
      id,
      syncState,
      opts.spItemId ?? null,
      JSON.stringify({ state: syncState, ts: stamp(), ...(opts.spRef ? { sp: opts.spRef } : {}) }),
    ]
  );
}

export async function updateProject(
  id: string,
  opts: {
    patch?: Partial<Project>;
    syncState?: SyncState;
    dirtyFields?: string[];
    fieldAttribution?: Record<string, FieldAttribution>;
    spItemId?: string;
  }
): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  let n = 2;
  if (opts.patch && Object.keys(opts.patch).length > 0) {
    sets.push(`data = data || $${n}::jsonb`);
    params.push(JSON.stringify(opts.patch));
    n += 1;
  }
  if (opts.syncState) {
    sets.push(`sync_state = $${n}`);
    params.push(opts.syncState);
    n += 1;
  }
  if (opts.dirtyFields) {
    sets.push(`dirty_fields = $${n}::jsonb`);
    params.push(JSON.stringify(opts.dirtyFields));
    n += 1;
  }
  if (opts.fieldAttribution) {
    sets.push(`field_attribution = $${n}::jsonb`);
    params.push(JSON.stringify(opts.fieldAttribution));
    n += 1;
  }
  if (opts.spItemId !== undefined) {
    sets.push(`sp_item_id = $${n}`);
    params.push(opts.spItemId);
    n += 1;
  }
  await query(`UPDATE projects SET ${sets.join(", ")} WHERE id = $1`, params);
}

/** Insert a newly adopted inbound Project (never overwrites an existing id). */
export async function insertAdoptedProject(
  project: Project,
  spItemId: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO projects (id, data, sync_state, sp_item_id, dirty_fields)
     VALUES ($1, $2, 'synced', $3, '[]'::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [project.id, JSON.stringify(project), spItemId]
  );
  return rows.length > 0;
}

/** Insert a newly adopted inbound Bucket. */
export async function insertAdoptedBucket(bucket: Bucket, spItemId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO buckets (id, data, sync_state, sp_item_id, project_id, dirty_fields)
     VALUES ($1, $2, 'synced', $3, $4, '[]'::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [bucket.id, JSON.stringify(bucket), spItemId, bucket.project ?? null]
  );
  return rows.length > 0;
}
