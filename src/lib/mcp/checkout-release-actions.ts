// mc_release_checkout / mc_release_checkouts (TASK-2326) — shared by
// POST /api/cursor/checkouts/release[-batch] (the stdio client's proxy target)
// and the HTTP MCP transport. A release ends a stray or expired lease on the
// dispatch ledger: it sets released_at + released_reason and appends
// checkout.released in one statement. It never touches the task (stage,
// Verified, evidence) — only the lease.
//
// AuthZ: the principal needs task.checkout (the lease capability), then one of:
//   accountable_human — the operator is the lease's accountable human;
//   admin             — the operator is an owner/admin in the PLX directory;
//   steward           — the operator is a Ledger/CoS steward identity.
// Anyone else gets 403 and a checkout.release_denied audit row with its
// reasonCode. The operator email is the same admitted context checkout()
// recorded as accountable_human, so this rule trusts nothing new.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import * as complianceRepo from "@/lib/compliance/repo";
import { HUMANS } from "@/lib/mc-data/data";
import { directoryRoleToAccessRole, POLICY_VERSION } from "@/lib/permissions";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";
import { checkoutRef } from "./read-actions";

export const RELEASE_REASON_MAX = 500;
export const RELEASE_BATCH_MAX = 50;

/**
 * Ledger/CoS steward identities. Ledger and CoS run as fleet agents under the
 * cos@ operator identity; MC has no separate Ledger or CoS service principal.
 */
export const CHECKOUT_RELEASE_STEWARDS: readonly string[] = ["cos@petrasoap.com"];

// Full id: dsp_ + base36 (genId). Ref: dsp_…last4, as mc_list_checkouts and
// mc_get_task print it; three ASCII dots are accepted for plain keyboards.
const FULL_CHECKOUT_ID_RE = /^dsp_[A-Za-z0-9]+$/;
const CHECKOUT_REF_RE = /^dsp_(?:…|\.\.\.)([A-Za-z0-9]{4})$/;

export const releaseCheckoutSchema = z.object({
  checkoutId: z.string().trim().min(1).optional().describe("Full dsp_* checkout id"),
  checkoutRef: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Redacted ref dsp_…last4 from mc_list_checkouts / mc_get_task; needs taskId"),
  taskId: z.string().trim().min(1).optional().describe("TASK-* id; required with checkoutRef"),
  reason: z.string().trim().min(1).max(RELEASE_REASON_MAX),
});

export type ReleaseCheckoutInput = z.infer<typeof releaseCheckoutSchema>;

export const releaseCheckoutsSchema = z.object({
  items: z.array(releaseCheckoutSchema).min(1).max(RELEASE_BATCH_MAX),
});

export type ReleaseAuthzReasonCode = "accountable_human" | "admin" | "steward" | "not_accountable";

/** Who may release this lease (pure; the operator email is already allowlisted). */
export function authorizeCheckoutRelease(
  operatorEmail: string,
  dispatch: Pick<complianceRepo.DispatchRow, "accountableHuman">
): { allowed: boolean; reasonCode: ReleaseAuthzReasonCode } {
  const operator = operatorEmail.trim().toLowerCase();
  if (operator && operator === dispatch.accountableHuman.trim().toLowerCase()) {
    return { allowed: true, reasonCode: "accountable_human" };
  }
  const human = Object.values(HUMANS).find((h) => (h.email ?? "").toLowerCase() === operator);
  const role = human ? directoryRoleToAccessRole(human.role) : null;
  if (role === "owner" || role === "admin") return { allowed: true, reasonCode: "admin" };
  if (CHECKOUT_RELEASE_STEWARDS.includes(operator)) return { allowed: true, reasonCode: "steward" };
  return { allowed: false, reasonCode: "not_accountable" };
}

async function resolveTarget(input: ReleaseCheckoutInput): Promise<complianceRepo.DispatchRow> {
  const taskId = input.taskId?.trim() || undefined;
  if (input.checkoutId && input.checkoutRef) {
    throw new ApiError("invalid_request", "Pass checkoutId or checkoutRef, not both.", 400);
  }
  if (input.checkoutId) {
    if (!FULL_CHECKOUT_ID_RE.test(input.checkoutId)) {
      throw new ApiError(
        "invalid_request",
        "checkoutId must be a full dsp_* id. Pass a redacted dsp_…last4 as checkoutRef with taskId.",
        400
      );
    }
    const dispatch = await complianceRepo.getDispatch(input.checkoutId);
    if (!dispatch || (taskId && dispatch.taskId !== taskId)) {
      throw new ApiError("not_found", "Unknown checkout.", 404);
    }
    return dispatch;
  }
  if (!input.checkoutRef) {
    throw new ApiError("invalid_request", "checkoutId or checkoutRef is required.", 400);
  }
  const match = CHECKOUT_REF_RE.exec(input.checkoutRef);
  if (!match) {
    throw new ApiError("invalid_request", "checkoutRef must look like dsp_…last4.", 400);
  }
  if (!taskId) {
    throw new ApiError("invalid_request", "taskId is required with checkoutRef.", 400);
  }
  const rows = await complianceRepo.findDispatchesBySuffix(taskId, match[1]);
  if (rows.length === 0) {
    throw new ApiError("not_found", `No checkout ${input.checkoutRef} on ${taskId}.`, 404);
  }
  if (rows.length > 1) {
    throw new ApiError(
      "ambiguous_checkout_ref",
      `${input.checkoutRef} matches ${rows.length} checkouts on ${taskId}. Pass the full checkoutId.`,
      409
    );
  }
  return rows[0];
}

