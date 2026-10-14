// POST /api/reporting/goals/refresh — an Editor refreshes the report now.
// Answers 202 with the claimed run as soon as it is claimed; the refresh then
// finishes after the response (poll GET /api/reporting/goals/runs/<id>). One
// refresh runs at a time (409) and users may start one per 5 minutes (429).

import { after, NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { requireGoalsRole, runRefresh, startRefresh } from "@/lib/reporting/goals";
import { reportingDatabaseConfigured } from "@/lib/secrets";

export const dynamic = "force-dynamic";
// The refresh outlives the response: a 120 s attempt budget plus retries.
export const maxDuration = 300;

const refreshSchema = z.object({}).strict();

export const POST = route(async (req) => {
  const actor = await requireGoalsRole("editor");
  await parseBody(req, refreshSchema);
  if (!reportingDatabaseConfigured()) {
    throw new ApiError("not_configured", "Goals & production isn't connected to the reporting database yet.", 503);
  }
  const claim = await startRefresh("user", actor.label);
  if (claim.kind === "running") {
    throw new ApiError("refresh_running", "A refresh is already running.", 409);
  }
  if (claim.kind === "rate_limited") {
    const minutes = Math.max(1, Math.ceil(claim.retryAfterSeconds / 60));
    throw new ApiError(
      "rate_limited",
      `The report refreshed less than 5 minutes ago. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      429
    );
  }
  const work = async () => {
    try {
      await runRefresh(claim.run);
    } catch (err) {
      // Only a Mission Control database failure reaches here; the run row stays
      // "running" until the next claim fails it as abandoned.
      console.error("[reporting-goals] refresh run=%s could not finish: %s", claim.run.id, err instanceof Error ? err.message : String(err));
    }
  };
  try {
    after(work);
  } catch {
    // Outside a Next request scope (tests / direct invocation): run fire-and-forget.
    void work();
  }
  return NextResponse.json({ data: { run: claim.run } }, { status: 202 });
});
