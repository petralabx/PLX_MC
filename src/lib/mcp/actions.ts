// PLX MC cursor API actions — shared by REST routes and HTTP MCP transport.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { withTransaction } from "@/lib/db";
import { resolveCompletionAutonomy } from "@/lib/routing";
import { classifyRiskTier, evidenceStandardReport, requiresHumanVerification } from "@/lib/compliance";
import { checkout, complete } from "@/lib/compliance/service";
import * as complianceRepo from "@/lib/compliance/repo";
import {
  archiveContainer,
  createBucket,
  createProject,
  createTask,
  patchBucket,
  patchTask,
  snapshot,
  searchTaskPage,
  type TaskSearchFilter,
  type CreateBucketInput,
  type CreateProjectInput,
  type CreateTaskInput,
  type PatchBucketInput,
} from "@/lib/sync";
import { cancelTask } from "@/lib/sync/cancel";
import { getEntity } from "@/lib/sync/repo";
import {
  creatorApprovalViolation,
  isArchived,
  resolveHumanAccountableOwner,
  STAGE_IDX,
  TERMINAL_STAGES,
  isClosedStage,
  type Evidence,
  type StageKey,
  type Task,
} from "@/lib/mc-data";
import {
  aclPrincipalFromMcp,
  requireMcpActor,
} from "@/lib/routing/mutations/actors";
import { assertAgentAssigneeAllowed } from "@/lib/permissions/agent-assignee-guard";
import { isCreatorApprovalGated } from "@/lib/permissions";
import { createLabelsWithKind } from "@/lib/tasks/kind";
import { isUatTicketTask } from "@/lib/tasks/uat-labels";
import {
  assertBucketProjectAccess,
  assertProjectIdAccess,
  assertTaskProjectAccess,
  loadProjectAclMaps,
  recordReadShadowMismatch,
} from "@/lib/permissions/project-acl-guard";
import {
  canAccessBucket,
  filterBucketsByAcl,
  filterProjectsByAcl,
  filterTasksByAcl,
  indexById,
} from "@/lib/permissions/project-acl";
import { mcpAuditActor, type McpIdentity } from "./auth";
import { taskSearchSchema, type SearchTasksInput } from "./task-search-schema";
export type { SearchTasksInput } from "./task-search-schema";
import { TERMINAL_TASK_STAGES } from "./task-update-actions";
import { resolveCheckoutRepo } from "./checkout-repo";
import { checkoutLaneCap, laneCapCheckoutMode, laneCapRefusal, type LaneCapResult } from "./checkout-lane-cap";
import { bucketLink, projectLink, taskLink } from "./envelope";
import { assertEvidenceStandard } from "./evidence-standard-guard";
import { assertMayCloseOrReopen, cancelContextFor } from "./task-cancel-actions";
import { buildHonestyFields } from "./honesty";
import { syncMetaForTask } from "./sync-meta";
import { runIdempotentTaskCreate, taskCreatePayloadHash } from "./task-create-idempotency";

export {
  actionSuggestWork,
  mintRoutingSessionId,
  registerRoutingSuggestTools,
  routingSuggestEnabled,
  type SuggestWorkInput,
  type SuggestWorkResult,
} from "./routing-suggest-actions";

export {
  actionConfirmExisting,
  actionAttachCheckout,
  actionCreateRoutedTask,
  registerRoutingMutationTools,
} from "./routing-mutation-actions";

export {
  actionListConflicts,
  actionDismissConflict,
  actionDismissConflicts,
  actionResolveConflict,
  actionResolveConflicts,
  registerSyncConflictTools,
} from "./sync-actions";

export async function actionSelfCheck(identity: McpIdentity) {
  const snap = await snapshot();
  const honesty = await buildHonestyFields({ lastSweep: snap.lastSweep });
  return {
    ok: true,
    operator: identity.operatorEmail,
    taskCount: snap.tasks.length,
    bucketCount: snap.buckets.length,
    lastSweep: snap.lastSweep,
    ...honesty,
  };
}

export type SearchTasksFilter = TaskSearchFilter;

export type GetContextInput = {
  depth?: "compact" | "full";
  bucket?: string;
  taskIds?: string[];
};

export type GetContextFilter = {
  depth: "compact" | "full";
  bucket?: string;
  taskIds?: string[];
};

/** Resolve `q` / `query` aliases; reject conflicting values. */
export function resolveSearchQueryText(input: { q?: string; query?: string }): string {
  const q = input.q;
  const query = input.query;
  if (q != null && query != null && q !== query) {
    throw new ApiError(
      "invalid_request",
      "Provide only one of q or query (they are aliases); conflicting values were sent."
    );
  }
  return (q ?? query ?? "").trim();
}

