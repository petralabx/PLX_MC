// PR lifecycle → sync Task projection (EN-007 P1). Consumes normalized PR events
// after mc_events are appended; mutates tasks via the sync state layer only.
// Operator sparse-Task creation is retired — unrouted operator PRs become
// action_required routing proposals (see proposeRoutingFromPr in service.ts).

import { ApiError } from "@/lib/api/route";
import type { PullRequest, StageKey, Task } from "@/lib/mc-data";
import {
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  type PermissionActor,
} from "@/lib/permissions";
import {
  authorizeStaged,
  recordUnresolvedActorDenial,
  resolveStagedServicePrincipal,
} from "@/lib/permissions/enforcement";
import { patchTask } from "@/lib/sync/state";
import { getEntity } from "@/lib/sync/repo";
import * as complianceRepo from "./repo";
import type { ActorKind } from "./types";
import type { PrEvent } from "./webhook";

const PROJECTION_ACTOR = "compliance-projection";
const DONE_STAGES: StageKey[] = ["merged", "verified"];
const OPEN_ACTIONS = ["opened", "reopened", "synchronize", "ready_for_review"];

export function projectionEnabled(): boolean {
  return process.env.COMPLIANCE_PROJECTION_ENABLED !== "0";
}

async function loadTask(taskId: string): Promise<Task | null> {
  const row = await getEntity("task", taskId);
  return row ? (row.data as unknown as Task) : null;
}

// One row per repo and PR number; GitHub repo names are case-insensitive.
function samePr(a: PullRequest, b: Pick<PullRequest, "repo" | "num">): boolean {
  return a.repo.toLowerCase() === b.repo.toLowerCase() && a.num === b.num;
}

function appendPr(existing: PullRequest[], pr: PullRequest): PullRequest[] {
  const idx = existing.findIndex((p) => samePr(p, pr));
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
  const staged = await resolveStagedServicePrincipal(
    COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID
  );
  if (!staged.actor) {
    recordUnresolvedActorDenial({
      site: "compliance.projection",
      capability,
      actorKind: "service",
      actorId: COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
      resource,
    });
    throw new ApiError(
      "forbidden",
      "Durable sp_compliance_projection service principal is missing.",
      403
    );
  }
  const decision = authorizeStaged({
    site: "compliance.projection",
    capability,
    resource,
    context,
    appliedActor: staged.actor,
    shadowActor: staged.shadowActor,
    shadowMissing: staged.shadowMissing,
  });
  if (!decision.allowed) {
    throw new ApiError(
      "forbidden",
      `compliance projection ${capability} denied (${decision.reasonCode}).`,
      403
    );
  }
  return staged.actor;
}

async function setProgress(taskId: string, evt: PrEvent): Promise<void> {
  const task = await loadTask(taskId);
  if (!task || DONE_STAGES.includes(task.stage)) return;
  if (task.stage === "progress") return;
  if (await skipCancelled(task, evt)) return;

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

function validIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

// A PR never reopens or promotes a cancelled task (TASK-2529); it leaves a
// task.promotion_skipped event so the PR check and the task history both show why.
async function skipCancelled(task: Task, evt: PrEvent): Promise<boolean> {
  if (task.stage !== "cancelled") return false;
  await complianceRepo.appendEvent({
    kind: "task.promotion_skipped",
    actor: PROJECTION_ACTOR,
    repo: evt.repo,
    taskId: task.id,
    pr: String(evt.prNumber),
    payload: { reason: "task_cancelled", cancellation: task.cancellation ?? null },
    dedupKey: `task.promotion_skipped:${evt.repo}:${evt.prNumber}:${evt.headSha}:${task.id}`,
  });
  return true;
}

// TASK-3743: show the PR on its task before merge (open / draft / closed). The
// merged entry wins, and an unchanged row is not rewritten, so replays are no-ops.
// A cancelled task is never touched (TASK-2529; setProgress records the skip).
async function linkPr(taskId: string, evt: PrEvent, status: PullRequest["status"]): Promise<void> {
  const task = await loadTask(taskId);
  if (!task || task.stage === "cancelled") return;
  const prs = task.prs ?? [];
  const prior = prs.find((p) => samePr(p, { repo: evt.repo, num: evt.prNumber }));
  if (prior?.status === "merged" || (prior?.status === status && prior.title === evt.title)) return;

  await requireProjectionAuthorized(
    "task.link",
    { type: "task", id: taskId, repos: task.repos, stage: task.stage }
  );

  await patchTask(
    taskId,
    { prs: appendPr(prs, { repo: evt.repo, num: evt.prNumber, status, title: evt.title }) },
    PROJECTION_ACTOR,
    { complianceProjection: true }
  );
}

async function promoteMerged(taskId: string, evt: PrEvent): Promise<void> {
  const task = await loadTask(taskId);
  if (!task) return;
  if (await skipCancelled(task, evt)) return;

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
    // completed_at is the PR merge time, not this projection run (TASK-2528).
    { complianceProjection: true, completedAt: validIso(evt.mergedAt) }
  );

  await complianceRepo.appendEvent({
    kind: "task.promoted",
    actor: PROJECTION_ACTOR,
    repo: evt.repo,
    taskId,
    pr: String(evt.prNumber),
    payload: { sha: mergeSha, stage: "merged", completionSource: "pr_merge" },
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
    for (const tid of taskIds) {
      if (evt.merged) await promoteMerged(tid, evt);
      else await linkPr(tid, evt, "closed");
    }
    return;
  }

  if (OPEN_ACTIONS.includes(evt.action)) {
    for (const tid of taskIds) {
      await setProgress(tid, evt);
      await linkPr(tid, evt, evt.draft ? "draft" : "open");
    }
  }
}
