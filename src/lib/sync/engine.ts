// The sync engine (SHAREPOINT_INTEGRATION.md §5–6): outbound push of pending
// MC mutations, inbound Graph delta poll, two-sided conflict detection with
// MANUAL resolution only, push-error queue, and an audit row for every
// reconciliation. Runs inside the Next.js server process (scheduler.ts) until
// webhooks force a public deploy.
//
// Scope of this increment: ToDos + Risk Register lists, including the ToDos
// person columns (Assigned To ↔, Accountable Owner →, Reporter →) resolved to
// site-user lookup ids. Documents (driveItem content) and the Initiative lookup
// column land with a later increment (see docs/modules/sync/README.md).

import { ACTORS, BUCKETS, FILES, PROJECTS, REPOS, RISKS, SP_CONFLICTS, SP_ERRORS, TASKS } from "@/lib/mc-data/data";
import type { SyncState, Task } from "@/lib/mc-data/types";
import {
  createListItem,
  findItemByField,
  GraphError,
  listDelta,
  patchListItemFields,
  REPO_REGISTRY_KEY,
  resolveEmailByLookupId,
  resolveSiteUserLookupId,
  siteContext,
  type SiteContext,
} from "./graph";
import {
  actorIdByEmail,
  displayFieldFor,
  displayValue,
  inboundPatches,
  mcFieldFor,
  outboundFields,
  parseFieldValue,
  planTaskPersons,
  reconcileInbound,
  repoOutboundFields,
  TASK_PERSON_FIELDS,
  type EntityData,
  type EntityType,
  type TaskPersonMc,
} from "./mapping";
import * as repo from "./repo";

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

const PUSHABLE: EntityType[] = ["task", "risk"];

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

async function pushEntity(ctx: SiteContext, row: repo.EntityRow): Promise<"synced" | "error"> {
  const listKey = row.entity_type === "task" ? "todos" : "risks";
  // Resolve person columns up front (tasks only); failures degrade to skip+audit
  // and never throw, so they cannot block the rest of the push.
  const resolved =
    row.entity_type === "task"
      ? await resolveTaskPersons(ctx, row.data as unknown as Task)
      : null;
  const withPersons = <T extends object>(opts: T): T & { persons?: ResolvedPersons["persons"] } =>
    resolved ? { ...opts, persons: resolved.persons } : opts;
  try {
    if (row.sp_item_id) {
      const only = row.dirty_fields.length > 0 ? row.dirty_fields : undefined;
      await patchListItemFields(ctx, listKey, row.sp_item_id, outboundFields(row.entity_type, row.data, withPersons({ only })));
      await repo.updateEntity(row.entity_type, row.id, { syncState: "synced", dirtyFields: [] });
      await auditUnresolvedPersons(row, resolved);
      return "synced";
    }
    // No item yet: adopt an existing one by unique key (tasks only), else create.
    let itemId: string | null = null;
    if (row.entity_type === "task") {
      const existing = await findItemByField(ctx, "todos", "TaskID", row.id);
      if (existing) {
        itemId = existing.id;
        await patchListItemFields(ctx, listKey, itemId, outboundFields("task", row.data, withPersons({})));
      }
    }
    if (!itemId) {
      itemId = await createListItem(ctx, listKey, outboundFields(row.entity_type, row.data, withPersons({ creating: true })));
    }
    await repo.updateEntity(row.entity_type, row.id, {
      syncState: "synced",
      spItemId: itemId,
      dirtyFields: [],
      syncExtras: { sp: `${listKey === "todos" ? "ToDos" : "Risk Register"} · item ${itemId}` },
    });
    await auditUnresolvedPersons(row, resolved);
    return "synced";
  } catch (err) {
    if (err instanceof GraphError && err.status < 500) {
      const field = row.dirty_fields[0] ?? "—";
      await repo.insertPushError({
        id: `er-${row.id.toLowerCase()}-${Date.now()}`,
        entityType: row.entity_type,
        entityId: row.id,
        field: displayFieldFor(row.entity_type, field) ?? field,
        value: displayValue(row.data[field]),
        reason: `SharePoint rejected the write: ${err.body.slice(0, 160)}`,
      });
      await repo.updateEntity(row.entity_type, row.id, {
        syncState: "error",
        syncExtras: { reason: "SharePoint rejected the outbound write" },
      });
      await repo.appendAudit(SYNC_ACTOR, `Push failed for ${row.id} — queued in the error register.`, "error");
      return "error";
    }
    throw err;
  }
}

