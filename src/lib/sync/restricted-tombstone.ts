// Graph tombstone for restrict-after-push mirror rows (TASK-1534). Marking a
// previously shared project restricted stops later pushes but leaves the
// Projects/Roadmap/ToDos items it already mirrored. This step deletes exactly
// those items by their recorded spItemId — one Graph DELETE per known id,
// children before the project. Never by query, never a SQL DELETE: local rows
// stay, only the SharePoint link is cleared. Gated by
// PLX_MC_SP_RESTRICTED_TOMBSTONE (default OFF; off = log what would be deleted).

import { restrictedBucketIds, restrictedProjectIds } from "@/lib/permissions/project-acl";
import type { Task } from "@/lib/mc-data/types";
import { restrictedTombstoneEnabled } from "@/lib/secrets";
import { deleteListItem, GraphError, PROJECTS_KEY, ROADMAP_KEY, type SiteContext } from "./graph";
import {
  clearPushRetry,
  getDeferredPushSet,
  isTransientGraphFailure,
  pushRetryKey,
  recordTransientPushFailure,
  type PushEntityKind,
} from "./push-queue";
import * as repo from "./repo";

interface Target {
  kind: PushEntityKind;
  id: string;
  listKey: string;
  spItemId: string;
  clear: () => Promise<void>;
}

export interface TombstoneResult {
  deleted: number;
  deferred: number;
  wouldDelete: number;
}

export async function tombstoneRestrictedMirrors(ctx: SiteContext, actor: string): Promise<TombstoneResult> {
  const projectRows = await repo.getProjectRows();
  const hiddenProjects = restrictedProjectIds(projectRows.map((r) => r.project));
  if (hiddenProjects.size === 0) return { deleted: 0, deferred: 0, wouldDelete: 0 };
  const bucketRows = await repo.getBucketRows();
  const hiddenBuckets = restrictedBucketIds(bucketRows.map((r) => r.bucket), hiddenProjects);

  // Only rows of a restricted project that carry a recorded spItemId.
  const targets: Target[] = [];
  for (const row of await repo.getEntities("task")) {
    if (!row.sp_item_id || !hiddenBuckets.has(String((row.data as unknown as Task).bucket ?? ""))) continue;
    targets.push({
      kind: "task",
      id: row.id,
      listKey: "todos",
      spItemId: row.sp_item_id,
      clear: () => repo.updateEntity("task", row.id, { clearSpItemId: true }),
    });
  }
  for (const { bucket, spItemId } of bucketRows) {
    if (!spItemId || !hiddenBuckets.has(bucket.id)) continue;
    targets.push({
      kind: "bucket",
      id: bucket.id,
      listKey: ROADMAP_KEY,
      spItemId,
      clear: () => repo.updateBucket(bucket.id, { spItemId: null }),
    });
  }
  for (const { project, spItemId } of projectRows) {
    if (!spItemId || !hiddenProjects.has(project.id)) continue;
    targets.push({
      kind: "project",
      id: project.id,
      listKey: PROJECTS_KEY,
      spItemId,
      clear: () => repo.updateProject(project.id, { spItemId: null }),
    });
  }
  if (targets.length === 0) return { deleted: 0, deferred: 0, wouldDelete: 0 };

  if (!restrictedTombstoneEnabled()) {
    for (const t of targets) {
      console.log(
        `[sync] restricted tombstone gate OFF — would delete ${t.listKey} item ${t.spItemId} for ${t.kind} ${t.id}`
      );
    }
    return { deleted: 0, deferred: 0, wouldDelete: targets.length };
  }

  const deferredSet = await getDeferredPushSet();
  let deleted = 0;
  let deferred = 0;
  for (const t of targets) {
    if (deferredSet.has(pushRetryKey(t.kind, t.id))) {
      deferred += 1;
      continue;
    }
    try {
      const outcome = await deleteListItem(ctx, t.listKey, t.spItemId);
      await t.clear();
      await clearPushRetry(t.kind, t.id);
      await repo.appendAudit(
        actor,
        `Tombstoned ${t.listKey} item ${t.spItemId} for ${t.kind} ${t.id} — project is restricted${
          outcome === "already_gone" ? " (already deleted in SharePoint)" : ""
        }.`,
        "synced"
      );
      deleted += 1;
    } catch (err) {
      if (isTransientGraphFailure(err)) {
        // 429/5xx: link stays, so the next due sweep retries with backoff.
        const record = await recordTransientPushFailure(t.kind, t.id, err);
        if (record.terminal) {
          await repo.appendAudit(
            actor,
            `Tombstone of ${t.listKey} item ${t.spItemId} for ${t.kind} ${t.id} failed after ${record.attempts} attempts — ${err.body.slice(0, 120)}`,
            "error"
          );
        } else {
          deferred += 1;
        }
      } else if (err instanceof GraphError) {
        await repo.appendAudit(
          actor,
          `Tombstone of ${t.listKey} item ${t.spItemId} for ${t.kind} ${t.id} rejected — SharePoint ${err.status}.`,
          "error"
        );
      } else {
        throw err;
      }
    }
  }
  return { deleted, deferred, wouldDelete: 0 };
}
