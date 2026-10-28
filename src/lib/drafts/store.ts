// Draft Projects persistence (TASK-4059): the drafts and draft_versions tables
// (migration 056). Uses Postgres when configured; otherwise a process-local
// fallback keeps tests and local dev from needing PLX_MC_DATABASE_URL (the
// contract the stars and skills-directory stores keep). Server-only.
//
// Every change goes through mutateDraft: one transaction that locks the draft
// row, applies the caller's change and, on a submit, inserts the frozen version
// in the same transaction. A frozen version is never updated or deleted (the
// migration's trigger refuses both).

import { query, withTransaction, type TxQuery } from "@/lib/db";
import { databaseConfigured } from "@/lib/secrets";

import type { Draft, DraftContent, DraftReview, DraftStatus, DraftVersion } from "./types";

interface DraftRow {
  id: string;
  status: DraftStatus;
  author: string;
  created_by: string;
  visibility: "shared" | "restricted";
  members: string[];
  reviewers: string[];
  version: number;
  digest: string | null;
  working: DraftContent;
  reviews: DraftReview[];
  materialized: Record<string, string>;
  accepted_at: Date | null;
  accepted_by: string | null;
  withdrawn_at: Date | null;
  withdrawn_by: string | null;
  withdraw_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  draft_id: string;
  version: number;
  digest: string;
  content: DraftContent;
  frozen_by: string;
  frozen_at: Date;
}

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

