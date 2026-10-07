// Cancel / reopen entry points shared by mc_report_progress and mc_update_task
// (TASK-2529). The data rules and the single transaction live in
// lib/sync/cancel.ts; this file adds who may close or reopen a task, the input
// schemas, and the MCP identity -> audit context mapping.
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import * as complianceRepo from "@/lib/compliance/repo";
import { HUMANS } from "@/lib/mc-data/data";
import type { StageKey, Task } from "@/lib/mc-data/types";
import { directoryRoleToAccessRole, POLICY_VERSION } from "@/lib/permissions";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";
import type { CancelContext } from "@/lib/sync/cancel";
import type { McpIdentity } from "./auth";
import { CHECKOUT_RELEASE_STEWARDS } from "./checkout-release-actions";

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

export type CloseAuthzReason = "accountable_owner" | "admin" | "steward" | "not_authorized";

/** Who may cancel or reopen a task: its accountable owner, an admin, or a Ledger/CoS steward. */
export function authorizeTaskClose(
  operatorEmail: string,
  task: Pick<Task, "accountableOwner">
): { allowed: boolean; reasonCode: CloseAuthzReason } {
  const operator = operatorEmail.trim().toLowerCase();
  const ownerEmail = task.accountableOwner ? HUMANS[task.accountableOwner]?.email : undefined;
  if (operator && ownerEmail && operator === ownerEmail.toLowerCase()) {
    return { allowed: true, reasonCode: "accountable_owner" };
  }
  const human = Object.values(HUMANS).find((h) => (h.email ?? "").toLowerCase() === operator);
  const role = human ? directoryRoleToAccessRole(human.role) : null;
  if (role === "owner" || role === "admin") return { allowed: true, reasonCode: "admin" };
  if (CHECKOUT_RELEASE_STEWARDS.includes(operator)) return { allowed: true, reasonCode: "steward" };
  return { allowed: false, reasonCode: "not_authorized" };
}

/** Records the decision (and a denial event) and throws 403 unless the operator may cancel/reopen. */
export async function assertMayCloseOrReopen(
  identity: McpIdentity,
  task: Pick<Task, "id" | "accountableOwner">,
  action: "cancel" | "reopen"
): Promise<void> {
  const authz = authorizeTaskClose(identity.operatorEmail, task);
  void recordPermissionDecision({
    site: "mcp.task-cancel",
    actorKind: identity.actor.kind,
    actorId: identity.actor.id,
    capability: "task.progress",
    resourceType: "task",
    resourceId: task.id,
    allowed: authz.allowed,
    reasonCode: authz.reasonCode,
    policyVersion: POLICY_VERSION,
    auditLabel: identity.operatorEmail,
  });
  if (authz.allowed) return;
  await complianceRepo.appendEvent({
    kind: `task.${action}_denied`,
    actor: `${identity.runtime}:${identity.operatorEmail}`,
    repo: identity.repo,
    taskId: task.id,
    payload: { reasonCode: authz.reasonCode, servicePrincipalId: identity.servicePrincipalId },
  });
  throw new ApiError(
    "forbidden",
    `${action} denied (${authz.reasonCode}): only the task's accountable owner, an admin, or a Ledger/CoS steward may ${action} ${task.id}.`,
    403
  );
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
