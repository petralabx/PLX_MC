#!/usr/bin/env node
// Swarm Dispatch MCP server (stdio, dependency-free).
//
// Exposes the agentic-swarm dispatch API as MCP tools so Cursor agents
// (local IDE + Cloud Agents) can delegate work to the 41-agent / 7-team swarm
// without shelling out. It is a thin HTTP client over the swarm's /dispatch
// endpoint and has NO npm dependencies — point it at a local `swarm serve`
// (default) today, or a hosted endpoint later by changing one URL.
//
// Transport: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport).
// Runtime: Node >= 18 (uses global fetch / AbortController). No npm install.
//
// API-key resolution (keyed + automated, single source = AWS Secrets Manager):
//   1. SWARM_API_KEY env var (explicit override; placeholders like "${env:..}" ignored)
//   2. SWARM_KEY_CMD — a shell command whose stdout is the key. We default this
//      (in .cursor/mcp.json) to the swarm's own accessor:
//        <venv>/python -c "from src.secrets import get_secret; print(get_secret('SWARM_API_KEY'))"
//      so the key is pulled from AWS Secrets Manager via the VM's IAM role and
//      never duplicated into a second secret store.
//   3. none — calls go out unauthenticated (works against a loopback server
//      started with SWARM_API_KEY_REQUIRED=0).
//
// Config (env):
//   SWARM_API_URL             default http://127.0.0.1:8900
//   SWARM_API_KEY             optional explicit key
//   SWARM_KEY_CMD             optional shell command that prints the key
//   SWARM_DEFAULT_TEAM        default "ceo"
//   SWARM_DISPATCH_TIMEOUT_MS default 900000 (15 min)
//   SWARM_KEY_CMD_TIMEOUT_MS  default 15000
//   SWARM_DISPATCH_ENABLED    default "1"; set "0" to hard-disable dispatch

import process from "node:process";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";

// Ignore unsubstituted placeholders (e.g. a literal "${env:SWARM_API_KEY}").
function cleanKey(v) {
  const s = (v || "").trim();
  return /\$\{.*\}/.test(s) ? "" : s;
}

const CONFIG = {
  url: (process.env.SWARM_API_URL || "http://127.0.0.1:8900").replace(/\/+$/, ""),
  apiKey: cleanKey(process.env.SWARM_API_KEY),
  keyCmd: (process.env.SWARM_KEY_CMD || "").trim(),
  keyCmdTimeoutMs: Number(process.env.SWARM_KEY_CMD_TIMEOUT_MS || 15000),
  defaultTeam: process.env.SWARM_DEFAULT_TEAM || "ceo",
  timeoutMs: Number(process.env.SWARM_DISPATCH_TIMEOUT_MS || 900000),
  enabled: (process.env.SWARM_DISPATCH_ENABLED || "1").trim() !== "0",
};

const SERVER_INFO = { name: "swarm-dispatch", version: "1.1.0" };
const PROTOCOL_VERSION = "2024-11-05";

// Valid COS dispatch routes (agentic-swarm dispatch_core VALID_TEAMS).
const TEAMS = [
  "ceo", "rr", "rr_deep", "dev", "qa", "plx", "trading",
  "cfo", "cro", "cmo", "hr", "factory_auto", "pa", "m365_auto", "viz_spec", "dr_docops",
];

const log = (...a) => process.stderr.write(`[swarm-dispatch] ${a.join(" ")}\n`);

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

// Resolve the API key once and cache it (env > SWARM_KEY_CMD > none).
let _keyPromise = null;
function resolveApiKey() {
  if (_keyPromise) return _keyPromise;
  _keyPromise = new Promise((resolve) => {
    if (CONFIG.apiKey) {
      log("api key source=env");
      return resolve(CONFIG.apiKey);
    }
    if (!CONFIG.keyCmd) {
      log("api key source=none");
      return resolve("");
    }
    const isWin = process.platform === "win32";
    const file = isWin ? "cmd" : "sh";
    const args = isWin ? ["/c", CONFIG.keyCmd] : ["-c", CONFIG.keyCmd];
    execFile(file, args, { timeout: CONFIG.keyCmdTimeoutMs, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) {
        log(`api key source=cmd FAILED (${err.message}) — proceeding unauthenticated`);
        return resolve("");
      }
      const key = cleanKey(String(stdout || ""));
      log(`api key source=cmd (${key ? "resolved" : "empty"})`);
      resolve(key);
    });
  });
  return _keyPromise;
}