export function resolveSearchFilter(input: SearchTasksInput): SearchTasksFilter {
  const parsed = taskSearchSchema.safeParse(input);
  if (!parsed.success) throw new ApiError("invalid_request", parsed.error.message);
  const query = resolveSearchQueryText(input);
  const limit = input.limit ?? 50;
  const assignee = (input.assignee ?? "").trim();
  const completedAfter = normalizeInstant("completedAfter", input.completedAfter);
  const completedBefore = normalizeInstant("completedBefore", input.completedBefore);
  return {
    ...(query ? { query } : {}),
    ...(input.bucket ? { bucket: input.bucket } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    ...(assignee ? { assignee } : {}),
    ...(completedAfter ? { completedAfter } : {}),
    ...(completedBefore ? { completedBefore } : {}),
    ...(input.label ? { label: input.label } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.searchComments !== undefined ? { searchComments: input.searchComments } : {}),
    ...(input.in ? { in: [...new Set(input.in)].sort() } : {}),
    ...(input.fields ? { fields: input.fields } : {}),
    limit,
  };
}

function normalizeInstant(name: string, value: string | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new ApiError("invalid_request", `${name} must be an ISO-8601 date or timestamp; got "${raw}".`);
  }
  return new Date(ms).toISOString();
}

export function resolveContextFilter(input: GetContextInput = {}): GetContextFilter {
  const depth = input.depth === "full" ? "full" : "compact";
  const taskIds = (input.taskIds ?? []).map((id) => id.trim()).filter(Boolean);
  return {
    depth,
    ...(input.bucket ? { bucket: input.bucket } : {}),
    ...(taskIds.length ? { taskIds } : {}),
  };
}

export async function actionGetContext(
  input: GetContextInput | "compact" | "full" = "compact",
  identity?: McpIdentity
) {
  // Back-compat: older callers passed depth as a bare string.
  const opts: GetContextInput = typeof input === "string" ? { depth: input } : input;
  const filter = resolveContextFilter(opts);
  const snap = await snapshot();
  const principal = identity ? aclPrincipalFromMcp(identity) : undefined;
  recordReadShadowMismatch("mcp.get-context", snap.projects ?? [], principal);
  const projectsById = indexById(snap.projects ?? []);
  const bucketsById = indexById(snap.buckets ?? []);
  let visibleBuckets = principal
    ? filterBucketsByAcl(snap.buckets ?? [], projectsById, principal)
    : (snap.buckets ?? []);
  let visibleTasks = principal
    ? filterTasksByAcl(snap.tasks, bucketsById, projectsById, principal)
    : snap.tasks;
  let visibleProjects = principal
    ? filterProjectsByAcl(snap.projects ?? [], principal)
    : (snap.projects ?? []);
  const idSet = filter.taskIds ? new Set(filter.taskIds) : null;
  if (!idSet && !filter.bucket) {
    const retired = new Set(visibleBuckets.filter((b) => isArchived(b) || isArchived(projectsById.get(b.project ?? ""))).map((b) => b.id));
    visibleBuckets = visibleBuckets.filter((b) => !retired.has(b.id));
    visibleProjects = visibleProjects.filter((p) => !isArchived(p));
    visibleTasks = visibleTasks.filter((t) => !retired.has(t.bucket));
  }

  if (filter.depth === "full") {
    let tasks = visibleTasks;
    if (filter.bucket) tasks = tasks.filter((t) => t.bucket === filter.bucket);
    if (idSet) tasks = tasks.filter((t) => idSet.has(t.id));
    return {
      tasks,
      buckets: visibleBuckets,
      projects: visibleProjects,
      conflicts: snap.conflicts.length,
      errors: snap.errors.length,
      lastSweep: snap.lastSweep,
      filter,
    };
  }

  let active = visibleTasks.filter((t) => !isClosedStage(t.stage));
  if (filter.bucket) active = active.filter((t) => t.bucket === filter.bucket);
  if (idSet) active = active.filter((t) => idSet.has(t.id));
  return {
    taskCount: visibleTasks.length,
    activeCount: active.length,
    buckets: visibleBuckets.map((b) => ({ id: b.id, name: b.name })),
    projects: visibleProjects.map((p) => ({ id: p.id, name: p.name, status: p.status ?? "active" })),
    topTasks: active.slice(0, 15).map((t) => ({
      id: t.id,
      title: t.title,
      stage: t.stage,
      bucket: t.bucket,
      priority: t.priority,
    })),
    lastSweep: snap.lastSweep,
    filter,
  };
}

export async function actionSearchTasks(input: SearchTasksInput = {}, identity?: McpIdentity) {
  const filter = resolveSearchFilter(input);
  const principal = identity ? aclPrincipalFromMcp(identity) : undefined;
  const hiddenBuckets: string[] = [];
  if (principal) {
    const { projects, buckets, projectsById } = await loadProjectAclMaps();
    recordReadShadowMismatch("mcp.search-tasks", projects, principal);
    for (const bucket of buckets) {
      if (!canAccessBucket(bucket, projectsById, principal)) hiddenBuckets.push(bucket.id);
    }
  }
  const result = await searchTaskPage(filter, hiddenBuckets, principal?.tokens.slice().sort().join("|") ?? "");
  return { ...result, filter };
}

/**
 * W02: every MCP and cursor-API caller is a service principal, and only a
 * person marks a task Verified: on the web, or through the portal's
 * mc_update_task verify for a UAT ticket task.
 */
const VERIFIED_NEEDS_PERSON = "Only a person marks a task Verified, in Mission Control.";

export type CreateTaskActionInput = CreateTaskInput & {
  /** Optional idempotency key (fleet P8b): a repeat returns the original task. */
  idempotencyKey?: string;
};

