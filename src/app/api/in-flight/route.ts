// GET /api/in-flight — the Dashboard's live In flight panel (TASK-2592): open
// checkouts grouped by task with each task's latest activity, the newest
// meaningful events, and a task-write marker the client uses to decide when to
// reload its snapshot. Session-authenticated read (the /api/agent-metrics
// gate), filtered by project access like /api/events. Polled every 20 s.

import { route } from "@/lib/api/route";
import { loadInFlight } from "@/lib/compliance/in-flight";
import { aclPrincipalFromSession, requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireSessionActor("task.read");
  return loadInFlight(await aclPrincipalFromSession());
});
