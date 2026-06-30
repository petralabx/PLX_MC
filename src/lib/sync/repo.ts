// Postgres accessors for the sync engine's state (schema: db/migrations/).
// The entity payload (jsonb `data`) keeps the canonical TS shape including
// its SyncRef; the relational sync columns are updated in the same statement
// so there is exactly one write path and no drift.

import { query, withTransaction } from "@/lib/db";
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
} from "@/lib/mc-data/types";
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
}

export async function getBuckets(): Promise<Bucket[]> {
  const rows = await query<BucketRow>("SELECT id, data FROM buckets ORDER BY created_at, id");
  return rows.map((r) => r.data);
}

// Idempotent seed of the fixture buckets — never disturbs an existing/edited row
// (ON CONFLICT DO NOTHING), so a fresh DB gets the 8 initiatives and any edits
// persist across boots.
export async function seedBuckets(buckets: Bucket[]): Promise<void> {
  for (const b of buckets) {
    await query(
      `INSERT INTO buckets (id, data, sync_state) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [b.id, JSON.stringify(b), b.sync?.state ?? "pending"]
    );
  }
}

// Upsert a bucket (create or edit). An edit re-queues the (future) Roadmap mirror
// (sync_state -> pending), preserving the prior sp_item_id.
export async function upsertBucket(b: Bucket): Promise<void> {
  await query(
    `INSERT INTO buckets (id, data, sync_state) VALUES ($1, $2, 'pending')
     ON CONFLICT (id) DO UPDATE SET data = $2, sync_state = 'pending', updated_at = now()`,
    [b.id, JSON.stringify(b)]
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
