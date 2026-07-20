/**
 * Stdio MCP registration for routing mutation tools (confirm/attach/create).
 * Suggestion tools remain in routing-suggest-tools.ts.
 */

import { z } from "zod";

type PrintResult = (result: unknown) => {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type DisabledTool = (name: string) => {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

type McFetch = (
  path: string,
  init?: { method?: string; body?: unknown }
) => Promise<unknown>;

type ToolServer = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: (...args: any[]) => unknown;
};

const trustEnum = z
  .enum([
    "credentialed_checkout",
    "persisted_decision",
    "author_declaration",
    "routing_correlation",
    "fuzzy",
    "none",
  ])
  .optional();

export function registerRoutingMutationTools(opts: {
  server: ToolServer;
  mcpEnabled: boolean;
  mcFetch: McFetch;
  printResult: PrintResult;
  disabledTool: DisabledTool;
}): void {
  const { server, mcpEnabled, mcFetch, printResult, disabledTool } = opts;

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
      authorizationTrust: trustEnum,
      overrideReason: z.string().optional(),
    },
    async (args: Record<string, unknown>) => {
      if (!mcpEnabled) return disabledTool("mc_confirm_existing");
      return printResult(
        await mcFetch("/routing/confirm", { method: "POST", body: args })
      );
    }
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
      authorizationTrust: trustEnum,
    },
    async (args: Record<string, unknown>) => {
      if (!mcpEnabled) return disabledTool("mc_attach_checkout");
      return printResult(
        await mcFetch("/routing/attach", { method: "POST", body: args })
      );
    }
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
      authorizationTrust: trustEnum,
    },
    async (args: Record<string, unknown>) => {
      if (!mcpEnabled) return disabledTool("mc_create_routed_task");
      return printResult(
        await mcFetch("/routing/create-task", { method: "POST", body: args })
      );
    }
  );
}
