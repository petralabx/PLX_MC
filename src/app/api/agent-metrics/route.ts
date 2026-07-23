// GET /api/agent-metrics — per-runtime agent outcome metrics (TASK-632/633):
// success, rework, cycle time, and session token/cost telemetry, computed
// from the append-only mc_events substrate. Session-authenticated read.

import { route } from "@/lib/api/route";
import { loadAgentOutcomes } from "@/lib/routing/outcomes";
import { requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireSessionActor("task.read");
  const outcomes = await loadAgentOutcomes();
  return { outcomes };
});
