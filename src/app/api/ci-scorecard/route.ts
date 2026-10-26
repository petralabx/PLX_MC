// GET /api/ci-scorecard — the CI scorecard (TASK-3913): the stored weekly
// snapshots, one per ISO week, graded against the CI redesign's targets for the
// current phase. `latest` is the newest week; `history` the weekly scores,
// oldest first. Optional `?weeks=1..52` (default 12) bounds the history.
// Session-authenticated read.

import { z } from "zod";

import { ApiError, route } from "@/lib/api/route";
import { buildScorecard } from "@/lib/ci-scorecard";
import { listSnapshots } from "@/lib/ci-scorecard/store";
import { requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

const querySchema = z.object({ weeks: z.coerce.number().int().min(1).max(52).default(12) });

export const GET = route(async (req) => {
  await requireSessionActor("task.read");
  const raw = new URL(req.url).searchParams.get("weeks");
  const parsed = querySchema.safeParse({ weeks: raw === null || raw === "" ? undefined : raw });
  if (!parsed.success) {
    throw new ApiError("invalid_query", "weeks must be an integer 1-52.");
  }
  const scorecard = buildScorecard(await listSnapshots());
  return { ...scorecard, history: scorecard.history.slice(-parsed.data.weeks) };
});
