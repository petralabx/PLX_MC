// The sync engine (SHAREPOINT_INTEGRATION.md §5–6): outbound push of pending
// MC mutations, inbound Graph delta poll, two-sided conflict detection with
// MANUAL resolution only, push-error queue, and an audit row for every
// reconciliation. Runs inside the Next.js server process (scheduler.ts) until
// webhooks force a public deploy.
//
// Scope of this increment: ToDos + Risk Register lists, including the ToDos
// person columns (Assigned To ↔, Accountable Owner →, Reporter →) resolved to
// site-user lookup ids, the Initiative lookup on ToDos (two-way via Roadmap
// item ids), and Roadmap Gantt inbound (name/health/started/target). Documents:
// inbound-only Project Documents drive mirror behind PLX_MC_DOCUMENTS_SYNC_ENABLED
// (TASK-628; see docs/modules/sync/README.md).

import { ACTORS, BUCKETS, FILES, HUMANS, PROJECTS, REPOS, RISKS, SP_CONFLICTS, SP_ERRORS, TASKS } from "@/lib/mc-data/data";
import type { Bucket, SyncState, Task } from "@/lib/mc-data/types";
import {
  createListItem,
  documentsDriveId,
  driveDelta,
  findItemByField,
  GraphError,
  listDelta,
  normalizeLastModified,
  patchListItemFields,
  PROJECTS_KEY,
  REPO_REGISTRY_KEY,
  ROADMAP_KEY,
  resolveEmailByLookupId,
  resolveSiteUserLookupId,
  siteContext,
  type SiteContext,
  type SpListItem,
} from "./graph";
import {
  actorIdByEmail,
  bucketOutboundFields,
  displayFieldFor,
  displayValue,
  inboundBucketPatches,
  inboundPatches,
  inboundProjectPatches,
  mcFieldFor,
  outboundFields,
  parseFieldValue,
  planningOutboundField,
  planTaskPersons,
  projectOutboundFields,
  reconcileInbound,
  repoOutboundFields,
  ROUTING_BUCKET_FIELDS,
  ROUTING_PROJECT_FIELDS,
  ROUTING_TASK_FIELDS,
  TASK_PERSON_FIELDS,
  validateInboundAdoptionRow,
  type EntityData,
  type EntityType,
  type FieldAttribution,
  type SyncConflictSubject,
  type TaskPersonMc,
} from "./mapping";
import { documentsSyncEnabled } from "@/lib/secrets";
import { fileEntryFromDriveItem, type DriveItem } from "./documents";
import { evaluateSyncFreshness, type SyncFreshnessResult } from "./freshness";
import {
  clearPushRetry,
  getDeferredPushSet,
  isTransientGraphFailure,
  pushRetryKey,
  recordTransientPushFailure,
  type PushEntityKind,
} from "./push-queue";
import * as repo from "./repo";
import { SYNC_INBOUND_SERVICE_PRINCIPAL_ID, type PermissionActor } from "@/lib/permissions";
import {
  authorizeStaged,
  recordUnresolvedActorDenial,
  resolveStagedHumanActor,
  resolveStagedServicePrincipal,
} from "@/lib/permissions/enforcement";
import { ApiError } from "@/lib/api/route";
import { auth } from "@/lib/auth";
import type { Project } from "@/lib/mc-data/types";

const SYNC_ACTOR = "scribe"; // the ops agent persona attributed to engine sweeps

// ─── Person-column resolution (Item 1) ───────────────────────────────────────

export interface ResolvedPersons {
  // Pre-resolved `<Column>LookupId` values for outboundFields: a number sets the
  // person, `null` clears it, an absent key leaves the column untouched.
  persons: Partial<Record<TaskPersonMc, number | null>>;
  // Humans assigned but not resolvable to a site-user id (not in the UIL) — the
  // column is left untouched and the miss is audited (fail visible, never faked).
  unresolved: { mc: TaskPersonMc; actorId: string }[];
}

// Resolve a task's three person columns to site-user lookup ids. Pure planning
// (planTaskPersons) + injectable async resolution, so the classification is
// unit-testable without Graph. A resolution failure degrades to "unresolved"
// (skip + audit) and never blocks the rest of the task push.
export async function resolveTaskPersons(
  ctx: SiteContext,
  task: Pick<Task, TaskPersonMc>,
  resolve: (ctx: SiteContext, email: string) => Promise<number | null> = resolveSiteUserLookupId
): Promise<ResolvedPersons> {
  const plan = planTaskPersons(task);
  const persons: Partial<Record<TaskPersonMc, number | null>> = {};
  const unresolved: { mc: TaskPersonMc; actorId: string }[] = [];
  for (const mc of plan.clear) persons[mc] = null;
  for (const { mc, actorId, email } of plan.resolve) {
    let id: number | null = null;
    try {
      id = await resolve(ctx, email);
    } catch {
      id = null; // resolution failure → treat as unresolved (audited), never blocks the push
    }
    if (id == null) unresolved.push({ mc, actorId });
    else persons[mc] = id;
  }
  return { persons, unresolved };
}

// Resolve a task's Initiative lookup to the Roadmap list item id (SharePoint
// stores Initiative as a lookup to Roadmap). Returns undefined when the bucket
// is not yet mirrored (leave column untouched + audit); null when the task has
// no bucket (clear the column).
export async function resolveInitiativeLookupId(
  task: Pick<Task, "bucket">,
  loadBuckets: () => Promise<repo.BucketWithSync[]> = () => repo.getBucketRows()
): Promise<{ initiativeLookupId?: number | null; unresolvedBucket?: string }> {
  const bucketId = task.bucket;
  if (!bucketId) return { initiativeLookupId: null };
  const rows = await loadBuckets();
  const hit = rows.find((r) => r.bucket.id === bucketId);
  if (!hit?.spItemId) return { unresolvedBucket: bucketId };
  const n = Number(hit.spItemId);
  if (Number.isNaN(n)) return { unresolvedBucket: bucketId };
  return { initiativeLookupId: n };
}

// ─── Seed bootstrap ──────────────────────────────────────────────────────────

// First run against an empty mirror: load the prototype fixtures. Entities
// the fixtures call "synced" are seeded as PENDING — nothing has actually
// been pushed to the dev site yet, and claiming sync without evidence is
// exactly what this engine exists to prevent. Conflict/error fixtures keep
// their states so the review queues are exercised end-to-end. Files keep
// fixture states (documents sync is a later increment).
export async function ensureSeeded(): Promise<boolean> {
  // Re-runs when fixtures grow (e.g. the go-live plan, 2026-06-11): inserts
  // are ON CONFLICT DO NOTHING, so existing mirror rows are never touched.
  const newestTask = TASKS[TASKS.length - 1];
  const newestFile = FILES[FILES.length - 1];
  if (
    (await repo.entityCount()) > 0 &&
    (await repo.getEntity("task", newestTask.id)) &&
    (!newestFile || (await repo.getEntity("file", newestFile.id)))
  ) {
    return false;
  }

  const conflictIds = new Set(SP_CONFLICTS.map((c) => c.entityId));
  const errorIds = new Set(SP_ERRORS.map((e) => e.entityId));
  const seedState = (id: string, fixture: SyncState): SyncState => {
    if (conflictIds.has(id)) return "conflict";
    if (errorIds.has(id)) return "error";
    return fixture === "synced" ? "pending" : fixture;
  };

  for (const t of TASKS) {
    await repo.insertEntity("task", t.id, t as unknown as EntityData, seedState(t.id, t.sync.state), conflictIds.has(t.id) ? ["stage"] : []);
  }
  for (const r of RISKS) {
    const dirty = conflictIds.has(r.id) || errorIds.has(r.id) ? ["like"] : [];
    await repo.insertEntity("risk", r.id, r as unknown as EntityData, seedState(r.id, r.sync.state), dirty);
  }
  for (const f of FILES) {
    await repo.insertEntity("file", f.id, f as unknown as EntityData, f.sync?.state ?? "synced", []);
  }
  for (const c of SP_CONFLICTS) {
    await repo.insertConflict({
      id: c.id,
      entityType: c.entity.toLowerCase() as EntityType,
      entityId: c.entityId,
      field: c.field,
      mcVal: c.mcVal,
      spVal: c.spVal,
      by: c.by,
      note: c.note,
    });
  }
  for (const e of SP_ERRORS) {
    await repo.insertPushError({
      id: e.id,
      entityType: e.entity.toLowerCase() as EntityType,
      entityId: e.entityId,
      field: e.field,
      value: e.value,
      reason: e.reason,
    });
  }
  await repo.appendAudit(SYNC_ACTOR, "Mirror seeded from prototype fixtures — synced states reset to pending until first push.", "pending");
  return true;
}

