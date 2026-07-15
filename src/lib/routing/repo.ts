// Transaction-aware routing repository. Write APIs accept TxQuery so P8 can
// atomically lock a proposal, allocate a Task ID, insert link/decision/event,
// and resolve — without this module implementing those mutations yet.

import type { TxQuery } from "@/lib/db";

import { formatTaskId } from "./persistence/constants";
import type {
  CreationIntentRecord,
  ProposalIdentity,
  RoutingDecisionInput,
  RoutingCandidateRecord,
  RoutingProposalInput,
  RoutingProposalRecord,
  RoutingRevisionInput,
  RoutingRevisionRecord,
  RoutingSessionInput,
  RoutingSessionRecord,
  WorkLinkInput,
} from "./types";

export type RoutingQuery = TxQuery;

async function defaultQuery<R extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<R[]> {
  const { query } = await import("@/lib/db");
  return query<R>(text, params);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapCandidate(row: Record<string, unknown>): RoutingCandidateRecord {
  return {
    rank: Number(row.rank),
    taskId: String(row.task_id),
    bucketId: String(row.bucket_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    matchScore: Number(row.match_score),
    authorizationTrust:
      row.authorization_trust as RoutingCandidateRecord["authorizationTrust"],
    reasons: asStringArray(row.reasons),
  };
}

function mapProposal(row: Record<string, unknown>): RoutingProposalRecord {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    changeId: String(row.change_id),
    sessionId: asString(row.session_id),
    state: row.state as RoutingProposalRecord["state"],
    title: asString(row.title),
    bodyContentHash: asString(row.body_content_hash),
    markers: Array.isArray(row.markers) ? (row.markers as RoutingProposalRecord["markers"]) : [],
    derivedProjectId: row.derived_project_id == null ? null : String(row.derived_project_id),
    failureReason: (row.failure_reason as RoutingProposalRecord["failureReason"]) ?? null,
    selectedTaskId: row.selected_task_id == null ? null : String(row.selected_task_id),
    selectedBucketId: row.selected_bucket_id == null ? null : String(row.selected_bucket_id),
  };
}

export async function upsertRoutingSession(
  input: RoutingSessionInput,
  runQuery: RoutingQuery = defaultQuery
): Promise<RoutingSessionRecord> {
  const rows = await runQuery<Record<string, unknown>>(
    `INSERT INTO routing_sessions (
        id, repo_id, actor_id, actor_kind, base_branch, source_branch,
        head_sha, status, absolute_expires_at, idle_expires_at, last_activity_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz, now())
      ON CONFLICT (id) DO UPDATE SET
        head_sha = EXCLUDED.head_sha,
        idle_expires_at = LEAST(
          EXCLUDED.idle_expires_at,
          routing_sessions.absolute_expires_at
        ),
        last_activity_at = now()
      WHERE routing_sessions.status = 'active'
        AND EXCLUDED.status = 'active'
        AND routing_sessions.repo_id = EXCLUDED.repo_id
        AND routing_sessions.actor_id = EXCLUDED.actor_id
        AND routing_sessions.actor_kind = EXCLUDED.actor_kind
        AND routing_sessions.base_branch = EXCLUDED.base_branch
        AND routing_sessions.source_branch = EXCLUDED.source_branch
        AND routing_sessions.absolute_expires_at > now()
        AND routing_sessions.idle_expires_at > now()
        AND EXCLUDED.idle_expires_at > now()
      RETURNING id, repo_id, actor_id, actor_kind, base_branch, source_branch,
                head_sha, status, absolute_expires_at, idle_expires_at`,
    [
      input.id,
      input.repoId,
      input.actorId,
      input.actorKind,
      input.baseBranch,
      input.sourceBranch,
      input.headSha,
      input.status,
      input.absoluteExpiresAt,
      input.idleExpiresAt,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error("upsertRoutingSession returned no row");
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    actorId: String(row.actor_id),
    actorKind: row.actor_kind as RoutingSessionRecord["actorKind"],
    baseBranch: String(row.base_branch),
    sourceBranch: String(row.source_branch),
    headSha: row.head_sha == null ? null : String(row.head_sha),
    status: row.status as RoutingSessionRecord["status"],
    absoluteExpiresAt: String(row.absolute_expires_at),
    idleExpiresAt: String(row.idle_expires_at),
  };
}

export async function upsertRoutingProposal(
  input: RoutingProposalInput,
  runQuery: RoutingQuery = defaultQuery
): Promise<RoutingProposalRecord> {
  const rows = await runQuery<Record<string, unknown>>(
    `INSERT INTO routing_proposals (
        id, repo_id, change_id, session_id, state, title, body_content_hash,
        markers, derived_project_id, failure_reason, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10, now())
      ON CONFLICT (repo_id, change_id) DO UPDATE SET
        session_id = COALESCE(EXCLUDED.session_id, routing_proposals.session_id),
        state = CASE
          WHEN routing_proposals.state IN ('resolved', 'rejected')
            THEN routing_proposals.state
          ELSE EXCLUDED.state
        END,
        title = EXCLUDED.title,
        body_content_hash = EXCLUDED.body_content_hash,
        markers = EXCLUDED.markers,
        derived_project_id = EXCLUDED.derived_project_id,
        failure_reason = EXCLUDED.failure_reason,
        updated_at = now()
      RETURNING id, repo_id, change_id, session_id, state, title, body_content_hash,
                markers, derived_project_id, failure_reason, selected_task_id, selected_bucket_id`,
    [
      input.id,
      input.repoId,
      input.changeId,
      input.sessionId,
      input.state,
      input.title,
      input.bodyContentHash,
      JSON.stringify(input.markers),
      input.derivedProjectId,
      input.failureReason,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error("upsertRoutingProposal returned no row");
  return mapProposal(row);
}

export async function getProposalByIdentity(
  identity: ProposalIdentity,
  runQuery: RoutingQuery = defaultQuery
): Promise<RoutingProposalRecord | null> {
  const rows = await runQuery<Record<string, unknown>>(
    `SELECT id, repo_id, change_id, session_id, state, title, body_content_hash,
            markers, derived_project_id, failure_reason, selected_task_id, selected_bucket_id
       FROM routing_proposals
      WHERE repo_id = $1 AND change_id = $2
      LIMIT 1`,
    [identity.repoId, identity.changeId]
  );
  const row = rows[0];
  return row ? mapProposal(row) : null;
}

/**
 * Lock a proposal row for the duration of the caller's transaction.
 * P8 uses this before allocate/create/link/decision/resolve.
 */
export async function lockProposalForUpdate(
  proposalId: string,
  runQuery: RoutingQuery
): Promise<RoutingProposalRecord | null> {
  const rows = await runQuery<Record<string, unknown>>(
    `SELECT id, repo_id, change_id, session_id, state, title, body_content_hash,
            markers, derived_project_id, failure_reason, selected_task_id, selected_bucket_id
       FROM routing_proposals
      WHERE id = $1
      FOR UPDATE`,
    [proposalId]
  );
  const row = rows[0];
  return row ? mapProposal(row) : null;
}

export async function upsertProposalRevision(
  input: RoutingRevisionInput,
  runQuery: RoutingQuery = defaultQuery
): Promise<RoutingRevisionRecord> {
  const candidateInput = input.candidates.map((candidate) => ({
    rank: candidate.rank,
    task_id: candidate.taskId,
    bucket_id: candidate.bucketId,
    project_id: candidate.projectId,
    match_score: candidate.matchScore,
    authorization_trust: candidate.authorizationTrust,
    reasons: candidate.reasons,
  }));
  const rows = await runQuery<Record<string, unknown>>(
    `WITH persisted_revision AS (
       INSERT INTO routing_proposal_revisions (
         id, proposal_id, head_sha, policy_version, evidence_meta
       ) VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (proposal_id, head_sha) DO UPDATE
         SET proposal_id = routing_proposal_revisions.proposal_id
       RETURNING id, proposal_id, head_sha, policy_version, evidence_meta, created_at
     ),
     candidate_input AS (
       SELECT *
         FROM jsonb_to_recordset($6::jsonb) AS candidate(
           rank integer,
           task_id text,
           bucket_id text,
           project_id text,
           match_score double precision,
           authorization_trust text,
           reasons jsonb
         )
     ),
     inserted_candidates AS (
       INSERT INTO routing_revision_candidates (
         id, revision_id, rank, task_id, bucket_id, project_id,
         match_score, authorization_trust, reasons
       )
       SELECT
         persisted_revision.id || '_c' || candidate_input.rank::text,
         persisted_revision.id,
         candidate_input.rank,
         candidate_input.task_id,
         candidate_input.bucket_id,
         candidate_input.project_id,
         candidate_input.match_score,
         candidate_input.authorization_trust,
         candidate_input.reasons
       FROM persisted_revision
       CROSS JOIN candidate_input
       ON CONFLICT (revision_id, rank) DO NOTHING
       RETURNING id
     )
     SELECT id, proposal_id, head_sha, policy_version, evidence_meta, created_at
       FROM persisted_revision`,
    [
      input.id,
      input.proposalId,
      input.headSha,
      input.policyVersion,
      JSON.stringify(input.evidenceMeta),
      JSON.stringify(candidateInput),
    ]
  );
  const row = rows[0];
  if (!row) throw new Error("upsertProposalRevision returned no row");
  const persisted = await getProposalRevision(input.proposalId, input.headSha, runQuery);
  if (!persisted) {
    throw new Error("upsertProposalRevision could not reload persisted revision");
  }
  return persisted;
}

export async function getProposalRevision(
  proposalId: string,
  headSha: string,
  runQuery: RoutingQuery = defaultQuery
): Promise<RoutingRevisionRecord | null> {
  const rows = await runQuery<Record<string, unknown>>(
    `SELECT id, proposal_id, head_sha, policy_version, evidence_meta, created_at
       FROM routing_proposal_revisions
      WHERE proposal_id = $1 AND head_sha = $2
      LIMIT 1`,
    [proposalId, headSha]
  );
  const row = rows[0];
  if (!row) return null;
  const candidateRows = await runQuery<Record<string, unknown>>(
    `SELECT rank, task_id, bucket_id, project_id, match_score,
            authorization_trust, reasons
       FROM routing_revision_candidates
      WHERE revision_id = $1
      ORDER BY rank ASC`,
    [String(row.id)]
  );
  return {
    id: String(row.id),
    proposalId: String(row.proposal_id),
    headSha: String(row.head_sha),
    policyVersion: String(row.policy_version),
    evidenceMeta: (row.evidence_meta ?? {}) as RoutingRevisionRecord["evidenceMeta"],
    candidates: candidateRows.map(mapCandidate),
    createdAt: row.created_at ? String(row.created_at) : undefined,
  };
}

export async function recordDecision(
  input: RoutingDecisionInput,
  runQuery: RoutingQuery = defaultQuery
): Promise<void> {
  await runQuery(
    `INSERT INTO routing_decisions (
        id, proposal_id, revision_id, decision_kind, task_id, bucket_id, project_id,
        actor_id, actor_kind, override_reason, rejection_reason, policy_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO NOTHING`,
    [
      input.id,
      input.proposalId,
      input.revisionId,
      input.decisionKind,
      input.taskId,
      input.bucketId,
      input.projectId,
      input.actorId,
      input.actorKind,
      input.overrideReason,
      input.rejectionReason,
      input.policyVersion,
    ]
  );
}

export async function appendWorkLink(
  input: WorkLinkInput,
  runQuery: RoutingQuery = defaultQuery
): Promise<void> {
  await runQuery(
    `INSERT INTO routing_work_links (
        id, proposal_id, task_id, link_type, repo_id, change_id,
        head_sha, merge_sha, evidence, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
      ON CONFLICT ON CONSTRAINT routing_work_links_replay_key DO NOTHING`,
    [
      input.id,
      input.proposalId,
      input.taskId,
      input.linkType,
      input.repoId,
      input.changeId,
      input.headSha,
      input.mergeSha,
      JSON.stringify(input.evidence),
      input.createdBy,
    ]
  );
}

/**
 * Idempotent creation-intent row for P8 Task creation.
 * Unique on (proposal_id, creation_intent_hash); retries return the first task.
 */
export async function insertCreationIntent(
  input: CreationIntentRecord,
  runQuery: RoutingQuery = defaultQuery
): Promise<CreationIntentRecord> {
  const rows = await runQuery<Record<string, unknown>>(
    `INSERT INTO routing_creation_intents (
        id, proposal_id, creation_intent_hash, task_id
      ) VALUES ($1,$2,$3,$4)
      ON CONFLICT (proposal_id, creation_intent_hash) DO UPDATE
        SET proposal_id = EXCLUDED.proposal_id
      RETURNING id, proposal_id, creation_intent_hash, task_id`,
    [input.id, input.proposalId, input.creationIntentHash, input.taskId]
  );
  // ON CONFLICT DO UPDATE above is a no-op touch so RETURNING yields the
  // existing row's task_id (Postgres returns the persisted row values).
  const row = rows[0];
  if (!row) throw new Error("insertCreationIntent returned no row");
  return {
    id: String(row.id),
    proposalId: String(row.proposal_id),
    creationIntentHash: String(row.creation_intent_hash),
    taskId: String(row.task_id),
  };
}

/**
 * Allocate the next global Task ID via mc_task_id_seq.
 * Must be called inside the same transaction as Task insert (P8).
 */
export async function allocateNextTaskId(runQuery: RoutingQuery): Promise<string> {
  const rows = await runQuery<{ next_id: string | number }>(
    `SELECT nextval('mc_task_id_seq') AS next_id`
  );
  const raw = rows[0]?.next_id;
  if (raw == null) throw new Error("allocateNextTaskId: sequence returned empty");
  return formatTaskId(raw);
}

export interface ResolveProposalInput {
  proposalId: string;
  state: "resolved" | "rejected";
  selectedTaskId: string | null;
  selectedBucketId: string | null;
  derivedProjectId: string | null;
  failureReason?: RoutingProposalRecord["failureReason"];
}

/** Mark a locked proposal resolved/rejected inside the caller's transaction. */
export async function resolveProposal(
  input: ResolveProposalInput,
  runQuery: RoutingQuery
): Promise<RoutingProposalRecord> {
  const rows = await runQuery<Record<string, unknown>>(
    `UPDATE routing_proposals
        SET state = $2,
            selected_task_id = $3,
            selected_bucket_id = $4,
            derived_project_id = $5,
            failure_reason = $6,
            resolved_at = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING id, repo_id, change_id, session_id, state, title, body_content_hash,
                markers, derived_project_id, failure_reason, selected_task_id, selected_bucket_id`,
    [
      input.proposalId,
      input.state,
      input.selectedTaskId,
      input.selectedBucketId,
      input.derivedProjectId,
      input.failureReason ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error(`resolveProposal: proposal ${input.proposalId} not found`);
  return mapProposal(row);
}

/** Consume an active routing session after a confirmed decision. */
export async function consumeRoutingSession(
  sessionId: string,
  proposalId: string,
  runQuery: RoutingQuery
): Promise<void> {
  await runQuery(
    `UPDATE routing_sessions
        SET status = 'consumed',
            consumed_at = now(),
            consumed_proposal_id = $2,
            last_activity_at = now()
      WHERE id = $1
        AND status = 'active'`,
    [sessionId, proposalId]
  );
}
