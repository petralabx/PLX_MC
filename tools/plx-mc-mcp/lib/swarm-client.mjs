// Shared swarm HTTP client for PLX-MC MCP (compose — do not duplicate dispatch logic).

import process from "node:process";
import { execFile } from "node:child_process";

export function cleanKey(v) {
  const s = (v || "").trim();
  return /\$\{.*\}/.test(s) ? "" : s;
}

export const SWARM_TEAMS = [
  "ceo", "rr", "rr_deep", "dev", "qa", "plx", "trading",
  "cfo", "cro", "cmo", "hr", "factory_auto", "pa", "m365_auto", "viz_spec", "dr_docops",
];

export function swarmConfig() {
  return {
    url: (process.env.SWARM_API_URL || "http://127.0.0.1:8900").replace(/\/+$/, ""),
    apiKey: cleanKey(process.env.SWARM_API_KEY),
    keyCmd: (process.env.SWARM_KEY_CMD || "").trim(),
    keyCmdTimeoutMs: Number(process.env.SWARM_KEY_CMD_TIMEOUT_MS || 15000),
    defaultTeam: process.env.SWARM_DEFAULT_TEAM || "ceo",
    timeoutMs: Number(process.env.SWARM_DISPATCH_TIMEOUT_MS || 900000),
    enabled: (process.env.SWARM_DISPATCH_ENABLED || "1").trim() !== "0",
  };
}

let _keyPromise = null;

export function resolveSwarmApiKey() {
  const CONFIG = swarmConfig();
  if (_keyPromise) return _keyPromise;
  _keyPromise = new Promise((resolve) => {
    if (CONFIG.apiKey) return resolve(CONFIG.apiKey);
    if (!CONFIG.keyCmd) return resolve("");
    const isWin = process.platform === "win32";
    const file = isWin ? "cmd" : "sh";
    const args = isWin ? ["/c", CONFIG.keyCmd] : ["-c", CONFIG.keyCmd];
    execFile(file, args, { timeout: CONFIG.keyCmdTimeoutMs, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve("");
      resolve(cleanKey(String(stdout || "")));
    });
  });
  return _keyPromise;
}

export async function swarmHttpJson(method, path, body) {
  const CONFIG = swarmConfig();
  const key = await resolveSwarmApiKey();
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

export async function callSwarmTool(name, args = {}) {
  if (name === "list_swarm_teams") {
    return {
      text:
        "Swarm dispatch routes (use as `team`):\n" +
        SWARM_TEAMS.map((t) => `- ${t}`).join("\n") +
        "\n\nDefault is `ceo` (COS orchestration).",
      isError: false,
    };
  }
  if (name === "swarm_health") {
    try {
      const r = await swarmHttpJson("GET", "/health");
      const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2);
      return { text: `status=${r.status}\n${body}`, isError: !r.ok };
    } catch (e) {
      return { text: `Swarm unreachable: ${e?.message || e}`, isError: true };
    }
  }
  if (name === "dispatch_to_swarm") {
    const CONFIG = swarmConfig();
    if (!CONFIG.enabled) {
      return { text: "Swarm dispatch is disabled (SWARM_DISPATCH_ENABLED=0).", isError: true };
    }
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return { text: "`message` is required.", isError: true };
    const payload = { message, team: args.team || CONFIG.defaultTeam };
    if (args.thread_id) payload.thread_id = String(args.thread_id);
    if (typeof args.deep === "boolean") payload.deep = args.deep;
    if (Number.isFinite(args.timeout_seconds)) payload.timeout_seconds = args.timeout_seconds;
    try {
      const r = await swarmHttpJson("POST", "/dispatch", payload);
      const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2);
      if (!r.ok) return { text: `Dispatch failed (HTTP ${r.status}):\n${body}`, isError: true };
      return { text: body, isError: false };
    } catch (e) {
      const msg = e?.name === "AbortError"
        ? `Dispatch timed out after ${CONFIG.timeoutMs} ms.`
        : `Dispatch error: ${e?.message || e}`;
      return { text: msg, isError: true };
    }
  }
  return { text: `Unknown swarm tool: ${name}`, isError: true };
}
