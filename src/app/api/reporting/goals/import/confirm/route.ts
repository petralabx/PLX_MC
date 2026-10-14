// POST /api/reporting/goals/import/confirm — an Editor applies their preview (TASK-2897).
// Body: { importId, token } from POST …/import. Everything is applied in one
// transaction and audited (reporting.goals.import.confirmed, with counts); the
// uploaded file stays in report_manual_import. 409 entries_changed when the
// entries changed since the preview — nothing is applied then.

import { parseBody, route } from "@/lib/api/route";
import { CONFIRM_BODY, confirmImport, requireGoalsRole } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route(async (req) => {
  const actor = await requireGoalsRole("editor");
  const body = await parseBody(req, CONFIRM_BODY);
  return confirmImport({ importId: body.importId, token: body.token, actor });
});