// Push-only mirror of the repo registry to the "Repo Registry" list (Item 2).
// Mission Control is authoritative for the allow-list, so the list is never read
// back. Skips with an honest audit when the list isn't provisioned — a missing
// optional list never blocks the core task/risk sweep.
async function pushRepoRegistry(ctx: SiteContext): Promise<number> {
  const pending = (await repo.getRepos()).filter((r) => r.syncState === "pending");
  if (pending.length === 0) return 0;
  if (!ctx.listIds[REPO_REGISTRY_KEY]) {
    await repo.appendAudit(
      SYNC_ACTOR,
      "Repo Registry list not provisioned — registry mirror skipped (run scripts/provision-sharepoint.py).",
      "pending"
    );
    return 0;
  }
  let pushed = 0;
  for (const r of pending) {
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
      pushed += 1;
    } catch (err) {
      if (err instanceof GraphError && err.status < 500) {
        await repo.setRepoSync(r.id, "error");
        await repo.appendAudit(SYNC_ACTOR, `Repo Registry push failed for ${r.id} — ${err.body.slice(0, 120)}`, "error");
      } else {
        throw err;
      }
    }
  }
  return pushed;
}

// ─── Inbound (delta pull) ────────────────────────────────────────────────────

const DELTA_LISTS: { listKey: string; type: EntityType }[] = [
  { listKey: "todos", type: "task" },
  { listKey: "risks", type: "risk" },
];

async function matchEntity(
  type: EntityType,
  rows: repo.EntityRow[],
  item: { id: string; fields?: Record<string, unknown> }
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
}

