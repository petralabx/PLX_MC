// Builds the in-process PLX-MC MCP server (HTTP transport + shared tool logic).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SKILL_ID_PATTERN } from "@/lib/skills-directory";
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
import {
  actionInstallSkills,
  actionListSkills,
  actionSubmitSkill,
  actionSyncSkills,
} from "./skills-actions";
import { registerRoutingSuggestTools } from "./routing-suggest-actions";
import { registerRoutingMutationTools } from "./routing-mutation-actions";

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Modular routing tool registration seam.
 * P5: suggestion tools. P8: confirmed mutation tools.
 */
export function registerRoutingTools(server: McpServer, identity: McpIdentity): void {
  registerRoutingSuggestTools(server, identity);
  registerRoutingMutationTools(server, identity);
}

export function createPlxMcMcpServer(identity: McpIdentity): McpServer {
  const server = new McpServer(
    {
      name: "PLX-MC",
      version: "1.0.0",
    },
    {
      instructions:
        "PLX Mission Control MCP — task lifecycle (checkout/progress/complete), routing suggestions (mc_suggest_work), skills directory install/sync/submit, and optional swarm delegation. " +
        "Prefer mc_suggest_work when the Task is unknown; always mc_checkout_task before agent work; append MC-Checkout stamp lines to PR bodies.",
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
    async (body) => jsonResult(await actionCreateTask(identity, { ...body, reporter: body.reporter || identity.operatorEmail }))
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
      rollback: z.string().optional(),
      testRun: z
        .object({
          suite: z.string().min(1),
          passed: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          total: z.number().int().nonnegative().optional(),
        })
        .optional(),
      shots: z.array(z.object({ label: z.string(), cap: z.string() })).optional(),
    },
    async (body) => jsonResult(await actionComplete(identity, body))
  );

  server.tool(
    "mc_list_skills",
    "List PLX skills catalog entries, optionally filtered by query, tag, or status.",
    {
      q: z.string().optional(),
      tag: z.string().optional(),
      status: z.string().optional(),
    },
    async (args) => jsonResult(await actionListSkills(args))
  );

  server.tool(
    "mc_install_skills",
    "Build local install/sync scripts for PLX company skills.",
    {
      ids: z.array(z.string().regex(SKILL_ID_PATTERN)).optional(),
      mode: z.enum(["install", "sync"]).optional(),
      runtimes: z.array(z.enum(["cursor", "claude"])).optional(),
      projectRoot: z.string().min(1).optional(),
      localRegistry: z.unknown().optional(),
    },
    async (args) => jsonResult(await actionInstallSkills(args))
  );

  server.tool(
    "mc_sync_skills",
    "Compare a local PLX skills registry against the approved catalog.",
    {
      packageId: z.string().min(1).optional(),
      localRegistry: z.unknown().optional(),
      runtimes: z.array(z.enum(["cursor", "claude"])).optional(),
    },
    async (args) => jsonResult(await actionSyncSkills(args))
  );

  server.tool(
    "mc_submit_skill",
    "Submit a proposed skill to the PLX skills directory review queue.",
    {
      id: z.string().regex(SKILL_ID_PATTERN),
      name: z.string().min(1),
      description: z.string().min(1),
      skillMd: z.string().min(1),
      tags: z.array(z.string().min(1)).optional(),
      owner: z.string().min(1).optional(),
    },
    async (body) => jsonResult(await actionSubmitSkill(identity, body))
  );

  registerRoutingTools(server, identity);

  return server;
}

export function mcTaskDeepLink(taskId: string): string {
  return taskLink(taskId);
}
