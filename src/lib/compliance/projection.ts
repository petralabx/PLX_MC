// PR lifecycle → sync Task projection (EN-007 P1). Consumes normalized PR events
// after mc_events are appended; mutates tasks via the sync state layer only.

import trackedRepos from "../../../config/tracked-repos-registry.json";
import type { PullRequest, StageKey, Task } from "@/lib/mc-data/types";
import { repoIdFromName } from "@/lib/mc-data/repos";
import { createTask, patchTask } from "@/lib/sync/state";
import { getEntity } from "@/lib/sync/repo";
import * as complianceRepo from "./repo";
import type { ActorKind } from "./types";
import type { PrEvent } from "./webhook";

const PROJECTION_ACTOR = "compliance-projection";
const DONE_STAGES: StageKey[] = ["merged", "verified"];

export function projectionEnabled(): boolean {
  return process.env.COMPLIANCE_PROJECTION_ENABLED !== "0";
}

type RegistryEntry = {
  repo: string;
  tier: string;
  default_bucket?: string;
};

function bareRepoName(repo: string): string {
  return repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo;
}

function registryEntry(githubRepoName: string): RegistryEntry | undefined {
  const bare = bareRepoName(githubRepoName);
  return (trackedRepos.repos as RegistryEntry[]).find((r) => {
    const slug = r.repo.includes("/") ? r.repo.split("/")[1] : r.repo;
    return slug === bare || r.repo === bare;
  });
}

function defaultBucketForRepo(githubRepoName: string): string {
  const entry = registryEntry(githubRepoName);
  if (entry?.default_bucket) return entry.default_bucket;
  switch (entry?.tier) {
    case "product_app":
      return "BKT-PROD";
    case "sandbox":
      return "BKT-UAT";
    default:
      return "BKT-INFRA";
  }
}

function repoIdsForGithubRepo(githubRepoName: string): string[] {
  const bare = bareRepoName(githubRepoName);
  return [repoIdFromName(bare)];
}

function sparseDedupKey(repo: string, prNumber: number): string {
  return `sparse-task:${bareRepoName(repo)}:${prNumber}`;
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

async function ensureSparseTask(evt: PrEvent): Promise<string> {
  const dedupKey = sparseDedupKey(evt.repo, evt.prNumber);
  const existing = await complianceRepo.eventTaskIdByDedupKey(dedupKey);
  if (existing) return existing;

  const created = await createTask({
    title: evt.title.trim() || `PR #${evt.prNumber} (${evt.repo})`,
    description: `Sparse task auto-created from operator PR #${evt.prNumber}.`,
    bucket: defaultBucketForRepo(evt.repo),
    reporter: evt.author || "operator",
    accountableOwner: evt.author || "operator",
    repos: repoIdsForGithubRepo(evt.repo),
    labels: ["sparse-pr"],
    stage: "backlog",
  });

  await complianceRepo.appendEvent({
    kind: "task.sparse_created",
    actor: PROJECTION_ACTOR,
    repo: evt.repo,
    taskId: created.id,
    pr: String(evt.prNumber),
    payload: { author: evt.author, title: evt.title, dedupKey },
    dedupKey,
  });

  return created.id;
}

async function setProgress(taskId: string, evt: PrEvent): Promise<void> {
  const task = await loadTask(taskId);
  if (!task || DONE_STAGES.includes(task.stage)) return;
  if (task.stage === "progress") return;
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

  const pr: PullRequest = {
    repo: evt.repo,
    num: evt.prNumber,
    status: "merged",
    title: evt.title,
  };
  const prs = appendPr(task.prs ?? [], pr);
  const mergeOn = new Date().toISOString().slice(0, 10);

  await patchTask(
    taskId,
    {
      stage: "merged",
      prs,
      merge: { sha: evt.headSha, on: mergeOn },
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
    payload: { sha: evt.headSha, stage: "merged" },
    dedupKey: `task.promoted:${evt.repo}:${evt.prNumber}:${evt.headSha}:${taskId}`,
  });
}

export interface ProjectionInput {
  actorKind: ActorKind;
  actorIdentity: string;
  taskIds: string[];
  sparse: boolean;
}

export async function projectPullRequest(evt: PrEvent, input: ProjectionInput): Promise<void> {
  if (!projectionEnabled()) return;

  let taskIds = [...input.taskIds];

  if (input.sparse && taskIds.length === 0 && ["opened", "reopened", "synchronize"].includes(evt.action)) {
    const sparseId = await ensureSparseTask(evt);
    taskIds = [sparseId];
  }

  if (evt.action === "closed") {
    if (!evt.merged) return;
    if (input.sparse && taskIds.length === 0) {
      taskIds = [await ensureSparseTask(evt)];
    }
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
