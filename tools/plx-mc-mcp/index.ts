#!/usr/bin/env node
/**
 * PLX-MC MCP Server (stdio)
 *
 * Team-distributed MCP for PLX Mission Control task lifecycle + swarm delegation.
 * Proxies to PLX MC /api/cursor/* (REST) with standard envelope + audit trail.
 *
 * Remote alternative: register https://mc.plxcustomer.io/api/cursor/mcp (Streamable HTTP).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomBytes } from "node:crypto";
import os from "node:os";
import { z } from "zod";
import { callSwarmTool } from "./lib/swarm-client.mjs";

const DEFAULT_MC_BASE = "https://mc.plxcustomer.io";
const MC_BASE_URL = (process.env.MC_BASE_URL?.trim() || DEFAULT_MC_BASE).replace(/\/+$/, "");
const MC_MCP_API_KEY = (process.env.MC_MCP_API_KEY || "").replace(/\$\{.*\}/, "").trim();
const MC_OPERATOR_EMAIL = (process.env.MC_OPERATOR_EMAIL || process.env.MC_ACCOUNTABLE || "").trim().toLowerCase();
const MC_REPO = (process.env.MC_REPO || "").trim();
const MCP_ENABLED = (process.env.PLX_MC_MCP_ENABLED || "0").trim() !== "0";
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.MC_MCP_TIMEOUT_MS || "15000") || 15000);

const BOX_ID =
  process.env.SWARM_BOX_ID?.trim() ||
  os.hostname().replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase() ||
  "unknown-box";
const RUNTIME = (process.env.MC_RUNTIME || "cursor").trim();
const WORKER_ID = `${BOX_ID}-${RUNTIME}-${process.pid}-${randomBytes(3).toString("hex")}`;

function disabledTool(name: string) {
  return {
    content: [{ type: "text" as const, text: `${name} is disabled (PLX_MC_MCP_ENABLED=0). Set PLX_MC_MCP_ENABLED=1 to enable.` }],
    isError: true,
  };
}

function requireConfig() {
  if (!MCP_ENABLED) throw new Error("PLX_MC_MCP_ENABLED=0");
  if (!MC_MCP_API_KEY) throw new Error("MC_MCP_API_KEY is not set");
  if (!MC_OPERATOR_EMAIL) throw new Error("MC_OPERATOR_EMAIL (or MC_ACCOUNTABLE) is not set");
  if (!MC_REPO) throw new Error("MC_REPO is not set (e.g. taylorvalton/PLX_MC)");
}

async function mcFetch(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${MC_BASE_URL}/api/cursor${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MC_MCP_API_KEY,
        "X-MC-Operator-Email": MC_OPERATOR_EMAIL,
        "X-MC-Runtime": RUNTIME,
        "X-MC-Worker-Id": WORKER_ID,
        "X-MC-Repo": MC_REPO,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      const err = json as { error?: { message?: string } };
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function printResult(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

const server = new McpServer(
  { name: "PLX-MC", version: "1.0.0" },
  {
    instructions:
      "PLX Mission Control — checkout tasks (mc_checkout_task), report progress, complete with evidence, " +
      "and optionally dispatch_to_swarm. Append MC-Checkout lines from checkout responses to PR bodies.",
  }
);

server.tool("mc_self_check", "Validate PLX MC MCP auth and connectivity.", {}, async () => {
  if (!MCP_ENABLED) return disabledTool("mc_self_check");
  return printResult(await mcFetch("/self-check"));
});

server.tool(
  "mc_get_context",
  "Read compact or full MC context (tasks, buckets).",
  { depth: z.enum(["compact", "full"]).optional(), bucket: z.string().optional() },
  async ({ depth, bucket }) => {
    if (!MCP_ENABLED) return disabledTool("mc_get_context");
    const qs = new URLSearchParams();
    if (depth) qs.set("depth", depth);
    if (bucket) qs.set("bucket", bucket);
    const q = qs.toString();
    return printResult(await mcFetch(`/context${q ? `?${q}` : ""}`));
  }
);

server.tool(
  "mc_search_tasks",
  "Search/list MC tasks.",
  {
    q: z.string().optional(),
    bucket: z.string().optional(),
    stage: z.string().optional(),
    limit: z.number().int().optional(),
  },
  async (args) => {
    if (!MCP_ENABLED) return disabledTool("mc_search_tasks");
    const qs = new URLSearchParams();
    if (args.q) qs.set("q", args.q);
    if (args.bucket) qs.set("bucket", args.bucket);
    if (args.stage) qs.set("stage", args.stage);
    if (args.limit) qs.set("limit", String(args.limit));
    return printResult(await mcFetch(`/tasks?${qs.toString()}`));
  }
);

server.tool(
  "mc_create_task",
  "Create a new MC task.",
  {
    title: z.string().min(1),
    bucket: z.string().min(1),
    reporter: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
    repos: z.array(z.string()).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_create_task");
    return printResult(
      await mcFetch("/tasks", {
        method: "POST",
        body: { ...body, reporter: body.reporter || MC_OPERATOR_EMAIL },
      })
    );
  }
);

server.tool("mc_checkout_task", "Check out a task; returns MC-Checkout stamp for PR body.", { taskId: z.string().min(1) }, async ({ taskId }) => {
  if (!MCP_ENABLED) return disabledTool("mc_checkout_task");
  return printResult(await mcFetch("/checkout", { method: "POST", body: { taskId } }));
});

server.tool(
  "mc_report_progress",
  "Report task progress (stage, notes).",
  {
    taskId: z.string().min(1),
    stage: z.string().optional(),
    notes: z.string().optional(),
    progressPct: z.number().min(0).max(100).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_report_progress");
    return printResult(await mcFetch("/progress", { method: "POST", body }));
  }
);

server.tool(
  "mc_complete_task",
  "Complete agent work for a checkout credential.",
  {
    checkoutId: z.string().min(1),
    summary: z.string().min(1),
    commitSha: z.string().optional(),
    prUrl: z.string().optional(),
    verificationCommands: z.array(z.string()).optional(),
    filesChanged: z.array(z.string()).optional(),
  },
  async (body) => {
    if (!MCP_ENABLED) return disabledTool("mc_complete_task");
    return printResult(await mcFetch("/complete", { method: "POST", body }));
  }
);

server.tool(
  "dispatch_to_swarm",
  "Delegate work to the agentic-swarm COS orchestrator.",
  {
    message: z.string().min(1),
    team: z.string().optional(),
    thread_id: z.string().optional(),
    deep: z.boolean().optional(),
    timeout_seconds: z.number().optional(),
  },
  async (args) => {
    const r = await callSwarmTool("dispatch_to_swarm", args);
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  }
);

server.tool("list_swarm_teams", "List valid swarm dispatch team routes.", {}, async () => {
  const r = await callSwarmTool("list_swarm_teams");
  return { content: [{ type: "text" as const, text: r.text }] };
});

server.tool("swarm_health", "Check swarm API health.", {}, async () => {
  const r = await callSwarmTool("swarm_health");
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

const transport = new StdioServerTransport();
await server.connect(transport);
