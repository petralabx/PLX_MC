// TASK-4150: when a stamped PR merges, the task records what merged before its
// checkouts are released. One transaction writes the evidence event and the
// progress note, so a release never happens without them; a webhook replay
// finds the dedup key and writes nothing twice.
import { withTransaction } from "@/lib/db";
import type { Task } from "@/lib/mc-data";
import { patchTask } from "@/lib/sync";
import { getEntity } from "@/lib/sync/repo";
import * as repo from "./repo";

export interface MergeRecord {
  taskId: string;
  /** Full owner/name slug of the merged PR's repo. */
  repo: string;
  prNumber: number;
  mergeSha: string;
  /** Checkouts this merge is about to release. */
  checkoutIds: string[];
  /** Audit actor: the checkout's runtime. */
  actor: string;
}

export function mergePrUrl(repoSlug: string, prNumber: number): string {
  return `https://github.com/${repoSlug}/pull/${prNumber}`;
}

export function mergeRollback(mergeSha: string): string {
  return `git revert -m 1 ${mergeSha}`;
}

// The usable dsp_* id never lands in a task note; the reference form does.
function checkoutRef(id: string): string {
  return id.length > 8 ? `dsp_…${id.slice(-4)}` : id;
}

export function mergeNoteBody(r: MergeRecord): string {
  return [
    `Merged: ${mergePrUrl(r.repo, r.prNumber)} at ${r.mergeSha}.`,
    `Rollback: ${mergeRollback(r.mergeSha)}`,
    `Checkouts released (reason merged): ${r.checkoutIds.map(checkoutRef).join(", ")}.`,
  ].join("\n");
}

export function mergeNoteDedupKey(r: Pick<MergeRecord, "repo" | "prNumber" | "taskId">): string {
  return `task.merge_recorded:${r.repo.toLowerCase()}:${r.prNumber}:${r.taskId}`;
}

/** Writes the merge evidence event and the progress note; false when already recorded or the task is gone. */
export async function recordMergeOnTask(r: MergeRecord): Promise<boolean> {
  const dedupKey = mergeNoteDedupKey(r);
  return withTransaction(async (q) => {
    await repo.lockDedupKeyTx(q, dedupKey);
    if (await repo.eventAgeByDedupKeyTx(q, dedupKey)) return false;
    const locked = await getEntity("task", r.taskId, q, true);
    if (!locked) return false;
    const prUrl = mergePrUrl(r.repo, r.prNumber);
    const rollback = mergeRollback(r.mergeSha);
    // Evidence first: the audited record of what merged and how to undo it.
    await repo.appendEventTx(q, {
      kind: "task.merge_recorded",
      actor: r.actor,
      repo: r.repo,
      taskId: r.taskId,
      pr: String(r.prNumber),
      payload: { mergeSha: r.mergeSha, prUrl, rollback, checkoutIds: r.checkoutIds, releaseReason: "merged" },
      dedupKey,
    });
    const note = {
      id: `merge-${r.prNumber}-${r.mergeSha.slice(0, 12)}`,
      author: "mission-control",
      body: mergeNoteBody(r),
      ts: new Date().toISOString(),
      mentions: [] as string[],
    };
    const comments = [...((locked.data as unknown as Task).comments ?? []), note];
    await patchTask(r.taskId, { comments } as Parameters<typeof patchTask>[1], "mission-control", {
      query: q,
      attribution: { source: "service", actorId: r.actor },
    });
    return true;
  });
}
