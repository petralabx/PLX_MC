// POST /api/cursor/checkouts/release-batch — mc_release_checkouts (TASK-2326).
// Batch form of /api/cursor/checkouts/release with per-item outcomes.

import { actionReleaseCheckouts, releaseCheckoutsSchema } from "@/lib/mcp/checkout-release-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_release_checkouts", async (req, _ctx, identity) => {
  const body = await parseCursorBody(req, releaseCheckoutsSchema);
  return { data: await actionReleaseCheckouts(identity, body) };
});
