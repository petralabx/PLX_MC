// EN-005 / WS-5 — Postgres accessors for the repo registry (= allow-list) and the
// self-service request queue (schema: db/migrations/008_repo_registry.sql). The
// registry is now server-persisted so the task mutation (state.ts createTask)
// validates against the SAME runtime allow-list the client uses, closing the
// static-REPOS drift (EN-005 obs. #7). This is the pure DB layer; the role gate +
// GitHub validation orchestration lives in state.ts. All SQL is parameterized.
// Mockable in tests via vi.mock (mirrors the sync repo seam in tests/mc-patch.test.ts).

import { query } from "@/lib/db";
import { REPOS } from "@/lib/mc-data/data";
import type { Repo, RepoRequest, RepoRequestStatus, RepoVisibility } from "@/lib/mc-data/types";
import { stamp } from "./repo";

// ─── Seed ────────────────────────────────────────────────────────────────────

// First run against an empty registry: load the data.ts REPOS fixture (the three
// canonical repos). Inserts are ON CONFLICT DO NOTHING, so an existing row is
// never touched and a later fixture addition backfills safely (mirrors
// engine.ensureSeeded). Returns true when it seeded, false when already present.
export async function ensureRegistrySeeded(): Promise<boolean> {
  const ids = Object.keys(REPOS);
  const present = await query<{ id: string }>(
    "SELECT id FROM mc_repos WHERE id = ANY($1::text[])",
    [ids]
  );
  if (present.length === ids.length) return false;
  for (const r of Object.values(REPOS)) {
    await query(
      `INSERT INTO mc_repos (id, name, lang, def, owner, visibility, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.name, r.lang, r.def, r.owner, r.visibility, r.scope]
    );
  }
  return true;
}

// ─── Registry (the allow-list) ───────────────────────────────────────────────

interface RepoRow {
  id: string;
  name: string;
  lang: string;
  def: string;
  owner: string;
  visibility: RepoVisibility;
  scope: string;
}

export async function getRegistry(): Promise<Record<string, Repo>> {
  const rows = await query<RepoRow>(
    "SELECT id, name, lang, def, owner, visibility, scope FROM mc_repos ORDER BY id"
  );
  const out: Record<string, Repo> = {};
  for (const r of rows) {
    out[r.id] = { id: r.id, name: r.name, lang: r.lang, def: r.def, owner: r.owner, visibility: r.visibility, scope: r.scope };
  }
  return out;
}

export async function insertRepo(repo: Repo): Promise<void> {
  await query(
    `INSERT INTO mc_repos (id, name, lang, def, owner, visibility, scope, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO NOTHING`,
    [repo.id, repo.name, repo.lang, repo.def, repo.owner, repo.visibility, repo.scope]
  );
}

// ─── Request queue ───────────────────────────────────────────────────────────

interface RequestRow {
  id: string;
  name: string;
  owner: string;
  lang: string | null;
  visibility: RepoVisibility | null;
  scope: string | null;
  def: string | null;
  requested_by: string;
  requested_at: Date;
  status: RepoRequestStatus;
  verified: boolean;
  note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
}

function toRequest(r: RequestRow): RepoRequest {
  return {
    id: r.id,
    name: r.name,
    owner: r.owner,
    lang: r.lang ?? undefined,
    visibility: r.visibility ?? undefined,
    scope: r.scope ?? undefined,
    def: r.def ?? undefined,
    requestedBy: r.requested_by,
    requestedTs: stamp(r.requested_at),
    status: r.status,
    verified: r.verified,
    note: r.note ?? undefined,
    decidedBy: r.decided_by ?? undefined,
    decidedTs: r.decided_at ? stamp(r.decided_at) : undefined,
  };
}

const REQUEST_COLS =
  "id, name, owner, lang, visibility, scope, def, requested_by, requested_at, status, verified, note, decided_by, decided_at";

export async function getRequests(): Promise<RepoRequest[]> {
  const rows = await query<RequestRow>(
    `SELECT ${REQUEST_COLS} FROM mc_repo_requests ORDER BY requested_at DESC`
  );
  return rows.map(toRequest);
}

export async function getRequest(id: string): Promise<RepoRequest | null> {
  const rows = await query<RequestRow>(
    `SELECT ${REQUEST_COLS} FROM mc_repo_requests WHERE id = $1`,
    [id]
  );
  return rows[0] ? toRequest(rows[0]) : null;
}

// Persist a self-service request. A re-request of a previously REJECTED name
// reopens that row (back to pending/unverified); a pending or approved row is
// left untouched (dedupe) — the id is deterministic from the repo name so the
// client and server always address the same request.
export async function upsertRequest(req: {
  id: string;
  name: string;
  owner: string;
  scope?: string | null;
  requestedBy: string;
}): Promise<void> {
  await query(
    `INSERT INTO mc_repo_requests (id, name, owner, scope, requested_by, status, verified)
     VALUES ($1, $2, $3, $4, $5, 'pending', false)
     ON CONFLICT (id) DO UPDATE
       SET name = excluded.name,
           owner = excluded.owner,
           scope = excluded.scope,
           requested_by = excluded.requested_by,
           requested_at = now(),
           status = 'pending',
           verified = false,
           note = NULL,
           decided_by = NULL,
           decided_at = NULL
       WHERE mc_repo_requests.status = 'rejected'`,
    [req.id, req.name, req.owner, req.scope ?? null, req.requestedBy]
  );
}

export async function setRequestVerification(
  id: string,
  v: { verified: boolean; visibility?: RepoVisibility; def?: string; lang?: string; note?: string }
): Promise<void> {
  await query(
    `UPDATE mc_repo_requests
        SET verified = $2,
            visibility = COALESCE($3, visibility),
            def = COALESCE($4, def),
            lang = COALESCE($5, lang),
            note = $6
      WHERE id = $1`,
    [id, v.verified, v.visibility ?? null, v.def ?? null, v.lang ?? null, v.note ?? null]
  );
}

// Mark a pending request decided (approved/rejected). Scoped to status='pending'
// so a double-submit can't re-decide an already-resolved request.
export async function markRequestDecided(
  id: string,
  status: Exclude<RepoRequestStatus, "pending">,
  decidedBy: string
): Promise<void> {
  await query(
    "UPDATE mc_repo_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'pending'",
    [id, status, decidedBy]
  );
}