export async function actionCreateTask(identity: McpIdentity, createInput: CreateTaskActionInput) {
  const { idempotencyKey, ...input } = createInput;
  // Task creation remains gated by the reviewed MCP service-principal registry.
  const authorized = requireMcpActor(identity, "task.create", {
    type: "bucket",
    id: input.bucket,
  });
  // Only a signed-in person or sp_mcp_portal may set an `agent:` assignee
  // (agent fleet P8, D16). This covers the MCP tool and POST /api/cursor/tasks.
  assertAgentAssigneeAllowed(identity.actor, input.assignee, { capability: "task.create" });
  // POST /api/cursor/tasks takes a stage; a task is never born Verified (W02).
  if (input.stage === "verified") throw new ApiError("verified_needs_person", VERIFIED_NEEDS_PERSON, 403);
  const principal = aclPrincipalFromMcp(identity);
  await assertBucketProjectAccess(input.bucket, principal);
  // Evidence standard (TASK-3165): a task a person must verify gets an STE-lite
  // description. Checked before the idempotency claim, like the checks above,
  // against the labels createTask will store.
  const evidenceStandard = evidenceStandardReport(
    input.description ?? "",
    requiresHumanVerification(createLabelsWithKind(input.labels, input.kind))
  );
  assertEvidenceStandard("The task description", evidenceStandard);
  const standardMeta = evidenceStandard.applies ? { evidenceStandard } : {};
  // TASK-3530: a gated creator's task starts with a pending creator approval,
  // so it may not be created straight into progress or later either.
  const creatorApproval = isCreatorApprovalGated(identity.servicePrincipalId)
    ? { principal: identity.servicePrincipalId, status: "pending" as const, requestedAt: new Date().toISOString() }
    : undefined;
  const createViolation =
    creatorApproval && input.stage ? creatorApprovalViolation({ id: "The new task", creatorApproval }, input.stage) : null;
  if (createViolation) throw new ApiError("creator_approval_pending", createViolation, 409);
  const create = (options?: Parameters<typeof createTask>[2]) =>
    createTask(
      {
        ...input,
        reporter: identity.operatorEmail,
        // Agent-created tasks default to the human operator behind the session
        // (Entra email admitted by the allowlist) so the EN-003 gate does not
        // strand them ownerless in Planned — same resolution as the checkout
        // backfill. An explicit accountableOwner from the caller still wins.
        accountableOwner:
          input.accountableOwner ?? resolveHumanAccountableOwner(identity.operatorEmail),
        // Server-set only: a caller value never reaches the task.
        creatorApproval,
      },
      { source: "service", actorId: authorized.actorId },
      options
    );
  if (idempotencyKey === undefined) {
    const task = await create();
    return { task, taskId: task.id, link: taskLink(task.id), sync: await syncMetaForTask(task.id), ...standardMeta };
  }

  // The checks above run before the claim, so a refused call does not use up
  // the key. See task-create-idempotency.ts for the claim and replay rules.
  let created: Task | undefined;
  const outcome = await runIdempotentTaskCreate(
    {
      principalId: identity.servicePrincipalId,
      idempotencyKey,
      payloadHash: taskCreatePayloadHash(input),
      actor: identity.runtime,
      repo: identity.repo,
    },
    async (persistResult) => {
      // The result event commits in the task's own transaction.
      created = await create({ inTransaction: (q, task) => persistResult(q, task.id) });
      return created.id;
    }
  );
  if (created) {
    return {
      task: created,
      taskId: created.id,
      link: taskLink(created.id),
      sync: await syncMetaForTask(created.id),
      ...standardMeta,
    };
  }
  const row = await getEntity("task", outcome.taskId);
  if (!row) {
    throw new ApiError(
      "not_found",
      `Task ${outcome.taskId} for idempotencyKey ${idempotencyKey} no longer exists.`,
      404
    );
  }
  // The task may have moved since the first call. Check the project of its
  // current bucket before any of its data or sync metadata goes back.
  const replayedTask = row.data as unknown as Task;
  await assertBucketProjectAccess(replayedTask.bucket, principal);
  return {
    task: replayedTask,
    taskId: outcome.taskId,
    link: taskLink(outcome.taskId),
    sync: await syncMetaForTask(outcome.taskId),
    replayed: true,
    ...standardMeta,
  };
}

export type CreateProjectActionInput = Omit<CreateProjectInput, "desc"> & {
  description?: string;
};

export async function actionCreateProject(
  identity: McpIdentity,
  input: CreateProjectActionInput
) {
  requireMcpActor(identity, "project.create");
  const { description, ...projectInput } = input;
  const creator = aclPrincipalFromMcp(identity);
  const project = await createProject({
    ...projectInput,
    desc: description,
    owner: input.owner ?? resolveHumanAccountableOwner(identity.operatorEmail),
    ...(projectInput.visibility === "restricted"
      ? { members: [...creator.tokens, ...(projectInput.members ?? [])] }
      : {}),
  });
  return { project, projectId: project.id, link: projectLink(project.id), sync: project.sync };
}

export type CreateBucketActionInput = Omit<CreateBucketInput, "desc"> & {
  description?: string;
};

