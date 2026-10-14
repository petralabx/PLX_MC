// GET /api/reporting/goals — the Goals & Production page model: the latest
// successful refresh combined with the live manual entries, plus the run it
// came from and the query behind each section. Viewers and Editors.

import { route } from "@/lib/api/route";
import { loadGoalsView, requireGoalsRole } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireGoalsRole("viewer");
  return loadGoalsView();
});