// Idempotent seed of the canonical repo registry (EN-002 / Item 2) from the
// REPOS fixture — the single source of truth. Never disturbs an existing or
// approved row (ON CONFLICT DO NOTHING), so a fresh DB gets the 3 canonical
// repos and approvals persist across boots.
export async function ensureReposSeeded(): Promise<void> {
  await repo.seedRepos(Object.values(REPOS));
}

// Idempotent seed of the fixture buckets/initiatives (EN-005) from the BUCKETS
// fixture (the single source of truth) — a fresh DB gets the 8 initiatives and
// user-created/edited buckets persist across boots.
export async function ensureBucketsSeeded(): Promise<void> {
  await repo.seedBuckets(BUCKETS);
}

// Idempotent seed of the fixture projects (P2) — the umbrella parent above
// buckets, from the PROJECTS fixture (single source of truth).
export async function ensureProjectsSeeded(): Promise<void> {
  await repo.seedProjects(PROJECTS);
}

// ─── Outbound (push) ─────────────────────────────────────────────────────────

const PUSHABLE = ["task", "risk"] as const satisfies readonly EntityType[];

// Audit any human assigned to a person column that could not be mirrored
// (not in the dev-site User Information List) — once per push, never silently.
async function auditUnresolvedPersons(row: repo.EntityRow, resolved: ResolvedPersons | null): Promise<void> {
  if (!resolved || resolved.unresolved.length === 0) return;
  for (const { mc, actorId } of resolved.unresolved) {
    const sp = TASK_PERSON_FIELDS.find((f) => f.mc === mc)?.sp ?? mc;
    const name = ACTORS[actorId]?.name ?? actorId;
    await repo.appendAudit(
      SYNC_ACTOR,
      `${row.id} · ${sp}: ${name} is not yet in the site directory (User Information List) — person mirror skipped; other fields pushed.`,
      "pending"
    );
  }
}

// Park an entity in the error register — terminal outcome for 4xx rejections
// and for transient failures that exhausted their retry budget (TASK-622).
async function parkEntityPushError(row: repo.EntityRow, err: GraphError, reason: string): Promise<void> {
  const field = row.dirty_fields[0] ?? "—";
  await repo.insertPushError({
    id: `er-${row.id.toLowerCase()}-${Date.now()}`,
    entityType: row.entity_type,
    entityId: row.id,
    field: displayFieldFor(row.entity_type, field) ?? field,
    value: displayValue(row.data[field]),
    reason: `${reason}: ${err.body.slice(0, 160)}`,
  });
  await repo.updateEntity(row.entity_type, row.id, {
    syncState: "error",
    syncExtras: { reason },
  });
  await repo.appendAudit(SYNC_ACTOR, `Push failed for ${row.id} — queued in the error register.`, "error");
}

async function pushEntity(ctx: SiteContext, row: repo.EntityRow): Promise<"synced" | "error" | "deferred"> {
  const listKey = row.entity_type === "task" ? "todos" : "risks";
  const retryKind: PushEntityKind = row.entity_type === "task" ? "task" : "risk";
  // Resolve person columns up front (tasks only); failures degrade to skip+audit
  // and never throw, so they cannot block the rest of the push.
  const resolved =
    row.entity_type === "task"
      ? await resolveTaskPersons(ctx, row.data as unknown as Task)
      : null;
  const initiative =
    row.entity_type === "task" ? await resolveInitiativeLookupId(row.data as unknown as Task) : {};
  if (initiative.unresolvedBucket) {
    await repo.appendAudit(
      SYNC_ACTOR,
      `${row.id} · Initiative: ${initiative.unresolvedBucket} is not yet mirrored to Roadmap — Initiative lookup skipped; other fields pushed.`,
      "pending"
    );
  }
  const withLookups = <T extends object>(
    opts: T
  ): T & { persons?: ResolvedPersons["persons"]; initiativeLookupId?: number | null } => {
    const next: T & { persons?: ResolvedPersons["persons"]; initiativeLookupId?: number | null } = {
      ...opts,
    };
    if (resolved) next.persons = resolved.persons;
    if (initiative.initiativeLookupId !== undefined) next.initiativeLookupId = initiative.initiativeLookupId;
    return next;
  };
  try {
    if (row.sp_item_id) {
      const only = row.dirty_fields.length > 0 ? row.dirty_fields : undefined;
      await patchListItemFields(ctx, listKey, row.sp_item_id, outboundFields(row.entity_type, row.data, withLookups({ only })));
      await repo.updateEntity(row.entity_type, row.id, { syncState: "synced", dirtyFields: [] });
      await clearPushRetry(retryKind, row.id);
      await auditUnresolvedPersons(row, resolved);
      return "synced";
    }
    // No item yet: adopt an existing one by unique key (tasks only), else create.
    let itemId: string | null = null;
    if (row.entity_type === "task") {
      const existing = await findItemByField(ctx, "todos", "TaskID", row.id);
      if (existing) {
        itemId = existing.id;
        await patchListItemFields(ctx, listKey, itemId, outboundFields("task", row.data, withLookups({})));
      }
    }
    if (!itemId) {
      itemId = await createListItem(ctx, listKey, outboundFields(row.entity_type, row.data, withLookups({ creating: true })));
    }
    await repo.updateEntity(row.entity_type, row.id, {
      syncState: "synced",
      spItemId: itemId,
      dirtyFields: [],
      syncExtras: { sp: `${listKey === "todos" ? "ToDos" : "Risk Register"} · item ${itemId}` },
    });
    await clearPushRetry(retryKind, row.id);
    await auditUnresolvedPersons(row, resolved);
    return "synced";
  } catch (err) {
    if (err instanceof GraphError && err.status < 500 && err.status !== 429) {
      await parkEntityPushError(row, err, "SharePoint rejected the outbound write");
      await clearPushRetry(retryKind, row.id);
      return "error";
    }
    if (isTransientGraphFailure(err)) {
      // 429/5xx: defer this entity with backoff — never abort the sweep for
      // the other entities (TASK-622). Terminal after the retry budget.
      const record = await recordTransientPushFailure(retryKind, row.id, err);
      if (record.terminal) {
        await parkEntityPushError(row, err, `SharePoint unavailable after ${record.attempts} attempts`);
        return "error";
      }
      if (record.attempts === 1) {
        await repo.appendAudit(
          SYNC_ACTOR,
          `Push deferred for ${row.id} — SharePoint ${err.status}; retrying with backoff.`,
          "pending"
        );
      }
      return "deferred";
    }
    throw err;
  }
}

interface RegisterPushResult {
  pushed: number;
  deferred: number;
}

// Shared transient-failure handling for the register mirrors (TASK-622):
// defer with backoff, park as an error once the retry budget is exhausted.
async function deferRegisterPush(
  kind: PushEntityKind,
  id: string,
  err: GraphError,
  markError: () => Promise<void>,
  label: string
): Promise<"deferred" | "terminal"> {
  const record = await recordTransientPushFailure(kind, id, err);
  if (record.terminal) {
    await markError();
    await repo.appendAudit(
      SYNC_ACTOR,
      `${label} push failed for ${id} after ${record.attempts} attempts — ${err.body.slice(0, 120)}`,
      "error"
    );
    return "terminal";
  }
  if (record.attempts === 1) {
    await repo.appendAudit(
      SYNC_ACTOR,
      `${label} push deferred for ${id} — SharePoint ${err.status}; retrying with backoff.`,
      "pending"
    );
  }
  return "deferred";
}

