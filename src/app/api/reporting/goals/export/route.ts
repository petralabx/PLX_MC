// GET /api/reporting/goals/export — the Goals & Production workbook
// (TASK-2898): the ten-sheet .xlsx of the latest good refresh plus the live
// manual entries, exactly as the page shows them, downloaded as
// "PLX goals and production YYYY-MM-DD.xlsx" (the run's Toronto date).
// `?fx=sage` converts USD revenue at the fixed Sage rate, as the page can, and
// adds " (Sage rate)" to the name (TASK-3780). `?sales=` narrows it to some
// salespeople's customers, as the page can, and names them (TASK-4277).
// Viewers and Editors. Each export is recorded as reporting.goals.export (who,
// the run id, the rate and the salespeople; never figures).

import { ApiError, route } from "@/lib/api/route";
import { appendEvent } from "@/lib/compliance/repo";
import {
  XLSX_CONTENT_TYPE,
  buildGoalsWorkbook,
  loadGoalsExport,
  requireGoalsRole,
  revenueBasisParam,
  salesParam,
  workbookFileName,
} from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const actor = await requireGoalsRole("viewer");
  const params = new URL(req.url).searchParams;
  const basis = revenueBasisParam(params.get("fx"));
  if (!basis) throw new ApiError("invalid_request", "fx must be boc or sage.");
  const sales = salesParam(params.get("sales"));
  if (!sales) throw new ApiError("invalid_request", "sales must be Sage salesperson codes or none, separated by commas.");
  const { view, shipments, shipmentLines, truckloads, rates, creditNotes, pendingShipments } = await loadGoalsExport(basis, sales);
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
  // Never a workbook of every customer under a salesperson's name.
  const narrowed = view.salespeople?.applied ? view.salespeople : null;
  if (sales.length > 0 && !narrowed) {
    throw new ApiError("salespeople_unavailable", "Sage’s salespeople can’t be read right now, so the workbook can’t be narrowed to them.", 503);
  }
  const workbook = await buildGoalsWorkbook({
    run,
    model,
    settings,
    shipments,
    shipmentLines,
    truckloads,
    rates,
    exportedAt: new Date(),
    forecast: view.forecast,
    revenueByClass: view.revenueByClass,
    creditNotes,
    pendingShipments,
    customerRevenue: view.customerRevenue,
    salespeople: narrowed?.label,
  });
  await appendEvent({
    kind: "reporting.goals.export",
    actor: `human:${actor.label}`,
    payload: { runId: run.id, fx: basis, ...(narrowed ? { sales: narrowed.selected } : {}) },
  });
  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${workbookFileName(model.today, basis, narrowed?.selected)}"`,
      "cache-control": "no-store",
    },
  });
});
