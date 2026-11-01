// Agent assignees (agent fleet P8, D15/D16; TASK-4005 part c). A task's
// assignee may name an agent as `agent:<slug>`.
// - A signed-in person or sp_mcp_portal may set any slug. The portal checks
//   the slug against its own agent registry (for example
//   agent:hasitha-fernando).
// - Any other active MCP principal that holds task.assign (today sp_mcp_ledger
//   and sp_mcp_cos) may set one only when sp_mcp_<slug> is a registered agent
//   principal (Vince, 2026-11-01, question q_a9fe0b74e79fadee). Person
//   principals (sp_mcp_person_*) are people, not agents, so they do not count.
// Outside doors such as Grok Bot hold no task.assign, so they still cannot
// delegate work through MC.
// Pure predicates: safe for the client barrel. The throwing guard lives in
// agent-assignee-guard.ts (server only).

import { capabilitiesForServicePrincipal } from "./grants";
import {
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  PORTAL_MCP_SERVICE_PRINCIPAL_ID,
  type PermissionActor,
} from "./types";

export const AGENT_ASSIGNEE_PREFIX = "agent:";

const PRINCIPAL_PREFIX = "sp_mcp_";
const PERSON_PRINCIPAL_PREFIX = "sp_mcp_person_";

/** `agent:<slug>` for each registered agent principal sp_mcp_<slug>. */
const REGISTERED_AGENT_ASSIGNEES = new Set<string>(
  MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter((id) => !id.startsWith(PERSON_PRINCIPAL_PREFIX)).map(
    (id) => AGENT_ASSIGNEE_PREFIX + id.slice(PRINCIPAL_PREFIX.length)
  )
);

/** True when the assignee names an agent. Case and outer spaces do not matter. */
export function isAgentAssignee(assignee: string | null | undefined): boolean {
  return (
    typeof assignee === "string" &&
    assignee.trim().toLowerCase().startsWith(AGENT_ASSIGNEE_PREFIX)
  );
}

/**
 * True when the assignee is exactly `agent:<slug>`, in lower case with no outer
 * spaces, and sp_mcp_<slug> is a registered agent principal. Task creation
 * stores the assignee as sent, so only this one spelling is accepted: every
 * task assigned to an agent then stores the same value.
 */
export function isRegisteredAgentAssignee(assignee: string | null | undefined): boolean {
  return typeof assignee === "string" && REGISTERED_AGENT_ASSIGNEES.has(assignee);
}

/** True when the actor may set any agent assignee: an active person or sp_mcp_portal. */
export function mayAssignAnyAgent(actor: PermissionActor | null | undefined): boolean {
  if (!actor || actor.status !== "active") return false;
  if (actor.kind === "human") return true;
  return actor.id === PORTAL_MCP_SERVICE_PRINCIPAL_ID;
}

/** True when the actor is an active MCP principal holding task.assign. */
export function mayAssignRegisteredAgent(actor: PermissionActor | null | undefined): boolean {
  if (!actor || actor.status !== "active" || actor.kind !== "service") return false;
  return capabilitiesForServicePrincipal(actor.id).includes("task.assign");
}

/** True when the actor may set this agent assignee. */
export function mayAssignAgent(
  actor: PermissionActor | null | undefined,
  assignee: string | null | undefined
): boolean {
  if (mayAssignAnyAgent(actor)) return true;
  return mayAssignRegisteredAgent(actor) && isRegisteredAgentAssignee(assignee);
}