// Push-only mirror of the repo registry to the "Repo Registry" list (Item 2).
// Mission Control is authoritative for the allow-list, so the list is never read
// back. Skips with an honest audit when the list isn't provisioned — a missing
// optional list never blocks the core task/risk sweep.
async function pushRepoRegistry(
  ctx: SiteContext,
  deferredSet: ReadonlySet<string>
): Promise<RegisterPushResult> {
  const pending = (await repo.getRepos()).filter((r) => r.syncState === "pending");
  if (pending.length === 0) return { pushed: 0, deferred: 0 };
  if (!ctx.listIds[REPO_REGISTRY_KEY]) {
    await repo.appendAudit(
      SYNC_ACTOR,
      "Repo Registry list not provisioned — registry mirror skipped (run scripts/provision-sharepoint.py).",
      "pending"
    );
    return { pushed: 0, deferred: 0 };
  }
  let pushed = 0;
  let deferred = 0;
  for (const r of pending) {
    if (deferredSet.has(pushRetryKey("repo", r.id))) {
      deferred += 1;
      continue;
    }
    try {
      if (r.spItemId) {
        await patchListItemFields(ctx, REPO_REGISTRY_KEY, r.spItemId, repoOutboundFields(r));
        await repo.setRepoSync(r.id, "synced");
      } else {
        const existing = await findItemByField(ctx, REPO_REGISTRY_KEY, "RepoID", r.id);
        const itemId = existing
          ? existing.id
          : await createListItem(ctx, REPO_REGISTRY_KEY, repoOutboundFields(r, { creating: true }));
        if (existing) await patchListItemFields(ctx, REPO_REGISTRY_KEY, itemId, repoOutboundFields(r));
        await repo.setRepoSync(r.id, "synced", itemId);
      }
      await clearPushRetry("repo", r.id);
      pushed += 1;
    } catch (err) {
      if (err instanceof GraphError && err.status < 500 && err.status !== 429) {
        await repo.setRepoSync(r.id, "error");
        await repo.appendAudit(SYNC_ACTOR, `Repo Registry push failed for ${r.id} — ${err.body.slice(0, 120)}`, "error");
        await clearPushRetry("repo", r.id);
      } else if (isTransientGraphFailure(err)) {
        const outcome = await deferRegisterPush(
          "repo",
          r.id,
          err,
          () => repo.setRepoSync(r.id, "error"),
          "Repo Registry"
        );
        if (outcome === "deferred") deferred += 1;
      } else {
        throw err;
      }
    }
  }
  return { pushed, deferred };
}

// Push-only mirror of projects to the "Projects" list (P2). Mission Control is
// authoritative; the list is never read back. Projects must land before buckets
// so Roadmap can resolve the Project lookup column.
async function pushProjectsMirror(
  ctx: SiteContext,
  deferredSet: ReadonlySet<string>
): Promise<RegisterPushResult> {
  const pending = (await repo.getProjectRows()).filter((r) => r.syncState === "pending");
  if (pending.length === 0) return { pushed: 0, deferred: 0 };
  if (!ctx.listIds[PROJECTS_KEY]) {
    await repo.appendAudit(
      SYNC_ACTOR,
      "Projects list not provisioned — projects mirror skipped (run scripts/provision-sharepoint.py).",
      "pending"
    );
    return { pushed: 0, deferred: 0 };
  }
  let pushed = 0;
  let deferred = 0;
  for (const { project, spItemId } of pending) {
    if (deferredSet.has(pushRetryKey("project", project.id))) {
      deferred += 1;
      continue;
    }
    try {
      if (spItemId) {
        await patchListItemFields(ctx, PROJECTS_KEY, spItemId, projectOutboundFields(project));
        await repo.setProjectSync(project.id, "synced", { spRef: "Projects" });
      } else {
        const existing = await findItemByField(ctx, PROJECTS_KEY, "ProjectID", project.id);
        const itemId = existing
          ? existing.id
          : await createListItem(ctx, PROJECTS_KEY, projectOutboundFields(project, { creating: true }));
        if (existing) await patchListItemFields(ctx, PROJECTS_KEY, itemId, projectOutboundFields(project));
        await repo.setProjectSync(project.id, "synced", { spItemId: itemId, spRef: "Projects" });
      }
      await clearPushRetry("project", project.id);
      pushed += 1;
    } catch (err) {
      if (err instanceof GraphError && err.status < 500 && err.status !== 429) {
        await repo.setProjectSync(project.id, "error");
        await repo.appendAudit(SYNC_ACTOR, `Projects push failed for ${project.id} — ${err.body.slice(0, 120)}`, "error");
        await clearPushRetry("project", project.id);
      } else if (isTransientGraphFailure(err)) {
        const outcome = await deferRegisterPush(
          "project",
          project.id,
          err,
          () => repo.setProjectSync(project.id, "error"),
          "Projects"
        );
        if (outcome === "deferred") deferred += 1;
      } else {
        throw err;
      }
    }
  }
  return { pushed, deferred };
}

// Push-only mirror of buckets/initiatives to the "Roadmap" list (EN-005). MC is
// authoritative; inbound Gantt edits land in a later increment.
async function pushBucketRoadmap(
  ctx: SiteContext,
  deferredSet: ReadonlySet<string>
): Promise<RegisterPushResult> {
  const pending = (await repo.getBucketRows()).filter((r) => r.syncState === "pending");
  if (pending.length === 0) return { pushed: 0, deferred: 0 };
  if (!ctx.listIds[ROADMAP_KEY]) {
    await repo.appendAudit(
      SYNC_ACTOR,
      "Roadmap list not provisioned — initiatives mirror skipped (run scripts/provision-sharepoint.py).",
      "pending"
    );
    return { pushed: 0, deferred: 0 };
  }
  const projectSpIds = new Map(
    (await repo.getProjectRows())
      .filter((r) => r.spItemId)
      .map((r) => [r.project.id, Number(r.spItemId)])
  );
  let pushed = 0;
  let deferred = 0;
  for (const { bucket, spItemId } of pending) {
    if (deferredSet.has(pushRetryKey("bucket", bucket.id))) {
      deferred += 1;
      continue;
    }
    try {
      const ownerEmail = ACTORS[bucket.owner]?.kind === "human" ? HUMANS[bucket.owner]?.email : undefined;
      const ownerLookupId = ownerEmail ? await resolveSiteUserLookupId(ctx, ownerEmail) : null;
      const projectLookupId = bucket.project ? projectSpIds.get(bucket.project) ?? null : null;
      const fields = bucketOutboundFields(bucket, { ownerLookupId, projectLookupId: projectLookupId ?? undefined });
      if (spItemId) {
        await patchListItemFields(ctx, ROADMAP_KEY, spItemId, fields);
        await repo.setBucketSync(bucket.id, "synced", { spRef: "Roadmap" });
      } else {
        const existing = await findItemByField(ctx, ROADMAP_KEY, "InitiativeID", bucket.id);
        const itemId = existing
          ? existing.id
          : await createListItem(ctx, ROADMAP_KEY, bucketOutboundFields(bucket, { creating: true, ownerLookupId, projectLookupId: projectLookupId ?? undefined }));
        if (existing) await patchListItemFields(ctx, ROADMAP_KEY, itemId, fields);
        await repo.setBucketSync(bucket.id, "synced", { spItemId: itemId, spRef: "Roadmap" });
      }
      await clearPushRetry("bucket", bucket.id);
      pushed += 1;
    } catch (err) {
      if (err instanceof GraphError && err.status < 500 && err.status !== 429) {
        await repo.setBucketSync(bucket.id, "error");
        await repo.appendAudit(SYNC_ACTOR, `Roadmap push failed for ${bucket.id} — ${err.body.slice(0, 120)}`, "error");
        await clearPushRetry("bucket", bucket.id);
      } else if (isTransientGraphFailure(err)) {
        const outcome = await deferRegisterPush(
          "bucket",
          bucket.id,
          err,
          () => repo.setBucketSync(bucket.id, "error"),
          "Roadmap"
        );
        if (outcome === "deferred") deferred += 1;
      } else {
        throw err;
      }
    }
  }
  return { pushed, deferred };
}

// ─── Inbound (delta pull) ────────────────────────────────────────────────────