export async function actionReleaseCheckout(identity: McpIdentity, input: ReleaseCheckoutInput) {
  requireMcpActor(identity, "task.checkout");
  const reason = input.reason.trim();
  if (!reason) throw new ApiError("invalid_request", "reason is required.", 400);
  const dispatch = await resolveTarget(input);
  const ref = checkoutRef(dispatch.id);
  // Same restricted-project guard as every other MCP task write.
  await assertTaskProjectAccess(dispatch.taskId, aclPrincipalFromMcp(identity));
  const actor = `${identity.runtime}:${identity.operatorEmail}`;

  const authz = authorizeCheckoutRelease(identity.operatorEmail, dispatch);
  void recordPermissionDecision({
    site: "mcp.release-checkout",
    actorKind: identity.actor.kind,
    actorId: identity.actor.id,
    capability: "task.checkout",
    resourceType: "task",
    resourceId: dispatch.taskId,
    allowed: authz.allowed,
    reasonCode: authz.reasonCode,
    policyVersion: POLICY_VERSION,
    auditLabel: identity.operatorEmail,
  });
  if (!authz.allowed) {
    await complianceRepo.appendEvent({
      kind: "checkout.release_denied",
      actor,
      repo: dispatch.repo,
      taskId: dispatch.taskId,
      payload: {
        checkoutRef: ref,
        reason,
        reasonCode: authz.reasonCode,
        servicePrincipalId: identity.servicePrincipalId,
      },
    });
    throw new ApiError(
      "forbidden",
      `mc_release_checkout denied (${authz.reasonCode}): only the checkout's accountable human, an admin, or a Ledger/CoS steward may release it.`,
      403
    );
  }

  if (dispatch.revoked) {
    throw new ApiError("checkout_revoked", `${ref} is revoked; there is no lease to release.`, 409);
  }
  const alreadyReleased = () =>
    new ApiError("already_released", `${ref} is already released; nothing changed.`, 409);
  if (dispatch.releasedAt) throw alreadyReleased();

  const releasedReason = `manual: ${reason}`;
  const released = await complianceRepo.releaseDispatchManually({
    id: dispatch.id,
    releasedReason,
    actor,
    payload: {
      checkoutId: dispatch.id,
      checkoutRef: ref,
      reason,
      reasonCode: authz.reasonCode,
      servicePrincipalId: identity.servicePrincipalId,
      wasExpired: new Date(dispatch.expiresAt).getTime() <= Date.now(),
    },
  });
  // A concurrent release or revoke won the race between the read and the write.
  if (!released) throw alreadyReleased();

  return {
    taskId: dispatch.taskId,
    checkoutRef: ref,
    repo: dispatch.repo,
    runtime: dispatch.runtime,
    releasedAt: released.releasedAt,
    releasedReason,
    authz: authz.reasonCode,
    eventSeq: released.eventSeq,
    link: taskLink(dispatch.taskId),
  };
}

export type ReleaseItemOutcome =
  | { index: number; ok: true; data: Awaited<ReturnType<typeof actionReleaseCheckout>> }
  | { index: number; ok: false; error: { code: string; message: string } };

/** Batch form: every item runs on its own and reports its own outcome. */
export async function actionReleaseCheckouts(
  identity: McpIdentity,
  input: z.infer<typeof releaseCheckoutsSchema>
) {
  requireMcpActor(identity, "task.checkout");
  const results: ReleaseItemOutcome[] = [];
  for (const [index, item] of input.items.entries()) {
    try {
      results.push({ index, ok: true, data: await actionReleaseCheckout(identity, item) });
    } catch (err) {
      if (!(err instanceof ApiError)) {
        console.error("[mcp] mc_release_checkouts item %d failed:", index, err);
      }
      const error =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: "internal", message: "Internal error." };
      results.push({ index, ok: false, error });
    }
  }
  const released = results.filter((r) => r.ok).length;
  return { results, released, failed: results.length - released };
}

const RELEASE_DESCRIPTION =
  "Release a stray or expired checkout lease (sets releasedAt/releasedReason, audits checkout.released). Target the full checkoutId, or the redacted checkoutRef (dsp_…last4) plus taskId. Only the checkout's accountable human, an admin, or a Ledger/CoS steward may release. Refuses an already-released lease. Never changes the task stage or Verified.";

export function registerCheckoutReleaseTools(server: McpServer, identity: McpIdentity): void {
  server.tool("mc_release_checkout", RELEASE_DESCRIPTION, releaseCheckoutSchema.shape, async (args) =>
    mcpJsonResult({ data: await actionReleaseCheckout(identity, args) })
  );

  server.tool(
    "mc_release_checkouts",
    `Batch form of mc_release_checkout (max ${RELEASE_BATCH_MAX} items). Each item is released on its own and reports ok + data or ok:false + error.`,
    releaseCheckoutsSchema.shape,
    async (args) => mcpJsonResult({ data: await actionReleaseCheckouts(identity, args) })
  );
}
