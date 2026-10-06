// Per-principal MCP tool allowlists (agent fleet P8, decision CG-07b).
//
// A capability grant is coarse: task.read admits mc_search_tasks, but also
// mc_get_context, mc_list_buckets, mc_list_conflicts and the other read tools.
// A principal listed here may call only the named tools. Every other tool
// gives 403 forbidden, over HTTP MCP (create-http-server.ts) and over the
// cursor REST routes (route.ts). The capability checks inside each action
// still run as well. A principal that is not listed keeps every tool.

import { ApiError } from "@/lib/api/route";
import {
  POLICY_VERSION,
  PORTAL_MCP_SERVICE_PRINCIPAL_ID,
  type McpAgentServicePrincipalId,
} from "@/lib/permissions";
import { recordPermissionDecision } from "@/lib/permissions/decision-log";

export const MCP_TOOL_ALLOWLISTS: Readonly<
  Partial<Record<McpAgentServicePrincipalId, readonly string[]>>
> = {
  // The portal's COS delegate tool creates tasks (an agent: assignee
  // included) and searches them. The portal also reads agent reports through
  // GET /api/cursor/agent-reports (fleet P8b). Nothing else.
  // mc_update_task / mc_update_tasks remain Hub-only, like progress/release.
  [PORTAL_MCP_SERVICE_PRINCIPAL_ID]: ["mc_create_task", "mc_search_tasks", "mc_list_agent_reports"],
};

export function isMcpToolAllowed(principalId: string, tool: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(MCP_TOOL_ALLOWLISTS, principalId)) return true;
  const allowlist = MCP_TOOL_ALLOWLISTS[principalId as McpAgentServicePrincipalId] ?? [];
  return allowlist.includes(tool);
}

export function assertMcpToolAllowed(
  identity: { servicePrincipalId: string; operatorEmail?: string },
  tool: string
): void {
  if (isMcpToolAllowed(identity.servicePrincipalId, tool)) return;
  void recordPermissionDecision({
    site: "mcp.tool-allowlist",
    actorKind: "service",
    actorId: identity.servicePrincipalId,
    capability: tool,
    allowed: false,
    reasonCode: "tool_not_allowlisted",
    policyVersion: POLICY_VERSION,
    auditLabel: identity.operatorEmail,
  });
  throw new ApiError(
    "forbidden",
    `${tool} is denied for ${identity.servicePrincipalId}. It may call only: ${(
      MCP_TOOL_ALLOWLISTS[identity.servicePrincipalId as McpAgentServicePrincipalId] ?? []
    ).join(", ")}.`,
    403
  );
}