const DELTA_LISTS: { listKey: string; type: EntityType }[] = [
  { listKey: "todos", type: "task" },
  { listKey: "risks", type: "risk" },
];

function attributionFromItem(item: SpListItem): {
  source: FieldAttribution["source"];
  at: string;
} {
  const n = normalizeLastModified(item);
  return {
    source: n.source,
    at: n.at ?? new Date().toISOString(),
  };
}

/** Build a minimal adopted Task from validated SharePoint fields (no fabricated owners). */
export function buildAdoptedTask(
  id: string,
  fields: Record<string, unknown>,
  opts: { bucket?: string | null; assignee?: string | null } = {}
): Task {
  const patches = inboundPatches("task", fields, { bucket: opts.bucket });
  return {
    id,
    title: String(fields.Title ?? id),
    description: typeof patches.description === "string" ? patches.description : "",
    bucket: typeof patches.bucket === "string" ? patches.bucket : opts.bucket ?? "",
    stage: (patches.stage as Task["stage"]) ?? "backlog",
    priority: (patches.priority as Task["priority"]) ?? "medium",
    assignee: opts.assignee ?? null,
    coassignees: [],
    reporter: "",
    accountableOwner: null,
    reqs: [],
    repos: [],
    estimate: "M",
    labels: [],
    prs: [],
    due: typeof patches.due === "string" ? patches.due : "—",
    sync: { state: "synced", ts: repo.stamp(), sp: "ToDos" },
    subtasks: [],
    activity: [],
    evidence: { summary: "", items: [] },
  };
}

export function buildAdoptedBucket(
  id: string,
  fields: Record<string, unknown>,
  opts: { project?: string | null } = {}
): Bucket {
  const patches = inboundBucketPatches(fields, { project: opts.project });
  return {
    id,
    name: String(fields.Title ?? id),
    owner: "", // never fabricate — leave empty until a human/resolvable owner lands
    health: patches.health ?? "track",
    target: patches.target ?? "—",
    started: patches.started ?? "—",
    desc: "",
    repos: [],
    sync: { state: "synced", ts: repo.stamp(), sp: "Roadmap" },
    prd: null,
    project: opts.project ?? null,
    progress: patches.progress,
  };
}

export function buildAdoptedProject(id: string, fields: Record<string, unknown>): Project {
  const patches = inboundProjectPatches(fields);
  return {
    id,
    name: String(fields.Title ?? id),
    owner: "",
    health: patches.health ?? "track",
    target: patches.target ?? "—",
    started: patches.started ?? "—",
    desc: typeof patches.desc === "string" ? patches.desc : "",
    repos: [],
    sync: { state: "synced", ts: repo.stamp(), sp: "Projects" },
    prd: null,
  };
}

async function matchEntity(
  type: EntityType,
  rows: repo.EntityRow[],
  item: SpListItem
): Promise<repo.EntityRow | null> {
  const bySpId = rows.find((r) => r.sp_item_id === item.id);
  if (bySpId) return bySpId;
  if (type === "task" && typeof item.fields?.TaskID === "string") {
    const byKey = rows.find((r) => r.id === item.fields?.TaskID);
    if (byKey) {
      await repo.updateEntity(type, byKey.id, { spItemId: item.id });
      return { ...byKey, sp_item_id: item.id };
    }
  }
  return null;
}

interface InboundResult {
  pulled: number;
  conflicts: number;
  skipped: number;
  adopted: number;
}

async function adoptUnknownTask(ctx: SiteContext, item: SpListItem): Promise<"adopted" | "invalid" | "skipped"> {
  if (!item.fields) return "skipped";
  const validation = validateInboundAdoptionRow("task", item.fields);
  if (!validation.ok || !validation.id) {
    await repo.appendAudit(
      SYNC_ACTOR,
      `Inbound ToDos row skipped (invalid adoption) — spItem=${item.id} errors=${validation.errors.join(",")}.`,
      "error"
    );
    return "invalid";
  }
  let bucket: string | null | undefined;
  const initRaw = item.fields.InitiativeLookupId;
  if (initRaw !== undefined && initRaw !== null && initRaw !== "") {
    const hit = await repo.getBucketBySpItemId(String(initRaw));
    bucket = hit?.bucket.id ?? undefined;
  } else if (initRaw === null || initRaw === "") {
    bucket = null;
  }
  let assignee: string | null = null;
  const rawId = item.fields.AssignedToLookupId;
  if (rawId !== undefined && rawId !== null && rawId !== "") {
    const email = await resolveEmailByLookupId(ctx, Number(rawId));
    assignee = email ? actorIdByEmail(email) : null;
  }
  const task = buildAdoptedTask(validation.id, item.fields, { bucket, assignee });
  const inserted = await repo.insertAdoptedTask(task, item.id);
  if (!inserted) return "skipped";
  await repo.appendAudit(
    SYNC_ACTOR,
    `Inbound ToDos adoption — ${task.id} imported from SharePoint (spItem=${item.id}).`,
    "synced"
  );
  return "adopted";
}

async function pullList(ctx: SiteContext, listKey: string, type: EntityType): Promise<InboundResult> {
  const stored = await repo.getDeltaLink(listKey);
  const { items, deltaLink } = await listDelta(ctx, listKey, stored);
  const result: InboundResult = { pulled: 0, conflicts: 0, skipped: 0, adopted: 0 };
  const rows = await repo.getEntities(type);

  for (const item of items) {
    if (item.deleted || !item.fields) continue; // engine never deletes (TOOLS.md guardrail)
    let row = await matchEntity(type, rows, item);
    if (!row && type === "task") {
      const outcome = await adoptUnknownTask(ctx, item);
      if (outcome === "adopted") {
        result.adopted += 1;
        row = await repo.getEntity("task", String(item.fields.TaskID));
      } else {
        result.skipped += 1;
        continue;
      }
    }
    if (!row) {
      result.skipped += 1;
      continue;
    }
    const patches = inboundPatches(type, item.fields);
    const inboundAttr = attributionFromItem(item);
    if (type === "task") {
      const rawId = item.fields.AssignedToLookupId;
      if (rawId !== undefined && rawId !== null && rawId !== "") {
        const email = await resolveEmailByLookupId(ctx, Number(rawId));
        const actorId = email ? actorIdByEmail(email) : null;
        if (actorId) patches.assignee = actorId;
      }
      const initRaw = item.fields.InitiativeLookupId;
      if (initRaw !== undefined && initRaw !== null && initRaw !== "") {
        const hit = await repo.getBucketBySpItemId(String(initRaw));
        if (hit) patches.bucket = hit.bucket.id;
      } else if (initRaw === null || initRaw === "") {
        patches.bucket = null;
      }
    }
    const { apply, conflicts, clearedDirty, attributionEvents } = reconcileInbound(
      row.data,
      row.dirty_fields,
      patches,
      {
        inboundSource: inboundAttr.source,
        inboundAt: inboundAttr.at,
        localAttribution: row.field_attribution,
        routingFields: type === "task" ? ROUTING_TASK_FIELDS : undefined,
      }
    );
    for (const ev of attributionEvents) {
      await repo.appendAudit(
        SYNC_ACTOR,
        `Human SharePoint edit beat service pending on ${row.id} · ${ev.field} (sp=${ev.inboundAt} > service=${ev.localAt}).`,
        "synced"
      );
    }
    for (const c of conflicts) {
      const display = displayFieldFor(type, c.field) ?? c.field;
      await repo.insertConflict({
        id: `cf-${row.id.toLowerCase()}-${c.field}-${Date.now()}`,
        entityType: type,
        entityId: row.id,
        field: display,
        mcVal: c.mcVal,
        spVal: c.spVal,
        by: SYNC_ACTOR,
        note: "Edited in SharePoint while Mission Control also changed it.",
      });
      await repo.updateEntity(type, row.id, {
        syncState: "conflict",
        syncExtras: { wsVal: c.mcVal, spVal: c.spVal },
      });
      await repo.appendAudit(SYNC_ACTOR, `Conflict detected on ${row.id} · ${display} (edited both sides).`, "conflict");
      result.conflicts += 1;
    }
    if (Object.keys(apply).length > 0 || clearedDirty.length > 0) {
      const nextDirty = row.dirty_fields.filter((f) => !clearedDirty.includes(f) && !(f in apply));
      const nextAttr = { ...row.field_attribution };
      for (const f of clearedDirty) delete nextAttr[f];
      for (const f of Object.keys(apply)) delete nextAttr[f];
      await repo.updateEntity(type, row.id, {
        patch: apply,
        dirtyFields: nextDirty,
        fieldAttribution: nextAttr,
      });
      if (Object.keys(apply).length > 0) {
        await repo.appendAudit(
          SYNC_ACTOR,
          `Inbound change pulled — ${row.id} ${Object.keys(apply)
            .map((f) => displayFieldFor(type, f) ?? f)
            .join(", ")} updated from SharePoint.`,
          "synced"
        );
        result.pulled += 1;
      }
    }
  }
  await repo.saveDeltaLink(listKey, deltaLink);
  await repo.markRegisterInboundComplete(listKey);
  return result;
}

