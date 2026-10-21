// mc_record_checkout_head (TASK-3410) — shared by POST /api/cursor/checkout/head
// and the HTTP MCP transport. The launcher that took a checkout records each head
// it pushes, so the gate can hold the PR head to the checkout's SHA chain.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { boundPr } from "@/lib/compliance/lease-chain";
import * as complianceRepo from "@/lib/compliance/repo";
import { recordCheckoutHead } from "@/lib/compliance/service";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";
import { checkoutRef } from "./read-actions";

const fullSha = z.string().trim().regex(/^[0-9a-fA-F]{40}$/, "must be a full 40-character commit SHA");

export const recordCheckoutHeadSchema = z
  .object({
    checkoutId: z.string().trim().regex(/^dsp_[A-Za-z0-9]+$/, "must be a full dsp_* checkout id"),
    headSha: fullSha,
    beforeSha: fullSha.optional(),
    pr: z.number().int().positive().optional(),
  })
  .strict();

export type RecordCheckoutHeadActionInput = z.infer<typeof recordCheckoutHeadSchema>;

export async function actionRecordCheckoutHead(identity: McpIdentity, input: RecordCheckoutHeadActionInput) {
  requireMcpActor(identity, "task.checkout");
  // Same restricted-project guard as every other MCP task write, before the write.
  const existing = await complianceRepo.getDispatch(input.checkoutId);
  if (existing) await assertTaskProjectAccess(existing.taskId, aclPrincipalFromMcp(identity));
  const { dispatch, recorded, chain } = await recordCheckoutHead({
    checkoutId: input.checkoutId,
    headSha: input.headSha,
    beforeSha: input.beforeSha ?? null,
    prNumber: input.pr ?? null,
    principalId: identity.actor.id,
  });
  return {
    checkoutRef: checkoutRef(dispatch.id),
    taskId: dispatch.taskId,
    recorded,
    baseSha: dispatch.baseSha ?? null,
    launchRecorded: !!dispatch.launchId,
    boundPr: boundPr(chain),
    chain: chain.map((h) => ({ headSha: h.headSha, source: h.source, pr: h.pr, recordedAt: h.recordedAt })),
    link: taskLink(dispatch.taskId),
  };
}

export function registerCheckoutHeadTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_record_checkout_head",
    "Record a head you pushed on your own checkout's SHA chain (TASK-3410): checkoutId (full dsp_*), headSha, optional beforeSha and pr. Only the principal that took the checkout may record. The compliance gate holds a launcher checkout's PR head to this chain; a rebase or force-push needs this call. Idempotent per head.",
    recordCheckoutHeadSchema.shape,
    async (args) =>
      mcpJsonResult({ data: await actionRecordCheckoutHead(identity, recordCheckoutHeadSchema.parse(args)) })
  );
}
