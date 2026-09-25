#!/usr/bin/env node
// Mission Control REST fallback CLI — for when the PLX-MC MCP connector is
// unavailable. Calls the same /api/cursor/* routes the MCP REST wrapper exposes
// (src/lib/mcp/route.ts), with the same MCP key + operator headers. No deps.
//
// Usage:
//   node scripts/mc.mjs checkout --task TASK-123 [--repo owner/name]
//   node scripts/mc.mjs complete --checkout dsp_x --summary "..." \
//        --verify "npm run typecheck" [--verify "..."] --rollback "..." \
//        [--pr <url>] [--commit <sha>]
//   node scripts/mc.mjs status --task TASK-123 [--repo owner/name]
//
// Env:
//   MC_BASE_URL        default https://mc.plxcustomer.io
//   MC_MCP_API_KEY     MCP API key (required)
//   MC_OPERATOR_EMAIL  allowlisted operator, audit context (required)
//   MC_REPO            full slug for X-MC-Repo when --repo is not passed
//   MC_RUNTIME         X-MC-Runtime label (default mc-cli)
//
// Prints JSON on stdout: the server { data, meta } envelope on success, or
// { error: { code, message, status? } } with exit 1 on any failure. complete is
// refused locally without at least one --verify and a --rollback.

import { pathToFileURL } from "node:url";

export const DEFAULT_MC_BASE_URL = "https://mc.plxcustomer.io";

const COMMANDS = new Set(["checkout", "complete", "status"]);
const VALUE_FLAGS = new Set(["task", "repo", "checkout", "summary", "rollback", "pr", "commit"]);
const REPEATABLE_FLAGS = new Set(["verify"]);
const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const USAGE =
  "usage: node scripts/mc.mjs <checkout|complete|status> " +
  "[--task TASK-n] [--repo owner/name] [--checkout dsp_x --summary s --verify cmd... --rollback r]";

export class McCliError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "McCliError";
    this.code = code;
  }
}

/**
 * @param {string[]} argv
 * @returns {{ command: string, flags: Record<string, string | string[]> }}
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || !COMMANDS.has(command)) {
    throw new McCliError("invalid_args", `unknown or missing command. ${USAGE}`);
  }
  /** @type {Record<string, string | string[]>} */
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const name = arg.startsWith("--") ? arg.slice(2) : "";
    if (!VALUE_FLAGS.has(name) && !REPEATABLE_FLAGS.has(name)) {
      throw new McCliError("invalid_args", `unknown argument: ${arg}. ${USAGE}`);
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new McCliError("invalid_args", `--${name} needs a value.`);
    }
    i++;
    if (REPEATABLE_FLAGS.has(name)) {
      flags[name] = [...(/** @type {string[]} */ (flags[name]) ?? []), value];
    } else {
      flags[name] = value;
    }
  }
  return { command, flags };
}

/**
 * @param {Record<string, string | string[]>} flags
 * @param {string} name
 */
function requireFlag(flags, name) {
  const value = typeof flags[name] === "string" ? /** @type {string} */ (flags[name]).trim() : "";
  if (!value) throw new McCliError("invalid_args", `--${name} is required.`);
  return value;
}

/**
 * Build the HTTP request for a parsed command. Pure — no network, no process state.
 * @param {{ command: string, flags: Record<string, string | string[]> }} parsed
 * @param {Record<string, string | undefined>} env
 * @param {{ workerId?: string }} [opts]
 */
