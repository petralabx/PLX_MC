// Builds the in-process PLX-MC MCP server (HTTP transport + shared tool logic).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpIdentity } from "./auth";
import {
  actionCheckout,
  actionComplete,
  actionCreateTask,
  actionGetContext,
  actionProgress,
  actionSearchTasks,
  actionSelfCheck,
} from "./actions";
import { taskLink } from "./envelope";

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export function createPlxMcMcpServer(identity: McpIdentity): McpServer {
  const server = new McpServer(
    {
      name: "PLX-MC",
      version: "1.0.0",
    },
    {
      instructions:
        "PLX Mission Control MCP — task lifecycle (checkout/progress/complete), search, and optional swarm delegation. " +
        "Always mc_checkout_task before agent work; append MC-Checkout stamp lines to PR bodies.",
    }
  );

  server.tool("mc_self_check", "Validate MCP auth and PLX MC reachability.", {}, async () =>
    jsonResult(await actionSelfCheck(identity))
  );

  server.tool(
    "mc_get_context",
    "Compact or full task/bucket context from Mission Control.",
    { depth: z.enum(["compact", "full"]).optional(), bucket: z.string().optional() },
    async ({ depth, bucket }) => {
      const data = await actionGetContext(depth ?? "compact");
      if (bucket && depth !== "full" && "topTasks" in data && data.topTasks) {
        return jsonResult({ ...data, topTasks: data.topTasks.filter((t) => t.bucket === bucket) });
      }
      return jsonResult(data);
    }
  );

  server.tool(
    "mc_search_tasks",
    "Search/list tasks by query, bucket, or stage.",
    {
      q: z.string().optional(),
      bucket: z.string().optional(),
      stage: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async (args) => jsonResult(await actionSearchTasks(args))
  );

  server.tool(
    "mc_create_task",
    "Create a new MC task (SharePoint ToDos mirror).",
    {
      title: z.string().min(1),
      bucket: z.string().min(1),
      reporter: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
      repos: z.array(z.string()).optional(),
    },
    async (body) => jsonResult(await actionCreateTask({ ...body, reporter: body.reporter || identity.operatorEmail }))
  );

  server.tool(
    "mc_checkout_task",
    "Check out a task for agent work; returns MC-Checkout stamp for PR body.",
    { taskId: z.string().min(1) },
    async ({ taskId }) => jsonResult(await actionCheckout(identity, taskId))
  );

  server.tool(
    "mc_report_progress",
    "Report progress on a checked-out task (stage, notes).",
    {
      taskId: z.string().min(1),
      stage: z
        .enum(["backlog", "specced", "approved", "planned", "progress", "qa", "review", "merged", "verified"])
        .optional(),
      notes: z.string().optional(),
      progressPct: z.number().min(0).max(100).optional(),
    },
    async (body) => jsonResult(await actionProgress(identity, body))
  );

  server.tool(
    "mc_complete_task",
    "Mark agent work complete for a checkout credential.",
    {
      checkoutId: z.string().min(1),
      summary: z.string().min(1),
      commitSha: z.string().optional(),
      prUrl: z.string().optional(),
      verificationCommands: z.array(z.string()).optional(),
      filesChanged: z.array(z.string()).optional(),
    },
    async (body) => jsonResult(await actionComplete(body))
  );

  return server;
}

export function mcTaskDeepLink(taskId: string): string {
  return taskLink(taskId);
}