const TOOLS = [
  {
    name: "dispatch_to_swarm",
    description:
      "Delegate a task to the agentic-swarm (41 agents across 7 teams) via its COS orchestrator. " +
      "Use team='ceo' (default) and steer routing in the message, e.g. 'Route to the dev team. <task>'. " +
      "Returns the swarm's final response. Long-running: orchestration can take minutes.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The task/instruction for the swarm. Be specific; name a target team if you want one." },
        team: { type: "string", enum: TEAMS, default: "ceo", description: "Dispatch route. Default 'ceo' = COS plan-then-execute orchestration." },
        thread_id: { type: "string", description: "Optional thread id to continue a prior swarm conversation." },
        deep: { type: "boolean", description: "Optional: request deeper/long-form processing where supported." },
        timeout_seconds: { type: "integer", description: "Optional server-side dispatch timeout in seconds." },
      },
      required: ["message"],
    },
  },
  {
    name: "list_swarm_teams",
    description: "List the agentic-swarm dispatch routes (teams) you can target via dispatch_to_swarm.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "swarm_health",
    description: "Check whether the swarm dispatch API is reachable and healthy (GET /health).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function httpJson(method, path, body) {
  const key = await resolveApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
  try {
    const headers = { "Content-Type": "application/json" };
    if (key) headers["X-API-Key"] = key;
    const res = await fetch(`${CONFIG.url}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function toolText(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function callTool(name, args) {
  args = args || {};

  if (name === "list_swarm_teams") {
    return toolText(
      "Swarm dispatch routes (use as `team`):\n" +
      TEAMS.map((t) => `- ${t}`).join("\n") +
      "\n\nDefault is `ceo` (COS orchestration). In COS_ONLY_MODE only `ceo` is accepted publicly; " +
      'steer other teams from the message, e.g. "Route to the dev team. <task>".'
    );
  }

  if (name === "swarm_health") {
    try {
      const r = await httpJson("GET", "/health");
      const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2);
      return toolText(`status=${r.status}\n${body}`, !r.ok);
    } catch (e) {
      return toolText(`Swarm unreachable at ${CONFIG.url}: ${e?.message || e}`, true);
    }
  }

  if (name === "dispatch_to_swarm") {
    if (!CONFIG.enabled) {
      return toolText("Swarm dispatch is disabled (SWARM_DISPATCH_ENABLED=0). Set it to 1 to enable.", true);
    }
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return toolText("`message` is required.", true);

    const payload = { message, team: args.team || CONFIG.defaultTeam };
    if (args.thread_id) payload.thread_id = String(args.thread_id);
    if (typeof args.deep === "boolean") payload.deep = args.deep;
    if (Number.isFinite(args.timeout_seconds)) payload.timeout_seconds = args.timeout_seconds;

    try {
      const r = await httpJson("POST", "/dispatch", payload);
      const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2);
      if (!r.ok) return toolText(`Dispatch failed (HTTP ${r.status}):\n${body}`, true);
      return toolText(body);
    } catch (e) {
      const msg = e?.name === "AbortError"
        ? `Dispatch timed out after ${CONFIG.timeoutMs} ms.`
        : `Dispatch error: ${e?.message || e} (is \`swarm serve\` running at ${CONFIG.url}?)`;
      return toolText(msg, true);
    }
  }

  return toolText(`Unknown tool: ${name}`, true);
}

async function handle(msg) {
  const { id, method, params } = msg;
  // Notifications (no id) get no response.
  if (id === undefined || id === null) return;

  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const res = await callTool(params?.name, params?.arguments);
      reply(id, res);
      return;
    }
    default:
      replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch (e) {
    log(`parse error: ${e?.message || e}`);
    return;
  }
  Promise.resolve(handle(msg)).catch((e) => {
    log(`handler error: ${e?.message || e}`);
    if (msg && msg.id !== undefined && msg.id !== null) replyError(msg.id, -32603, String(e?.message || e));
  });
});
rl.on("close", () => process.exit(0));

log(`ready — url=${CONFIG.url} key=${CONFIG.apiKey ? "env" : CONFIG.keyCmd ? "cmd" : "none"} enabled=${CONFIG.enabled}`);