export function buildRequest(parsed, env, opts = {}) {
  const { command, flags } = parsed;
  const apiKey = (env.MC_MCP_API_KEY ?? "").trim();
  if (!apiKey) throw new McCliError("missing_api_key", "MC_MCP_API_KEY is not set.");
  const operator = (env.MC_OPERATOR_EMAIL ?? "").trim().toLowerCase();
  if (!operator) throw new McCliError("missing_operator", "MC_OPERATOR_EMAIL is not set.");
  const repo = (typeof flags.repo === "string" ? flags.repo : env.MC_REPO ?? "").trim();
  if (!repo) throw new McCliError("missing_repo", "Pass --repo owner/name or set MC_REPO.");
  if (!SLUG_RE.test(repo)) {
    throw new McCliError("invalid_repo", `repo must be a full GitHub slug (owner/name), got: ${repo}`);
  }

  const base = (env.MC_BASE_URL?.trim() || DEFAULT_MC_BASE_URL).replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "x-mc-operator-email": operator,
    "x-mc-repo": repo,
    "x-mc-runtime": env.MC_RUNTIME?.trim() || "mc-cli",
    "x-mc-worker-id": opts.workerId ?? "mc-cli",
  };

  if (command === "checkout") {
    return {
      method: "POST",
      url: `${base}/api/cursor/checkout`,
      headers,
      body: { taskId: requireFlag(flags, "task"), repo },
    };
  }

  if (command === "complete") {
    const checkoutId = requireFlag(flags, "checkout");
    const summary = requireFlag(flags, "summary");
    const verify = (/** @type {string[]} */ (flags.verify) ?? [])
      .map((cmd) => cmd.trim())
      .filter(Boolean);
    if (verify.length === 0) {
      throw new McCliError(
        "verify_required",
        "complete needs at least one --verify command (the gate derives the evidence checklist from it)."
      );
    }
    const rollback = typeof flags.rollback === "string" ? flags.rollback.trim() : "";
    if (!rollback) {
      throw new McCliError("rollback_required", "complete needs a non-empty --rollback plan.");
    }
    return {
      method: "POST",
      url: `${base}/api/cursor/complete`,
      headers,
      body: {
        checkoutId,
        summary,
        verificationCommands: verify,
        rollback,
        ...(typeof flags.pr === "string" ? { prUrl: flags.pr } : {}),
        ...(typeof flags.commit === "string" ? { commitSha: flags.commit } : {}),
      },
    };
  }

  // status
  return {
    method: "GET",
    url: `${base}/api/cursor/tasks/${encodeURIComponent(requireFlag(flags, "task"))}`,
    headers,
    body: undefined,
  };
}

/** @param {unknown} err */
function errorOutput(err) {
  if (err instanceof McCliError) return { error: { code: err.code, message: err.message } };
  return { error: { code: "cli_error", message: err instanceof Error ? err.message : String(err) } };
}

/**
 * Parse, call MC, and return what to print. Never throws.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof globalThis.fetch, workerId?: string }} [opts]
 * @returns {Promise<{ exitCode: number, output: any }>}
 */
export async function run(argv, opts = {}) {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  let parsed;
  let req;
  try {
    parsed = parseArgs(argv);
    req = buildRequest(parsed, env, { workerId: opts.workerId });
  } catch (err) {
    return { exitCode: 1, output: errorOutput(err) };
  }

  let res;
  try {
    res = await fetchFn(req.url, {
      method: req.method,
      headers: req.headers,
      ...(req.body ? { body: JSON.stringify(req.body) } : {}),
    });
  } catch (err) {
    return {
      exitCode: 1,
      output: {
        error: { code: "network_error", message: err instanceof Error ? err.message : String(err) },
      },
    };
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = typeof json?.error?.code === "string" ? json.error.code : `http_${res.status}`;
    const message = typeof json?.error?.message === "string" ? json.error.message : `HTTP ${res.status}`;
    return { exitCode: 1, output: { error: { code, message, status: res.status } } };
  }
  if (json === null) {
    return {
      exitCode: 1,
      output: { error: { code: "invalid_response", message: "Mission Control returned a non-JSON body." } },
    };
  }

  // Pipeline contract: refuse a checkout receipt that is not for this task and
  // repo — a wrong-scope stamp fails GitHub verify with taskId:null.
  if (parsed.command === "checkout") {
    const data = json.data ?? {};
    if (data.taskId !== req.body.taskId) {
      return {
        exitCode: 1,
        output: {
          error: {
            code: "checkout_task_mismatch",
            message: `expected taskId ${req.body.taskId}, received ${data.taskId ?? "missing"}`,
          },
        },
      };
    }
    if (data.actor?.repo !== req.body.repo) {
      return {
        exitCode: 1,
        output: {
          error: {
            code: "checkout_repo_mismatch",
            message: `expected actor.repo ${req.body.repo}, received ${data.actor?.repo ?? "missing"}`,
          },
        },
      };
    }
  }
  return { exitCode: 0, output: json };
}

async function main() {
  const { exitCode, output } = await run(process.argv.slice(2), {
    workerId: `mc-cli-${process.pid}`,
  });
  console.log(JSON.stringify(output, null, 2));
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
