// Server-only guard for agent assignees (agent fleet P8). Import from routes
// and actions, not the permissions barrel (keeps next/server out of the
// browser bundle).

import { ApiError } from "@/lib/api/route";
import { isAgentAssignee, mayAssignAgent } from "./agent-assignee";
import type { PermissionActor } from "./types";

/** Throws 403 when the actor may not set this assignee. */
export function assertAgentAssigneeAllowed(
  actor: PermissionActor | null | undefined,
  assignee: string | null | undefined
): void {
  if (!isAgentAssignee(assignee) || mayAssignAgent(actor)) return;
  throw new ApiError(
    "forbidden",
    "Only a signed-in person or sp_mcp_portal may set an agent: assignee.",
    403
  );
}