async function pullList(ctx: SiteContext, listKey: string, type: EntityType): Promise<InboundResult> {
  const stored = await repo.getDeltaLink(listKey);
  const { items, deltaLink } = await listDelta(ctx, listKey, stored);
  const result: InboundResult = { pulled: 0, conflicts: 0, skipped: 0 };
  const rows = await repo.getEntities(type);

  for (const item of items) {
    if (item.deleted || !item.fields) continue; // engine never deletes (TOOLS.md guardrail)
    const row = await matchEntity(type, rows, item);
    if (!row) {
      result.skipped += 1;
      continue;
    }
    const patches = inboundPatches(type, item.fields);
    // Assigned To is two-way: resolve the inbound site-user lookup id back to an
    // MC actor before reconciliation, so a SharePoint reassignment pulls in (and
    // a both-sides edit raises a conflict, never an overwrite). Owner + Reporter
    // are push-only and are never read back.
    if (type === "task") {
      const rawId = item.fields.AssignedToLookupId;
      if (rawId !== undefined && rawId !== null && rawId !== "") {
        const email = await resolveEmailByLookupId(ctx, Number(rawId));
        const actorId = email ? actorIdByEmail(email) : null;
        if (actorId) patches.assignee = actorId;
      }
    }
    const { apply, conflicts } = reconcileInbound(row.data, row.dirty_fields, patches);
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
    if (Object.keys(apply).length > 0) {
      await repo.updateEntity(type, row.id, { patch: apply });
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
  await repo.saveDeltaLink(listKey, deltaLink);
  return result;
}

// ─── The sweep ───────────────────────────────────────────────────────────────

export interface SweepResult {
  pushed: number;
  pushErrors: number;
  pulled: number;
  conflicts: number;
  skippedInbound: number;
  counts: Record<string, repo.ListCounts>;
  lastSweep: string;
}

export async function runSweep(actor: string = SYNC_ACTOR): Promise<SweepResult> {
  await ensureSeeded();
  await ensureReposSeeded();
  const ctx = await siteContext();

  // Inbound FIRST: SharePoint-side edits must be seen — and dirty-field
  // conflicts raised (§5.1) — before any outbound write. Pushing first would
  // silently overwrite the remote edit: last-write-wins, which is forbidden.
  let pulled = 0;
  let conflicts = 0;
  let skippedInbound = 0;
  for (const { listKey, type } of DELTA_LISTS) {
    const r = await pullList(ctx, listKey, type);
    pulled += r.pulled;
    conflicts += r.conflicts;
    skippedInbound += r.skipped;
  }

  // Outbound: conflicted entities are no longer "pending", so they are held
  // back until a human resolves them.
  let pushed = 0;
  let pushErrors = 0;
  for (const type of PUSHABLE) {
    const rows = await repo.getEntities(type);
    for (const row of rows.filter((r) => r.sync_state === "pending")) {
      const outcome = await pushEntity(ctx, row);
      if (outcome === "synced") pushed += 1;
      else pushErrors += 1;
    }
  }
  // Push-only repo-registry mirror (Item 2) — counted with the outbound pushes.
  pushed += await pushRepoRegistry(ctx);

  const lastSweep = repo.stamp();
  // Only audit a sweep that actually changed something. Under the scheduled
  // 5-min cron the common case is a no-op sweep (0 pushed / 0 pulled); writing a
  // "0 outbound, 0 inbound" row every cadence would flood sync_audit_log. The
  // "last sync" heartbeat is tracked separately via delta_links.updated_at
  // (re-stamped on every sweep — see repo.lastSweepAt), so the UI indicator
  // still advances even when a sweep records nothing.
  if (pushed > 0 || pulled > 0 || conflicts > 0 || pushErrors > 0) {
    await repo.appendAudit(
      actor,
      `Sweep completed — ${pushed} outbound push${pushed === 1 ? "" : "es"}, ${pulled} inbound change${pulled === 1 ? "" : "s"}${
        conflicts ? `, ${conflicts} conflict${conflicts === 1 ? "" : "s"} raised` : ""
      }${pushErrors ? `, ${pushErrors} push error${pushErrors === 1 ? "" : "s"}` : ""}.`,
      pushErrors > 0 ? "error" : conflicts > 0 ? "conflict" : "synced"
    );
  }

  return { pushed, pushErrors, pulled, conflicts, skippedInbound, counts: await repo.countsByList(), lastSweep };
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
  if (type === "task") {
    persons = (await resolveTaskPersons(ctx, row.data as unknown as Task)).persons;
    const isPerson = TASK_PERSON_FIELDS.some((f) => f.mc === mcField);
    if (isPerson && persons[mcField as TaskPersonMc] === undefined) return false; // unresolved person — never fabricate
  }
  await patchListItemFields(ctx, listKey, row.sp_item_id, outboundFields(type, row.data, { only: [mcField], persons }));
  return true;
}

export async function resolveConflict(conflictId: string, winner: "mc" | "sp", actor: string): Promise<boolean> {
  const conflict = await repo.getConflict(conflictId);
  if (!conflict) return false;
  const type = conflict.entityType;
  const mcField = mcFieldFor(type, conflict.field) ?? conflict.field;
  const row = await repo.getEntity(type, conflict.entityId);

  if (row && winner === "sp") {
    const value = parseFieldValue(type, mcField, conflict.spVal);
    await repo.updateEntity(type, conflict.entityId, {
      patch: value !== undefined ? { [mcField]: value } : {},
      syncState: "synced",
    });
  } else if (row && winner === "mc") {
    // Push MC's value to the loser. No item yet (or an unresolved person column)
    // → re-queue for the next sweep rather than claim a sync that didn't happen.
    const ctx = row.sp_item_id ? await siteContext() : null;
    const pushed = ctx ? await pushSingleField(ctx, type, row, mcField) : false;
    if (pushed) {
      await repo.updateEntity(type, conflict.entityId, { syncState: "synced", dirtyFields: [] });
    } else {
      await repo.updateEntity(type, conflict.entityId, { syncState: "pending" });
      if (row.sp_item_id) {
        await repo.appendAudit(
          actor,
          `Kept Mission Control on ${conflict.entityId} · ${conflict.field}, but its person isn't resolvable to a site user yet — re-queued for the next sweep.`,
          "pending"
        );
      }
    }
  }

  await repo.resolveConflictRow(conflictId, winner);
  await repo.appendAudit(
    actor,
    `Resolved conflict on ${conflict.entityId} · ${conflict.field} — kept ${winner === "mc" ? "Mission Control" : "SharePoint"} ("${winner === "mc" ? conflict.mcVal : conflict.spVal}").`,
    "synced"
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
