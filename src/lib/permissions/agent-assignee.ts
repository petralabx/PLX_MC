// Agent assignees (agent fleet P8, D15/D16). A task's assignee may name an
// agent as `agent:<slug>`. Only a signed-in person or sp_mcp_portal may set
// one, so outside doors such as Grok Bot cannot delegate work through MC.
// Pure predicates: safe for the client barrel. The throwing guard lives in
// agent-assignee-guard.ts (server only).

import { PORTAL_MCP_SERVICE_PRINCIPAL_ID, type PermissionActor } from "./types";

export const AGENT_ASSIGNEE_PREFIX = "agent:";

/** True when the assignee names an agent. Case and outer spaces do not matter. */
export function isAgentAssignee(assignee: string | null | undefined): boolean {
  return (
    typeof assignee === "string" &&
    assignee.trim().toLowerCase().startsWith(AGENT_ASSIGNEE_PREFIX)
  );
}

/** True when the actor may set an agent assignee: an active person or sp_mcp_portal. */
export function mayAssignAgent(actor: PermissionActor | null | undefined): boolean {
  if (!actor || actor.status !== "active") return false;
  if (actor.kind === "human") return true;
  return actor.id === PORTAL_MCP_SERVICE_PRINCIPAL_ID;
}
