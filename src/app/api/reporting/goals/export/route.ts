// GET /api/reporting/goals/export — the Goals & Production workbook
// (TASK-2898): the eight-sheet .xlsx of the latest good refresh plus the live
// manual entries, exactly as the page shows them, downloaded as
// "PLX goals and production YYYY-MM-DD.xlsx" (the run's Toronto date).
// Viewers and Editors. Each export is recorded as reporting.goals.export (who,
// and the run id; never figures).

import { ApiError, route } from "@/lib/api/route";
import { appendEvent } from "@/lib/compliance/repo";
import {
  XLSX_CONTENT_TYPE,
  buildGoalsWorkbook,
  loadGoalsExport,
  requireGoalsRole,
  workbookFileName,
} from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const actor = await requireGoalsRole("viewer");
  const { view, shipments, truckloads, rates } = await loadGoalsExport();
  const { run, model, settings } = view;
  if (view.state !== "ready" || !run || !model || !settings) {
    throw new ApiError(
      "no_data",
      view.state === "not_configured"
        ? "There’s nothing to export: Goals & production isn’t connected to the reporting database yet."
        : "There’s nothing to export yet: the report fills in after its first refresh.",
      404
    );
  }
  const workbook = await buildGoalsWorkbook({ run, model, settings, shipments, truckloads, rates, exportedAt: new Date(), forecast: view.forecast });
  await appendEvent({ kind: "reporting.goals.export", actor: `human:${actor.label}`, payload: { runId: run.id } });
  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${workbookFileName(model.today)}"`,
      "cache-control": "no-store",
    },
  });
});
