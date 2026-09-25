// Standard MCP cursor response envelope — { data, meta } with deep links.

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api/route";
import type { McpIdentity } from "./auth";
import { MCP_CHECKOUT_REPO_ALLOWLIST } from "./checkout-repo";

export interface McpSyncMeta {
  status: "pushed" | "queued" | "conflict" | "synced";
  conflictId?: string;
  link?: string;
}

export interface McpResponseMeta {
  requestId: string;
  ts: string;
  actor: McpIdentity;
  links: {
    mcBase: string;
    task?: string;
    checkoutStamp?: string;
    events?: string;
    conflicts?: string;
  };
  /** Applied tool filters (search/context). Absent keys were not requested. */
  filter?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  audit: { eventSeq?: string; kinds: string[] };
  sync?: McpSyncMeta;
}

export function publicMcBaseUrl(): string {
  return (process.env.PLX_MC_PUBLIC_URL ?? "https://mc.plxcustomer.io").replace(/\/+$/, "");
}

export function taskLink(taskId: string): string {
  return `${publicMcBaseUrl()}/tasks/${encodeURIComponent(taskId)}`;
}

export function buildMeta(
  identity: McpIdentity,
  partial: Partial<Omit<McpResponseMeta, "requestId" | "ts" | "actor">> = {}
): McpResponseMeta {
  const base = publicMcBaseUrl();
  return {
    requestId: randomUUID(),
    ts: new Date().toISOString(),
    actor: identity,
    links: {
      mcBase: base,
      events: `${base}/api/events`,
      ...partial.links,
    },
    audit: partial.audit ?? { kinds: [] },
    filter: partial.filter,
    evidence: partial.evidence,
    sync: partial.sync,
  };
}

export function wrapMcpResponse<T>(data: T, meta: McpResponseMeta): { data: T; meta: McpResponseMeta } {
  return { data, meta };
}

// ─── MCP tool results ────────────────────────────────────────────────────────

export function mcpJsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export interface McpToolErrorBody {
  error: { code: string; message: string; hint?: string };
}

// Agent-actionable next steps for codes an agent can fix on its own. Keep this
// short: a hint that is not concrete is noise.
const TOOL_ERROR_HINTS: Readonly<Record<string, string>> = {
  repo_not_allowlisted: `Pass one of ${MCP_CHECKOUT_REPO_ALLOWLIST.join(", ")} as repo, or omit repo to bind the connector X-MC-Repo.`,
  invalid_repo: "Pass a full GitHub slug (owner/name), not a bare repo name or MC registry id.",
  invalid_checkout:
    "The checkout is unknown, revoked, or expired: run mc_checkout_task again and use the new MC-Checkout stamp.",
};

/**
 * A failed tool call as MCP `isError` + the standard `{ error: { code, message } }`
 * JSON (plus an optional hint), mirroring the cursor REST envelope. Unexpected
 * throws map to `internal` without leaking their message, as cursorRoute does.
 */
export function mcpToolErrorResult(err: unknown) {
  let body: McpToolErrorBody;
  if (err instanceof ApiError) {
    const hint = TOOL_ERROR_HINTS[err.code];
    body = { error: { code: err.code, message: err.message, ...(hint ? { hint } : {}) } };
  } else {
    console.error("[mcp] unhandled tool error:", err);
    body = { error: { code: "internal", message: "Internal error." } };
  }
  return { ...mcpJsonResult(body), isError: true as const };
}

type ToolRegistrar = (...args: unknown[]) => unknown;

function withToolErrors(args: unknown[]): unknown[] {
  const last = args.length - 1;
  const callback = args[last];
  if (typeof callback !== "function") return args;
  const wrapped = async (...callbackArgs: unknown[]) => {
    try {
      return await callback(...callbackArgs);
    } catch (err) {
      return mcpToolErrorResult(err);
    }
  };
  return [...args.slice(0, last), wrapped];
}

/**
 * Route every tool registered on `server` afterwards (server.tool and
 * server.registerTool, including the split registration modules) through
 * mcpToolErrorResult. Without this the SDK flattens a thrown ApiError to its
 * message text and the code is lost. Call once, right after constructing the
 * server and before any registration.
 */
export function installMcpToolErrorEnvelope(server: McpServer): McpServer {
  const registrars = server as unknown as { tool: ToolRegistrar; registerTool: ToolRegistrar };
  const tool = registrars.tool.bind(server);
  const registerTool = registrars.registerTool.bind(server);
  registrars.tool = (...args) => tool(...withToolErrors(args));
  registrars.registerTool = (...args) => registerTool(...withToolErrors(args));
  return server;
}
