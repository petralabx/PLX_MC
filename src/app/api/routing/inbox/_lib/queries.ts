// Read-side SQL for Routing Inbox list/detail. Lives in the API layer so P9
// does not extend src/lib/routing/repo.ts (owned by earlier phases).

import { query } from "@/lib/db";
import type {
  InboxCandidateDto,
  InboxProposalDetail,
  InboxProposalSummary,
  InboxScope,
} from "./types";

const OPEN_STATES = ["provisional", "action_required", "degraded"] as const;

function slaAgeHours(createdAt: string | Date): number {
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function slaBreach(hours: number): InboxProposalSummary["slaBreach"] {
  if (hours >= 24 * 7) return "expire_7d";
  if (hours >= 24) return "alert_24h";
  return "none";
}

function mapCandidate(row: Record<string, unknown>): InboxCandidateDto {
  const reasonsRaw = row.reasons;
  let reasons: string[] = [];
  if (Array.isArray(reasonsRaw)) {
    reasons = reasonsRaw.map(String);
  } else if (typeof reasonsRaw === "string") {
    try {
      const parsed = JSON.parse(reasonsRaw) as unknown;
      reasons = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      reasons = [];
    }
  }
  return {
    rank: Number(row.rank),
    taskId: String(row.task_id),
    bucketId: String(row.bucket_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    matchScore: Number(row.match_score),
    authorizationTrust: String(row.authorization_trust),
    reasons,
  };
}

function mapSummary(row: Record<string, unknown>): InboxProposalSummary {
  const createdAt = row.created_at ? String(row.created_at) : new Date(0).toISOString();
  const hours = slaAgeHours(createdAt);
  const top =
    row.top_rank != null
      ? mapCandidate({
          rank: row.top_rank,
          task_id: row.top_task_id,
          bucket_id: row.top_bucket_id,
          project_id: row.top_project_id,
          match_score: row.top_match_score,
          authorization_trust: row.top_authorization_trust,
          reasons: row.top_reasons,
        })
      : null;
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    changeId: String(row.change_id),
    title: row.title == null ? null : String(row.title),
    state: String(row.state),
    failureReason: row.failure_reason == null ? null : String(row.failure_reason),
    derivedProjectId: row.derived_project_id == null ? null : String(row.derived_project_id),
    selectedBucketId: row.selected_bucket_id == null ? null : String(row.selected_bucket_id),
    selectedTaskId: row.selected_task_id == null ? null : String(row.selected_task_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    accountableActorId: row.actor_id == null ? null : String(row.actor_id),
    accountableActorKind: row.actor_kind == null ? null : String(row.actor_kind),
    topCandidate: top,
    slaAgeHours: Math.round(hours * 10) / 10,
    slaBreach: slaBreach(hours),
    createdAt,
    updatedAt: row.updated_at ? String(row.updated_at) : createdAt,
  };
}

export interface ListInboxInput {
  scope: InboxScope;
  actorId: string;
  projectId?: string;
  bucketId?: string;
  limit?: number;
}

export async function listInboxProposals(
  input: ListInboxInput
): Promise<{ proposals: InboxProposalSummary[]; counts: Record<InboxScope, number> }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const baseSelect = `
    SELECT p.id, p.repo_id, p.change_id, p.title, p.state, p.failure_reason,
           p.derived_project_id, p.selected_bucket_id, p.selected_task_id,
           p.session_id, p.created_at, p.updated_at,
           s.actor_id, s.actor_kind,
           c.rank AS top_rank, c.task_id AS top_task_id, c.bucket_id AS top_bucket_id,
           c.project_id AS top_project_id, c.match_score AS top_match_score,
           c.authorization_trust AS top_authorization_trust, c.reasons AS top_reasons
      FROM routing_proposals p
      LEFT JOIN routing_sessions s ON s.id = p.session_id
      LEFT JOIN LATERAL (
        SELECT rc.rank, rc.task_id, rc.bucket_id, rc.project_id,
               rc.match_score, rc.authorization_trust, rc.reasons
          FROM routing_proposal_revisions r
          JOIN routing_revision_candidates rc ON rc.revision_id = r.id
         WHERE r.proposal_id = p.id
         ORDER BY r.created_at DESC, rc.rank ASC
         LIMIT 1
      ) c ON true
     WHERE p.state = ANY($1::text[])
  `;

  let whereExtra = "";
  const params: unknown[] = [[...OPEN_STATES]];

  if (input.scope === "personal") {
    params.push(input.actorId);
    whereExtra = ` AND s.actor_id = $${params.length} AND s.status = 'active'`;
  } else if (input.scope === "project") {
    if (!input.projectId) {
      return { proposals: [], counts: await countByScope(input.actorId) };
    }
    params.push(input.projectId);
    whereExtra = ` AND (
      p.derived_project_id = $${params.length}
      OR c.project_id = $${params.length}
    )`;
  } else if (input.scope === "bucket") {
    if (!input.bucketId) {
      return { proposals: [], counts: await countByScope(input.actorId) };
    }
    params.push(input.bucketId);
    whereExtra = ` AND (
      p.selected_bucket_id = $${params.length}
      OR c.bucket_id = $${params.length}
    )`;
  } else {
    // unrouted — no project and no bucket from proposal or top candidate
    whereExtra = ` AND p.derived_project_id IS NULL
                   AND p.selected_bucket_id IS NULL
                   AND c.project_id IS NULL
                   AND c.bucket_id IS NULL`;
  }

  params.push(limit);
  const rows = await query<Record<string, unknown>>(
    `${baseSelect}${whereExtra}
     ORDER BY p.created_at ASC
     LIMIT $${params.length}`,
    params
  );

  return {
    proposals: rows.map(mapSummary),
    counts: await countByScope(input.actorId),
  };
}

async function countByScope(actorId: string): Promise<Record<InboxScope, number>> {
  const rows = await query<{ scope: string; n: string | number }>(
    `WITH open_p AS (
       SELECT p.id, p.derived_project_id, p.selected_bucket_id, p.session_id,
              s.actor_id, s.status AS session_status,
              c.project_id AS top_project_id, c.bucket_id AS top_bucket_id
         FROM routing_proposals p
         LEFT JOIN routing_sessions s ON s.id = p.session_id
         LEFT JOIN LATERAL (
           SELECT rc.project_id, rc.bucket_id
             FROM routing_proposal_revisions r
             JOIN routing_revision_candidates rc ON rc.revision_id = r.id
            WHERE r.proposal_id = p.id
            ORDER BY r.created_at DESC, rc.rank ASC
            LIMIT 1
         ) c ON true
        WHERE p.state = ANY($1::text[])
     )
     SELECT 'personal'::text AS scope, COUNT(*)::int AS n FROM open_p
      WHERE actor_id = $2 AND session_status = 'active'
     UNION ALL
     SELECT 'project', COUNT(*)::int FROM open_p
      WHERE derived_project_id IS NOT NULL OR top_project_id IS NOT NULL
     UNION ALL
     SELECT 'bucket', COUNT(*)::int FROM open_p
      WHERE selected_bucket_id IS NOT NULL OR top_bucket_id IS NOT NULL
     UNION ALL
     SELECT 'unrouted', COUNT(*)::int FROM open_p
      WHERE derived_project_id IS NULL AND selected_bucket_id IS NULL
        AND top_project_id IS NULL AND top_bucket_id IS NULL`,
    [[...OPEN_STATES], actorId]
  );

  const counts: Record<InboxScope, number> = {
    personal: 0,
    project: 0,
    bucket: 0,
    unrouted: 0,
  };
  for (const row of rows) {
    const key = row.scope as InboxScope;
    if (key in counts) counts[key] = Number(row.n);
  }
  return counts;
}

export async function getInboxProposalDetail(
  proposalId: string
): Promise<InboxProposalDetail | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT p.id, p.repo_id, p.change_id, p.title, p.state, p.failure_reason,
            p.derived_project_id, p.selected_bucket_id, p.selected_task_id,
            p.session_id, p.created_at, p.updated_at, p.markers,
            s.actor_id, s.actor_kind,
            r.id AS revision_id, r.head_sha, r.policy_version
       FROM routing_proposals p
       LEFT JOIN routing_sessions s ON s.id = p.session_id
       LEFT JOIN LATERAL (
         SELECT id, head_sha, policy_version
           FROM routing_proposal_revisions
          WHERE proposal_id = p.id
          ORDER BY created_at DESC
          LIMIT 1
       ) r ON true
      WHERE p.id = $1
      LIMIT 1`,
    [proposalId]
  );
  const row = rows[0];
  if (!row) return null;

  const candidates =
    row.revision_id != null
      ? (
          await query<Record<string, unknown>>(
            `SELECT rank, task_id, bucket_id, project_id, match_score,
                    authorization_trust, reasons
               FROM routing_revision_candidates
              WHERE revision_id = $1
              ORDER BY rank ASC
              LIMIT 10`,
            [String(row.revision_id)]
          )
        ).map(mapCandidate)
      : [];

  const summary = mapSummary({
    ...row,
    top_rank: candidates[0]?.rank,
    top_task_id: candidates[0]?.taskId,
    top_bucket_id: candidates[0]?.bucketId,
    top_project_id: candidates[0]?.projectId,
    top_match_score: candidates[0]?.matchScore,
    top_authorization_trust: candidates[0]?.authorizationTrust,
    top_reasons: candidates[0]?.reasons,
  });

  const bucketId =
    summary.selectedBucketId ?? candidates[0]?.bucketId ?? null;
  const projectId =
    summary.derivedProjectId ?? candidates[0]?.projectId ?? null;

  return {
    ...summary,
    markers: Array.isArray(row.markers) ? row.markers : [],
    hierarchy: {
      projectId,
      bucketId,
      taskId: summary.selectedTaskId ?? candidates[0]?.taskId ?? null,
    },
    candidates,
    revisionId: row.revision_id == null ? null : String(row.revision_id),
    headSha: row.head_sha == null ? null : String(row.head_sha),
    policyVersion: row.policy_version == null ? null : String(row.policy_version),
    overrideAvailable: summary.state === "action_required" || summary.state === "degraded",
  };
}
