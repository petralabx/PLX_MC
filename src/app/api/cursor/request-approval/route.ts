// POST /api/cursor/request-approval — mc_request_approval (TASK-629).
// An agent mid-run raises a runtime approval gate on its Task (the A2A
// input-required pattern): the task's stage freezes until a human other than
// the requester decides the gate in the Approvals inbox. Shared with the HTTP
// MCP tool via actionRequestApproval.

import { actionRequestApproval, requestApprovalSchema } from "@/lib/mcp/approval-actions";
import { taskLink } from "@/lib/mcp/envelope";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_request_approval", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, requestApprovalSchema);
  const data = await actionRequestApproval(identity, body);
  return {
    data,
    meta: {
      links: {
        ...meta.links,
        task: taskLink(body.taskId),
      },
    },
  };
});