// ─── Project Documents inbound (TASK-628) ────────────────────────────────────

const DOCUMENTS_DELTA_KEY = "documents";

// Inbound-only mirror of the Project Documents drive. SharePoint is
// authoritative for files; MC never pushes them. Deletions are audited and
// skipped (engine never deletes — TOOLS.md guardrail).
async function pullDocuments(ctx: SiteContext): Promise<InboundResult> {
  const result: InboundResult = { pulled: 0, conflicts: 0, skipped: 0, adopted: 0 };
  const driveId = await documentsDriveId(ctx);
  if (!driveId) {
    await repo.appendAudit(
      SYNC_ACTOR,
      "Project Documents library not provisioned — documents mirror skipped.",
      "pending"
    );
    return result;
  }
  const stored = await repo.getDeltaLink(DOCUMENTS_DELTA_KEY);
  const { items, deltaLink } = await driveDelta(driveId, stored);
  for (const raw of items) {
    const item = raw as unknown as DriveItem & { root?: object };
    if (!item?.id || item.root) continue; // malformed page rows / the drive root
    if (item.deleted) {
      await repo.appendAudit(
        SYNC_ACTOR,
        `Document removed in SharePoint — ${item.name ?? item.id}; mirror row retained (engine never deletes).`,
        "pending"
      );
      result.skipped += 1;
      continue;
    }
    const entry = fileEntryFromDriveItem(item);
    if (!entry) {
      result.skipped += 1;
      continue;
    }
    const existing = await repo.getEntity("file", entry.id);
    if (existing) {
      await repo.updateEntity("file", entry.id, {
        patch: entry as unknown as EntityData,
        syncState: "synced",
      });
    } else {
      await repo.insertEntity("file", entry.id, entry as unknown as EntityData, "synced", []);
    }
    result.pulled += 1;
  }
  if (result.pulled > 0) {
    await repo.appendAudit(
      SYNC_ACTOR,
      `Inbound documents pulled — ${result.pulled} Project Documents item${result.pulled === 1 ? "" : "s"} mirrored.`,
      "synced"
    );
  }
  await repo.saveDeltaLink(DOCUMENTS_DELTA_KEY, deltaLink);
  await repo.markRegisterInboundComplete(DOCUMENTS_DELTA_KEY);
  return result;
}

async function pullRoadmap(ctx: SiteContext): Promise<InboundResult> {
  const result: InboundResult = { pulled: 0, conflicts: 0, skipped: 0, adopted: 0 };
  if (!ctx.listIds[ROADMAP_KEY]) return result;
  const stored = await repo.getDeltaLink(ROADMAP_KEY);
  const { items, deltaLink } = await listDelta(ctx, ROADMAP_KEY, stored);
  let rows = await repo.getBucketRows();

  for (const item of items) {
    if (item.deleted || !item.fields) continue;
    let row =
      rows.find((r) => r.spItemId === item.id) ??
      (typeof item.fields.InitiativeID === "string"
        ? rows.find((r) => r.bucket.id === item.fields?.InitiativeID)
        : undefined);
    if (!row && typeof item.fields.InitiativeID === "string") {
      const byKey = rows.find((r) => r.bucket.id === item.fields?.InitiativeID);
      if (byKey) {
        await repo.updateBucket(byKey.bucket.id, { spItemId: item.id });
        row = { ...byKey, spItemId: item.id };
      }
    }
    if (!row) {
      const validation = validateInboundAdoptionRow("bucket", item.fields);
      if (!validation.ok || !validation.id) {
        await repo.appendAudit(
          SYNC_ACTOR,
          `Inbound Roadmap row skipped (invalid adoption) — spItem=${item.id} errors=${validation.errors.join(",")}.`,
          "error"
        );
        result.skipped += 1;
        continue;
      }
      let project: string | null | undefined;
      const projRaw = item.fields.ProjectLookupId;
      if (projRaw !== undefined && projRaw !== null && projRaw !== "") {
        const hit = (await repo.getProjectRows()).find((p) => p.spItemId === String(projRaw));
        project = hit?.project.id ?? undefined;
      } else if (projRaw === null || projRaw === "") {
        project = null;
      }
      const bucket = buildAdoptedBucket(validation.id, item.fields, { project });
      const inserted = await repo.insertAdoptedBucket(bucket, item.id);
      if (!inserted) {
        result.skipped += 1;
        continue;
      }
      await repo.appendAudit(
        SYNC_ACTOR,
        `Inbound Roadmap adoption — ${bucket.id} imported from SharePoint (spItem=${item.id}).`,
        "synced"
      );
      result.adopted += 1;
      rows = await repo.getBucketRows();
      row = rows.find((r) => r.bucket.id === bucket.id);
      if (!row) {
        result.skipped += 1;
        continue;
      }
    }
    let projectOpt: string | null | undefined;
    const projRaw = item.fields.ProjectLookupId;
    if (projRaw !== undefined && projRaw !== null && projRaw !== "") {
      const hit = (await repo.getProjectRows()).find((p) => p.spItemId === String(projRaw));
      if (hit) projectOpt = hit.project.id;
    } else if (projRaw === null || projRaw === "") {
      projectOpt = null;
    }
    const patches = inboundBucketPatches(item.fields, {
      project: projectOpt,
    }) as EntityData;
    const inboundAttr = attributionFromItem(item);
    const { apply, conflicts, clearedDirty, attributionEvents } = reconcileInbound(
      row.bucket as unknown as EntityData,
      row.dirtyFields,
      patches,
      {
        inboundSource: inboundAttr.source,
        inboundAt: inboundAttr.at,
        localAttribution: row.fieldAttribution ?? {},
        routingFields: ROUTING_BUCKET_FIELDS,
      }
    );
    for (const ev of attributionEvents) {
      await repo.appendAudit(
        SYNC_ACTOR,
        `Human SharePoint edit beat service pending on ${row.bucket.id} · ${ev.field} (sp=${ev.inboundAt} > service=${ev.localAt}).`,
        "synced"
      );
    }
    for (const c of conflicts) {
      await repo.insertConflict({
        id: `cf-${row.bucket.id.toLowerCase()}-${c.field}-${Date.now()}`,
        entityType: "bucket",
        entityId: row.bucket.id,
        field: displayFieldFor("bucket", c.field) ?? c.field,
        mcVal: c.mcVal,
        spVal: c.spVal,
        by: SYNC_ACTOR,
        note: "Edited in SharePoint Roadmap while Mission Control also changed it.",
      });
      await repo.updateBucket(row.bucket.id, { syncState: "conflict" });
      await repo.appendAudit(
        SYNC_ACTOR,
        `Conflict detected on ${row.bucket.id} · ${c.field} (edited both sides on Roadmap).`,
        "conflict"
      );
      result.conflicts += 1;
    }
    if (Object.keys(apply).length > 0 || clearedDirty.length > 0) {
      const nextDirty = row.dirtyFields.filter((f) => !clearedDirty.includes(f) && !(f in apply));
      const nextAttr = { ...(row.fieldAttribution ?? {}) };
      for (const f of clearedDirty) delete nextAttr[f];
      for (const f of Object.keys(apply)) delete nextAttr[f];
      await repo.updateBucket(row.bucket.id, {
        patch: apply as Partial<Bucket>,
        dirtyFields: nextDirty,
        fieldAttribution: nextAttr,
      });
      if (Object.keys(apply).length > 0) {
        await repo.appendAudit(
          SYNC_ACTOR,
          `Inbound Roadmap change pulled — ${row.bucket.id} ${Object.keys(apply).join(", ")} updated from SharePoint.`,
          "synced"
        );
        result.pulled += 1;
      }
    }
  }
  await repo.saveDeltaLink(ROADMAP_KEY, deltaLink);
  await repo.markRegisterInboundComplete(ROADMAP_KEY);
  return result;
}

