// GET /api/reporting/goals — the Goals & Production page model: the latest
// successful refresh combined with the live manual entries, plus the run it
// came from, the query behind each section, and whether this viewer may
// refresh. Viewers and Editors.

import { route } from "@/lib/api/route";
import { loadGoalsView, requireGoalsRole, type GoalsPage } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async (): Promise<GoalsPage> => {
  const actor = await requireGoalsRole("viewer");
  const view = await loadGoalsView();
  return { ...view, viewer: { editor: actor.roles.includes("editor") } };
});
