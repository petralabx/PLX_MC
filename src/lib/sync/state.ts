// Server-side state surface for the API routes: a full snapshot for store
// hydration, plus MC-side mutations (create/patch task). Mutations only mark
// the mirror pending/dirty — the engine's sweep is the single outbound code
// path (spec §6 "pending until the first successful write, then synced").

import { SP_LISTS } from "@/lib/mc-data/data";
import type { AuditRow, FileEntry, Risk, SpConflict, SpError, Task } from "@/lib/mc-data/types";
import { ensureSeeded } from "./engine";
import type { EntityData } from "./mapping";
import * as repo from "./repo";

export interface StateSnapshot {
  tasks: Task[];
  risks: Risk[];
  files: FileEntry[];
  conflicts: SpConflict[];
  errors: SpError[];
  audit: AuditRow[];
  counts: Record<string, repo.ListCounts>;
  lastSweep: string;
}

export async function snapshot(): Promise<StateSnapshot> {
  await ensureSeeded();
  const [tasks, risks, files, conflicts, errors, audit, counts] = await Promise.all([
    repo.getEntities("task"),
    repo.getEntities("risk"),
    repo.getEntities("file"),
    repo.openConflicts(),
    repo.openErrors(),
    repo.auditRows(),
    repo.countsByList(),
  ]);
  return {
    tasks: tasks.map((r) => r.data as unknown as Task),
    risks: risks.map((r) => r.data as unknown as Risk),
    files: files.map((r) => r.data as unknown as FileEntry),
    conflicts,
    errors,
    audit,
    counts,
    // Lists not yet mirrored (roadmap, milestones) keep their fixture counts;
    // mirrored lists report live counts. The store merges via SP_LISTS keys.
    lastSweep: audit.find((a) => a.body.startsWith("Sweep completed"))?.ts ?? SP_LISTS[0].lastSync,
  };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  bucket: string;
  stage?: Task["stage"];
  priority?: Task["priority"];
  assignee?: string | null;
  coassignees?: string[];
  reporter: string;
  reqs?: string[];
  repos?: string[];
  estimate?: Task["estimate"];
  labels?: string[];
  due?: string;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  await ensureSeeded();
  const rows = await repo.getEntities("task");
  const max = Math.max(0, ...rows.map((r) => parseInt((/(\d+)/.exec(r.id) ?? [])[1] ?? "0", 10)));
  const id = `TASK-${max + 1}`;
  const task: Task = {
    id,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    bucket: input.bucket,
    stage: input.stage ?? "backlog",
    priority: input.priority ?? "medium",
    assignee: input.assignee ?? null,
    coassignees: input.coassignees ?? [],
    reporter: input.reporter,
    reqs: input.reqs ?? [],
    repos: input.repos ?? [],
    estimate: input.estimate ?? "M",
    labels: input.labels ?? [],
    prs: [],
    due: input.due || "—",
    sync: { state: "pending", ts: repo.stamp(), sp: `ToDos · item ${max + 1}` },
    subtasks: [],
    activity: [
      { age: "now", who: input.reporter, kind: "move", what: "created the task" },
    ],
    userCreated: true,
  };
  await repo.insertEntity("task", id, task as unknown as EntityData, "pending", []);
  await repo.appendAudit(input.reporter, `Created ${id} — pending first push to ToDos.`, "pending");
  return task;
}

export interface PatchTaskInput {
  assignee?: string | null;
  title?: string;
  stage?: Task["stage"];
  priority?: Task["priority"];
  due?: string;
  description?: string;
}

const PUSHED_FIELDS = ["title", "stage", "priority", "due", "description"];

export async function patchTask(id: string, patch: PatchTaskInput, actor: string): Promise<Task | null> {
  await ensureSeeded();
  const row = await repo.getEntity("task", id);
  if (!row) return null;

  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return row.data as unknown as Task;

  const pushedDirty = entries.map(([k]) => k).filter((k) => PUSHED_FIELDS.includes(k));
  const dirty = Array.from(new Set([...row.dirty_fields, ...pushedDirty]));

  await repo.updateEntity("task", id, {
    patch: Object.fromEntries(entries),
    // Person columns (assignee) are not mirrored yet (directory increment) —
    // an assignee-only patch does not re-queue the entity for push.
    syncState: pushedDirty.length > 0 ? "pending" : undefined,
    dirtyFields: dirty,
  });

  if ("assignee" in patch) {
    await repo.appendAudit(
      actor,
      patch.assignee === null
        ? `Unassigned ${id} — Assigned To mirror deferred to the directory increment.`
        : `Reassigned ${id} — Assigned To mirror deferred to the directory increment.`,
      "pending"
    );
  }
  if (pushedDirty.length > 0) {
    await repo.appendAudit(actor, `Edited ${id} (${pushedDirty.join(", ")}) — pending push.`, "pending");
  }
  const updated = await repo.getEntity("task", id);
  return (updated?.data ?? null) as Task | null;
}