async function pullProjects(ctx: SiteContext): Promise<InboundResult> {
  const result: InboundResult = { pulled: 0, conflicts: 0, skipped: 0, adopted: 0 };
  if (!ctx.listIds[PROJECTS_KEY]) return result;
  const stored = await repo.getDeltaLink(PROJECTS_KEY);
  const { items, deltaLink } = await listDelta(ctx, PROJECTS_KEY, stored);
  let rows = await repo.getProjectRows();

  for (const item of items) {
    if (item.deleted || !item.fields) continue;
    let row =
      rows.find((r) => r.spItemId === item.id) ??
      (typeof item.fields.ProjectID === "string"
        ? rows.find((r) => r.project.id === item.fields?.ProjectID)
        : undefined);
    if (!row && typeof item.fields.ProjectID === "string") {
      const byKey = rows.find((r) => r.project.id === item.fields?.ProjectID);
      if (byKey) {
        await repo.updateProject(byKey.project.id, { spItemId: item.id });
        row = { ...byKey, spItemId: item.id };
      }
    }
    if (!row) {
      const validation = validateInboundAdoptionRow("project", item.fields);
      if (!validation.ok || !validation.id) {
        await repo.appendAudit(
          SYNC_ACTOR,
          `Inbound Projects row skipped (invalid adoption) — spItem=${item.id} errors=${validation.errors.join(",")}.`,
          "error"
        );
        result.skipped += 1;
        continue;
      }
      const project = buildAdoptedProject(validation.id, item.fields);
      const inserted = await repo.insertAdoptedProject(project, item.id);
      if (!inserted) {
        result.skipped += 1;
        continue;
      }
      await repo.appendAudit(
        SYNC_ACTOR,
        `Inbound Projects adoption — ${project.id} imported from SharePoint (spItem=${item.id}).`,
        "synced"
      );
      result.adopted += 1;
      rows = await repo.getProjectRows();
      row = rows.find((r) => r.project.id === project.id);
      if (!row) {
        result.skipped += 1;
        continue;
      }
    }
    const patches = inboundProjectPatches(item.fields) as EntityData;
    const inboundAttr = attributionFromItem(item);
    const { apply, conflicts, clearedDirty, attributionEvents } = reconcileInbound(
      row.project as unknown as EntityData,
      row.dirtyFields,
      patches,
      {
        inboundSource: inboundAttr.source,
        inboundAt: inboundAttr.at,
        localAttribution: row.fieldAttribution ?? {},
        routingFields: ROUTING_PROJECT_FIELDS,
      }
    );
    for (const ev of attributionEvents) {
      await repo.appendAudit(
        SYNC_ACTOR,
        `Human SharePoint edit beat service pending on ${row.project.id} · ${ev.field} (sp=${ev.inboundAt} > service=${ev.localAt}).`,
        "synced"
      );
    }
    for (const c of conflicts) {
      await repo.insertConflict({
        id: `cf-${row.project.id.toLowerCase()}-${c.field}-${Date.now()}`,
        entityType: "project",
        entityId: row.project.id,
        field: c.field,
        mcVal: c.mcVal,
        spVal: c.spVal,
        by: SYNC_ACTOR,
        note: "Edited in SharePoint Projects while Mission Control also changed it.",
      });
      await repo.updateProject(row.project.id, { syncState: "conflict" });
      await repo.appendAudit(
        SYNC_ACTOR,
        `Conflict detected on ${row.project.id} · ${c.field} (edited both sides on Projects).`,
        "conflict"
      );
      result.conflicts += 1;
    }
    if (Object.keys(apply).length > 0 || clearedDirty.length > 0) {
      const nextDirty = row.dirtyFields.filter((f) => !clearedDirty.includes(f) && !(f in apply));
      const nextAttr = { ...(row.fieldAttribution ?? {}) };
      for (const f of clearedDirty) delete nextAttr[f];
      for (const f of Object.keys(apply)) delete nextAttr[f];
      await repo.updateProject(row.project.id, {
        patch: apply as Partial<Project>,
        dirtyFields: nextDirty,
        fieldAttribution: nextAttr,
      });
      if (Object.keys(apply).length > 0) {
        await repo.appendAudit(
          SYNC_ACTOR,
          `Inbound Projects change pulled — ${row.project.id} ${Object.keys(apply).join(", ")} updated from SharePoint.`,
          "synced"
        );
        result.pulled += 1;
      }
    }
  }
  await repo.saveDeltaLink(PROJECTS_KEY, deltaLink);
  await repo.markRegisterInboundComplete(PROJECTS_KEY);
  return result;
}

// ─── The sweep ───────────────────────────────────────────────────────────────

export interface SweepResult {
  pushed: number;
  pushErrors: number;
  /** Entities deferred to a later tick by the transient-failure backoff queue. */
  pushDeferred: number;
  pulled: number;
  conflicts: number;
  skippedInbound: number;
  adoptedInbound: number;
  counts: Record<string, repo.ListCounts>;
  lastSweep: string;
}

/**
 * Targeted inbound pull for ONE notified register (TASK-627) — the scoped
 * delta the notification queue drains, so a SharePoint edit reaches the UI in
 * seconds instead of waiting for the 5-minute sweep. Returns null for an
 * unknown list key; the caller falls back to a full sweep (recovery path).
 */
export async function runScopedListDelta(listKey: string): Promise<InboundResult | null> {
  await ensureSeeded();
  await ensureReposSeeded();
  const ctx = await siteContext();
  if (listKey === PROJECTS_KEY) return pullProjects(ctx);
  if (listKey === ROADMAP_KEY) return pullRoadmap(ctx);
  if (listKey === "todos") return pullList(ctx, "todos", "task");
  if (listKey === "risks") return pullList(ctx, "risks", "risk");
  if (listKey === DOCUMENTS_DELTA_KEY && documentsSyncEnabled()) return pullDocuments(ctx);
  return null;
}

