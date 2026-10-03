// POST /api/cursor/checkouts/release — mc_release_checkout (TASK-2326).
// Releases one stray or expired checkout lease. Shared with the HTTP MCP tool
// via actionReleaseCheckout; never touches the task stage or Verified.

import { actionReleaseCheckout, releaseCheckoutSchema } from "@/lib/mcp/checkout-release-actions";
import { taskLink } from "@/lib/mcp/envelope";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_release_checkout", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, releaseCheckoutSchema);
  const data = await actionReleaseCheckout(identity, body);
  return { data, meta: { links: { ...meta.links, task: taskLink(data.taskId) } } };
});
