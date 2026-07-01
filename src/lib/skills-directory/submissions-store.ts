// Skill submission persistence. Uses Postgres when configured; otherwise a
// process-local fallback keeps tests/local dev from needing PLX_MC_DATABASE_URL.

import { randomUUID } from "node:crypto";

import { query } from "@/lib/db";

import { assertValidSkillId } from "./ids";

export type SkillSubmissionStatus = "pending" | "approved" | "rejected";

export interface SkillSubmission {
  id: string;
  skillId: string;
  title: string;
  description: string;
  submitterEmail: string;
  repoUrl?: string;
  contentUrl?: string;
  skillMd?: string;
  status: SkillSubmissionStatus;
  notes?: string;
  reviewComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillSubmissionInput {
  skillId: string;
  title: string;
  description?: string;
  submitterEmail: string;
  repoUrl?: string;
  contentUrl?: string;
  skillMd?: string;
  notes?: string;
}

export interface UpdateSkillSubmissionInput {
  status?: SkillSubmissionStatus;
  notes?: string;
  reviewComment?: string;
}

interface SkillSubmissionRow {
  id: string;
  skill_id: string;
  title: string;
  description: string;
  submitter_email: string;
  repo_url: string | null;
  content_url: string | null;
  skill_md: string | null;
  status: SkillSubmissionStatus;
  notes: string | null;
  review_comment: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const globalForSubmissions = globalThis as unknown as {
  __plxSkillSubmissions?: Map<string, SkillSubmission>;
};

function memoryStore(): Map<string, SkillSubmission> {
  if (!globalForSubmissions.__plxSkillSubmissions) {
    globalForSubmissions.__plxSkillSubmissions = new Map();
  }
  return globalForSubmissions.__plxSkillSubmissions;
}

function hasDb(): boolean {
  return !!process.env.PLX_MC_DATABASE_URL;
}

function nowIso(): string {
  return new Date().toISOString();
}

function dateIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSubmission(row: SkillSubmissionRow): SkillSubmission {
  return {
    id: row.id,
    skillId: row.skill_id,
    title: row.title,
    description: row.description,
    submitterEmail: row.submitter_email,
    repoUrl: row.repo_url ?? undefined,
    contentUrl: row.content_url ?? undefined,
    skillMd: row.skill_md ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    reviewComment: row.review_comment ?? undefined,
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
  };
}

export async function createSkillSubmission(
  input: CreateSkillSubmissionInput
): Promise<SkillSubmission> {
  const id = `skill-sub-${randomUUID()}`;
  const skillId = assertValidSkillId(input.skillId);
  if (!hasDb()) {
    const ts = nowIso();
    const submission: SkillSubmission = {
      id,
      skillId,
      title: input.title,
      description: input.description ?? "",
      submitterEmail: input.submitterEmail,
      repoUrl: input.repoUrl,
      contentUrl: input.contentUrl,
      skillMd: input.skillMd,
      status: "pending",
      notes: input.notes,
      createdAt: ts,
      updatedAt: ts,
    };
    memoryStore().set(id, submission);
    return submission;
  }

  const rows = await query<SkillSubmissionRow>(
    `INSERT INTO skill_submissions
       (id, skill_id, title, description, submitter_email, repo_url, content_url, skill_md, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, skill_id, title, description, submitter_email, repo_url,
               content_url, skill_md, status, notes, review_comment, created_at, updated_at`,
    [
      id,
      skillId,
      input.title,
      input.description ?? "",
      input.submitterEmail,
      input.repoUrl ?? null,
      input.contentUrl ?? null,
      input.skillMd ?? null,
      input.notes ?? null,
    ]
  );
  return toSubmission(rows[0]);
}

export async function listSkillSubmissions(
  status?: SkillSubmissionStatus
): Promise<SkillSubmission[]> {
  if (!hasDb()) {
    const rows = [...memoryStore().values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    return status ? rows.filter((r) => r.status === status) : rows;
  }

  const where = status ? "WHERE status = $1" : "";
  const rows = await query<SkillSubmissionRow>(
    `SELECT id, skill_id, title, description, submitter_email, repo_url,
            content_url, skill_md, status, notes, review_comment, created_at, updated_at
       FROM skill_submissions
       ${where}
      ORDER BY created_at DESC, id`,
    status ? [status] : []
  );
  return rows.map(toSubmission);
}

export async function getSkillSubmission(id: string): Promise<SkillSubmission | null> {
  if (!hasDb()) {
    return memoryStore().get(id) ?? null;
  }
  const rows = await query<SkillSubmissionRow>(
    `SELECT id, skill_id, title, description, submitter_email, repo_url,
            content_url, skill_md, status, notes, review_comment, created_at, updated_at
       FROM skill_submissions WHERE id = $1`,
    [id]
  );
  return rows[0] ? toSubmission(rows[0]) : null;
}

export async function updateSkillSubmission(
  id: string,
  input: UpdateSkillSubmissionInput
): Promise<SkillSubmission | null> {
  if (!hasDb()) {
    const current = memoryStore().get(id);
    if (!current) return null;
    const updated: SkillSubmission = {
      ...current,
      status: input.status ?? current.status,
      notes: input.notes ?? current.notes,
      reviewComment: input.reviewComment ?? current.reviewComment,
      updatedAt: nowIso(),
    };
    memoryStore().set(id, updated);
    return updated;
  }

  const rows = await query<SkillSubmissionRow>(
    `UPDATE skill_submissions SET
       status = COALESCE($2, status),
       notes = COALESCE($3, notes),
       review_comment = COALESCE($4, review_comment),
       updated_at = now()
     WHERE id = $1
     RETURNING id, skill_id, title, description, submitter_email, repo_url,
               content_url, skill_md, status, notes, review_comment, created_at, updated_at`,
    [id, input.status ?? null, input.notes ?? null, input.reviewComment ?? null]
  );
  return rows[0] ? toSubmission(rows[0]) : null;
}

export async function deleteSkillSubmission(id: string): Promise<boolean> {
  if (!hasDb()) {
    return memoryStore().delete(id);
  }
  const rows = await query<{ id: string }>(
    "DELETE FROM skill_submissions WHERE id = $1 RETURNING id",
    [id]
  );
  return rows.length > 0;
}
