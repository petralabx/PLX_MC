// GET /api/reporting/goals/runs/[id]/shipment-lines — one good refresh run's
// Sage invoice lines (TASK-3144), as the refresh read them, and whether the
// login could read them. The shipments list fetches them once when it opens, so
// the page model stays small (a busy month's lines would more than double it).
// Viewers and Editors. 404 when the run has none stored (it failed, or it
// predates them).

import { ApiError, route } from "@/lib/api/route";
import { loadShipmentLines, requireGoalsRole } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => {
  await requireGoalsRole("viewer");
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(runId) || runId <= 0) {
    throw new ApiError("invalid_request", "Run id must be a positive whole number.");
  }
  const lines = await loadShipmentLines(runId);
  if (!lines) throw new ApiError("not_found", `Refresh run ${runId} has no invoice lines.`, 404);
  return lines;
});
