// Postgres accessors for the sync engine's state (schema: db/migrations/).
// The entity payload (jsonb `data`) keeps the canonical TS shape including
// its SyncRef; the relational sync columns are updated in the same statement
// so there is exactly one write path and no drift.

import { query } from "@/lib/db";
import type { AuditRow, SpConflict, SpError, SyncState } from "@/lib/mc-data/types";
import type { EntityData, EntityType } from "./mapping";
import { LIST_KEY_FOR } from "./mapping";

export interface EntityRow {
  entity_type: EntityType;
  id: string;
  data: EntityData;
  sync_state: SyncState;
  sp_item_id: string | null;
  dirty_fields: string[];
}

// UTC render of the prototype's timestamp format (SOUL: store/compare UTC).
export function stamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} · ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// ─── Entities ────────────────────────────────────────────────────────────────

export async function entityCount(): Promise<number> {
  const rows = await query<{ n: string }>("SELECT count(*) AS n FROM entities");
  return Number(rows[0].n);
}

export async function getEntities(type?: EntityType): Promise<EntityRow[]> {
  return query<EntityRow>(
    `SELECT entity_type, id, data, sync_state, sp_item_id, dirty_fields
       FROM entities
      WHERE $1::text IS NULL OR entity_type = $1
      ORDER BY id`,
    [type ?? null]
  );
}

export async function getEntity(type: EntityType, id: string): Promise<EntityRow | null> {
  const rows = await query<EntityRow>(
    `SELECT entity_type, id, data, sync_state, sp_item_id, dirty_fields
       FROM entities WHERE entity_type = $1 AND id = $2`,
    [type, id]
  );
  return rows[0] ?? null;
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
  await query(
    `UPDATE entities
        SET data = $3,
            sync_state = $4,
            sync_ts = now(),
            sp_item_id = COALESCE($5, sp_item_id),
            dirty_fields = COALESCE($6, dirty_fields),
            updated_at = now()
      WHERE entity_type = $1 AND id = $2`,
    [
      type,
      id,
      JSON.stringify(data),
      nextState,
      opts.spItemId ?? null,
      opts.dirtyFields ? JSON.stringify(opts.dirtyFields) : null,
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

// ─── Conflicts ───────────────────────────────────────────────────────────────

interface ConflictRow {
  id: string;
  list_key: string;
  entity_type: EntityType;
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
  entity: r.entity_type === "task" ? "Task" : r.entity_type === "risk" ? "Risk" : "File",
  entityId: r.entity_id,
  field: r.field,
  mcVal: r.mc_val ?? "—",
  spVal: r.sp_val ?? "—",
  detected: stamp(r.detected_at).split(" · ")[1] ?? "",
  by: r.detected_by,
  note: r.note,
});

export async function openConflicts(): Promise<SpConflict[]> {
  const rows = await query<ConflictRow>(
    `SELECT id, list_key, entity_type, entity_id, field, mc_val, sp_val,
            detected_at, detected_by, note
       FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY detected_at`
  );
  return rows.map(toConflict);
}

export async function getConflict(id: string): Promise<(SpConflict & { entityType: EntityType }) | null> {
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
  entityType: EntityType;
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
    [c.id, LIST_KEY_FOR[c.entityType], c.entityType, c.entityId, c.field, c.mcVal, c.spVal, c.by, c.note]
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
  return out;
}
