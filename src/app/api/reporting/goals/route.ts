// GET /api/reporting/goals — the Goals & Production page model: the latest
// successful refresh combined with the live manual entries, plus the run it
// came from, the query behind each section, and whether this viewer may
// refresh. Viewers and Editors. `?fx=sage` converts USD revenue at the fixed
// Sage rate instead of the run's Bank of Canada rate (TASK-3780). `?sales=`
// narrows it to some salespeople's customers: codes, comma-separated, and
// `none` for customers without one (TASK-4277).

import { ApiError, route } from "@/lib/api/route";
import { loadGoalsView, requireGoalsRole, revenueBasisParam, salesParam, type GoalsPage } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async (req): Promise<GoalsPage> => {
  const actor = await requireGoalsRole("viewer");
  const params = new URL(req.url).searchParams;
  const basis = revenueBasisParam(params.get("fx"));
  if (!basis) throw new ApiError("invalid_request", "fx must be boc or sage.");
  const sales = salesParam(params.get("sales"));
  if (!sales) throw new ApiError("invalid_request", "sales must be Sage salesperson codes or none, separated by commas.");
  const view = await loadGoalsView(basis, sales);
  return { ...view, viewer: { editor: actor.roles.includes("editor") } };
});
