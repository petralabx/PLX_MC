// SharePoint sync status for MCP responses (two-way mirror invariant).

import { publicMcBaseUrl, type McpSyncMeta } from "./envelope";
import * as syncRepo from "@/lib/sync/repo";

export async function syncMetaForTask(taskId: string): Promise<McpSyncMeta | undefined> {
  const row = await syncRepo.getEntity("task", taskId);
  if (!row) return undefined;
  const state = row.sync_state;
  if (state === "conflict") {
    const conflicts = await syncRepo.openConflicts();
    const hit = conflicts.find((c) => c.entityId === taskId);
    return {
      status: "conflict",
      conflictId: hit?.id,
      link: hit ? `${publicMcBaseUrl()}/conflicts/${encodeURIComponent(hit.id)}` : `${publicMcBaseUrl()}/conflicts`,
    };
  }
  if (state === "pending") return { status: "queued" };
  if (state === "synced") return { status: "synced" };
  return { status: "pushed" };
}
