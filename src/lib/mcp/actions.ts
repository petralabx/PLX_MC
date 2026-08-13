// PLX MC cursor API actions — shared by REST routes and HTTP MCP transport.

import { ApiError } from "@/lib/api/route";
import { checkout, complete } from "@/lib/compliance/service";
import * as complianceRepo from "@/lib/compliance/repo";
import {
  createBucket,
  createProject,
  createTask,
  patchTask,
  snapshot,
  type CreateBucketInput,
  type CreateProjectInput,
  type CreateTaskInput,
} from "@/lib/sync";
import { getBuckets, getEntity } from "@/lib/sync/repo";
import { resolveHumanAccountableOwner, type Evidence, type Task } from "@/lib/mc-data";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { taskLink } from "./envelope";
import { buildHonestyFields } from "./honesty";
import { syncMetaForTask } from "./sync-meta";

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

export type SearchTasksInput = {
  /** Canonical search text. */
  q?: string;
  /** Alias for `q` — agents commonly pass this name; must not conflict with `q`. */
  query?: string;
  bucket?: string;
  stage?: string;
  limit?: number;
};

export type SearchTasksFilter = {
  query?: string;
  bucket?: string;
  stage?: string;
  limit: number;
};

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
  const query = resolveSearchQueryText(input);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return {
    ...(query ? { query } : {}),
    ...(input.bucket ? { bucket: input.bucket } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    limit,
  };
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

export async function actionGetContext(input: GetContextInput | "compact" | "full" = "compact") {
  // Back-compat: older callers passed depth as a bare string.
  const opts: GetContextInput = typeof input === "string" ? { depth: input } : input;
  const filter = resolveContextFilter(opts);
  const snap = await snapshot();
  const idSet = filter.taskIds ? new Set(filter.taskIds) : null;

  if (filter.depth === "full") {
    let tasks = snap.tasks;
    if (filter.bucket) tasks = tasks.filter((t) => t.bucket === filter.bucket);
    if (idSet) tasks = tasks.filter((t) => idSet.has(t.id));
    return {
      tasks,
      buckets: snap.buckets,
      conflicts: snap.conflicts.length,
      errors: snap.errors.length,
      lastSweep: snap.lastSweep,
      filter,
    };
  }

  let active = snap.tasks.filter((t) => !["merged", "verified"].includes(t.stage));
  if (filter.bucket) active = active.filter((t) => t.bucket === filter.bucket);
  if (idSet) active = active.filter((t) => idSet.has(t.id));
  return {
    taskCount: snap.tasks.length,
    activeCount: active.length,
    buckets: snap.buckets.map((b) => ({ id: b.id, name: b.name })),
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

export async function actionSearchTasks(input: SearchTasksInput = {}) {
  const filter = resolveSearchFilter(input);
  const snap = await snapshot();
  let tasks = snap.tasks;
  const q = (filter.query ?? "").toLowerCase();
  if (q) {
    tasks = tasks.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
    );
  }
  if (filter.bucket) tasks = tasks.filter((t) => t.bucket === filter.bucket);
  if (filter.stage) tasks = tasks.filter((t) => t.stage === filter.stage);
  return { tasks: tasks.slice(0, filter.limit), total: tasks.length, filter };
}

export async function actionCreateTask(identity: McpIdentity, input: CreateTaskInput) {
  // Task creation remains gated by the reviewed MCP service-principal registry.
  const authorized = requireMcpActor(identity, "task.create", {
    type: "bucket",
    id: input.bucket,
  });
  const task = await createTask(
    {
      ...input,
      reporter: identity.operatorEmail,
      // Agent-created tasks default to the human operator behind the session
      // (Entra email admitted by the allowlist) so the EN-003 gate does not
      // strand them ownerless in Planned — same resolution as the checkout
      // backfill. An explicit accountableOwner from the caller still wins.
      accountableOwner:
        input.accountableOwner ?? resolveHumanAccountableOwner(identity.operatorEmail),
    },
    { source: "service", actorId: authorized.actorId }
  );
  return { task, taskId: task.id, link: taskLink(task.id), sync: await syncMetaForTask(task.id) };
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
  const project = await createProject({
    ...projectInput,
    desc: description,
    owner: input.owner ?? resolveHumanAccountableOwner(identity.operatorEmail),
  });
  return { project, projectId: project.id, sync: project.sync };
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
  const { description, ...bucketInput } = input;
  const bucket = await createBucket({
    ...bucketInput,
    desc: description,
    owner: input.owner ?? resolveHumanAccountableOwner(identity.operatorEmail),
  });
  return { bucket, bucketId: bucket.id, sync: bucket.sync };
}

export async function actionListBuckets(
  identity: McpIdentity,
  input: { q?: string; project?: string } = {}
) {
  // Listing is available only to principals already trusted to create buckets.
  // This keeps discovery inside the existing reviewed capability surface.
  requireMcpActor(identity, "bucket.create");

  const query = input.q?.trim().toLowerCase();
  const buckets = (await getBuckets())
    .filter((bucket) => {
      const matchesQuery =
        !query ||
        bucket.id.toLowerCase().includes(query) ||
        bucket.name.toLowerCase().includes(query);
      const matchesProject = !input.project || bucket.project === input.project;
      return matchesQuery && matchesProject;
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, name, owner, health, project }) => ({
      id,
      name,
      owner,
      health,
      project: project ?? null,
    }));

  return { buckets, count: buckets.length };
}

export async function actionCheckout(identity: McpIdentity, taskId: string) {
  requireMcpActor(identity, "task.checkout", { type: "task", id: taskId }, {
    repositoryId: identity.repo,
  });
  const { checkoutId } = await checkout({
    taskId,
    runtime: identity.runtime,
    accountableHuman: identity.operatorEmail,
    repo: identity.repo,
    actor: identity.actor,
    door: "mcp",
  });
  const stamp = `MC-Checkout: ${checkoutId}`;
  return {
    checkoutId,
    taskId,
    prBodyLine: stamp,
    link: taskLink(taskId),
    sync: await syncMetaForTask(taskId),
  };
}

export async function actionProgress(
  identity: McpIdentity,
  input: {
    taskId: string;
    stage?: Task["stage"];
    notes?: string;
    subtasks?: Task["subtasks"];
    progressPct?: number;
  }
) {
  const authorized = requireMcpActor(identity, "task.progress", {
    type: "task",
    id: input.taskId,
  });
  const patch: Record<string, unknown> = {};
  if (input.stage) patch.stage = input.stage;
  if (input.notes) {
    const row = await getEntity("task", input.taskId);
    const current = row?.data as Task | undefined;
    const comment = {
      id: `mcp-${Date.now().toString(36)}`,
      author: identity.operatorEmail,
      body: input.notes,
      ts: new Date().toISOString(),
      mentions: [] as string[],
    };
    patch.comments = [...(current?.comments ?? []), comment];
  }
  if (input.subtasks) patch.subtasks = input.subtasks;
  if (!input.stage && !input.notes && !input.subtasks) {
    patch.stage = "progress";
  }
  const task = await patchTask(
    input.taskId,
    patch as Parameters<typeof patchTask>[1],
    identity.operatorEmail,
    { attribution: { source: "service", actorId: authorized.actorId } }
  );
  if (!task) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
  await complianceRepo.appendEvent({
    kind: "task.progress",
    actor: `${identity.runtime}:${identity.operatorEmail}`,
    repo: identity.repo,
    taskId: input.taskId,
    payload: {
      workerId: identity.workerId,
      stage: patch.stage ?? task.stage,
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

export async function actionComplete(
  identity: McpIdentity,
  input: {
    checkoutId: string;
    summary: string;
    commitSha?: string;
    prUrl?: string;
    verificationCommands?: string[];
    filesChanged?: string[];
    rollback?: string;
    testRun?: { suite: string; passed: number; failed: number; total?: number };
    shots?: { label: string; cap: string }[];
  }
) {
  requireMcpActor(identity, "task.complete");
  await complete({
    checkoutId: input.checkoutId,
    summary: input.summary,
    commitSha: input.commitSha,
    prUrl: input.prUrl,
    actor: identity.actor,
  });
  const dispatch = await complianceRepo.getDispatch(input.checkoutId);
  const taskId = dispatch?.taskId ?? "";

  const qa = input.testRun
    ? {
        pass: input.testRun.passed,
        fail: input.testRun.failed,
        total: input.testRun.total ?? input.testRun.passed + input.testRun.failed,
        suite: input.testRun.suite,
        ran: new Date().toISOString(),
        tests: [],
      }
    : undefined;
  if (taskId) {
    const evidence: Evidence = {
      summary: input.summary,
      items: [
        { key: "summary", label: "Summary — what changed", done: true },
        {
          key: "verification",
          label: "Verification commands run",
          done: (input.verificationCommands?.length ?? 0) > 0,
        },
        { key: "rollback", label: "Rollback plan", done: !!input.rollback?.trim() },
      ],
      rollback: input.rollback?.trim() || null,
      ...(qa ? { qa } : {}),
      ...(input.shots?.length ? { shots: input.shots } : {}),
    };
    await patchTask(
      taskId,
      { evidence } as Parameters<typeof patchTask>[1],
      dispatch?.accountableHuman ?? identity.operatorEmail,
      { attribution: { source: "service", actorId: identity.actor.id } }
    );
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
      verificationCommands: input.verificationCommands ?? [],
      filesChanged: input.filesChanged ?? [],
      rollback: input.rollback ?? null,
      qa: qa ?? null,
      shots: input.shots ?? [],
    },
    sync: taskId ? await syncMetaForTask(taskId) : undefined,
  };
}
