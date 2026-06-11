// The sync engine (SHAREPOINT_INTEGRATION.md §5–6): outbound push of pending
// MC mutations, inbound Graph delta poll, two-sided conflict detection with
// MANUAL resolution only, push-error queue, and an audit row for every
// reconciliation. Runs inside the Next.js server process (scheduler.ts) until
// webhooks force a public deploy.
//
// Scope of this increment: ToDos + Risk Register lists. Documents (driveItem
// content), person columns, and lookup columns land with the directory /
// notification increment (see docs/modules/sync/README.md).

import { FILES, RISKS, SP_CONFLICTS, SP_ERRORS, TASKS } from "@/lib/mc-data/data";
import type { SyncState } from "@/lib/mc-data/types";
import {
  createListItem,
  findItemByField,
  GraphError,
  listDelta,
  patchListItemFields,
  siteContext,
  type SiteContext,
} from "./graph";
import {
  displayFieldFor,
  displayValue,
  inboundPatches,
  mcFieldFor,
  outboundFields,
  parseFieldValue,
  reconcileInbound,
  type EntityData,
  type EntityType,
} from "./mapping";
import * as repo from "./repo";

const SYNC_ACTOR = "scribe"; // the ops agent persona attributed to engine sweeps

// ─── Seed bootstrap ──────────────────────────────────────────────────────────

// First run against an empty mirror: load the prototype fixtures. Entities
// the fixtures call "synced" are seeded as PENDING — nothing has actually
// been pushed to the dev site yet, and claiming sync without evidence is
// exactly what this engine exists to prevent. Conflict/error fixtures keep
// their states so the review queues are exercised end-to-end. Files keep
// fixture states (documents sync is a later increment).
export async function ensureSeeded(): Promise<boolean> {
  if ((await repo.entityCount()) > 0) return false;

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

// ─── Outbound (push) ─────────────────────────────────────────────────────────

const PUSHABLE: EntityType[] = ["task", "risk"];

async function pushEntity(ctx: SiteContext, row: repo.EntityRow): Promise<"synced" | "error"> {
  const listKey = row.entity_type === "task" ? "todos" : "risks";
  try {
    if (row.sp_item_id) {
      const only = row.dirty_fields.length > 0 ? row.dirty_fields : undefined;
      await patchListItemFields(ctx, listKey, row.sp_item_id, outboundFields(row.entity_type, row.data, { only }));
      await repo.updateEntity(row.entity_type, row.id, { syncState: "synced", dirtyFields: [] });
      return "synced";
    }
    // No item yet: adopt an existing one by unique key (tasks only), else create.
    let itemId: string | null = null;
    if (row.entity_type === "task") {
      const existing = await findItemByField(ctx, "todos", "TaskID", row.id);
      if (existing) {
        itemId = existing.id;
        await patchListItemFields(ctx, listKey, itemId, outboundFields("task", row.data));
      }
    }
    if (!itemId) {
      itemId = await createListItem(ctx, listKey, outboundFields(row.entity_type, row.data, { creating: true }));
    }
    await repo.updateEntity(row.entity_type, row.id, {
      syncState: "synced",
      spItemId: itemId,
      dirtyFields: [],
      syncExtras: { sp: `${listKey === "todos" ? "ToDos" : "Risk Register"} · item ${itemId}` },
    });
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
    const { apply, conflicts } = reconcileInbound(row.data, row.dirty_fields, inboundPatches(type, item.fields));
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

  const lastSweep = repo.stamp();
  await repo.appendAudit(
    actor,
    `Sweep completed — ${pushed} outbound push${pushed === 1 ? "" : "es"}, ${pulled} inbound change${pulled === 1 ? "" : "s"}${
      conflicts ? `, ${conflicts} conflict${conflicts === 1 ? "" : "s"} raised` : ""
    }${pushErrors ? `, ${pushErrors} push error${pushErrors === 1 ? "" : "s"}` : ""}.`,
    pushErrors > 0 ? "error" : conflicts > 0 ? "conflict" : "synced"
  );

  return { pushed, pushErrors, pulled, conflicts, skippedInbound, counts: await repo.countsByList(), lastSweep };
}

// ─── Manual reconciliation (humans decide — SOUL non-negotiable) ─────────────

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
    // Push MC's value to the loser. No item yet → it goes out with the next sweep.
    if (row.sp_item_id) {
      const ctx = await siteContext();
      const listKey = type === "task" ? "todos" : "risks";
      await patchListItemFields(ctx, listKey, row.sp_item_id, outboundFields(type, row.data, { only: [mcField] }));
      await repo.updateEntity(type, conflict.entityId, { syncState: "synced", dirtyFields: [] });
    } else {
      await repo.updateEntity(type, conflict.entityId, { syncState: "pending" });
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
      // The mapping layer normalizes on the way out (§5.2) — the retry succeeds.
      await patchListItemFields(ctx, listKey, row.sp_item_id, outboundFields(type, row.data, { only: [mcField] }));
    } else {
      const itemId = await createListItem(ctx, listKey, outboundFields(type, row.data, { creating: true }));
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
    `Retried push for ${error.entityId} · ${error.field} — value normalized ("${error.value}" → "${displayValue(outboundFields(type, row.data, { only: [mcField] })[error.field])}") and accepted.`,
    "synced"
  );
  return true;
}