function fromRow(row: DraftRow): Draft {
  return {
    id: row.id,
    status: row.status,
    author: row.author,
    createdBy: row.created_by,
    visibility: row.visibility,
    members: row.members,
    reviewers: row.reviewers,
    version: row.version,
    digest: row.digest,
    working: row.working,
    reviews: row.reviews,
    materialized: row.materialized,
    acceptedAt: iso(row.accepted_at),
    acceptedBy: row.accepted_by,
    withdrawnAt: iso(row.withdrawn_at),
    withdrawnBy: row.withdrawn_by,
    withdrawReason: row.withdraw_reason,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function fromVersionRow(row: VersionRow): DraftVersion {
  return {
    draftId: row.draft_id,
    version: row.version,
    digest: row.digest,
    content: row.content,
    frozenBy: row.frozen_by,
    frozenAt: iso(row.frozen_at)!,
  };
}

// ─── Memory fallback ─────────────────────────────────────────────────────────

const globalForDrafts = globalThis as unknown as {
  __plxDrafts?: { seq: number; drafts: Map<string, Draft>; versions: Map<string, DraftVersion[]> };
};

function memory() {
  globalForDrafts.__plxDrafts ??= { seq: 0, drafts: new Map(), versions: new Map() };
  return globalForDrafts.__plxDrafts;
}

/** Tests only: forget the memory fallback's drafts. */
export function __resetDraftsMemoryForTests(): void {
  delete globalForDrafts.__plxDrafts;
}

const clone = <T>(value: T): T => structuredClone(value);

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getDraft(id: string): Promise<Draft | null> {
  if (!databaseConfigured()) {
    const draft = memory().drafts.get(id);
    return draft ? clone(draft) : null;
  }
  const rows = await query<DraftRow>("SELECT * FROM drafts WHERE id = $1", [id]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** A list row: counts, not content (a working copy may be 512 KiB). */
export interface DraftSummary {
  id: string;
  title: string;
  status: DraftStatus;
  author: string;
  createdBy: string;
  visibility: "shared" | "restricted";
  version: number;
  digest: string | null;
  reviewers: string[];
  buckets: number;
  tasks: number;
  openFindings: number;
  openBlockingFindings: number;
  updatedAt: string;
}

export interface DraftListQuery {
  statuses: readonly DraftStatus[];
  /** The viewer's ACL tokens, lower-cased: a restricted draft lists only for its members and author. */
  tokens: readonly string[];
  /** Only drafts this email authors. */
  author?: string;
  /**
   * Only in-review drafts naming one of these tokens as a reviewer, with no
   * review other than a comment from `viewerEmail` on the current version.
   */
  reviewerTokens?: readonly string[];
  viewerEmail: string;
  /** Matches the id or title, case-insensitive. */
  q?: string;
  limit: number;
}

interface SummaryRow {
  id: string;
  title: string | null;
  status: DraftStatus;
  author: string;
  created_by: string;
  visibility: "shared" | "restricted";
  version: number;
  digest: string | null;
  reviewers: string[];
  buckets: number;
  tasks: number;
  open_findings: number;
  open_blocking: number;
  updated_at: Date;
}

/** The summary of one draft, as the list query computes it. */
export function summarizeDraft(draft: Draft): DraftSummary {
  const open = draft.reviews.filter((r) => r.kind === "finding" && r.status === "open");
  return {
    id: draft.id,
    title: draft.working.title,
    status: draft.status,
    author: draft.author,
    createdBy: draft.createdBy,
    visibility: draft.visibility,
    version: draft.version,
    digest: draft.digest,
    reviewers: draft.reviewers,
    buckets: draft.working.plan.buckets.length,
    tasks: draft.working.plan.tasks.length,
    openFindings: open.length,
    openBlockingFindings: open.filter((r) => r.blocking).length,
    updatedAt: draft.updatedAt,
  };
}

function matchesQuery(draft: Draft, filter: DraftListQuery): boolean {
  const tokens = new Set(filter.tokens.map((t) => t.toLowerCase()));
  if (!filter.statuses.includes(draft.status)) return false;
  const visible =
    draft.visibility === "shared" ||
    tokens.has(draft.author.toLowerCase()) ||
    draft.members.some((m) => tokens.has(m.toLowerCase()));
  if (!visible) return false;
  if (filter.author && draft.author.toLowerCase() !== filter.author.toLowerCase()) return false;
  if (filter.reviewerTokens) {
    const reviewer = new Set(filter.reviewerTokens.map((t) => t.toLowerCase()));
    if (draft.status !== "in_review" || !draft.reviewers.some((r) => reviewer.has(r.toLowerCase()))) return false;
    const viewer = filter.viewerEmail.toLowerCase();
    if (draft.reviews.some((r) => r.digest === draft.digest && r.by.toLowerCase() === viewer && r.kind !== "comment")) return false;
  }
  const q = filter.q?.toLowerCase();
  return !q || draft.id.toLowerCase().includes(q) || draft.working.title.toLowerCase().includes(q);
}

/** The drafts a viewer may list, filtered before the limit, newest change first. */
export async function listDraftSummaries(filter: DraftListQuery): Promise<DraftSummary[]> {
  if (!databaseConfigured()) {
    return [...memory().drafts.values()]
      .filter((d) => matchesQuery(d, filter))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit)
      .map(summarizeDraft);
  }
  const like = filter.q ? `%${filter.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await query<SummaryRow>(
    `SELECT id, working->>'title' AS title, status, author, created_by, visibility, version, digest, reviewers,
            COALESCE(jsonb_array_length(working->'plan'->'buckets'), 0)::int AS buckets,
            COALESCE(jsonb_array_length(working->'plan'->'tasks'), 0)::int AS tasks,
            (SELECT count(*) FROM jsonb_array_elements(reviews) r
              WHERE r->>'kind' = 'finding' AND r->>'status' = 'open')::int AS open_findings,
            (SELECT count(*) FROM jsonb_array_elements(reviews) r
              WHERE r->>'kind' = 'finding' AND r->>'status' = 'open' AND r->>'blocking' = 'true')::int AS open_blocking,
            updated_at
       FROM drafts
      WHERE status = ANY ($1::text[])
        AND (visibility = 'shared'
             OR lower(author) = ANY ($2::text[])
             OR EXISTS (SELECT 1 FROM unnest(members) m WHERE lower(m) = ANY ($2::text[])))
        AND ($3::text IS NULL OR lower(author) = $3)
        AND ($4::text[] IS NULL
             OR (status = 'in_review'
                 AND EXISTS (SELECT 1 FROM unnest(reviewers) rv WHERE lower(rv) = ANY ($4::text[]))
                 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(reviews) r
                                  WHERE r->>'digest' = drafts.digest AND lower(r->>'by') = $5 AND r->>'kind' <> 'comment')))
        AND ($6::text IS NULL OR lower(id) LIKE $6 ESCAPE '\\' OR lower(working->>'title') LIKE $6 ESCAPE '\\')
      ORDER BY updated_at DESC, id DESC
      LIMIT $7`,
    [
      filter.statuses,
      filter.tokens.map((t) => t.toLowerCase()),
      filter.author?.toLowerCase() ?? null,
      filter.reviewerTokens ? filter.reviewerTokens.map((t) => t.toLowerCase()) : null,
      filter.viewerEmail.toLowerCase(),
      like,
      filter.limit,
    ]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    status: row.status,
    author: row.author,
    createdBy: row.created_by,
    visibility: row.visibility,
    version: row.version,
    digest: row.digest,
    reviewers: row.reviewers,
    buckets: row.buckets,
    tasks: row.tasks,
    openFindings: row.open_findings,
    openBlockingFindings: row.open_blocking,
    updatedAt: iso(row.updated_at)!,
  }));
}

export async function getDraftVersion(id: string, version: number): Promise<DraftVersion | null> {
  if (!databaseConfigured()) {
    const found = memory().versions.get(id)?.find((v) => v.version === version);
    return found ? clone(found) : null;
  }
  const rows = await query<VersionRow>("SELECT * FROM draft_versions WHERE draft_id = $1 AND version = $2", [id, version]);
  return rows[0] ? fromVersionRow(rows[0]) : null;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export type NewDraft = Pick<Draft, "author" | "createdBy" | "visibility" | "members" | "reviewers" | "working">;

/** Insert a draft in `drafting` with no version yet; MC allocates the DRF-* id. */
export async function insertDraft(input: NewDraft): Promise<Draft> {
  if (!databaseConfigured()) {
    const mem = memory();
    mem.seq += 1;
    const now = new Date().toISOString();
    const draft: Draft = {
      id: `DRF-${mem.seq}`,
      status: "drafting",
      ...clone(input),
      version: 0,
      digest: null,
      reviews: [],
      materialized: {},
      acceptedAt: null,
      acceptedBy: null,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawReason: null,
      createdAt: now,
      updatedAt: now,
    };
    mem.drafts.set(draft.id, draft);
    return clone(draft);
  }
  const rows = await query<DraftRow>(
    `INSERT INTO drafts (id, author, created_by, visibility, members, reviewers, working)
     VALUES ('DRF-' || nextval('mc_draft_id_seq'), $1, $2, $3, $4::text[], $5::text[], $6::jsonb)
     RETURNING *`,
    [input.author, input.createdBy, input.visibility, input.members, input.reviewers, JSON.stringify(input.working)]
  );
  return fromRow(rows[0]);
}

export interface DraftChange {
  draft: Draft;
  /** A version to freeze in the same transaction (a submit). */
  freeze?: DraftVersion;
}

/**
 * Lock a draft, apply `change` to it and store the result. `change` returns
 * null to leave the draft as it is. Returns null when the draft does not exist.
 */
export async function mutateDraft(
  id: string,
  change: (current: Draft) => DraftChange | null
): Promise<{ draft: Draft; changed: boolean } | null> {
  if (!databaseConfigured()) {
    const mem = memory();
    const current = mem.drafts.get(id);
    if (!current) return null;
    const next = change(clone(current));
    if (!next) return { draft: clone(current), changed: false };
    const stored = { ...clone(next.draft), id, updatedAt: new Date().toISOString() };
    if (next.freeze) {
      const versions = mem.versions.get(id) ?? [];
      if (versions.some((v) => v.version === next.freeze!.version)) throw new Error(`draft ${id} version ${next.freeze.version} exists`);
      mem.versions.set(id, [...versions, clone(next.freeze)]);
    }
    mem.drafts.set(id, stored);
    return { draft: clone(stored), changed: true };
  }
  return withTransaction(async (q: TxQuery) => {
    const rows = await q<DraftRow>("SELECT * FROM drafts WHERE id = $1 FOR UPDATE", [id]);
    if (!rows[0]) return null;
    const current = fromRow(rows[0]);
    const next = change(current);
    if (!next) return { draft: current, changed: false };
    if (next.freeze) {
      const v = next.freeze;
      await q(
        `INSERT INTO draft_versions (draft_id, version, digest, content, frozen_by, frozen_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz)`,
        [id, v.version, v.digest, JSON.stringify(v.content), v.frozenBy, v.frozenAt]
      );
    }
    const d = next.draft;
    const updated = await q<DraftRow>(
      `UPDATE drafts SET
         status = $2, visibility = $3, members = $4::text[], reviewers = $5::text[],
         version = $6, digest = $7, working = $8::jsonb, reviews = $9::jsonb, materialized = $10::jsonb,
         accepted_at = $11::timestamptz, accepted_by = $12,
         withdrawn_at = $13::timestamptz, withdrawn_by = $14, withdraw_reason = $15,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        d.status,
        d.visibility,
        d.members,
        d.reviewers,
        d.version,
        d.digest,
        JSON.stringify(d.working),
        JSON.stringify(d.reviews),
        JSON.stringify(d.materialized),
        d.acceptedAt,
        d.acceptedBy,
        d.withdrawnAt,
        d.withdrawnBy,
        d.withdrawReason,
      ]
    );
    return { draft: fromRow(updated[0]), changed: true };
  });
}
