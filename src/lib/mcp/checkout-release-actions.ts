// mc_release_checkout / mc_release_checkouts (TASK-2326) — shared by
// POST /api/cursor/checkouts/release[-batch] (the stdio client's proxy target)
// and the HTTP MCP transport. A release ends a stray or expired lease on the
// dispatch ledger: it sets released_at + released_reason and appends
// checkout.released in one statement. It never touches the task (stage,
// Verified, evidence) — only the lease.
//
// AuthZ: the principal needs task.checkout (the lease capability), then one of:
//   checkout_principal — the authenticated principal is the one that checked
//                        the lease out (the checkout event's permissionActorId);
//   steward            — the authenticated principal is a Ledger/CoS steward
//                        service principal (sp_mcp_ledger, sp_mcp_cos).
// Anyone else gets 403 and a checkout.release_denied audit row with its
// reasonCode. The operator email header is caller-chosen audit context.
//
// Shadow rollout (TASK-3008 / TASK-2569): until PLX_MC_MCP_PRINCIPAL_AUTHZ is
// "enforce", the older operator rule still decides (accountable_human / admin /
// steward by operator email) so agents on the shared key keep working; the
// principal rule above is evaluated beside it and every disagreement is
// recorded as an authz.shadow_mismatch event. Enforce only after per-runtime
// keys are live and that log is clean.
//
// Open-PR guard (TASK-2965): an expired lease stays valid while an open PR
// carries its stamp (the verification-time expiry exception). A release whose
// reason says "expired" would override that exception, so the action refuses
// it with open_pr_expiry_exception and audits checkout.release_refused. Other
// reasons still release. Every release event records the caller's workerId
// (X-MC-Worker-Id, the stdio client's per-session id).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import * as complianceRepo from "@/lib/compliance/repo";
import { openPrHoldingCheckout } from "@/lib/compliance/service";
import { HUMANS } from "@/lib/mc-data/data";
import {
  COS_MCP_SERVICE_PRINCIPAL_ID,
  directoryRoleToAccessRole,
  LEDGER_MCP_SERVICE_PRINCIPAL_ID,
  POLICY_VERSION,
} from "@/lib/permissions";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";
import { recordShadowMismatch } from "@/lib/permissions/shadow-mismatch";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { mcpPrincipalAuthzMode, type McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";
import { checkoutRef } from "./read-actions";

export const RELEASE_REASON_MAX = 500;
export const RELEASE_BATCH_MAX = 50;

/** Ledger/CoS steward service principals, authenticated by their own API keys. */
export const CHECKOUT_RELEASE_STEWARDS: readonly string[] = [
  LEDGER_MCP_SERVICE_PRINCIPAL_ID,
  COS_MCP_SERVICE_PRINCIPAL_ID,
];

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

/** A release reason that claims the lease expired ("expired", "lease expired", "expiry"). */
const EXPIRED_REASON_RE = /\bexpir(?:e|ed|y)\b/i;

export function isExpiredReason(reason: string): boolean {
  return EXPIRED_REASON_RE.test(reason);
}

/** A refusal on a resolved checkout; the batch form reports its ref and task. */
export class CheckoutReleaseRefusal extends ApiError {
  constructor(
    code: string,
    message: string,
    status: number,
    readonly checkoutRef: string,
    readonly taskId: string
  ) {
    super(code, message, status);
  }
}

export type ReleaseAuthzReasonCode =
  | "checkout_principal"
  | "accountable_human"
  | "admin"
  | "steward"
  | "not_accountable";

/** Legacy operator-email steward identity (shadow period only, TASK-3008). */
const OPERATOR_RELEASE_STEWARDS: readonly string[] = ["cos@petrasoap.com"];

/**
 * The pre-TASK-3008 rule, keyed on the caller-chosen operator email. It still
 * decides while PLX_MC_MCP_PRINCIPAL_AUTHZ is "shadow" so nothing locks up
 * before per-runtime keys are live; remove it at cutover.
 */
export function authorizeCheckoutReleaseByOperator(
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
  if (OPERATOR_RELEASE_STEWARDS.includes(operator)) return { allowed: true, reasonCode: "steward" };
  return { allowed: false, reasonCode: "not_accountable" };
}

/**
 * Who may release this lease (pure). `principalId` is the authenticated
 * service principal; `checkoutPrincipalId` is the principal that minted the
 * lease (null when the checkout recorded none).
 */
export function authorizeCheckoutRelease(
  principalId: string,
  checkoutPrincipalId: string | null
): { allowed: boolean; reasonCode: ReleaseAuthzReasonCode } {
  if (CHECKOUT_RELEASE_STEWARDS.includes(principalId)) return { allowed: true, reasonCode: "steward" };
  if (principalId && principalId === checkoutPrincipalId) {
    return { allowed: true, reasonCode: "checkout_principal" };
  }
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
  const workerId = identity.workerId || "unknown-worker";
  const refuse = (code: string, message: string, status: number) =>
    new CheckoutReleaseRefusal(code, message, status, ref, dispatch.taskId);

  const byPrincipal = authorizeCheckoutRelease(
    identity.actor.id,
    await complianceRepo.getDispatchCheckoutPrincipal(dispatch.id)
  );
  const byOperator = authorizeCheckoutReleaseByOperator(identity.operatorEmail, dispatch);
  const mode = mcpPrincipalAuthzMode();
  const authz = mode === "enforce" ? byPrincipal : byOperator;
  const shadow = mode === "enforce" ? byOperator : byPrincipal;
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
    shadowAllowed: shadow.allowed,
    shadowReasonCode: shadow.reasonCode,
    auditLabel: identity.operatorEmail,
  });
  if (byPrincipal.allowed !== byOperator.allowed) {
    await recordShadowMismatch({
      site: "mcp.release-checkout",
      mode,
      actor,
      repo: dispatch.repo,
      taskId: dispatch.taskId,
      servicePrincipalId: identity.servicePrincipalId,
      workerId,
      operatorAllowed: byOperator.allowed,
      operatorReasonCode: byOperator.reasonCode,
      principalAllowed: byPrincipal.allowed,
      principalReasonCode: byPrincipal.reasonCode,
      checkoutRef: ref,
    });
  }
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
        workerId,
      },
    });
    throw refuse(
      "forbidden",
      mode === "enforce"
        ? `mc_release_checkout denied (${authz.reasonCode}): only the principal that checked it out or a Ledger/CoS steward principal may release it.`
        : `mc_release_checkout denied (${authz.reasonCode}): only the checkout's accountable human, an admin, or a Ledger/CoS steward may release it.`,
      403
    );
  }

  if (dispatch.revoked) {
    throw refuse("checkout_revoked", `${ref} is revoked; there is no lease to release.`, 409);
  }
  const alreadyReleased = () => refuse("already_released", `${ref} is already released; nothing changed.`, 409);
  if (dispatch.releasedAt) throw alreadyReleased();

  if (isExpiredReason(reason)) {
    let prNumber: number | null;
    try {
      prNumber = await openPrHoldingCheckout(dispatch);
    } catch (err) {
      // Fail closed: without proof that no open PR holds the stamp, keep the lease.
      console.error("[mcp] open-PR check for %s failed:", ref, err);
      throw refuse(
        "open_pr_check_unavailable",
        `${ref} was not released: MC could not read its PRs on GitHub to rule out an open PR. Retry later.`,
        503
      );
    }
    if (prNumber !== null) {
      await complianceRepo.appendEvent({
        kind: "checkout.release_refused",
        actor,
        repo: dispatch.repo,
        taskId: dispatch.taskId,
        pr: String(prNumber),
        payload: {
          checkoutRef: ref,
          reason,
          code: "open_pr_expiry_exception",
          servicePrincipalId: identity.servicePrincipalId,
          workerId,
        },
      });
      throw refuse(
        "open_pr_expiry_exception",
        `${ref} is stamped on open PR #${prNumber} in ${dispatch.repo}, so the open-PR expiry exception keeps it valid. It cannot be released as expired. Merging or closing the PR releases it.`,
        409
      );
    }
  }

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
      workerId,
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

