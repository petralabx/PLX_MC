// MCP cursor API authentication — per-agent API keys authenticate durable
// per-agent service principals (TASK-619); the legacy shared key still
// resolves sp_mcp_cursor behind a retirement kill switch. Operator email is
// allowlisted audit/context only and never grants human capabilities.

import { timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/api/route";
import { isAllowedUser } from "@/lib/auth/gate";
import {
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  MCP_SERVICE_PRINCIPAL_ID,
  type IdentityQuery,
  type McpAgentServicePrincipalId,
  type PermissionActor,
} from "@/lib/permissions";
import { resolveStagedServicePrincipal } from "@/lib/permissions/enforcement";

export { MCP_SERVICE_PRINCIPAL_ID };

export interface McpOperatorContext {
  operatorEmail: string;
  runtime: string;
  workerId: string;
  repo: string;
}

export interface McpIdentity extends McpOperatorContext {
  /** Durable per-agent service principal authenticated by its API key. */
  servicePrincipalId: McpAgentServicePrincipalId;
  /** Authorization actor — always the service principal, never the operator. */
  actor: PermissionActor;
}

export interface McpAuthOptions {
  query?: IdentityQuery;
}

function readApiKey(req: Request): string {
  const fromHeader = req.headers.get("x-api-key")?.trim() ?? "";
  if (fromHeader) return fromHeader;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

export function expectedMcpApiKey(): string {
  return (process.env.PLX_MC_MCP_API_KEY ?? "").trim();
}

/**
 * Retirement kill switch for the legacy shared key: set to 0 once every agent
 * runtime carries its own key and sp_mcp_cursor's shared credential is dead.
 */
export function sharedMcpKeyEnabled(): boolean {
  return (process.env.PLX_MC_MCP_SHARED_KEY_ENABLED ?? "1").trim() === "1";
}

const AGENT_PRINCIPAL_IDS = new Set<string>(MCP_AGENT_SERVICE_PRINCIPAL_IDS);

/**
 * Per-agent key registry from PLX_MC_MCP_AGENT_KEYS (JSON object mapping
 * service principal id → API key). Ids outside the reviewed registry and
 * malformed JSON are ignored — an unconfigured or broken registry can only
 * fail closed to "no per-agent keys".
 */
export function mcpAgentKeyRegistry(): ReadonlyMap<McpAgentServicePrincipalId, string> {
  const raw = (process.env.PLX_MC_MCP_AGENT_KEYS ?? "").trim();
  const registry = new Map<McpAgentServicePrincipalId, string>();
  if (!raw) return registry;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[mcp] PLX_MC_MCP_AGENT_KEYS is not valid JSON — per-agent keys disabled.");
    return registry;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return registry;
  for (const [principalId, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (!AGENT_PRINCIPAL_IDS.has(principalId)) {
      console.error("[mcp] ignoring unknown MCP agent principal id in key registry: %s", principalId);
      continue;
    }
    if (typeof key === "string" && key.trim()) {
      registry.set(principalId as McpAgentServicePrincipalId, key.trim());
    }
  }
  return registry;
}

function keysMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Resolve the presented API key to a durable per-agent principal id.
 * Per-agent keys win; the legacy shared key maps to sp_mcp_cursor while its
 * kill switch is on. Null = no configured key matched.
 */
export function resolveMcpPrincipalIdFromKey(
  provided: string
): McpAgentServicePrincipalId | null {
  if (!provided) return null;
  for (const [principalId, key] of mcpAgentKeyRegistry()) {
    if (keysMatch(provided, key)) return principalId;
  }
  const shared = expectedMcpApiKey();
  if (shared && sharedMcpKeyEnabled() && keysMatch(provided, shared)) {
    return MCP_SERVICE_PRINCIPAL_ID;
  }
  return null;
}

export function mcpEnabled(): boolean {
  return (process.env.PLX_MC_MCP_ENABLED ?? "0").trim() === "1";
}

/** @deprecated Prefer parseOperatorContext — kept for transitional imports. */
export function parseIdentity(req: Request): McpOperatorContext {
  return parseOperatorContext(req);
}

export function parseOperatorContext(req: Request): McpOperatorContext {
  const operatorEmail = (req.headers.get("x-mc-operator-email") ?? "").trim().toLowerCase();
  const runtime = (req.headers.get("x-mc-runtime") ?? "cursor").trim();
  const workerId = (req.headers.get("x-mc-worker-id") ?? "unknown-worker").trim();
  const repo = (req.headers.get("x-mc-repo") ?? "unknown").trim();
  if (!operatorEmail) {
    throw new ApiError("missing_operator", "X-MC-Operator-Email is required.", 401);
  }
  if (!isAllowedUser(operatorEmail)) {
    throw new ApiError("operator_not_allowed", `Operator ${operatorEmail} is not on the PLX MC allowlist.`, 403);
  }
  if (!repo || repo === "unknown") {
    throw new ApiError("missing_repo", "X-MC-Repo is required (e.g. petralabx/PLX_MC).", 400);
  }
  return { operatorEmail, runtime, workerId, repo };
}

/**
 * Resolve a durable MCP agent service principal. Staged enforcement decides
 * whether durable records gate the actor: revocation/existence fail closed
 * from "review" onward, log-only stays fail-open, off stays DB-free.
 */
export async function resolveMcpServicePrincipal(
  principalId: McpAgentServicePrincipalId = MCP_SERVICE_PRINCIPAL_ID,
  options: McpAuthOptions = {}
): Promise<PermissionActor> {
  const staged = await resolveStagedServicePrincipal(principalId, options.query);
  if (!staged.actor) {
    throw new ApiError(
      "mcp_service_principal_missing",
      "The MCP service principal is not configured.",
      503
    );
  }
  if (staged.actor.status !== "active") {
    throw new ApiError(
      "mcp_service_principal_revoked",
      "The MCP service principal is revoked.",
      403
    );
  }
  return staged.actor;
}

export async function verifyMcpRequest(
  req: Request,
  options: McpAuthOptions = {}
): Promise<McpIdentity> {
  if (!mcpEnabled()) {
    throw new ApiError("mcp_disabled", "PLX MC MCP is disabled (PLX_MC_MCP_ENABLED != 1).", 503);
  }
  const anyKeyConfigured =
    mcpAgentKeyRegistry().size > 0 || (sharedMcpKeyEnabled() && !!expectedMcpApiKey());
  if (!anyKeyConfigured) {
    throw new ApiError("mcp_key_not_configured", "No MCP API key is configured on the server.", 503);
  }
  const provided = readApiKey(req);
  const principalId = resolveMcpPrincipalIdFromKey(provided);
  if (!principalId) {
    throw new ApiError("invalid_api_key", "Invalid or missing MCP API key.", 401);
  }
  const operator = parseOperatorContext(req);
  const actor = await resolveMcpServicePrincipal(principalId, options);
  return {
    ...operator,
    servicePrincipalId: principalId,
    actor,
  };
}
