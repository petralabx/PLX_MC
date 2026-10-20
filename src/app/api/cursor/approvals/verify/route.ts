// POST /api/cursor/approvals/verify — mc_verify_approval (TASK-3408, TASK-3444):
// does a signed approval on the task cover this launch, merge or flag now?
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";
import { actionVerifyApproval, verifyApprovalSchema } from "@/lib/mcp/approval-actions";

export const POST = cursorRoute("mc_verify_approval", async (req, _ctx, identity) => {
  const input = await parseCursorBody(req, verifyApprovalSchema);
  return { data: await actionVerifyApproval(identity, input) };
});
