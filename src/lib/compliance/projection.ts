// PR lifecycle → sync Task projection (EN-007 P1). Consumes normalized PR events
// after mc_events are appended; mutates tasks via the sync state layer only.
// Operator sparse-Task creation is retired — unrouted operator PRs become
// action_required routing proposals (see proposeRoutingFromPr in service.ts).

import { ApiError } from "@/lib/api/route";
import { STAGES, type PullRequest, type StageKey, type Task } from "@/lib/mc-data";
import { creatorApprovalPending } from "@/lib/mc-data/policy";
import {
  COMPLIANCE_PROJECTION_SERVICE_PRINCIPAL_ID,
  type PermissionActor,
} from "@/lib/permissions";
import {
  authorizeStaged,
  recordUnresolvedActorDenial,
  resolveStagedServicePrincipal,
} from "@/lib/permissions/enforcement";
import { withTransaction } from "@/lib/db";
import { patchTask, type PatchTaskInput } from "@/lib/sync/state";
import { getEntity, taskIdsWithPr } from "@/lib/sync/repo";
import * as complianceRepo from "./repo";
import { integrationBranchFor } from "./tracked-repos";
import type { ActorKind } from "./types";
import type { PrEvent } from "./webhook";

const PROJECTION_ACTOR = "compliance-projection";
const DONE_STAGES: StageKey[] = ["merged", "verified"];
const OPEN_ACTIONS = ["opened", "reopened", "synchronize", "ready_for_review"];
const STAGE_NAME = new Map<string, string>(STAGES.map((s) => [s.key, s.name]));

export function projectionEnabled(): boolean {
  return process.env.COMPLIANCE_PROJECTION_ENABLED !== "0";
}

async function loadTask(taskId: string): Promise<Task | null> {
  const row = await getEntity("task", taskId);
  return row ? (row.data as unknown as Task) : null;
}