export async function actionCreateBucket(
  identity: McpIdentity,
  input: CreateBucketActionInput
) {
  requireMcpActor(
    identity,
    "bucket.create",
    input.project ? { type: "project", id: input.project } : undefined
  );
  await assertProjectIdAccess(input.project, aclPrincipalFromMcp(identity));
  const { description, ...bucketInput } = input;
  const bucket = await createBucket({
    ...bucketInput,
    desc: description,
    owner: input.owner ?? resolveHumanAccountableOwner(identity.operatorEmail),
  });
  return { bucket, bucketId: bucket.id, link: bucketLink(bucket.id), sync: bucket.sync };
}

export async function actionListBuckets(
  identity: McpIdentity,
  input: { q?: string; project?: string; includeArchived?: boolean } = {}
) {
  // Discovery is a read: task.read, like mc_list_conflicts. Read-only
  // principals must not need a create grant (or a TASK-0 workaround) to find a
  // BKT-* id; restricted-project buckets stay hidden by the ACL filter below.
  requireMcpActor(identity, "task.read");

  const query = input.q?.trim().toLowerCase();
  const maps = await loadProjectAclMaps();
  const visible = filterBucketsByAcl(
    maps.buckets,
    maps.projectsById,
    aclPrincipalFromMcp(identity)
  );
  const buckets = visible
    .filter((bucket) => {
      if (!input.includeArchived && (isArchived(bucket) || isArchived(maps.projectsById.get(bucket.project ?? "")))) return false;
      const matchesQuery =
        !query ||
        bucket.id.toLowerCase().includes(query) ||
        bucket.name.toLowerCase().includes(query);
      const matchesProject = !input.project || bucket.project === input.project;
      return matchesQuery && matchesProject;
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, name, owner, health, project, archivedAt, archivedBy, archiveReason }) => ({
      id,
      name,
      owner,
      health,
      project: project ?? null,
      archivedAt: archivedAt ?? null,
      archivedBy: archivedBy ?? null,
      archiveReason: archiveReason ?? null,
    }));

  return { buckets, count: buckets.length };
}

export type UpdateBucketActionInput = {
  id: string;
  action?: "archive" | "unarchive";
  reason?: string;
  force?: boolean;
  name?: string;
  description?: string;
  owner?: string;
  health?: PatchBucketInput["health"];
  target?: string;
  started?: string;
  repos?: string[];
  prd?: string | null;
  project?: string | null;
};

export async function actionUpdateBucket(
  identity: McpIdentity,
  input: UpdateBucketActionInput
) {
  const authorized = requireMcpActor(identity, "bucket.update", {
    type: "bucket",
    id: input.id,
  });
  const principal = aclPrincipalFromMcp(identity);
  await assertBucketProjectAccess(input.id, principal);
  if (typeof input.project === "string" && input.project.trim()) {
    await assertProjectIdAccess(input.project, principal);
  }
  if (input.action) {
    if (Object.entries(input).some(([key, value]) => !["id", "action", "reason", "force"].includes(key) && value !== undefined)) throw new ApiError("invalid_request", "Archive actions cannot mix with metadata edits.", 400);
    return { bucketId: input.id, ...await archiveContainer({ entityType: "bucket", id: input.id, action: input.action, reason: input.reason ?? "", force: input.force, actor: authorized.auditLabel, repo: identity.repo }) };
  }
  if (input.force !== undefined || input.reason !== undefined) throw new ApiError("invalid_request", "force/reason requires an archive action.", 400);
  const { id, description, ...rest } = input;
  delete rest.action;
  delete rest.reason;
  delete rest.force;
  const patch: PatchBucketInput = {
    ...rest,
    ...(description !== undefined ? { desc: description } : {}),
  };
  const defined = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (defined.length === 0) {
    throw new ApiError("invalid_request", "Provide at least one field to update besides id.");
  }
  const bucket = await patchBucket(id, patch, authorized.auditLabel);
  if (!bucket) throw new ApiError("not_found", `unknown bucket ${id}`, 404);
  return { bucket, bucketId: bucket.id, link: bucketLink(bucket.id), sync: bucket.sync };
}

/** Refuse a checkout without an agent (TASK-3407). Off by default: warn first. */
function checkoutAgentRequired(): boolean {
  return (process.env.PLX_MC_CHECKOUT_AGENT_REQUIRED ?? "").trim() === "1";
}

function checkoutWarnings(
  agent: string | undefined,
  concurrent: number,
  laneCap: LaneCapResult | null
): { warnings?: string[] } {
  const warnings = [
    ...(agent ? [] : ["agent_missing: pass agent (<runtime>/<lane>) or send X-MC-Agent; checkouts without one will be refused."]),
    ...(concurrent ? ["concurrent_holder: another holder has a live checkout of this task; coordinate before pushing."] : []),
    ...(laneCap?.status === "unverified"
      ? [
          laneCap.reason === "no_branch"
            ? "lane_cap_unverified: pass branch (the PR head branch) so the portal lane cap can be checked."
            : `lane_cap_unverified: the portal lane cap could not be read (${laneCap.reason}); the checkout proceeds.`,
        ]
      : []),
    ...(laneCap?.status === "blocked" ? [`lane_cap_full (warn mode): ${laneCapRefusal(laneCap)}`] : []),
  ];
  return warnings.length ? { warnings } : {};
}

