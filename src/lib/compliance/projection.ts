// PR lifecycle → sync Task projection (EN-007 P1). Consumes normalized PR events
// after mc_events are appended; mutates tasks via the sync state layer only.
// Operator sparse-Task creation is retired — unrouted operator PRs become
// action_required routing proposals (see proposeRoutingFromPr in service.ts).

import { ApiError } from "@/lib/api/route";
import { permissionsEnforcementEnabled } from "@/lib/auth";
import type { PullRequest, StageKey, Task } from "@/lib/mc-data";
import {
  authorize,
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  type PermissionActor,
} from "@/lib/permissions";
import { findServicePrincipalById } from "@/lib/permissions/repository";
import { patchTask } from "@/lib/sync/state";
import { getEntity } from "@/lib/sync/repo";
import * as complianceRepo from "./repo";
import type { ActorKind } from "./types";
import type { PrEvent } from "./webhook";

const PROJECTION_ACTOR = "compliance-projection";
const DONE_STAGES: StageKey[] = ["merged", "verified"];

export function projectionEnabled(): boolean {
  return process.env.COMPLIANCE_PROJECTION_ENABLED !== "0";
}

async function loadTask(taskId: string): Promise<Task | null> {
  const row = await getEntity("task", taskId);
  return row ? (row.data as unknown as Task) : null;
}

function appendPr(existing: PullRequest[], pr: PullRequest): PullRequest[] {
  const idx = existing.findIndex((p) => p.repo === pr.repo && p.num === pr.num);
  if (idx >= 0) {
    const next = [...existing];
    next[idx] = pr;
    return next;
  }
  return [...existing, pr];
}

/**
 * Resolve the durable compliance-projection service principal and require
 * authorize(...) before any projection-driven Task mutation.
 */
export async function requireProjectionAuthorized(
  capability: "task.progress" | "task.link",
  resource: { type: "task"; id: string; repos?: string[]; stage?: string },
  context?: { repositoryId?: string }
): Promise<PermissionActor> {
  let status: "active" | "revoked" = "active";
  if (permissionsEnforcementEnabled()) {
    const persisted = await findServicePrincipalById(
      COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID
    );
    if (!persisted) {
      throw new ApiError(
        "forbidden",
        "Durable sp_compliance_projection service principal is missing.",
        403
      );
    }
    status = persisted.status;
  }
  const actor: PermissionActor = {
    kind: "service",
    id: COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
    status,
  };
  const decision = authorize({
    actor,
    capability,
    resource,
    context,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `compliance projection ${capability} denied (${decision.reasonCode}).`,
      403
    );
  }
  return actor;
}

async function setProgress(taskId: string, evt: PrEvent): Promise<void> {
  const task = await loadTask(taskId);
  if (!task || DONE_STAGES.includes(task.stage)) return;
  if (task.stage === "progress") return;

  await requireProjectionAuthorized(
    "task.progress",
    { type: "task", id: taskId, repos: task.repos, stage: task.stage }
  );

  await patchTask(
    taskId,
    {
      stage: "progress",
      activityLine: {
        who: PROJECTION_ACTOR,
        what: `PR #${evt.prNumber} opened — moved to In Progress (compliance projection)`,
        kind: "move",
      },
    },
    PROJECTION_ACTOR,
    { complianceProjection: true }
  );
}

async function promoteMerged(taskId: string, evt: PrEvent): Promise<void> {
  const task = await loadTask(taskId);
  if (!task) return;

  await requireProjectionAuthorized(
    "task.link",
    { type: "task", id: taskId, repos: task.repos, stage: task.stage }
  );

  const pr: PullRequest = {
    repo: evt.repo,
    num: evt.prNumber,
    status: "merged",
    title: evt.title,
  };
  const prs = appendPr(task.prs ?? [], pr);
  const mergeOn = new Date().toISOString().slice(0, 10);
  const mergeSha = evt.mergeSha || evt.headSha;

  await patchTask(
    taskId,
    {
      stage: "merged",
      prs,
      merge: { sha: mergeSha, on: mergeOn },
      activityLine: {
        who: PROJECTION_ACTOR,
        what: `PR #${evt.prNumber} merged — promoted to Merged (compliance projection)`,
        kind: "move",
      },
    },
    PROJECTION_ACTOR,
    { complianceProjection: true }
  );

  await complianceRepo.appendEvent({
    kind: "task.promoted",
    actor: PROJECTION_ACTOR,
    repo: evt.repo,
    taskId,
    pr: String(evt.prNumber),
    payload: { sha: mergeSha, stage: "merged" },
    dedupKey: `task.promoted:${evt.repo}:${evt.prNumber}:${mergeSha}:${taskId}`,
  });
}

export interface ProjectionInput {
  actorKind: ActorKind;
  actorIdentity: string;
  taskIds: string[];
  /**
   * Legacy flag: previously triggered sparse Task creation for operator PRs.
   * Sparse creation is retired — when true with empty taskIds, projection is a
   * no-op (routing proposal + action_required deep link owns that path).
   */
  sparse: boolean;
}

export async function projectPullRequest(evt: PrEvent, input: ProjectionInput): Promise<void> {
  if (!projectionEnabled()) return;

  const taskIds = [...input.taskIds];

  // Sparse-task retirement: never auto-create Tasks for operator PRs.
  if (input.sparse && taskIds.length === 0) {
    return;
  }

  if (evt.action === "closed") {
    if (!evt.merged) return;
    for (const tid of taskIds) {
      await promoteMerged(tid, evt);
    }
    return;
  }

  if (["opened", "reopened", "synchronize"].includes(evt.action)) {
    for (const tid of taskIds) {
      await setProgress(tid, evt);
    }
  }
}
