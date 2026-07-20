// Server-side state surface for the API routes: a full snapshot for store
// hydration, plus MC-side mutations (create/patch task). Mutations only mark
// the mirror pending/dirty — the engine's sweep is the single outbound code
// path (spec §6 "pending until the first successful write, then synced").

import { ApiError } from "@/lib/api/route";
import { CURRENT_USER, SP_LISTS } from "@/lib/mc-data/data";
import { assignmentViolation, isAgentId, stageAdvanceViolation } from "@/lib/mc-data/policy";
import {
  formatRepoNotAllowedMessage,
  normalizeRepoInputs,
} from "@/lib/mc-data/repos";
import type {
  ActivityEntry,
  AuditRow,
  Bucket,
  Comment,
  FileEntry,
  Project,
  PullRequest,
  Repo,
  RepoRequest,
  Risk,
  SpConflict,
  SpError,
  Task,
} from "@/lib/mc-data/types";
import { ensureBucketsSeeded, ensureProjectsSeeded, ensureReposSeeded, ensureSeeded } from "./engine";
import type { EntityData, FieldAttribution } from "./mapping";
import * as repo from "./repo";

/** Normalize repos[] to registry ids; 422 on unknown/ambiguous (fail-closed). */
function requireRegistryRepos(
  inputs: string[] | undefined,
  registryMap: Record<string, Repo>
): string[] {
  const { ids, rejected } = normalizeRepoInputs(inputs ?? [], registryMap);
  if (rejected.length > 0) {
    throw new ApiError("repo_not_allowed", formatRepoNotAllowedMessage(rejected), 422);
  }
  return ids;
}

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
  // P2 — persisted projects (parent above buckets), so user-created ones survive reload.
  projects: Project[];
}