export async function actionCheckout(
  identity: McpIdentity,
  taskId: string,
  options: {
    repo?: string;
    agent?: string;
    reuse?: boolean;
    forceReason?: string;
    baseSha?: string;
    launchId?: string;
    branch?: string;
  } = {}
) {
  const repo = resolveCheckoutRepo(identity.repo, options.repo);
  requireMcpActor(identity, "task.checkout", { type: "task", id: taskId }, {
    repositoryId: repo,
  });
  await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity));
  // TASK-3407: every checkout names its <runtime>/<lane> so the gate holds each
  // commit's Agent trailer to it. Warn while runtimes adopt it; refuse once
  // PLX_MC_CHECKOUT_AGENT_REQUIRED=1.
  const agent = options.agent ?? identity.agent;
  if (!agent && checkoutAgentRequired()) {
    throw new ApiError(
      "agent_required",
      "mc_checkout_task needs agent (<runtime>/<lane>), as a parameter or the X-MC-Agent header.",
      400
    );
  }
  // D15 (TASK-3863): a full portal lane refuses a checkout for a new PR.
  const laneCap = await checkoutLaneCap({ repo, branch: options.branch });
  if (laneCap?.status === "blocked" && laneCapCheckoutMode() === "enforce") {
    throw new ApiError("lane_cap_full", laneCapRefusal(laneCap), 409);
  }
  const { checkoutId, accountablePerson, reused, concurrent } = await checkout({
    taskId,
    runtime: identity.runtime,
    accountableHuman: identity.operatorEmail,
    repo,
    actor: identity.actor,
    door: "mcp",
    agent,
    reuse: options.reuse,
    forceReason: options.forceReason,
    baseSha: options.baseSha,
    launchId: options.launchId,
  });
  const stamp = `MC-Checkout: ${checkoutId}`;
  return {
    checkoutId,
    taskId,
    prBodyLine: stamp,
    // The person commits name in On-Behalf-Of (TASK-3483).
    accountablePerson,
    // TASK-3409: an existing live checkout handed back, and other holders' leases.
    ...(reused ? { reused: true } : {}),
    ...(concurrent?.length ? { concurrent } : {}),
    ...(laneCap ? { laneCap } : {}),
    ...(checkoutWarnings(agent, concurrent?.length ?? 0, laneCap)),
    link: taskLink(taskId),
    sync: await syncMetaForTask(taskId),
    actor: { repo },
  };
}

// One input shape serves the HTTP MCP tool and the REST route so they cannot disagree.
export const progressSchemaShape = {
  taskId: z.string().min(1),
  stage: z
    .enum(["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified", "cancelled"])
    .optional(),
  notes: z.string().optional(),
  progressPct: z.number().min(0).max(100).optional(),
  cancelReason: z.string().optional(),
  replacedBy: z.string().nullable().optional(),
  note: z.string().max(2000).optional(),
};

