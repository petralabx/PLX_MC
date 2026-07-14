// POST /api/routing/transfer — transfer an unconsumed rtx_* session (same repo).
// Humans transfer their own session to another branch; Owner/Admin may transfer
// any active session (including to another accountable actor). Never cross-repo.

import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api/route";
import { query, withTransaction } from "@/lib/db";
import {
  recordDecision,
  upsertRoutingSession,
  ROUTING_POLICY_VERSION,
} from "@/lib/routing";
import {
  assertSameOriginMutation,
  requireInboxActor,
} from "../inbox/_lib/guard";

function mintId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const schema = z.object({
  sessionId: z.string().min(1).regex(/^rtx_/),
  sourceBranch: z.string().min(1),
  headSha: z.string().nullable().optional(),
  /** Optional new accountable actor (Owner/Admin only when different from self). */
  toActorId: z.string().min(1).optional(),
  proposalId: z.string().optional(),
  actorId: z.string().optional(),
});

export const POST = route(async (req) => {
  assertSameOriginMutation(req);
  const body = await parseBody(req, schema);
  const authorized = await requireInboxActor("routing.resolve", {
    type: "routing",
    id: body.sessionId,
  });

  const rows = await query<Record<string, unknown>>(
    `SELECT id, repo_id, actor_id, actor_kind, base_branch, source_branch,
            head_sha, status, absolute_expires_at, idle_expires_at
       FROM routing_sessions
      WHERE id = $1
      LIMIT 1`,
    [body.sessionId]
  );
  const session = rows[0];
  if (!session) {
    throw new ApiError("not_found", `unknown session ${body.sessionId}`, 404);
  }
  if (String(session.status) !== "active") {
    throw new ApiError(
      "session_not_active",
      `Session ${body.sessionId} is ${session.status}.`,
      409
    );
  }

  const sessionActorId = String(session.actor_id);
  const isOwner =
    authorized.actor.kind === "human" &&
    (authorized.actor.role === "owner" || authorized.actor.role === "admin");
  const ownsSession = sessionActorId === authorized.actorId;

  if (!ownsSession && !isOwner) {
    throw new ApiError(
      "forbidden",
      "Only the session actor or Owner/Admin may transfer a routing session.",
      403
    );
  }

  const toActorId = body.toActorId?.trim() || sessionActorId;
  if (toActorId !== sessionActorId && !isOwner) {
    throw new ApiError(
      "forbidden",
      "Only Owner/Admin may transfer a session to another actor.",
      403
    );
  }

  const newSessionId = mintId("rtx");
  const absoluteExpiresAt = String(session.absolute_expires_at);
  const idleMs = 24 * 60 * 60 * 1000;
  const idleExpiresAt = new Date(
    Math.min(Date.now() + idleMs, Date.parse(absoluteExpiresAt) || Date.now() + idleMs)
  ).toISOString();

  await withTransaction(async (q) => {
    await q(
      `UPDATE routing_sessions
          SET status = 'transferred',
              last_activity_at = now()
        WHERE id = $1
          AND status = 'active'`,
      [body.sessionId]
    );

    await upsertRoutingSession(
      {
        id: newSessionId,
        repoId: String(session.repo_id),
        actorId: toActorId,
        actorKind: "human",
        baseBranch: String(session.base_branch),
        sourceBranch: body.sourceBranch,
        headSha: body.headSha === undefined ? (session.head_sha as string | null) : body.headSha,
        status: "active",
        absoluteExpiresAt,
        idleExpiresAt,
      },
      q
    );

    // Stamp transfer_of on the new row (column exists; upsert helper omits it).
    await q(
      `UPDATE routing_sessions SET transfer_of = $2 WHERE id = $1`,
      [newSessionId, body.sessionId]
    );

    if (body.proposalId) {
      await q(
        `UPDATE routing_proposals
            SET session_id = $2, updated_at = now()
          WHERE id = $1
            AND state = ANY($3::text[])`,
        [body.proposalId, newSessionId, ["provisional", "action_required", "degraded"]]
      );

      await recordDecision(
        {
          id: mintId("rd"),
          proposalId: body.proposalId,
          revisionId: null,
          decisionKind: "transfer",
          taskId: null,
          bucketId: null,
          projectId: null,
          actorId: authorized.actorId,
          actorKind: authorized.actorKind,
          overrideReason: null,
          rejectionReason: null,
          policyVersion: ROUTING_POLICY_VERSION,
        },
        q
      );
    }

    await q(
      `INSERT INTO mc_events (kind, actor, repo, task_id, payload)
       VALUES ($1, $2, $3, NULL, $4::jsonb)`,
      [
        "routing.transfer",
        authorized.auditLabel,
        String(session.repo_id),
        JSON.stringify({
          fromSessionId: body.sessionId,
          toSessionId: newSessionId,
          sourceBranch: body.sourceBranch,
          toActorId,
          proposalId: body.proposalId ?? null,
        }),
      ]
    );
  });

  return {
    fromSessionId: body.sessionId,
    toSessionId: newSessionId,
    sourceBranch: body.sourceBranch,
    toActorId,
    proposalId: body.proposalId ?? null,
  };
});