export async function runSweep(actor: string = SYNC_ACTOR): Promise<SweepResult> {
  await ensureSeeded();
  await ensureReposSeeded();
  const ctx = await siteContext();

  // Inbound FIRST: SharePoint-side edits must be seen — and dirty-field
  // conflicts raised (§5.1) — before any outbound write. Pushing first would
  // silently overwrite the remote edit: last-write-wins, which is forbidden.
  // Projects → Roadmap → ToDos so lookups resolve on the same sweep.
  let pulled = 0;
  let conflicts = 0;
  let skippedInbound = 0;
  let adoptedInbound = 0;
  {
    const r = await pullProjects(ctx);
    pulled += r.pulled;
    conflicts += r.conflicts;
    skippedInbound += r.skipped;
    adoptedInbound += r.adopted;
  }
  {
    const r = await pullRoadmap(ctx);
    pulled += r.pulled;
    conflicts += r.conflicts;
    skippedInbound += r.skipped;
    adoptedInbound += r.adopted;
  }
  for (const { listKey, type } of DELTA_LISTS) {
    const r = await pullList(ctx, listKey, type);
    pulled += r.pulled;
    conflicts += r.conflicts;
    skippedInbound += r.skipped;
    adoptedInbound += r.adopted;
  }
  if (documentsSyncEnabled()) {
    // Optional register: a documents failure must never break the core sweep.
    try {
      const r = await pullDocuments(ctx);
      pulled += r.pulled;
      skippedInbound += r.skipped;
    } catch (err) {
      if (err instanceof GraphError) {
        await repo.appendAudit(
          SYNC_ACTOR,
          `Documents mirror failed — SharePoint ${err.status}; core sweep unaffected.`,
          "error"
        );
      } else {
        throw err;
      }
    }
  }

  // Outbound: Projects + Roadmap before tasks so InitiativeLookupId can resolve
  // on the same sweep. Conflicted entities are no longer "pending", so they are
  // held back until a human resolves them.
  let pushed = 0;
  let pushErrors = 0;
  let pushDeferred = 0;
  // Entities still inside their transient-failure backoff window are skipped
  // this tick instead of hammering a throttled/unavailable Graph (TASK-622).
  const deferredSet = await getDeferredPushSet();
  for (const register of [pushRepoRegistry, pushProjectsMirror, pushBucketRoadmap]) {
    const r = await register(ctx, deferredSet);
    pushed += r.pushed;
    pushDeferred += r.deferred;
  }
  for (const type of PUSHABLE) {
    const rows = await repo.getEntities(type);
    for (const row of rows.filter((r) => r.sync_state === "pending")) {
      if (deferredSet.has(pushRetryKey(type, row.id))) {
        pushDeferred += 1;
        continue;
      }
      const outcome = await pushEntity(ctx, row);
      if (outcome === "synced") pushed += 1;
      else if (outcome === "deferred") pushDeferred += 1;
      else pushErrors += 1;
    }
  }

  const lastSweep = repo.stamp();
  if (pushed > 0 || pulled > 0 || conflicts > 0 || pushErrors > 0 || adoptedInbound > 0) {
    await repo.appendAudit(
      actor,
      `Sweep completed — ${pushed} outbound push${pushed === 1 ? "" : "es"}, ${pulled} inbound change${pulled === 1 ? "" : "s"}${
        adoptedInbound ? `, ${adoptedInbound} adopted` : ""
      }${conflicts ? `, ${conflicts} conflict${conflicts === 1 ? "" : "s"} raised` : ""}${
        pushErrors ? `, ${pushErrors} push error${pushErrors === 1 ? "" : "s"}` : ""
      }${pushDeferred ? `, ${pushDeferred} deferred for retry` : ""}.`,
      pushErrors > 0 ? "error" : conflicts > 0 ? "conflict" : "synced"
    );
  }

  // Mirror-is-boring streak: every successful sweep is one cron tick. Fail-soft —
  // never fail the sweep if the gate table is missing or the eval throws.
  try {
    const { recordBoringTickAfterSweep } = await import("./boring-gate");
    // A tick with transient Graph failures is not "boring" — the streak resets
    // (before TASK-622 such a tick aborted and never recorded at all).
    const boring = await recordBoringTickAfterSweep({ graphOk: pushDeferred === 0 });
    console.log(
      `[sync] boring-tick ${boring.lastBoringOutcome} streak=${boring.boringTickStreak}/${boring.boringGateN} gateMet=${boring.boringGateMet}`
    );
  } catch (err) {
    console.warn(
      "[sync] boring-tick eval skipped:",
      err instanceof Error ? err.message : err
    );
  }

  return {
    pushed,
    pushErrors,
    pushDeferred,
    pulled,
    conflicts,
    skippedInbound,
    adoptedInbound,
    counts: await repo.countsByList(),
    lastSweep,
  };
}

/** Canonical routing freshness check against persisted complete-inbound stamps. */
export async function checkRoutingFreshness(now?: Date): Promise<SyncFreshnessResult> {
  return evaluateSyncFreshness({
    now,
    loadRegisterTimestamps: async () => repo.getRegisterInboundCompletions(),
  });
}

/** Session-authenticated sync.mutate gate — ignores caller-supplied actor authority. */
export async function requireSyncMutateActor(): Promise<{ oid: string; actor: PermissionActor }> {
  let session: { user?: { oid?: string | null; email?: string | null } } | null;
  try {
    session = (await auth()) as { user?: { oid?: string | null; email?: string | null } } | null;
  } catch {
    throw new ApiError("forbidden", "Authenticated session with Entra oid required for sync.mutate.", 403);
  }
  const oid = session?.user?.oid?.trim();
  if (!oid) {
    throw new ApiError("forbidden", "Authenticated session with Entra oid required for sync.mutate.", 403);
  }

  const auditLabel = session?.user?.email?.trim().toLowerCase() || oid;
  const staged = await resolveStagedHumanActor(oid);
  if (!staged.appliedActor) {
    recordUnresolvedActorDenial({
      site: "sync.mutate",
      capability: "sync.mutate",
      actorKind: "human",
      actorId: oid,
      resource: { type: "sync" },
      auditLabel,
    });
    throw new ApiError("forbidden", "No MC identity for session oid.", 403);
  }

  const decision = authorizeStaged({
    site: "sync.mutate",
    capability: "sync.mutate",
    resource: { type: "sync" },
    auditLabel,
    appliedActor: staged.appliedActor,
    shadowActor: staged.shadowActor,
    shadowMissing: staged.shadowMissing,
  });
  if (!decision.allowed) {
    throw new ApiError("forbidden", `sync.mutate denied (${decision.reasonCode}).`, 403);
  }
  return { oid, actor: staged.appliedActor };
}

/**
 * Cron / inbound service gate — durable sp_sync_inbound +
 * sync.service.write. Operator context is audit-only and never grants.
 * Enforcement-off intentionally remains DB-free.
 */
export async function requireSyncServiceWrite(
  _context: { operatorContext?: string } = {}
): Promise<PermissionActor> {
  const staged = await resolveStagedServicePrincipal(SYNC_INBOUND_SERVICE_PRINCIPAL_ID);
  if (!staged.actor) {
    recordUnresolvedActorDenial({
      site: "sync.service",
      capability: "sync.service.write",
      actorKind: "service",
      actorId: SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
      resource: { type: "sync" },
    });
    throw new ApiError(
      "forbidden",
      "Durable sp_sync_inbound service principal is missing.",
      403
    );
  }
  const decision = authorizeStaged({
    site: "sync.service",
    capability: "sync.service.write",
    resource: { type: "sync" },
    appliedActor: staged.actor,
    shadowActor: staged.shadowActor,
    shadowMissing: staged.shadowMissing,
  });
  if (!decision.allowed) {
    throw new ApiError("forbidden", `sync.service.write denied (${decision.reasonCode}).`, 403);
  }
  return staged.actor;
}

// ─── Manual reconciliation (humans decide — SOUL non-negotiable) ─────────────

// Targeted outbound push of a SINGLE MC field (conflict "keep MC" / error retry).
// For a task PERSON column the `<Column>LookupId` must be resolved first —
// otherwise the write is an empty no-op that would still let the caller mark the
// row synced (a fabricated person sync — the exact class the audit flagged).
// Returns `true` when the field was genuinely written; `false` when it is a
// person column not yet resolvable to a site user, so the caller re-queues for
// the next sweep (which resolves + audits) instead of claiming success.
async function pushSingleField(ctx: SiteContext, type: EntityType, row: repo.EntityRow, mcField: string): Promise<boolean> {
  if (!row.sp_item_id) return false;
  const listKey = type === "task" ? "todos" : "risks";
  let persons: ResolvedPersons["persons"] | undefined;
  let initiativeLookupId: number | null | undefined;
  if (type === "task") {
    persons = (await resolveTaskPersons(ctx, row.data as unknown as Task)).persons;
    const isPerson = TASK_PERSON_FIELDS.some((f) => f.mc === mcField);
    if (isPerson && persons[mcField as TaskPersonMc] === undefined) return false; // unresolved person — never fabricate
    if (mcField === "bucket") {
      const init = await resolveInitiativeLookupId(row.data as unknown as Task);
      if (init.unresolvedBucket) return false;
      initiativeLookupId = init.initiativeLookupId;
    }
  }
  await patchListItemFields(
    ctx,
    listKey,
    row.sp_item_id,
    outboundFields(type, row.data, { only: [mcField], persons, initiativeLookupId })
  );
  return true;
}

interface PlanningConflictRow {
  subject: "bucket" | "project";
  id: string;
  data: Bucket | Project;
  syncState: SyncState;
  spItemId: string | null;
  dirtyFields: string[];
  fieldAttribution: Record<string, FieldAttribution>;
}

