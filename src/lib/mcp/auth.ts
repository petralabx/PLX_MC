// MCP cursor API authentication — per-agent API keys authenticate durable
// per-agent service principals (TASK-619); the legacy shared key still
// resolves sp_mcp_cursor behind a retirement kill switch. Operator email is
// allowlisted audit/context only and never grants human capabilities.

import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ApiError } from "@/lib/api/route";
import { isAllowedUser } from "@/lib/auth/gate";
import { ACTIVE_TRACKED_REPO_SLUGS } from "@/lib/compliance";
import {
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  MCP_SERVICE_PRINCIPAL_ID,
  POLICY_VERSION,
  type IdentityQuery,
  type McpAgentServicePrincipalId,
  type PermissionActor,
} from "@/lib/permissions";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";
import { resolveStagedServicePrincipal } from "@/lib/permissions/enforcement";

export { MCP_SERVICE_PRINCIPAL_ID };

export interface McpOperatorContext {
  operatorEmail: string;
  runtime: string;
  workerId: string;
  repo: string;
  /**
   * TASK-3407: the caller's stable `<runtime>/<lane>` from X-MC-Agent, one id
   * per actor and lane across MC, AWS and GitHub. Optional until every runtime
   * sends it; when present it names the actor on audit events and checkouts.
   */
  agent?: string;
}

const AGENT_ID_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * The audit actor for an MCP request (TASK-3407): `<runtime>/<lane>:<operator>`
 * when the caller names its lane, else the legacy `<runtime>:<operator>`.
 */
export function mcpAuditActor(identity: Pick<McpOperatorContext, "runtime" | "operatorEmail" | "agent">): string {
  return `${identity.agent ?? identity.runtime}:${identity.operatorEmail}`;
}

export interface McpIdentity extends McpOperatorContext {
  /** Durable per-agent service principal authenticated by its API key. */
  servicePrincipalId: McpAgentServicePrincipalId;
  /** Authorization actor — always the service principal, never the operator. */
  actor: PermissionActor;
  /** Real-status actor when log-only still applies an assumed-active principal. */
  shadowActor?: PermissionActor | null;
  /** Lookup ran and found no principal row (log-only). */
  shadowMissing?: boolean;
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
export type McpPrincipalAuthzMode = "shadow" | "enforce";

/**
 * TASK-3008 rollout switch. "shadow" (default, and any value but "enforce"):
 * the operator-email rules still decide checkout release and restricted-project
 * access, and the principal-only decision is logged beside them. "enforce":
 * only the authenticated principal decides. Flip only after per-runtime keys
 * are live and the authz.shadow_mismatch log is clean (TASK-2569).
 */
export function mcpPrincipalAuthzMode(): McpPrincipalAuthzMode {
  return (process.env.PLX_MC_MCP_PRINCIPAL_AUTHZ ?? "").trim().toLowerCase() === "enforce"
    ? "enforce"
    : "shadow";
}

export function sharedMcpKeyEnabled(): boolean {
  return (process.env.PLX_MC_MCP_SHARED_KEY_ENABLED ?? "1").trim() === "1";
}

const AGENT_PRINCIPAL_IDS = new Set<string>(MCP_AGENT_SERVICE_PRINCIPAL_IDS);
const ACTIVE_REPOS_BY_LOWER = new Set(ACTIVE_TRACKED_REPO_SLUGS.map((repo) => repo.toLowerCase()));

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
      console.error("[mcp] ignoring unknown MCP agent principal id in key registry.");
      continue;
    }
    if (typeof key === "string" && key.trim()) {
      registry.set(principalId as McpAgentServicePrincipalId, key.trim());
    }
  }
  return registry;
}

const rotationSchema = z.record(z.string(), z.object({
  next: z.string().trim().min(1).optional(),
  currentEnabled: z.boolean().default(true),
  nextEnabled: z.boolean().default(true),
}).strict());

function keyCredentials(): Array<{
  principalId: McpAgentServicePrincipalId;
  key: string;
  enabled: boolean;
}> {
  const raw = (process.env.PLX_MC_MCP_AGENT_KEY_ROTATIONS ?? "").trim();
  let rotations: z.infer<typeof rotationSchema> = {};
  if (raw) {
    try {
      rotations = rotationSchema.parse(JSON.parse(raw));
    } catch {
      // Never fall back to accepting a key whose disable flag could not be read.
      throw new ApiError("mcp_key_config_invalid", "MCP key rotation configuration is invalid.", 503);
    }
  }
  const credentials = [];
  for (const [principalId, key] of mcpAgentKeyRegistry()) {
    const rotation = rotations[principalId];
    credentials.push({ principalId, key, enabled: rotation?.currentEnabled ?? true });
    if (rotation?.next) {
      credentials.push({ principalId, key: rotation.next, enabled: rotation.nextEnabled });
    }
  }
  const shared = expectedMcpApiKey();
  if (shared) {
    credentials.push({ principalId: MCP_SERVICE_PRINCIPAL_ID, key: shared, enabled: sharedMcpKeyEnabled() });
  }
  return credentials;
}