export async function actionProgress(
  identity: McpIdentity,
  input: {
    taskId: string;
    stage?: Task["stage"];
    notes?: string;
    subtasks?: Task["subtasks"];
    progressPct?: number;
    /** Cancel details (stage "cancelled"): reason enum, replacedBy TASK-n, free-text note (TASK-2529). */
    cancelReason?: string;
    replacedBy?: string | null;
    note?: string;
  }
) {
  const authorized = requireMcpActor(identity, "task.progress", {
    type: "task",
    id: input.taskId,
  });
  await assertTaskProjectAccess(input.taskId, aclPrincipalFromMcp(identity));
  const row = await getEntity("task", input.taskId);
  if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
  const current = row.data as unknown as Task;
  const cancelling = input.stage === "cancelled";
  if (!cancelling && (input.cancelReason !== undefined || input.replacedBy != null || input.note !== undefined)) {
    throw new ApiError("invalid_request", "cancelReason, replacedBy and note apply only with stage \"cancelled\".", 400);
  }
  if (current?.stage === "cancelled" && !cancelling && (input.stage || (!input.notes && !input.subtasks))) {
    throw new ApiError("task_cancelled", `${input.taskId} is cancelled; reopen it with mc_update_task {reopen} before changing its stage.`, 409);
  }
  // A bare call changes nothing: report the current stage, write nothing.
  if (!input.stage && !input.notes && !input.subtasks) {
    return {
      ok: true,
      noop: true,
      taskId: input.taskId,
      stage: current.stage,
      link: taskLink(input.taskId),
      sync: await syncMetaForTask(input.taskId),
    };
  }
  // Only the compliance projection moves a task back from merged/verified.
  if (
    input.stage &&
    TERMINAL_TASK_STAGES.includes(current.stage) &&
    STAGE_IDX[input.stage] < STAGE_IDX[current.stage]
  ) {
    throw new ApiError(
      "stage_regression",
      `Task ${input.taskId} is ${current.stage}; a progress post cannot move it back to ${input.stage}.`,
      409
    );
  }
  // A UAT ticket task is verified only when its submitter confirms the fix: the
  // portal's mc_update_task verify, under task.uat_sync (TASK-3697).
  if (input.stage === "verified" && current.stage !== "verified" && isUatTicketTask(current)) {
    throw new ApiError(
      "forbidden",
      `Task ${input.taskId} is a UAT ticket task; only the portal's mc_update_task verify (task.uat_sync) moves it to verified.`,
      403
    );
  }
  // Every other task is verified by a person, in Mission Control (W02).
  if (input.stage === "verified" && current.stage !== "verified") {
    throw new ApiError("verified_needs_person", VERIFIED_NEEDS_PERSON, 403);
  }
  // The authenticated principal must hold an active checkout of this task.
  // X-MC-Operator-Email is audit context only and never authorizes.
  if (!(await complianceRepo.hasActiveCheckoutForPrincipal(input.taskId, identity.actor.id))) {
    throw new ApiError(
      "forbidden",
      `No active checkout of ${input.taskId} held by this principal. Check the task out (mc_checkout_task) before reporting progress.`,
      403
    );
  }
  const patch: Record<string, unknown> = {};
  let cancelResult: Awaited<ReturnType<typeof cancelTask>> | undefined;
  if (cancelling) {
    if (!current) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
    await assertMayCloseOrReopen(identity, current, "cancel");
    cancelResult = await cancelTask(
      input.taskId,
      { reason: input.cancelReason, replacedBy: input.replacedBy, note: input.note },
      cancelContextFor(identity, authorized.actorId)
    );
  } else if (input.stage) {
    patch.stage = input.stage;
  }
  const note = input.notes
    ? {
        id: `mcp-${randomUUID()}`,
        author: identity.operatorEmail,
        body: input.notes,
        ts: new Date().toISOString(),
        mentions: [] as string[],
      }
    : undefined;
  if (input.subtasks) patch.subtasks = input.subtasks;
  // The note joins the thread read under the task row lock, so a comment that
  // lands meanwhile (a person's, an answer) is kept (TASK-3632).
  const task = Object.keys(patch).length === 0 && !note && cancelResult
    ? cancelResult.task
    : await withTransaction(async (q) => {
        const locked = await getEntity("task", input.taskId, q, true);
        if (!locked) return null;
        if (note) patch.comments = [...((locked.data as unknown as Task).comments ?? []), note];
        return patchTask(
          input.taskId,
          patch as Parameters<typeof patchTask>[1],
          identity.operatorEmail,
          { query: q, attribution: { source: "service", actorId: authorized.actorId } }
        );
      });
  if (!task) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
  await complianceRepo.appendEvent({
    kind: "task.progress",
    actor: mcpAuditActor(identity),
    repo: identity.repo,
    taskId: input.taskId,
    payload: {
      workerId: identity.workerId,
      stage: patch.stage ?? task.stage,
      ...(patch.stage && TERMINAL_STAGES.includes(patch.stage as StageKey)
        ? { completionSource: "stage_event" }
        : {}),
      progressPct: input.progressPct ?? null,
      notes: input.notes ?? null,
    },
  });
  return {
    ok: true,
    taskId: input.taskId,
    stage: task.stage,
    link: taskLink(input.taskId),
    sync: await syncMetaForTask(input.taskId),
  };
}

// The pipeline contract requires non-empty verificationCommands AND a rollback
// on every completion. One input shape serves the HTTP MCP tool and the REST
// route so the transports cannot disagree.
const nonBlank = z.string().trim().min(1);
export const completeTaskInputShape = {
  checkoutId: z.string().min(1),
  summary: z.string().min(1),
  commitSha: z.string().optional(),
  prUrl: z.string().optional(),
  outcome: z.enum(["completed", "blocked", "failed"]).optional()
    .describe("UAT code work requires prUrl unless outcome is blocked or failed."),
  verificationCommands: z.array(nonBlank).min(1),
  filesChanged: z.array(z.string()).optional(),
  rollback: nonBlank,
  // High/full-tier proof: a test run or screenshots. Required by the gate for
  // high-risk changes (migrations, auth, infra); optional for standard tier.
  testRun: z
    .object({
      suite: z.string().min(1),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative().optional(),
    })
    .optional(),
  shots: z.array(z.object({ label: z.string(), cap: z.string() })).optional(),
};

// TASK-4017: the done stage for a PR-less completion. Never "verified".
export const PRLESS_COMPLETION_STAGE = "merged" as const;
const PRLESS_PROMOTABLE_STAGES = new Set(["backlog", "specced", "approved", "planned", "progress", "qa", "review"]);

/** A completed (not blocked/failed) hand-in with no prUrl, on a task with no PR rows, below the done stage. A UAT ticket task is excluded: its done stage only comes from a PR merge, whichever bucket it sits in. */
export function shouldPromotePrlessCompletion(
  task: Pick<Task, "stage" | "prs" | "labels"> | undefined,
  input: { prUrl?: string; outcome?: "completed" | "blocked" | "failed" }
): boolean {
  if (!task) return false;
  if ((input.outcome ?? "completed") !== "completed") return false;
  if (input.prUrl?.trim()) return false;
  if ((task.prs ?? []).length > 0) return false;
  if (isUatTicketTask(task)) return false;
  return typeof task.stage === "string" && PRLESS_PROMOTABLE_STAGES.has(task.stage);
}

