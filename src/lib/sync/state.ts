// Server-side state surface for the API routes: a full snapshot for store
// hydration, plus MC-side mutations (create/patch task). Mutations only mark
// the mirror pending/dirty — the engine's sweep is the single outbound code
// path (spec §6 "pending until the first successful write, then synced").

import { ApiError } from "@/lib/api/route";
import { SP_LISTS } from "@/lib/mc-data/data";
import { assignmentViolation, isAgentId, stageAdvanceViolation } from "@/lib/mc-data/policy";
import { disallowedRepos } from "@/lib/mc-data/repos";
import type {
  AuditRow,
  FileEntry,
  Repo,
  RepoRequest,
  Risk,
  SpConflict,
  SpError,
  Task,
} from "@/lib/mc-data/types";
import { ensureReposSeeded, ensureSeeded } from "./engine";
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
  // EN-002 / Item 2 — the persisted repo registry (allow-list) + request queue,
  // so approvals survive a reload.
  repos: Repo[];
  repoRequests: RepoRequest[];
}

export async function snapshot(): Promise<StateSnapshot> {
  await ensureSeeded();
  await ensureReposSeeded();
  const [tasks, risks, files, conflicts, errors, audit, counts, repos, repoRequests] = await Promise.all([
    repo.getEntities("task"),
    repo.getEntities("risk"),
    repo.getEntities("file"),
    repo.openConflicts(),
    repo.openErrors(),
    repo.auditRows(),
    repo.countsByList(),
    repo.getRepos(),
    repo.getRepoRequests(),
  ]);
  return {
    tasks: tasks.map((r) => r.data as unknown as Task),
    risks: risks.map((r) => r.data as unknown as Risk),
    files: files.map((r) => r.data as unknown as FileEntry),
    conflicts,
    errors,
    audit,
    counts,
    // Strip the internal sync bookkeeping — the store consumes the Repo shape.
    repos: repos.map(({ id, name, lang, def, owner, visibility, scope }) => ({
      id,
      name,
      lang,
      def,
      owner,
      visibility,
      scope,
    })),
    repoRequests,
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
  accountableOwner?: string | null;
  humanOnly?: boolean;
  reqs?: string[];
  repos?: string[];
  estimate?: Task["estimate"];
  labels?: string[];
  due?: string;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  await ensureSeeded();
  await ensureReposSeeded();
  // Allow-list enforcement (EN-002): a task may only attach registry repos.
  // Humans and agents hit this same server gate — an unknown repo is rejected,
  // never silently accepted (request → approve adds it to the registry first).
  // Check the PERSISTED registry (canonical seed + approved repos), not the
  // fixture, so an approved+persisted repo is actually accepted (Item 2).
  const registry = await repo.getRepos();
  const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
  const offlist = disallowedRepos(input.repos ?? [], registryMap);
  if (offlist.length > 0) {
    throw new ApiError(
      "repo_not_allowed",
      `These repos are not in the registry: ${offlist.join(", ")}. Request and get them approved first.`,
      422
    );
  }
  const rows = await repo.getEntities("task");
  const max = Math.max(0, ...rows.map((r) => parseInt((/(\d+)/.exec(r.id) ?? [])[1] ?? "0", 10)));
  const id = `TASK-${max + 1}`;
  // A human-only task can never carry an agent executor (EN-003 policy).
  const assignee =
    input.humanOnly && isAgentId(input.assignee ?? null) ? null : (input.assignee ?? null);
  const task: Task = {
    id,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    bucket: input.bucket,
    stage: input.stage ?? "backlog",
    priority: input.priority ?? "medium",
    assignee,
    coassignees: input.coassignees ?? [],
    reporter: input.reporter,
    accountableOwner: input.accountableOwner ?? null,
    humanOnly: input.humanOnly,
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
  assignee?: string | null; // Item 1 — pushed to the Assigned To person column (two-way)
  title?: string;
  stage?: Task["stage"];
  priority?: Task["priority"];
  due?: string;
  description?: string;
  bucket?: string; // DB-only (see §4)
  labels?: string[]; // DB-only
  coassignees?: string[]; // DB-only
  subtasks?: Task["subtasks"]; // DB-only (Subtask[], enriched in WS-3)
  comments?: Task["comments"]; // EN-001 / WS-3 — DB-only, app-only (never pushed)
  accountableOwner?: string | null; // Item 1 — pushed to the Accountable Owner person column (push-only)
  humanOnly?: boolean; // EN-003 — DB-only assignment policy
}

// Persistence tiers:
//   SP  (pushed): title, stage, priority, due, description; the person columns
//       assignee/accountableOwner/reporter (Item 1 — resolved to site-user lookup
//       ids on the sweep); and subtasks (Item 3 — push-only serialized mirror).
//       A patch touching any of these re-queues the entity for push.
//   DB  (jsonb-only, NOT pushed): bucket, labels, coassignees, comments, humanOnly.
//       bucket/labels promote to SP once the Initiative lookup + a Labels column
//       exist; comments stay app-only (EN-001 decision).
const PUSHED_FIELDS = ["title", "stage", "priority", "due", "description", "assignee", "accountableOwner", "reporter", "subtasks"];

export async function patchTask(id: string, patch: PatchTaskInput, actor: string): Promise<Task | null> {
  await ensureSeeded();
  const row = await repo.getEntity("task", id);
  if (!row) return null;

  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return row.data as unknown as Task;

  // Accountability policy (EN-003), enforced server-side in lockstep with the
  // client store: reject an agent executor on a human-only task, and reject a
  // stage advance that orphans the task past `planned` (or marks it done with
  // incomplete evidence). The effective task folds the incoming patch so a
  // patch that sets both owner and stage is evaluated against the new owner.
  const current = row.data as unknown as Task;
  const effective = { ...current, ...patch } as Task;
  if ("assignee" in patch) {
    const violation = assignmentViolation(effective, patch.assignee ?? null);
    if (violation) throw new ApiError("human_only_violation", violation, 409);
  }
  if ("stage" in patch && patch.stage) {
    const violation = stageAdvanceViolation(effective, patch.stage);
    if (violation) throw new ApiError("stage_blocked", violation, 409);
  }

  const pushedDirty = entries.map(([k]) => k).filter((k) => PUSHED_FIELDS.includes(k));
  const dirty = Array.from(new Set([...row.dirty_fields, ...pushedDirty]));

  await repo.updateEntity("task", id, {
    patch: Object.fromEntries(entries),
    // Person columns are pushed now (Item 1), so a person-only patch re-queues
    // the entity for the next outbound sweep.
    syncState: pushedDirty.length > 0 ? "pending" : undefined,
    dirtyFields: dirty,
  });

  if ("assignee" in patch) {
    await repo.appendAudit(
      actor,
      patch.assignee === null
        ? `Unassigned ${id} — clearing Assigned To on the next SharePoint sync.`
        : `Reassigned ${id} — Assigned To mirrors to SharePoint on the next sync.`,
      "pending"
    );
  }
  // The remaining pushed fields (incl. Accountable Owner / Reporter) log the
  // honest pending-push trail; assignee already has its own line above.
  const loggable = pushedDirty.filter((k) => k !== "assignee");
  if (loggable.length > 0) {
    await repo.appendAudit(actor, `Edited ${id} (${loggable.join(", ")}) — pending push.`, "pending");
  }
  const updated = await repo.getEntity("task", id);
  return (updated?.data ?? null) as Task | null;
}
