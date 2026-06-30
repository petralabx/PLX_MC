// Server-side state surface for the API routes: a full snapshot for store
// hydration, plus MC-side mutations (create/patch task). Mutations only mark
// the mirror pending/dirty — the engine's sweep is the single outbound code
// path (spec §6 "pending until the first successful write, then synced").

import { ApiError } from "@/lib/api/route";
import { CURRENT_USER, SP_LISTS } from "@/lib/mc-data/data";
import { assignmentViolation, isAgentId, stageAdvanceViolation } from "@/lib/mc-data/policy";
import { disallowedRepos } from "@/lib/mc-data/repos";
import type {
  AuditRow,
  Bucket,
  Comment,
  FileEntry,
  Repo,
  RepoRequest,
  Risk,
  SpConflict,
  SpError,
  Task,
} from "@/lib/mc-data/types";
import { ensureBucketsSeeded, ensureProjectsSeeded, ensureReposSeeded, ensureSeeded } from "./engine";
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
  // EN-001 / Item 4 — persisted bucket discussion threads (keyed by bucket id),
  // so they survive a reload. App-only (never mirrored to SharePoint).
  bucketComments: Record<string, Comment[]>;
  // EN-005 — persisted buckets/initiatives, so user-created ones survive reload.
  buckets: Bucket[];
}

export async function snapshot(): Promise<StateSnapshot> {
  await ensureSeeded();
  await ensureReposSeeded();
  await ensureProjectsSeeded();
  await ensureBucketsSeeded();
  const [tasks, risks, files, conflicts, errors, audit, counts, repos, repoRequests, bucketComments, buckets, lastSweptAt] = await Promise.all([
    repo.getEntities("task"),
    repo.getEntities("risk"),
    repo.getEntities("file"),
    repo.openConflicts(),
    repo.openErrors(),
    repo.auditRows(),
    repo.countsByList(),
    repo.getRepos(),
    repo.getRepoRequests(),
    repo.bucketCommentsByBucket(),
    repo.getBuckets(),
    repo.lastSweepAt(),
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
    bucketComments,
    buckets,
    // Lists not yet mirrored (roadmap, milestones) keep their fixture counts;
    // mirrored lists report live counts. The store merges via SP_LISTS keys.
    // Heartbeat from delta_links (advances every sweep, incl. no-op ones),
    // falling back to the legacy audit-derived value then the fixture stamp so
    // a brand-new mirror with no sweep yet still renders a value.
    lastSweep: lastSweptAt ?? audit.find((a) => a.body.startsWith("Sweep completed"))?.ts ?? SP_LISTS[0].lastSync,
  };
}

// Replace a bucket's discussion thread (EN-001 / Item 4). The store mirrors the
// whole array (the same shape task comments round-trip), so the server replaces
// the thread atomically and returns the stored comments. App-only — bucket
// comments are never pushed to SharePoint.
export async function setBucketComments(bucketId: string, comments: Comment[]): Promise<Comment[]> {
  return repo.replaceBucketComments(bucketId, comments);
}

// ─── Buckets / initiatives (EN-005) ──────────────────────────────────────────

// `BKT-<SLUG>` from the name (uppercased, hyphenated, capped), with a numeric
// suffix on collision — matching the semantic style of the fixture ids.
function nextBucketId(name: string, existing: Set<string>): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = `BKT-${slug || "NEW"}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const definedEntries = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

export interface CreateBucketInput {
  name: string;
  owner?: string;
  health?: Bucket["health"];
  target?: string;
  started?: string;
  desc?: string;
  repos?: string[];
  prd?: string | null;
}

export async function createBucket(input: CreateBucketInput): Promise<Bucket> {
  await ensureSeeded();
  await ensureReposSeeded();
  await ensureProjectsSeeded();
  await ensureBucketsSeeded();
  const name = input.name.trim();
  if (!name) throw new ApiError("invalid_request", "A bucket needs a name.", 422);
  // Allow-list clamp (EN-002): a bucket may only attach registry repos.
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
  const existing = await repo.getBuckets();
  const id = nextBucketId(name, new Set(existing.map((b) => b.id)));
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const bucket: Bucket = {
    id,
    name,
    owner: input.owner || CURRENT_USER,
    health: input.health ?? "track",
    target: input.target?.trim() || "—",
    started: input.started?.trim() || today,
    desc: (input.desc ?? "").trim(),
    repos: input.repos ?? [],
    sync: { state: "pending", ts: repo.stamp(), sp: "Roadmap · unprovisioned" },
    prd: input.prd ?? null,
  };
  await repo.upsertBucket(bucket);
  await repo.appendAudit(bucket.owner, `Created initiative ${id} (${name}) — pending Roadmap mirror.`, "pending");
  return bucket;
}

export interface PatchBucketInput {
  name?: string;
  owner?: string;
  health?: Bucket["health"];
  target?: string;
  started?: string;
  desc?: string;
  repos?: string[];
  prd?: string | null;
}

export async function patchBucket(id: string, patch: PatchBucketInput, actor: string): Promise<Bucket | null> {
  await ensureBucketsSeeded();
  const existing = (await repo.getBuckets()).find((b) => b.id === id);
  if (!existing) return null;
  if (patch.repos) {
    await ensureReposSeeded();
    const registry = await repo.getRepos();
    const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
    const offlist = disallowedRepos(patch.repos, registryMap);
    if (offlist.length > 0) {
      throw new ApiError("repo_not_allowed", `These repos are not in the registry: ${offlist.join(", ")}.`, 422);
    }
  }
  const next: Bucket = { ...existing, ...definedEntries(patch) };
  await repo.upsertBucket(next);
  await repo.appendAudit(actor, `Edited initiative ${id} — pending Roadmap mirror.`, "pending");
  return next;
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
  targetEnv?: Task["targetEnv"];
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
    targetEnv: input.targetEnv ?? "staging",
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
  repos?: string[]; // EN-005 — pushed, allow-list enforced
  targetEnv?: Task["targetEnv"]; // pushed Target Environment column
  agentRunApproved?: boolean; // EN-005 — DB-only operator approval of an approve-mode agent run
}

// Persistence tiers:
//   SP  (pushed): title, stage, priority, due, description; the person columns
//       assignee/accountableOwner/reporter (Item 1 — resolved to site-user lookup
//       ids on the sweep); subtasks (Item 3 — push-only serialized mirror);
//       repos and targetEnv (push-only targeting fields). A patch touching any
//       of these re-queues the entity for push.
//   DB  (jsonb-only, NOT pushed): bucket, labels, coassignees, comments, humanOnly.
//       bucket/labels promote to SP once the Initiative lookup + a Labels column
//       exist; comments stay app-only (EN-001 decision).
const PUSHED_FIELDS = [
  "title",
  "stage",
  "priority",
  "due",
  "description",
  "assignee",
  "accountableOwner",
  "reporter",
  "subtasks",
  "repos",
  "targetEnv",
];

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
  // Allow-list enforcement on edit (EN-005): a task's repos may only be set to
  // registry members — the SAME persisted allow-list createTask validates against.
  if (patch.repos) {
    await ensureReposSeeded();
    const registry = await repo.getRepos();
    const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
    const offlist = disallowedRepos(patch.repos, registryMap);
    if (offlist.length > 0) {
      throw new ApiError(
        "repo_not_allowed",
        `These repos are not in the registry: ${offlist.join(", ")}. Request and get them approved first.`,
        422
      );
    }
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
