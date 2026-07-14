/**
 * Stdio MCP registration for routing suggestion tools.
 * Mutation tools (confirm/attach/create) register separately in P8 via
 * routing-mutation-tools.ts — keep this module suggestion-only.
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

/** Minimal tool-host surface — avoids coupling to MCP SDK generics. */
type ToolServer = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: (...args: any[]) => unknown;
};

/**
 * Register suggestion-only routing tools on a stdio MCP server.
 * Does not create/link Tasks — proxies to /api/cursor/routing/suggest.
 */
export function registerRoutingSuggestTools(opts: {
  server: ToolServer;
  mcpEnabled: boolean;
  mcFetch: McFetch;
  printResult: PrintResult;
  disabledTool: DisabledTool;
}): void {
  const { server, mcpEnabled, mcFetch, printResult, disabledTool } = opts;

  server.tool(
    "mc_suggest_work",
    "Suggest existing MC Tasks for current work. Returns routingSessionId + candidates without creating or linking Tasks.",
    {
      title: z.string().optional(),
      branch: z.string().optional(),
      baseBranch: z.string().optional(),
      sourceBranch: z.string().optional(),
      headSha: z.string().optional(),
      body: z.string().optional(),
      changedPaths: z.array(z.string()).optional(),
      labels: z.array(z.string()).optional(),
      routingSessionId: z.string().optional(),
      detailLimit: z.number().int().min(1).max(10).optional(),
    },
    async (args: Record<string, unknown>) => {
      if (!mcpEnabled) return disabledTool("mc_suggest_work");
      return printResult(
        await mcFetch("/routing/suggest", { method: "POST", body: args })
      );
    }
  );
}

/**
 * Modular routing tool registration seam for the stdio client.
 * P5: suggestions only. P8 will call registerRoutingMutationTools here.
 */
export function registerRoutingTools(opts: {
  server: ToolServer;
  mcpEnabled: boolean;
  mcFetch: McFetch;
  printResult: PrintResult;
  disabledTool: DisabledTool;
}): void {
  registerRoutingSuggestTools(opts);
  // P8: registerRoutingMutationTools(opts);
}
