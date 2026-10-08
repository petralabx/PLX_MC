// Cancel / reopen entry points shared by mc_report_progress and mc_update_task
// (TASK-2529). The data rules and the single transaction live in
// lib/sync/cancel.ts; this file adds the capability check for closing or reopening a task, the input
// schemas, and the MCP identity -> audit context mapping.
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import * as complianceRepo from "@/lib/compliance/repo";
import type { StageKey, Task } from "@/lib/mc-data/types";
import type { Capability } from "@/lib/permissions/types";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import type { CancelContext } from "@/lib/sync/cancel";
import type { McpIdentity } from "./auth";

export const cancelPatchSchema = z.object({
  reason: z.string().trim().min(1).describe("duplicate | obsolete | superseded | delivered_without_pr"),
  replacedBy: z.string().trim().nullable().optional().describe("TASK-n; required for duplicate and superseded"),
  note: z.string().trim().max(2000).optional(),
}).strict();

const REOPEN_STAGES = ["backlog", "specced", "approved", "planned", "progress", "qa", "review"] as const satisfies readonly StageKey[];

export const reopenPatchSchema = z.object({
  stage: z.enum(REOPEN_STAGES).optional().describe("non-terminal stage; default is the stage before the cancel"),
  note: z.string().trim().max(2000).optional(),
}).strict();

const CLOSE_CAPABILITY = { cancel: "task.cancel", reopen: "task.reopen" } as const satisfies Record<"cancel" | "reopen", Capability>;

/**
 * Cancel needs `task.cancel` and reopen `task.reopen`, evaluated on the
 * authenticated service principal (reviewed registry, src/lib/permissions/grants.ts).
 * The caller-supplied operator email is audit context only and grants nothing.
 * A denial is also recorded as `task.cancel_denied` / `task.reopen_denied`.
 */
export async function assertMayCloseOrReopen(
  identity: McpIdentity,
  task: Pick<Task, "id">,
  action: "cancel" | "reopen"
): Promise<void> {
  const capability = CLOSE_CAPABILITY[action];
  try {
    requireMcpActor(identity, capability, { type: "task", id: task.id });
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "forbidden") throw err;
    await complianceRepo.appendEvent({
      kind: `task.${action}_denied`,
      actor: `${identity.runtime}:${identity.operatorEmail}`,
      repo: identity.repo,
      taskId: task.id,
      payload: { capability, servicePrincipalId: identity.servicePrincipalId },
    });
    throw new ApiError("forbidden", `${action} denied: ${err.message} Only a principal granted ${capability} may ${action} ${task.id}.`, 403);
  }
}

export function cancelContextFor(identity: McpIdentity, actorId: string): CancelContext {
  return {
    actor: identity.operatorEmail,
    actorId,
    eventActor: `${identity.runtime}:${identity.operatorEmail}`,
    eventRepo: identity.repo,
    attribution: { source: "service", actorId },
    eventExtra: { servicePrincipalId: identity.servicePrincipalId, workerId: identity.workerId },
  };
}
