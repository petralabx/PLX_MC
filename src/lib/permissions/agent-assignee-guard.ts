// Server-only guard for agent assignees (agent fleet P8). Import from routes
// and actions, not the permissions barrel (keeps next/server out of the
// browser bundle).

import { ApiError } from "@/lib/api/route";
import { recordPermissionDecision } from "./decision-log";
import { isAgentAssignee, mayAssignAgent, mayAssignRegisteredAgent } from "./agent-assignee";
import { POLICY_VERSION, type PermissionActor } from "./types";

/** Throws 403 when the actor may not set this assignee. */
export function assertAgentAssigneeAllowed(
  actor: PermissionActor | null | undefined,
  assignee: string | null | undefined,
  audit?: { capability?: string }
): void {
  if (!isAgentAssignee(assignee)) return;
  const allowed = mayAssignAgent(actor, assignee);
  void recordPermissionDecision({
    site: "permissions.agent-assignee",
    actorKind: actor?.kind === "human" ? "human" : "service",
    actorId: actor?.id?.trim() || "unknown",
    capability: audit?.capability ?? "task.create",
    allowed,
    reasonCode: allowed ? "allowed" : "context_denied",
    policyVersion: POLICY_VERSION,
  });
  if (allowed) return;
  if (mayAssignRegisteredAgent(actor)) {
    throw new ApiError(
      "forbidden",
      "An agent: assignee must name a registered agent principal: exactly agent:<slug>, in lower case, where sp_mcp_<slug> exists.",
      403
    );
  }
  throw new ApiError(
    "forbidden",
    "Only a signed-in person, sp_mcp_portal or a principal holding task.assign may set an agent: assignee.",
    403
  );
}