function keysMatch(provided: string, expected: string): boolean {
  // Fixed-size digests avoid leaking credential length through the comparison.
  const digest = (key: string) => createHash("sha256").update(key).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

function resolveKey(provided: string, credentials: ReturnType<typeof keyCredentials>) {
  const matches = credentials.filter(({ key }) => keysMatch(provided, key));
  // A disabled slot wins even if its key was accidentally reused in an enabled
  // slot. Multiple principals sharing a credential fail closed as ambiguous.
  const principalIds = new Set(matches.map(({ principalId }) => principalId));
  const principalId = principalIds.size === 1 ? matches[0].principalId : null;
  const disabled = matches.some(({ enabled }) => !enabled);
  return { principalId, disabled };
}

/** Resolve only enabled, unambiguous keys; legacy remains enabled by default. */
export function resolveMcpPrincipalIdFromKey(
  provided: string
): McpAgentServicePrincipalId | null {
  if (!provided) return null;
  const resolved = resolveKey(provided, keyCredentials());
  return resolved.disabled ? null : resolved.principalId;
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
  if (!ACTIVE_REPOS_BY_LOWER.has(repo.toLowerCase())) {
    // TASK-1958 staged rollout: log-only. Follow-up enforcement must throw
    // ApiError("repo_not_allowlisted", ..., 403) only after operator review.
    // Never log raw header values: even X-MC-Repo can contain a misplaced key.
    console.warn("[mcp] repo header validation", {
      event: "mcp.repo_not_allowlisted",
      code: "repo_not_allowlisted",
      mode: "log-only",
      source: "x-mc-repo",
    });
  }
  const agentHeader = (req.headers.get("x-mc-agent") ?? "").trim();
  if (agentHeader) {
    if (!AGENT_ID_RE.test(agentHeader)) {
      throw new ApiError("invalid_agent", "X-MC-Agent must be <runtime>/<lane>, e.g. claude-code/claude-uat.", 400);
    }
    if (agentHeader.split("/")[0].toLowerCase() !== runtime.toLowerCase()) {
      throw new ApiError("invalid_agent", `X-MC-Agent must start with the X-MC-Runtime value (${runtime}).`, 400);
    }
    return { operatorEmail, runtime, workerId, repo, agent: agentHeader };
  }
  return { operatorEmail, runtime, workerId, repo };
}

function recordMcpAuthDenial(
  principalId: string,
  reasonCode: "unknown_actor" | "actor_revoked" | "key_revoked"
): void {
  void recordPermissionDecision({
    site: "mcp.auth",
    actorKind: "service",
    actorId: principalId,
    capability: "mcp.authenticate",
    allowed: false,
    reasonCode,
    policyVersion: POLICY_VERSION,
  });
}

/**
 * Resolve a durable MCP agent service principal. Staged enforcement decides
 * whether durable records gate the actor: revocation/existence fail closed
 * from "review" onward, log-only stays fail-open, off stays DB-free.
 * Missing and revoked principals record a denial before the throw.
 */
export async function resolveMcpServicePrincipal(
  principalId: McpAgentServicePrincipalId = MCP_SERVICE_PRINCIPAL_ID,
  options: McpAuthOptions = {}
): Promise<{
  actor: PermissionActor;
  shadowActor: PermissionActor | null;
  shadowMissing: boolean;
}> {
  const staged = await resolveStagedServicePrincipal(principalId, options.query);
  if (!staged.actor) {
    recordMcpAuthDenial(principalId, "unknown_actor");
    throw new ApiError(
      "mcp_service_principal_missing",
      "The MCP service principal is not configured.",
      503
    );
  }
  if (staged.actor.status !== "active") {
    recordMcpAuthDenial(principalId, "actor_revoked");
    throw new ApiError(
      "mcp_service_principal_revoked",
      "The MCP service principal is revoked.",
      403
    );
  }
  return {
    actor: staged.actor,
    shadowActor: staged.shadowActor,
    shadowMissing: staged.shadowMissing,
  };
}

export async function verifyMcpRequest(
  req: Request,
  options: McpAuthOptions = {}
): Promise<McpIdentity> {
  if (!mcpEnabled()) {
    throw new ApiError("mcp_disabled", "PLX MC MCP is disabled (PLX_MC_MCP_ENABLED != 1).", 503);
  }
  const credentials = keyCredentials();
  const provided = readApiKey(req);
  const { principalId, disabled } = resolveKey(provided, credentials);
  if (principalId && disabled) {
    recordMcpAuthDenial(principalId, "key_revoked");
    // Keep the public auth envelope stable; the decision audit carries reasonCode.
    throw new ApiError("invalid_api_key", "Invalid or missing MCP API key.", 401);
  }
  if (!credentials.some(({ enabled }) => enabled)) {
    throw new ApiError("mcp_key_not_configured", "No MCP API key is configured on the server.", 503);
  }
  if (!principalId || disabled) {
    throw new ApiError("invalid_api_key", "Invalid or missing MCP API key.", 401);
  }
  const operator = parseOperatorContext(req);
  const resolved = await resolveMcpServicePrincipal(principalId, options);
  return {
    ...operator,
    servicePrincipalId: principalId,
    actor: resolved.actor,
    shadowActor: resolved.shadowActor,
    shadowMissing: resolved.shadowMissing,
  };
}
