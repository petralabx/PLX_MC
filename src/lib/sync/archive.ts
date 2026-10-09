// Retirement keeps hierarchy and tasks intact. Data + per-container events
// commit together; the existing mirrors push the queued Archived flag.
import { ApiError } from "@/lib/api/route";
import { withTransaction } from "@/lib/db";
import { appendEventTx } from "@/lib/compliance/repo";
import { TERMINAL_STAGES } from "@/lib/mc-data/policy";
import { isArchived } from "@/lib/mc-data/helpers";
import { getBuckets, getProjects } from "./repo";

export interface ArchiveInput {
  entityType: "project" | "bucket";
  id: string;
  action: "archive" | "unarchive";
  reason: string;
  force?: boolean;
  actor: string;
  repo?: string;
}

export async function archiveContainer(input: ArchiveInput) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 2000) throw new ApiError("invalid_request", "Archive/unarchive requires a reason (1–2000 characters).", 400);
  return withTransaction(async (q) => {
    // Serialize hierarchy changes and task writes while checking the open-work
    // guard and applying a cascade. No task is written by retirement.
    await q("LOCK TABLE projects, buckets, entities IN SHARE ROW EXCLUSIVE MODE");
    const projects = await getProjects(q);
    const buckets = await getBuckets(q);
    const container = input.entityType === "project"
      ? projects.find((p) => p.id === input.id)
      : buckets.find((b) => b.id === input.id);
    if (!container) throw new ApiError("not_found", `unknown ${input.entityType} ${input.id}`, 404);
    const ownBuckets = input.entityType === "project" ? buckets.filter((b) => b.project === input.id) : buckets.filter((b) => b.id === input.id);
    if (input.entityType === "bucket" && input.action === "unarchive" && isArchived(projects.find((p) => p.id === ownBuckets[0].project))) {
      throw new ApiError("project_archived", "Unarchive the parent project first.", 409);
    }
    if (input.action === "archive" && !input.force) {
      const open = await q<{ id: string }>(
        "SELECT id FROM entities WHERE entity_type = 'task' AND data->>'bucket' = ANY($1::text[]) AND NOT (COALESCE(data->>'stage', '') = ANY($2::text[])) LIMIT 1",
        [ownBuckets.map((b) => b.id), TERMINAL_STAGES]
      );
      if (open.length) throw new ApiError("open_tasks", "Container has non-terminal tasks; archive requires force=true and a reason.", 409);
    }
    const archived = input.action === "archive";
    const patch = { archivedAt: archived ? new Date().toISOString() : null, archivedBy: archived ? input.actor : null, archiveReason: archived ? reason : null };
    const targets = [
      ...(input.entityType === "project" ? [{ type: "project" as const, id: input.id }] : []),
      ...ownBuckets.map((b) => ({ type: "bucket" as const, id: b.id })),
    ];
    for (const target of targets) {
      const table = target.type === "project" ? "projects" : "buckets";
      await q(`UPDATE ${table} SET data = data || $2::jsonb, sync_state = 'pending', updated_at = now() WHERE id = $1`, [target.id, JSON.stringify(patch)]);
      await appendEventTx(q, {
        kind: `${target.type}.${archived ? "archived" : "unarchived"}`,
        actor: input.actor,
        repo: input.repo,
        payload: { [`${target.type}Id`]: target.id, reason, force: input.force ?? false, ...(input.entityType === "project" && target.type === "bucket" ? { projectId: input.id, cascade: true } : {}) },
      });
    }
    return { id: input.id, action: input.action, affected: targets, ...patch };
  });
}