async function loadPlanningConflictRow(
  subject: "bucket" | "project",
  id: string
): Promise<PlanningConflictRow | null> {
  if (subject === "bucket") {
    const row = (await repo.getBucketRows()).find((candidate) => candidate.bucket.id === id);
    return row
      ? {
          subject,
          id,
          data: row.bucket,
          syncState: row.syncState,
          spItemId: row.spItemId,
          dirtyFields: row.dirtyFields,
          fieldAttribution: row.fieldAttribution ?? {},
        }
      : null;
  }
  const row = (await repo.getProjectRows()).find((candidate) => candidate.project.id === id);
  return row
    ? {
        subject,
        id,
        data: row.project,
        syncState: row.syncState,
        spItemId: row.spItemId,
        dirtyFields: row.dirtyFields,
        fieldAttribution: row.fieldAttribution ?? {},
      }
    : null;
}

async function updatePlanningConflictRow(
  row: PlanningConflictRow,
  opts: {
    patch?: Partial<Bucket> | Partial<Project>;
    syncState: SyncState;
    dirtyFields: string[];
    fieldAttribution: Record<string, FieldAttribution>;
  }
): Promise<void> {
  if (row.subject === "bucket") {
    await repo.updateBucket(row.id, {
      patch: opts.patch as Partial<Bucket> | undefined,
      syncState: opts.syncState,
      dirtyFields: opts.dirtyFields,
      fieldAttribution: opts.fieldAttribution,
    });
    return;
  }
  await repo.updateProject(row.id, {
    patch: opts.patch as Partial<Project> | undefined,
    syncState: opts.syncState,
    dirtyFields: opts.dirtyFields,
    fieldAttribution: opts.fieldAttribution,
  });
}

async function pushPlanningSingleField(
  ctx: SiteContext,
  row: PlanningConflictRow,
  mcField: string
): Promise<boolean> {
  if (!row.spItemId) return false;
  const listKey = row.subject === "bucket" ? ROADMAP_KEY : PROJECTS_KEY;
  if (!ctx.listIds[listKey]) return false;

  let projectLookupId: number | null | undefined;
  if (row.subject === "bucket" && mcField === "project") {
    const projectId = (row.data as Bucket).project;
    if (projectId) {
      const project = (await repo.getProjectRows()).find(
        (candidate) => candidate.project.id === projectId
      );
      if (!project?.spItemId) return false;
      projectLookupId = Number(project.spItemId);
      if (!Number.isFinite(projectLookupId)) return false;
    } else {
      projectLookupId = null;
    }
  }
  const fields = planningOutboundField(row.subject, row.data, mcField, {
    projectLookupId,
  });
  if (!fields) return false;
  await patchListItemFields(ctx, listKey, row.spItemId, fields);
  return true;
}

export async function resolveConflict(conflictId: string, winner: "mc" | "sp", actor: string): Promise<boolean> {
  const conflict = await repo.getConflict(conflictId);
  if (!conflict) return false;
  const subject = conflict.entityType as SyncConflictSubject;
  const mcField = mcFieldFor(subject, conflict.field) ?? conflict.field;
  const entityRow =
    subject === "task" || subject === "risk" || subject === "file"
      ? await repo.getEntity(subject, conflict.entityId)
      : null;
  const planningRow =
    subject === "bucket" || subject === "project"
      ? await loadPlanningConflictRow(subject, conflict.entityId)
      : null;
  if (!entityRow && !planningRow) return false;

  const dirtyFields = entityRow?.dirty_fields ?? planningRow?.dirtyFields ?? [];
  const attribution = {
    ...(entityRow?.field_attribution ?? planningRow?.fieldAttribution ?? {}),
  };
  const remainingDirty = dirtyFields.filter((field) => field !== mcField);
  delete attribution[mcField];

  let finalState: SyncState = "synced";
  if (winner === "sp") {
    const value = parseFieldValue(subject, mcField, conflict.spVal);
    if (value === undefined) return false;
    if (entityRow) {
      await repo.updateEntity(subject as EntityType, conflict.entityId, {
        patch: { [mcField]: value },
        syncState: remainingDirty.length > 0 ? "pending" : "synced",
        dirtyFields: remainingDirty,
        fieldAttribution: attribution,
      });
    } else if (planningRow) {
      await updatePlanningConflictRow(planningRow, {
        patch: { [mcField]: value },
        syncState: remainingDirty.length > 0 ? "pending" : "synced",
        dirtyFields: remainingDirty,
        fieldAttribution: attribution,
      });
    }
  } else {
    const spItemId = entityRow?.sp_item_id ?? planningRow?.spItemId ?? null;
    const ctx = spItemId ? await siteContext() : null;
    const pushed = ctx
      ? entityRow
        ? await pushSingleField(ctx, subject as EntityType, entityRow, mcField)
        : await pushPlanningSingleField(ctx, planningRow!, mcField)
      : false;
    finalState = pushed && remainingDirty.length === 0 ? "synced" : "pending";
    if (entityRow) {
      await repo.updateEntity(subject as EntityType, conflict.entityId, {
        syncState: finalState,
        dirtyFields: remainingDirty,
        fieldAttribution: attribution,
      });
    } else if (planningRow) {
      await updatePlanningConflictRow(planningRow, {
        syncState: finalState,
        dirtyFields: remainingDirty,
        fieldAttribution: attribution,
      });
    }
    if (!pushed) {
      const unresolvedPerson =
        subject === "task" &&
        TASK_PERSON_FIELDS.some((field) => field.mc === mcField);
      await repo.appendAudit(
        actor,
        unresolvedPerson
          ? `Kept Mission Control on ${conflict.entityId} · ${conflict.field}, but its person isn't resolvable to a site user yet — re-queued for the next sweep.`
          : `Kept Mission Control on ${conflict.entityId} · ${conflict.field}, but the field could not be pushed yet — re-queued for the next sweep.`,
        "pending"
      );
    }
  }

  // Resolve only after the selected value was applied locally, pushed, or
  // durably queued on the correct subject table.
  await repo.resolveConflictRow(conflictId, winner);
  await repo.appendAudit(
    actor,
    `Resolved conflict on ${conflict.entityId} · ${conflict.field} — kept ${winner === "mc" ? "Mission Control" : "SharePoint"} ("${winner === "mc" ? conflict.mcVal : conflict.spVal}").`,
    finalState
  );
  return true;
}

export async function retryError(errorId: string, actor: string): Promise<boolean> {
  const error = await repo.getError(errorId);
  if (!error) return false;
  const type = error.entityType;
  const row = await repo.getEntity(type, error.entityId);
  if (!row) return false;

  const ctx = await siteContext();
  const listKey = type === "task" ? "todos" : "risks";
  const mcField = mcFieldFor(type, error.field) ?? error.field;
  try {
    if (row.sp_item_id) {
      const pushed = await pushSingleField(ctx, type, row, mcField);
      if (!pushed) {
        // Unresolved person column — don't claim the retry succeeded; re-queue.
        await repo.updateEntity(type, row.id, { syncState: "pending" });
        await repo.appendAudit(
          actor,
          `Retry deferred for ${error.entityId} · ${error.field} — its person isn't resolvable to a site user yet; re-queued for the next sweep.`,
          "pending"
        );
        return false;
      }
    } else {
      const persons = type === "task" ? (await resolveTaskPersons(ctx, row.data as unknown as Task)).persons : undefined;
      const itemId = await createListItem(ctx, listKey, outboundFields(type, row.data, { creating: true, persons }));
      await repo.updateEntity(type, row.id, { spItemId: itemId });
    }
  } catch (err) {
    if (err instanceof GraphError) {
      await repo.appendAudit(actor, `Retry failed for ${error.entityId} · ${error.field} — ${err.body.slice(0, 120)}`, "error");
      return false;
    }
    throw err;
  }
  await repo.resolveErrorRow(errorId);
  await repo.updateEntity(type, row.id, { syncState: "synced", dirtyFields: [] });
  await repo.appendAudit(
    actor,
    `Retried push for ${error.entityId} · ${error.field} — re-pushed and accepted.`,
    "synced"
  );
  return true;
}