export async function actionComplete(
  identity: McpIdentity,
  input: {
    checkoutId: string;
    summary: string;
    commitSha?: string;
    prUrl?: string;
    outcome?: "completed" | "blocked" | "failed";
    verificationCommands?: string[];
    filesChanged?: string[];
    rollback?: string;
    testRun?: { suite: string; passed: number; failed: number; total?: number };
    shots?: { label: string; cap: string }[];
  }
) {
  requireMcpActor(identity, "task.complete");
  const existingDispatch = await complianceRepo.getDispatch(input.checkoutId);
  if (existingDispatch?.taskId) {
    await assertTaskProjectAccess(existingDispatch.taskId, aclPrincipalFromMcp(identity));
  }
  let autonomy: ReturnType<typeof resolveCompletionAutonomy> | undefined;
  let task: Task | undefined;
  if (existingDispatch?.taskId) {
    const row = await getEntity("task", existingDispatch.taskId);
    task = row?.data as unknown as Task | undefined;
    if (!task || typeof task.bucket !== "string" || typeof existingDispatch.repo !== "string") {
      throw new ApiError("autonomy_approval_required", "Checkout autonomy scope cannot be read; completion is refused.", 403);
    }
    autonomy = resolveCompletionAutonomy(existingDispatch.repo, task.bucket);
    const gate = task.approvalGates?.find((g) => g.id === existingDispatch.approvalGateId);
    if (autonomy.requiresApproval && gate?.status !== "approved") {
      throw new ApiError(
        "autonomy_approval_required",
        "Completion requires human approval: request a P4 runtime approval gate with this checkoutId and wait for approval.",
        403
      );
    }
  }
  // A pushed branch is not a reviewable UAT fix. The ticket is the label
  // (kind:code plus uat:<id>), not the bucket: TASK-3973 can move a ticket
  // task out of BKT-UAT and it is still a ticket. Check before any evidence
  // or completion event is written; blocked/failed hand-ins remain auditable.
  if (
    task &&
    isUatTicketTask(task) &&
    !input.prUrl?.trim() &&
    input.outcome !== "blocked" && input.outcome !== "failed"
  ) {
    throw new ApiError(
      "uat_code_pr_required",
      "UAT code completion requires prUrl or an explicit blocked or failed outcome. A branch push alone is incomplete.",
      400
    );
  }
  // Evidence standard (TASK-3165), before complete() records anything, so a
  // refused hand-in leaves no task.completed event or evidence behind. The
  // checkout stays open until the PR merges or closes: fix the text and send it
  // again. filesChanged gives the tier the PR gate will likely see; the gate,
  // which reads the PR's real paths and labels, stays the authority. The report
  // is always returned, because the gate may still find the change high-risk.
  const evidenceStandard = evidenceStandardReport(
    input.summary,
    requiresHumanVerification(task?.labels, classifyRiskTier(input.filesChanged ?? []))
  );
  assertEvidenceStandard("The evidence summary", evidenceStandard);
  await complete({
    checkoutId: input.checkoutId,
    summary: input.summary,
    commitSha: input.commitSha,
    prUrl: input.prUrl,
    outcome: input.outcome,
    actor: identity.actor,
  });
  if (autonomy && existingDispatch) {
    await complianceRepo.appendEvent({
      kind: "task.completion.autonomy",
      actor: mcpAuditActor(identity),
      repo: existingDispatch.repo,
      taskId: existingDispatch.taskId,
      payload: {
        ...autonomy,
        level: autonomy.requiresApproval ? "approval-required" : "autonomous-with-audit",
        approvalGateId: existingDispatch.approvalGateId ?? null,
      },
    });
  }
  const dispatch = await complianceRepo.getDispatch(input.checkoutId);
  const taskId = dispatch?.taskId ?? "";

  // Sent fields win; evidence saved earlier with mc_save_evidence fills the rest (TASK-4055).
  const { evidence, qa } = buildTaskEvidence(input, task?.evidence);
  if (taskId) {
    // Files from mc_upload_evidence (TASK-3166) outlive a new hand-in. They are
    // read under the task row lock, so an upload that lands meanwhile is kept.
    await withTransaction(async (q) => {
      const locked = (await getEntity("task", taskId, q, true))?.data as unknown as Task | undefined;
      const artifacts = locked?.evidence?.artifacts;
      // TASK-4017: a completed hand-in on a task with no PR has no merge to
      // promote it, so it stayed in backlog. Move it to the done stage
      // ("merged") here; tasks with PRs keep the merged-PR projection path.
      const promote = shouldPromotePrlessCompletion(locked, input);
      await patchTask(
        taskId,
        {
          evidence: { ...evidence, ...(artifacts?.length ? { artifacts } : {}) },
          ...(promote
            ? {
                stage: PRLESS_COMPLETION_STAGE,
                activityLine: {
                  who: dispatch?.accountableHuman ?? identity.operatorEmail,
                  what: "Completed with no linked PR (mc_complete_task); moved to merged",
                  kind: "move",
                },
              }
            : {}),
        } as Parameters<typeof patchTask>[1],
        dispatch?.accountableHuman ?? identity.operatorEmail,
        { query: q, attribution: { source: "service", actorId: identity.actor.id } }
      );
    });
  }

  return {
    ok: true,
    checkoutId: input.checkoutId,
    taskId,
    link: taskId ? taskLink(taskId) : undefined,
    evidence: {
      summary: input.summary,
      commitSha: input.commitSha ?? null,
      prUrl: input.prUrl ?? null,
      outcome: input.outcome ?? "completed",
      verificationCommands: input.verificationCommands ?? [],
      filesChanged: input.filesChanged ?? [],
      rollback: input.rollback ?? null,
      qa: qa ?? null,
      shots: input.shots ?? [],
    },
    evidenceStandard,
    sync: taskId ? await syncMetaForTask(taskId) : undefined,
  };
}

