// PLX MC cursor API actions — shared by REST routes and HTTP MCP transport.

import { ApiError } from "@/lib/api/route";
import { checkout, complete } from "@/lib/compliance/service";
import * as complianceRepo from "@/lib/compliance/repo";
import { createTask, patchTask, snapshot, type CreateTaskInput } from "@/lib/sync";
import { getEntity } from "@/lib/sync/repo";
import type { Task } from "@/lib/mc-data";
import type { McpIdentity } from "./auth";
import { taskLink } from "./envelope";
import { syncMetaForTask } from "./sync-meta";

export async function actionSelfCheck(identity: McpIdentity) {
  const snap = await snapshot();
  return {
    ok: true,
    mcpEnabled: true,
    operator: identity.operatorEmail,
    taskCount: snap.tasks.length,
    bucketCount: snap.buckets.length,
    lastSweep: snap.lastSweep,
  };
}

export async function actionGetContext(depth: "compact" | "full" = "compact") {
  const snap = await snapshot();
  if (depth === "full") {
    return {
      tasks: snap.tasks,
      buckets: snap.buckets,
      conflicts: snap.conflicts.length,
      errors: snap.errors.length,
      lastSweep: snap.lastSweep,
    };
  }
  const active = snap.tasks.filter((t) => !["merged", "verified"].includes(t.stage));
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
  };
}

export async function actionSearchTasks(query: {
  q?: string;
  bucket?: string;
  stage?: string;
  limit?: number;
}) {
  const snap = await snapshot();
  let tasks = snap.tasks;
  const q = (query.q ?? "").trim().toLowerCase();
  if (q) {
    tasks = tasks.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
    );
  }
  if (query.bucket) tasks = tasks.filter((t) => t.bucket === query.bucket);
  if (query.stage) tasks = tasks.filter((t) => t.stage === query.stage);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  return { tasks: tasks.slice(0, limit), total: tasks.length };
}

export async function actionCreateTask(input: CreateTaskInput) {
  const task = await createTask(input);
  return { task, taskId: task.id, link: taskLink(task.id), sync: await syncMetaForTask(task.id) };
}

export async function actionCheckout(identity: McpIdentity, taskId: string) {
  const { checkoutId } = await checkout({
    taskId,
    runtime: identity.runtime,
    accountableHuman: identity.operatorEmail,
    repo: identity.repo,
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
  const task = await patchTask(input.taskId, patch as Parameters<typeof patchTask>[1], identity.operatorEmail);
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
  input: {
    checkoutId: string;
    summary: string;
    commitSha?: string;
    prUrl?: string;
    verificationCommands?: string[];
    filesChanged?: string[];
  }
) {
  await complete({
    checkoutId: input.checkoutId,
    summary: input.summary,
    commitSha: input.commitSha,
    prUrl: input.prUrl,
  });
  const dispatch = await complianceRepo.getDispatch(input.checkoutId);
  const taskId = dispatch?.taskId ?? "";
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
    },
    sync: taskId ? await syncMetaForTask(taskId) : undefined,
  };
}
