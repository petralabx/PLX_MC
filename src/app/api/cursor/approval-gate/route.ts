// GET /api/cursor/approval-gate — mc_get_approval_gate (TASK-629): the agent resume
// signal for a runtime approval gate. Optional bounded long-poll (waitSeconds, hard
// cap 25 s) so it stays inside the serverless function budget.

import { ApiError } from "@/lib/api/route";
import { actionGetApprovalGate, getApprovalGateSchema } from "@/lib/mcp/approval-actions";
import { taskLink } from "@/lib/mcp/envelope";
import { cursorRoute } from "@/lib/mcp/route";

export const maxDuration = 30;

export const GET = cursorRoute("mc_get_approval_gate", async (req, _ctx, identity, meta) => {
  const p = new URL(req.url).searchParams;
  const wait = p.get("waitSeconds");
  const parsed = getApprovalGateSchema.safeParse({
    checkoutId: p.get("checkoutId") ?? undefined,
    taskId: p.get("taskId") ?? undefined,
    gateId: p.get("gateId") ?? undefined,
    waitSeconds: wait === null ? undefined : Number(wait),
  });
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  const data = await actionGetApprovalGate(identity, parsed.data);
  return { data, meta: { links: { ...meta.links, task: taskLink(data.taskId) } } };
});