/** One item the batch did not release, named by checkout and task where known. */
export interface ReleaseRefusedItem {
  index: number;
  checkoutRef: string | null;
  taskId: string | null;
  code: string;
  reason: string;
}

/** Batch form: every item runs on its own and reports its own outcome. */
export async function actionReleaseCheckouts(
  identity: McpIdentity,
  input: z.infer<typeof releaseCheckoutsSchema>
) {
  requireMcpActor(identity, "task.checkout");
  const results: ReleaseItemOutcome[] = [];
  const refused: ReleaseRefusedItem[] = [];
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
      const named = err instanceof CheckoutReleaseRefusal ? err : null;
      refused.push({
        index,
        checkoutRef: named?.checkoutRef ?? item.checkoutRef ?? null,
        taskId: named?.taskId ?? item.taskId ?? null,
        code: error.code,
        reason: error.message,
      });
    }
  }
  const released = results.filter((r) => r.ok).length;
  return { results, released, failed: results.length - released, refused };
}

const RELEASE_DESCRIPTION =
  "Release a stray or expired checkout lease (sets releasedAt/releasedReason, audits checkout.released). Target the full checkoutId, or the redacted checkoutRef (dsp_…last4) plus taskId. Only the service principal that checked it out, or a Ledger/CoS steward principal (sp_mcp_ledger, sp_mcp_cos), may release; during the shadow rollout the checkout's accountable human, an admin, or the CoS operator is still accepted. Refuses an already-released lease, and refuses an expired-lease reason (open_pr_expiry_exception) while an open PR carries the stamp. Never changes the task stage or Verified.";

export function registerCheckoutReleaseTools(server: McpServer, identity: McpIdentity): void {
  server.tool("mc_release_checkout", RELEASE_DESCRIPTION, releaseCheckoutSchema.shape, async (args) =>
    mcpJsonResult({ data: await actionReleaseCheckout(identity, args) })
  );

  server.tool(
    "mc_release_checkouts",
    `Batch form of mc_release_checkout (max ${RELEASE_BATCH_MAX} items). Each item is released on its own and reports ok + data or ok:false + error; refused[] names each unreleased item by checkoutRef, taskId, code and reason.`,
    releaseCheckoutsSchema.shape,
    async (args) => mcpJsonResult({ data: await actionReleaseCheckouts(identity, args) })
  );
}
