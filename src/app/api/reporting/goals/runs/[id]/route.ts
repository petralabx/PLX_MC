// GET /api/reporting/goals/runs/[id] — one refresh run: status, current step,
// cutoffs, rate and error. The Refresh button polls it. Viewers and Editors.

import { ApiError, route } from "@/lib/api/route";
import { getRun, requireGoalsRole } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => {
  await requireGoalsRole("viewer");
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(runId) || runId <= 0) {
    throw new ApiError("invalid_request", "Run id must be a positive whole number.");
  }
  const run = await getRun(runId);
  if (!run) throw new ApiError("not_found", `No refresh run ${runId}.`, 404);
  return run;
});
