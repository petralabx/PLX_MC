// MCP cursor API authentication — service key + operator identity headers.
// Fail closed: missing/invalid key or non-allowlisted operator → 401/403.

import { ApiError } from "@/lib/api/route";
import { isAllowedUser } from "@/lib/auth/gate";

export interface McpIdentity {
  operatorEmail: string;
  runtime: string;
  workerId: string;
  repo: string;
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

export function mcpEnabled(): boolean {
  return (process.env.PLX_MC_MCP_ENABLED ?? "0").trim() === "1";
}

export function parseIdentity(req: Request): McpIdentity {
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
    throw new ApiError("missing_repo", "X-MC-Repo is required (e.g. taylorvalton/PLX_MC).", 400);
  }
  return { operatorEmail, runtime, workerId, repo };
}

export function verifyMcpRequest(req: Request): McpIdentity {
  if (!mcpEnabled()) {
    throw new ApiError("mcp_disabled", "PLX MC MCP is disabled (PLX_MC_MCP_ENABLED != 1).", 503);
  }
  const expected = expectedMcpApiKey();
  if (!expected) {
    throw new ApiError("mcp_key_not_configured", "PLX_MC_MCP_API_KEY is not configured on the server.", 503);
  }
  const provided = readApiKey(req);
  if (!provided || provided !== expected) {
    throw new ApiError("invalid_api_key", "Invalid or missing MCP API key.", 401);
  }
  return parseIdentity(req);
}