type EvidenceInput = {
  summary: string;
  verificationCommands?: string[];
  rollback?: string;
  testRun?: { suite: string; passed: number; failed: number; total?: number };
  shots?: { label: string; cap: string }[];
};

/**
 * The task evidence mc_complete_task and mc_save_evidence write (TASK-4055).
 * The checklist is derived from verificationCommands and rollback. A field the
 * call does not send falls back to the evidence saved before it. Artifacts are
 * not built here: each caller keeps them under the task row lock.
 */
export function buildTaskEvidence(
  input: EvidenceInput,
  saved: Evidence | undefined
): { evidence: Evidence; qa: Evidence["qa"] } {
  const qa = input.testRun
    ? {
        pass: input.testRun.passed,
        fail: input.testRun.failed,
        total: input.testRun.total ?? input.testRun.passed + input.testRun.failed,
        suite: input.testRun.suite,
        ran: new Date().toISOString(),
        tests: [],
      }
    : saved?.qa;
  const verified =
    (input.verificationCommands?.length ?? 0) > 0 ||
    !!saved?.items?.some((i) => i.key === "verification" && i.done);
  const rollback = input.rollback?.trim() || saved?.rollback?.trim() || null;
  const shots = input.shots?.length ? input.shots : saved?.shots;
  const evidence: Evidence = {
    summary: input.summary,
    items: [
      { key: "summary", label: "Summary — what changed", done: true },
      { key: "verification", label: "Verification commands run", done: verified },
      { key: "rollback", label: "Rollback plan", done: !!rollback },
    ],
    rollback,
    ...(qa ? { qa } : {}),
    ...(shots?.length ? { shots } : {}),
  };
  return { evidence, qa };
}

// mc_save_evidence (TASK-4055): the compliance gate reads task.evidence while the
// PR is open, but mc_complete_task hands the work in. This saves the same
// evidence on a live checkout before merge and changes nothing else.
export const saveEvidenceInputShape = {
  checkoutId: z.string().min(1),
  summary: z.string().min(1),
  verificationCommands: z.array(nonBlank).optional(),
  filesChanged: z.array(z.string()).optional(),
  rollback: z.string().optional(),
  testRun: completeTaskInputShape.testRun,
  shots: completeTaskInputShape.shots,
};

export async function actionSaveEvidence(
  identity: McpIdentity,
  input: EvidenceInput & { checkoutId: string; filesChanged?: string[] }
) {
  const dispatch = await complianceRepo.getDispatch(input.checkoutId);
  if (!dispatch?.taskId || dispatch.revoked || dispatch.releasedAt || new Date(dispatch.expiresAt).getTime() <= Date.now()) {
    throw new ApiError("invalid_checkout", "Unknown, revoked, released, or expired checkout.", 409);
  }
  const taskId = dispatch.taskId;
  // The hand-in's grant. No autonomy approval check: saving evidence completes nothing.
  requireMcpActor(identity, "task.complete", { type: "task", id: taskId }, { repositoryId: dispatch.repo });
  await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity));
  if ((await complianceRepo.getDispatchCheckoutPrincipal(dispatch.id)) !== identity.actor.id) {
    throw new ApiError("forbidden", `Another principal holds this checkout of ${taskId}. Save evidence on your own checkout.`, 403);
  }
  const task = (await getEntity("task", taskId))?.data as unknown as Task | undefined;
  if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  // The same evidence standard as the hand-in (TASK-3165), before anything is written.
  const evidenceStandard = evidenceStandardReport(
    input.summary,
    requiresHumanVerification(task.labels, classifyRiskTier(input.filesChanged ?? []))
  );
  assertEvidenceStandard("The evidence summary", evidenceStandard);
  // Patches only `evidence`, under the task row lock, so an upload or an
  // earlier save that lands meanwhile is kept.
  const evidence = await withTransaction(async (q) => {
    const locked = (await getEntity("task", taskId, q, true))?.data as unknown as Task | undefined;
    if (!locked) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    const artifacts = locked.evidence?.artifacts;
    const next: Evidence = {
      ...buildTaskEvidence(input, locked.evidence).evidence,
      ...(artifacts?.length ? { artifacts } : {}),
    };
    await patchTask(
      taskId,
      { evidence: next } as Parameters<typeof patchTask>[1],
      dispatch.accountableHuman ?? identity.operatorEmail,
      { query: q, attribution: { source: "service", actorId: identity.actor.id } }
    );
    await complianceRepo.appendEventTx(q, {
      kind: "task.evidence.saved",
      actor: mcpAuditActor(identity),
      repo: dispatch.repo,
      taskId,
      payload: { items: next.items.map((i) => ({ key: i.key, done: i.done })), qa: !!next.qa, shots: next.shots?.length ?? 0 },
    });
    return next;
  });
  return {
    ok: true,
    checkoutId: input.checkoutId,
    taskId,
    link: taskLink(taskId),
    evidence,
    evidenceStandard,
    sync: await syncMetaForTask(taskId),
  };
}
