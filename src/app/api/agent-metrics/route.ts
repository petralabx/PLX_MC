// GET /api/agent-metrics — per-runtime agent outcome metrics (TASK-632/633):
// success, rework, cycle time, and session token/cost telemetry, computed
// from the append-only mc_events substrate. Also `principals`: the same
// outcomes keyed per service principal with gate outcomes and stage reopens.
// Optional `?windowDays=1..90` bounds both views to a rolling window.
// Session-authenticated read.

import { z } from "zod";

import { ApiError, route } from "@/lib/api/route";
import { loadCostRollup } from "@/lib/routing/cost-rollup";
import {
  MAX_WINDOW_DAYS,
  loadAgentOutcomes,
  loadPrincipalOutcomes,
} from "@/lib/routing/outcomes";
import { requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(MAX_WINDOW_DAYS).optional(),
});

export const GET = route(async (req) => {
  await requireSessionActor("task.read");
  const raw = new URL(req.url).searchParams.get("windowDays");
  const parsed = querySchema.safeParse({ windowDays: raw === null || raw === "" ? undefined : raw });
  if (!parsed.success) {
    throw new ApiError("invalid_query", `windowDays must be an integer 1-${MAX_WINDOW_DAYS}.`);
  }
  const { windowDays } = parsed.data;
  const [outcomes, { principals, truncated }] = await Promise.all([
    loadAgentOutcomes({ windowDays }),
    loadPrincipalOutcomes({ windowDays }),
  ]);
  const body = { outcomes, principals, windowDays: windowDays ?? null, truncated };
  // ?rollup=cost adds per-runtime and per-bucket cost-per-completed-task
  // (not bounded by windowDays).
  if (new URL(req.url).searchParams.get("rollup") === "cost") {
    return { ...body, cost: await loadCostRollup() };
  }
  return body;
});
