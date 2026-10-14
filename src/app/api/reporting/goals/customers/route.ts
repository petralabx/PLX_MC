// GET /api/reporting/goals/customers — the Sage customers from the latest good
// refresh (code, name, currency), for the entry form's customer picker
// (TASK-2897). Viewers and Editors.

import { route } from "@/lib/api/route";
import { latestCustomers, requireGoalsRole } from "@/lib/reporting/goals";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireGoalsRole("viewer");
  return { customers: await latestCustomers() };
});