// One row per repo and PR number; GitHub repo names are case-insensitive.
export function samePr(a: PullRequest, b: Pick<PullRequest, "repo" | "num">): boolean {
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
  if (await skipBlockedPromotion(task, evt)) return;

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

// A PR never reopens or promotes a cancelled task (TASK-2529), or a task that
// still waits for creator approval (TASK-3530); it leaves a
// task.promotion_skipped event so the PR check and the task history both show why.
async function skipBlockedPromotion(task: Task, evt: PrEvent): Promise<boolean> {
  const creatorPending = creatorApprovalPending(task);
  if (task.stage !== "cancelled" && !creatorPending) return false;
  await complianceRepo.appendEvent({
    kind: "task.promotion_skipped",
    actor: PROJECTION_ACTOR,
    repo: evt.repo,
    taskId: task.id,
    pr: String(evt.prNumber),
    payload: task.stage === "cancelled"
      ? { reason: "task_cancelled", cancellation: task.cancellation ?? null }
      : { reason: "creator_approval_pending", creatorPrincipal: task.creatorApproval?.principal ?? null },
    dedupKey: `task.promotion_skipped:${evt.repo}:${evt.prNumber}:${evt.headSha}:${task.id}`,
  });
  return true;
}

interface LockedPatch<R> {
  patch: PatchTaskInput;
  completedAt?: string;
  result?: R;
}

// Read-modify-write under the task row lock: the patch is built from the locked
// row, so two PR events landing at once never write a stale prs list over each
// other. `build` returns null to write nothing; patchLocked returns its result.
async function patchLocked<R = undefined>(taskId: string, build: (task: Task) => LockedPatch<R> | null): Promise<R | undefined> {
  return withTransaction(async (q) => {
    const row = await getEntity("task", taskId, q, true);
    const built = row ? build(row.data as unknown as Task) : null;
    if (!built) return undefined;
    await patchTask(taskId, built.patch, PROJECTION_ACTOR, { complianceProjection: true, completedAt: built.completedAt, query: q });
    return built.result;
  });
}

const isOpenRow = (p: PullRequest): boolean => p.status === "open" || p.status === "draft";

// TASK-3797: a task's work has landed only when a PR merged into the repo's
// integration branch (config/tracked-repos-registry.json). A row merged before
// TASK-3797 has no base, so it never counts.
function reachedIntegration(p: PullRequest): boolean {
  return p.status === "merged" && p.base !== undefined && p.base === integrationBranchFor(p.repo);
}

// A held task (its work reached the integration branch while another of its PRs
// was open: merge.held) is promoted once none of its PRs is open or draft.
// Returns the PR that reached the integration branch, or null. Only a hold
// counts: an older integration merge on a task moved back stays history.
function heldMergeReady(task: Task, prs: PullRequest[]): PullRequest | null {
  if (!task.merge?.held) return null;
  if (DONE_STAGES.includes(task.stage) || task.stage === "cancelled" || creatorApprovalPending(task)) return null;
  if (prs.some(isOpenRow)) return null;
  return prs.find(reachedIntegration) ?? null;
}

// The task's merge record with the hold cleared, once a held task is promoted.
function endHold(task: Task): PatchTaskInput["merge"] {
  return task.merge ? { sha: task.merge.sha, on: task.merge.on } : undefined;
}

async function recordHeldPromotion(taskId: string, evt: PrEvent, sha: string | undefined): Promise<void> {
  await complianceRepo.appendEvent({
    kind: "task.promoted",
    actor: PROJECTION_ACTOR,
    repo: evt.repo,
    taskId,
    pr: String(evt.prNumber),
    payload: { sha: sha ?? null, stage: "merged", completionSource: "held_merge" },
    dedupKey: `task.promoted:${evt.repo}:${evt.prNumber}:${sha ?? evt.headSha}:${taskId}`,
  });
}

// The prs patch that sets this PR's row to `status`, or null when nothing changes:
// a cancelled task (TASK-2529), a merged row (it always wins), an unchanged row,
// or, with `onlyExisting`, a task that holds no row for the PR. A closed row
// opens again only on `reopened`: a late or replayed open event would otherwise
// leave an open row that holds the task forever (TASK-3797).
function prRowPatch(task: Task, evt: PrEvent, status: PullRequest["status"], onlyExisting: boolean): PatchTaskInput | null {
  if (task.stage === "cancelled") return null;
  const prs = task.prs ?? [];
  const prior = prs.find((p) => samePr(p, { repo: evt.repo, num: evt.prNumber }));
  if ((onlyExisting && !prior) || prior?.status === "merged") return null;
  if (prior?.status === "closed" && status !== "closed" && evt.action !== "reopened") return null;
  if (prior?.status === status && prior.title === evt.title) return null;
  return { prs: appendPr(prs, { repo: evt.repo, num: evt.prNumber, status, title: evt.title }) };
}

// TASK-3743: show the PR on its task before merge (open / draft / closed). Replays
// are no-ops, and setProgress records the skip for a cancelled task. A close that
// leaves a held task with no open PR promotes it (TASK-3797).
async function linkPr(taskId: string, evt: PrEvent, status: PullRequest["status"], onlyExisting = false): Promise<void> {
  const task = await loadTask(taskId);
  if (!task || !prRowPatch(task, evt, status, onlyExisting)) return;

  await requireProjectionAuthorized(
    "task.link",
    { type: "task", id: taskId, repos: task.repos, stage: task.stage }
  );

  const promoted = await patchLocked<{ sha?: string }>(taskId, (locked) => {
    const patch = prRowPatch(locked, evt, status, onlyExisting);
    if (!patch) return null;
    const landed = status === "closed" ? heldMergeReady(locked, patch.prs ?? []) : null;
    if (!landed) return { patch };
    return {
      patch: {
        ...patch,
        stage: "merged",
        merge: endHold(locked),
        activityLine: {
          who: PROJECTION_ACTOR,
          what: `PR #${evt.prNumber} closed — promoted to Merged: PR #${landed.num} reached ${landed.base} (compliance projection)`,
          kind: "move",
        },
      },
      result: { sha: locked.merge?.sha },
    };
  });
  if (promoted) await recordHeldPromotion(taskId, evt, promoted.sha);
}

type MergeOutcome =
  | { kind: "promoted" }
  | { kind: "verified" }
  | { kind: "held"; openPrs: number[] }
  | { kind: "elsewhere"; integrationBranch: string }
  | { kind: "held_ended"; landed: PullRequest; sha?: string };

// A merged PR always shows on its task as merged, with the branch it went into.
// The task moves to Merged only when the work reached the repo's integration
// branch and none of the task's other PRs is still open or draft (TASK-3797).
async function promoteMerged(taskId: string, evt: PrEvent): Promise<void> {
  const task = await loadTask(taskId);
  if (!task) return;
  if (await skipBlockedPromotion(task, evt)) return;

  await requireProjectionAuthorized(
    "task.link",
    { type: "task", id: taskId, repos: task.repos, stage: task.stage }
  );

  const integrationBranch = integrationBranchFor(evt.repoFullName || evt.repo);
  // A webhook always carries the base. A caller that cannot read it counts as
  // the integration branch, as before TASK-3797.
  const base = evt.baseBranch || integrationBranch;
  const pr: PullRequest = {
    repo: evt.repo,
    num: evt.prNumber,
    status: "merged",
    title: evt.title,
    base,
  };
  const mergeOn = new Date().toISOString().slice(0, 10);
  const mergeSha = evt.mergeSha || evt.headSha;
  const line = (what: string) => ({ who: PROJECTION_ACTOR, what: `${what} (compliance projection)`, kind: "move" as const });

  const outcome = await patchLocked<MergeOutcome>(taskId, (locked): LockedPatch<MergeOutcome> => {
    const prs = appendPr(locked.prs ?? [], pr);
    // A merge never moves a verified task back to merged: the portal sets
    // verified when the submitter confirms the fix (TASK-3697). The PR and merge
    // are still recorded, and task.promotion_skipped says why the stage held.
    if (locked.stage === "verified") {
      return {
        patch: { prs, merge: { sha: mergeSha, on: mergeOn }, activityLine: line(`PR #${evt.prNumber} merged — stays Verified`) },
        result: { kind: "verified" },
      };
    }
    if (base !== integrationBranch) {
      // A merge into another branch can still end a hold: the task's own work is
      // on the integration branch and this was its last open PR.
      const landed = heldMergeReady(locked, prs);
      if (landed) {
        return {
          patch: {
            stage: "merged",
            prs,
            merge: endHold(locked),
            activityLine: line(`PR #${evt.prNumber} merged into ${base} — promoted to Merged: PR #${landed.num} reached ${landed.base}`),
          },
          completedAt: validIso(evt.mergedAt),
          result: { kind: "held_ended", landed, sha: locked.merge?.sha },
        };
      }
      return {
        patch: { prs, activityLine: line(`PR #${evt.prNumber} merged into ${base}, not promoted: ${integrationBranch} is the integration branch`) },
        result: { kind: "elsewhere", integrationBranch },
      };
    }
    const openPrs = prs.filter(isOpenRow).map((p) => p.num);
    if (openPrs.length > 0 && !DONE_STAGES.includes(locked.stage)) {
      const stageName = STAGE_NAME.get(locked.stage) ?? locked.stage;
      return {
        patch: {
          prs,
          merge: { sha: mergeSha, on: mergeOn, held: true },
          activityLine: line(`PR #${evt.prNumber} merged — held at ${stageName}: PR ${openPrs.map((n) => `#${n}`).join(", ")} still open`),
        },
        result: { kind: "held", openPrs },
      };
    }
    return {
      patch: {
        stage: "merged",
        prs,
        merge: { sha: mergeSha, on: mergeOn },
        activityLine: line(`PR #${evt.prNumber} merged — promoted to Merged`),
      },
      // completed_at is the PR merge time, not this projection run (TASK-2528).
      completedAt: validIso(evt.mergedAt),
      result: { kind: "promoted" },
    };
  });
  if (!outcome) return;

  const skip = (payload: Record<string, unknown>) =>
    complianceRepo.appendEvent({
      kind: "task.promotion_skipped",
      actor: PROJECTION_ACTOR,
      repo: evt.repo,
      taskId,
      pr: String(evt.prNumber),
      payload: { ...payload, sha: mergeSha },
      dedupKey: `task.promotion_skipped:${evt.repo}:${evt.prNumber}:${evt.headSha}:${taskId}`,
    });

  switch (outcome.kind) {
    case "verified":
      await skip({ reason: "task_verified" });
      return;
    case "elsewhere":
      await skip({ reason: "not_integration_branch", base, integrationBranch: outcome.integrationBranch });
      return;
    case "held":
      await skip({ reason: "open_pr", openPrs: outcome.openPrs });
      return;
    case "held_ended":
      await recordHeldPromotion(taskId, evt, outcome.sha);
      return;
    case "promoted":
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
}

export interface ProjectionInput {
  actorKind: ActorKind;
  actorIdentity: string;
  taskIds: string[];
  /**
   * Legacy flag: previously triggered sparse Task creation for operator PRs.
   * Sparse creation is retired — when true with empty taskIds, an open is a
   * no-op (routing proposal + action_required deep link owns that path); a
   * close still updates the PR rows that tasks already hold.
   */
  sparse: boolean;
  /**
   * TASK-4004: the task an unstamped PR's title or branch names
   * (resolvePrTask). An open links the PR row with no stage move; a merge is
   * projected as for a stamped task, so it promotes; an unmerged close only
   * updates a row the task already holds.
   */
  linkedTaskIds?: string[];
}

export async function projectPullRequest(evt: PrEvent, input: ProjectionInput): Promise<void> {
  if (!projectionEnabled()) return;

  const taskIds = [...input.taskIds];
  const linkedTaskIds = input.linkedTaskIds ?? [];

  if (evt.action === "closed") {
    // A linked task is promoted like a stamped one; an unmerged close only
    // updates the rows tasks already hold (the loop below).
    const closing = evt.merged ? [...taskIds, ...linkedTaskIds] : taskIds;
    for (const tid of closing) {
      if (evt.merged) await promoteMerged(tid, evt);
      else await linkPr(tid, evt, "closed");
    }
    // Any other task that holds a row for this PR (its stamp moved, or its
    // checkout expired or was released) sees it closed, with no stage move. Only
    // a stamped or linked task gets `merged` and the promotion; a merged row
    // stays merged.
    for (const tid of await taskIdsWithPr(evt.repo, evt.prNumber)) {
      if (!closing.includes(tid)) await linkPr(tid, evt, "closed", true);
    }
    return;
  }

  // Sparse-task retirement: never auto-create Tasks for operator PRs.
  if (input.sparse && taskIds.length === 0 && linkedTaskIds.length === 0) {
    return;
  }

  if (OPEN_ACTIONS.includes(evt.action)) {
    for (const tid of taskIds) {
      await setProgress(tid, evt);
      await linkPr(tid, evt, evt.draft ? "draft" : "open");
    }
    for (const tid of linkedTaskIds) await linkPr(tid, evt, evt.draft ? "draft" : "open");
  }
}