export async function snapshot(): Promise<StateSnapshot> {
  await ensureSeeded();
  await ensureReposSeeded();
  await ensureProjectsSeeded();
  await ensureBucketsSeeded();
  const [tasks, risks, files, conflicts, errors, audit, counts, repos, repoRequests, bucketComments, buckets, projects, lastSweptAt] = await Promise.all([
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
    repo.getProjects(),
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
    projects,
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

async function assertProjectExists(projectId: string): Promise<void> {
  await ensureProjectsSeeded();
  const known = new Set((await repo.getProjects()).map((p) => p.id));
  if (!known.has(projectId)) {
    throw new ApiError("not_found", `unknown project ${projectId}`, 404);
  }
}

async function defaultProjectId(): Promise<string | null> {
  await ensureProjectsSeeded();
  const projects = await repo.getProjects();
  const portal = projects.find((p) => p.id === "PRJ-PORTAL-GOLIVE");
  return portal?.id ?? projects[0]?.id ?? null;
}

export interface CreateBucketInput {
  name: string;
  owner?: string;
  health?: Bucket["health"];
  target?: string;
  started?: string;
  desc?: string;
  repos?: string[];
  prd?: string | null;
  project?: string | null;
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
  const repos = requireRegistryRepos(input.repos, registryMap);
  const existing = await repo.getBuckets();
  const id = nextBucketId(name, new Set(existing.map((b) => b.id)));
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  let projectId: string | null;
  if (input.project === null) projectId = null;
  else if (input.project) {
    await assertProjectExists(input.project);
    projectId = input.project;
  } else {
    projectId = await defaultProjectId();
  }
  const bucket: Bucket = {
    id,
    name,
    owner: input.owner || CURRENT_USER,
    health: input.health ?? "track",
    target: input.target?.trim() || "—",
    started: input.started?.trim() || today,
    desc: (input.desc ?? "").trim(),
    repos,
    sync: { state: "pending", ts: repo.stamp(), sp: "Roadmap · unprovisioned" },
    prd: input.prd ?? null,
    project: projectId,
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
  project?: string | null;
  progress?: number;
}

// Gantt / Roadmap fields that participate in inbound conflict detection.
const BUCKET_PUSHED_FIELDS = ["name", "health", "started", "target", "progress"];

export async function patchBucket(id: string, patch: PatchBucketInput, actor: string): Promise<Bucket | null> {
  await ensureBucketsSeeded();
  const rows = await repo.getBucketRows();
  const existingRow = rows.find((r) => r.bucket.id === id);
  if (!existingRow) return null;
  const existing = existingRow.bucket;
  if (patch.repos) {
    await ensureReposSeeded();
    const registry = await repo.getRepos();
    const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
    patch = { ...patch, repos: requireRegistryRepos(patch.repos, registryMap) };
  }
  if (patch.project) await assertProjectExists(patch.project);
  const defined = definedEntries(patch);
  const next: Bucket = { ...existing, ...defined };
  const pushedDirty = Object.keys(defined).filter((k) => BUCKET_PUSHED_FIELDS.includes(k));
  const dirty = Array.from(new Set([...existingRow.dirtyFields, ...pushedDirty]));
  await repo.upsertBucket(next, dirty);
  await repo.appendAudit(actor, `Edited initiative ${id} — pending Roadmap mirror.`, "pending");
  return next;
}

// ─── Projects (P2 — parent above buckets) ────────────────────────────────────

function nextProjectId(name: string, existing: Set<string>): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = `PRJ-${slug || "NEW"}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export interface CreateProjectInput {
  name: string;
  owner?: string;
  health?: Project["health"];
  target?: string;
  started?: string;
  desc?: string;
  repos?: string[];
  prd?: string | null;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  await ensureSeeded();
  await ensureReposSeeded();
  await ensureProjectsSeeded();
  const name = input.name.trim();
  if (!name) throw new ApiError("invalid_request", "A project needs a name.", 422);
  const registry = await repo.getRepos();
  const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
  const repos = requireRegistryRepos(input.repos, registryMap);
  const existing = await repo.getProjects();
  const id = nextProjectId(name, new Set(existing.map((p) => p.id)));
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  const project: Project = {
    id,
    name,
    owner: input.owner || CURRENT_USER,
    health: input.health ?? "track",
    target: input.target?.trim() || "—",
    started: input.started?.trim() || today,
    desc: (input.desc ?? "").trim(),
    repos,
    sync: { state: "pending", ts: repo.stamp(), sp: "Projects · unprovisioned" },
    prd: input.prd ?? null,
  };
  await repo.upsertProject(project);
  await repo.appendAudit(project.owner, `Created project ${id} (${name}) — pending Projects mirror.`, "pending");
  return project;
}

export interface PatchProjectInput {
  name?: string;
  owner?: string;
  health?: Project["health"];
  target?: string;
  started?: string;
  desc?: string;
  repos?: string[];
  prd?: string | null;
}

export async function patchProject(id: string, patch: PatchProjectInput, actor: string): Promise<Project | null> {
  await ensureProjectsSeeded();
  const existing = (await repo.getProjects()).find((p) => p.id === id);
  if (!existing) return null;
  if (patch.repos) {
    await ensureReposSeeded();
    const registry = await repo.getRepos();
    const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
    patch = { ...patch, repos: requireRegistryRepos(patch.repos, registryMap) };
  }
  const next: Project = { ...existing, ...definedEntries(patch) };
  await repo.upsertProject(next);
  await repo.appendAudit(actor, `Edited project ${id} — pending Projects mirror.`, "pending");
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

export interface MutationAttribution {
  source: "human" | "service";
  actorId: string;
}

export async function createTask(
  input: CreateTaskInput,
  attribution?: MutationAttribution
): Promise<Task> {
  await ensureSeeded();
  await ensureReposSeeded();
  await ensureBucketsSeeded();
  // Allow-list enforcement (EN-002): a task may only attach registry repos.
  // Normalize GitHub slugs / names → registry ids before persist.
  const registry = await repo.getRepos();
  const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
  const repos = requireRegistryRepos(input.repos, registryMap);

  // Bucket must already exist — never invent hierarchy (P8).
  const buckets = await repo.getBuckets();
  if (!buckets.some((b) => b.id === input.bucket)) {
    throw new ApiError("invalid_bucket", `Bucket ${input.bucket} does not exist.`, 422);
  }

  const { withTransaction } = await import("@/lib/db");
  const { allocateNextTaskId } = await import("@/lib/routing/repo");

  return withTransaction(async (q) => {
    const id = await allocateNextTaskId(q);
    const numeric = Number((/^TASK-(\d+)$/.exec(id) ?? [])[1] ?? 0);
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
      repos,
      targetEnv: input.targetEnv ?? "staging",
      estimate: input.estimate ?? "M",
      labels: input.labels ?? [],
      prs: [],
      due: input.due || "—",
      sync: { state: "pending", ts: repo.stamp(), sp: `ToDos · item ${numeric}` },
      subtasks: [],
      activity: [
        { age: "now", who: input.reporter, kind: "move", what: "created the task" },
      ],
      userCreated: true,
    };

    const fieldAttribution =
      attribution != null
        ? {
            title: {
              source: attribution.source,
              at: new Date().toISOString(),
              actorId: attribution.actorId,
            },
            bucket: {
              source: attribution.source,
              at: new Date().toISOString(),
              actorId: attribution.actorId,
            },
          }
        : {};

    const inserted = await q<{ id: string }>(
      `INSERT INTO entities (
         entity_type, id, data, sync_state, sync_ts, dirty_fields, field_attribution
       ) VALUES ('task', $1, $2::jsonb, 'pending', now(), '[]'::jsonb, $3::jsonb)
       ON CONFLICT (entity_type, id) DO NOTHING
       RETURNING id`,
      [id, JSON.stringify(task), JSON.stringify(fieldAttribution)]
    );
    if (!inserted[0]) {
      throw new ApiError("conflict", `Task ${id} already exists.`, 409);
    }

    await q(
      `INSERT INTO sync_audit_log (actor, body, state) VALUES ($1, $2, $3)`,
      [input.reporter, `Created ${id} — pending first push to ToDos.`, "pending"]
    );
    return task;
  });
}

export interface PatchTaskInput {
  assignee?: string | null; // Item 1 — pushed to the Assigned To person column (two-way)
  title?: string;
  stage?: Task["stage"];
  priority?: Task["priority"];
  due?: string;
  description?: string;
  bucket?: string; // Initiative lookup — pushed when Roadmap item is mirrored
  labels?: string[]; // DB-only
  coassignees?: string[]; // DB-only
  subtasks?: Task["subtasks"]; // DB-only (Subtask[], enriched in WS-3)
  comments?: Task["comments"]; // EN-001 / WS-3 — DB-only, app-only (never pushed)
  accountableOwner?: string | null; // Item 1 — pushed to the Accountable Owner person column (push-only)
  humanOnly?: boolean; // EN-003 — DB-only assignment policy
  repos?: string[]; // EN-005 — pushed, allow-list enforced
  targetEnv?: Task["targetEnv"]; // pushed Target Environment column
  agentRunApproved?: boolean; // EN-005 — DB-only operator approval of an approve-mode agent run
  prs?: PullRequest[]; // DB-only — PR links (compliance projection)
  merge?: { sha: string; on: string }; // DB-only — merge metadata (compliance projection)
  activityLine?: Pick<ActivityEntry, "who" | "what" | "kind">; // DB-only append
}

export interface PatchTaskOptions {
  /** Compliance PR projection may promote to merged without a complete evidence bundle. */
  complianceProjection?: boolean;
  /** Durable actor attribution for dirty routing fields (P8 / P4 residual). */
  attribution?: MutationAttribution;
}

// Persistence tiers:
//   SP  (pushed): title, stage, priority, due, description; the person columns
//       assignee/accountableOwner/reporter (Item 1 — resolved to site-user lookup
//       ids on the sweep); subtasks (Item 3 — push-only serialized mirror);
//       repos and targetEnv (push-only targeting fields); bucket (Initiative
//       lookup → Roadmap item id). A patch touching any of these re-queues the
//       entity for push.
//   DB  (jsonb-only, NOT pushed): labels, coassignees, comments, humanOnly.
//       labels promote to SP once a Labels column exists; comments stay app-only
//       (EN-001 decision).
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
  "bucket",
];

export async function patchTask(
  id: string,
  patch: PatchTaskInput,
  actor: string,
  opts: PatchTaskOptions = {}
): Promise<Task | null> {
  await ensureSeeded();
  const row = await repo.getEntity("task", id);
  if (!row) return null;

  const { activityLine, ...taskPatch } = patch;

  // Allow-list enforcement on edit (EN-005): normalize + validate repos before
  // building the persisted patch so slugs never land in entities.data.
  if (taskPatch.repos) {
    await ensureReposSeeded();
    const registry = await repo.getRepos();
    const registryMap = Object.fromEntries(registry.map((r) => [r.id, r]));
    taskPatch.repos = requireRegistryRepos(taskPatch.repos, registryMap);
  }

  const entries = Object.entries(taskPatch).filter(([, v]) => v !== undefined);
  if (entries.length === 0 && !activityLine) return row.data as unknown as Task;

  // Accountability policy (EN-003), enforced server-side in lockstep with the
  // client store: reject an agent executor on a human-only task, and reject a
  // stage advance that orphans the task past `planned` (or marks it done with
  // incomplete evidence). The effective task folds the incoming patch so a
  // patch that sets both owner and stage is evaluated against the new owner.
  const current = row.data as unknown as Task;
  const effective = { ...current, ...taskPatch } as Task;
  if ("assignee" in taskPatch) {
    const violation = assignmentViolation(effective, taskPatch.assignee ?? null);
    if (violation) throw new ApiError("human_only_violation", violation, 409);
  }
  if ("stage" in taskPatch && taskPatch.stage) {
    const skipEvidenceGate =
      opts.complianceProjection &&
      (taskPatch.stage === "merged" || taskPatch.stage === "verified" || taskPatch.stage === "progress");
    if (!skipEvidenceGate) {
      const violation = stageAdvanceViolation(effective, taskPatch.stage);
      if (violation) throw new ApiError("stage_blocked", violation, 409);
    }
  }

  const pushedDirty = entries.map(([k]) => k).filter((k) => PUSHED_FIELDS.includes(k));
  const dirty = Array.from(new Set([...row.dirty_fields, ...pushedDirty]));

  const dataPatch: EntityData = Object.fromEntries(entries);
  if (activityLine) {
    const prev = (current.activity ?? []) as ActivityEntry[];
    dataPatch.activity = [
      ...prev,
      {
        age: "now",
        who: activityLine.who,
        what: activityLine.what,
        kind: activityLine.kind ?? "move",
      },
    ];
  }

  const fieldAttribution: Record<string, FieldAttribution> | undefined =
    opts.attribution && pushedDirty.length > 0
      ? Object.fromEntries(
          pushedDirty.map((field) => [
            field,
            {
              source: opts.attribution!.source,
              at: new Date().toISOString(),
              actorId: opts.attribution!.actorId,
            } satisfies FieldAttribution,
          ])
        )
      : undefined;

  await repo.updateEntity("task", id, {
    patch: dataPatch,
    // Person columns are pushed now (Item 1), so a person-only patch re-queues
    // the entity for the next outbound sweep.
    syncState: pushedDirty.length > 0 ? "pending" : undefined,
    dirtyFields: dirty,
    fieldAttribution,
  });

  if ("assignee" in taskPatch) {
    await repo.appendAudit(
      actor,
      taskPatch.assignee === null
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
