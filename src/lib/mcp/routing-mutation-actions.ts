// MCP routing mutation actions — confirm / attach / create-task.
// Authorize durable MCP service principal; operator email is audit only.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpIdentity } from "./auth";
import { taskLink } from "./envelope";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import {
  attachCheckoutLink,
  confirmExistingTask,
  createConfirmedTask,
} from "@/lib/routing/service";
import { syncMetaForTask } from "./sync-meta";

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export async function actionConfirmExisting(
  identity: McpIdentity,
  input: {
    proposalId: string;
    taskId: string;
    revisionId?: string;
    linkType?: "related" | "delivery";
    headSha?: string;
    mergeSha?: string;
    authorizationTrust?:
      | "credentialed_checkout"
      | "persisted_decision"
      | "author_declaration"
      | "routing_correlation"
      | "fuzzy"
      | "none";
    overrideReason?: string;
  }
) {
  const authorized = requireMcpActor(identity, "routing.resolve", {
    type: "routing",
    id: input.proposalId,
  });
  const result = await confirmExistingTask(authorized, {
    proposalId: input.proposalId,
    taskId: input.taskId,
    revisionId: input.revisionId,
    linkType: input.linkType,
    headSha: input.headSha,
    mergeSha: input.mergeSha,
    authorizationTrust: input.authorizationTrust,
    overrideReason: input.overrideReason,
  });
  return {
    ...result,
    link: taskLink(result.taskId),
    sync: await syncMetaForTask(result.taskId),
  };
}

export async function actionAttachCheckout(
  identity: McpIdentity,
  input: {
    proposalId: string;
    taskId: string;
    checkoutId: string;
    revisionId?: string;
    headSha?: string;
    authorizationTrust?:
      | "credentialed_checkout"
      | "persisted_decision"
      | "author_declaration"
      | "routing_correlation"
      | "fuzzy"
      | "none";
  }
) {
  const authorized = requireMcpActor(identity, "routing.resolve", {
    type: "routing",
    id: input.proposalId,
  });
  const result = await attachCheckoutLink(authorized, {
    proposalId: input.proposalId,
    taskId: input.taskId,
    checkoutId: input.checkoutId,
    revisionId: input.revisionId,
    headSha: input.headSha,
    authorizationTrust: input.authorizationTrust ?? "credentialed_checkout",
  });
  return {
    ...result,
    link: taskLink(result.taskId),
    sync: await syncMetaForTask(result.taskId),
  };
}

export async function actionCreateRoutedTask(
  identity: McpIdentity,
  input: {
    proposalId: string;
    bucketId: string;
    title: string;
    description?: string;
    repos?: string[];
    accountableOwnerId: string;
    revisionId?: string;
    headSha?: string;
    mergeSha?: string;
    labels?: string[];
    priority?: "urgent" | "high" | "medium" | "low";
    authorizationTrust?:
      | "credentialed_checkout"
      | "persisted_decision"
      | "author_declaration"
      | "routing_correlation"
      | "fuzzy"
      | "none";
  }
) {
  const authorized = requireMcpActor(identity, "routing.resolve", {
    type: "routing",
    id: input.proposalId,
  });
  const result = await createConfirmedTask(authorized, {
    proposalId: input.proposalId,
    bucketId: input.bucketId,
    title: input.title,
    description: input.description,
    repos: input.repos,
    accountableOwnerId: input.accountableOwnerId,
    revisionId: input.revisionId,
    headSha: input.headSha,
    mergeSha: input.mergeSha,
    labels: input.labels,
    priority: input.priority,
    authorizationTrust: input.authorizationTrust,
  });
  return {
    ...result,
    link: taskLink(result.taskId),
    sync: await syncMetaForTask(result.taskId),
  };
}

/** HTTP MCP registration for confirmed routing mutations (P8). */
export function registerRoutingMutationTools(
  server: McpServer,
  identity: McpIdentity
): void {
  server.tool(
    "mc_confirm_existing",
    "Confirm an existing MC Task for a routing proposal (typed related/delivery link).",
    {
      proposalId: z.string().min(1),
      taskId: z.string().min(1),
      revisionId: z.string().optional(),
      linkType: z.enum(["related", "delivery"]).optional(),
      headSha: z.string().optional(),
      mergeSha: z.string().optional(),
      authorizationTrust: z
        .enum([
          "credentialed_checkout",
          "persisted_decision",
          "author_declaration",
          "routing_correlation",
          "fuzzy",
          "none",
        ])
        .optional(),
      overrideReason: z.string().optional(),
    },
    async (args) => jsonResult(await actionConfirmExisting(identity, args))
  );

  server.tool(
    "mc_attach_checkout",
    "Attach a credentialed checkout (dsp_*) to a routing proposal and Task.",
    {
      proposalId: z.string().min(1),
      taskId: z.string().min(1),
      checkoutId: z.string().min(1),
      revisionId: z.string().optional(),
      headSha: z.string().optional(),
      authorizationTrust: z
        .enum([
          "credentialed_checkout",
          "persisted_decision",
          "author_declaration",
          "routing_correlation",
          "fuzzy",
          "none",
        ])
        .optional(),
    },
    async (args) => jsonResult(await actionAttachCheckout(identity, args))
  );

  server.tool(
    "mc_create_routed_task",
    "Create a Task after explicit routing confirmation (idempotent creation intent).",
    {
      proposalId: z.string().min(1),
      bucketId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      repos: z
        .array(z.string())
        .optional()
        .describe(
          "MC registry ids only (e.g. portal-web, plx-mc). Not MC_REPO / GitHub slugs."
        ),
      accountableOwnerId: z.string().min(1),
      revisionId: z.string().optional(),
      headSha: z.string().optional(),
      mergeSha: z.string().optional(),
      labels: z.array(z.string()).optional(),
      priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
      authorizationTrust: z
        .enum([
          "credentialed_checkout",
          "persisted_decision",
          "author_declaration",
          "routing_correlation",
          "fuzzy",
          "none",
        ])
        .optional(),
    },
    async (args) => jsonResult(await actionCreateRoutedTask(identity, args))
  );
}
