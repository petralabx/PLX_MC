// GET /api/activity — cross-repo activity summary for the Activity screen: per
// fleet registry repo, last activity, open/unstamped PRs, unattributed merged
// PRs (newest nightly backfill report), gate block rate and data freshness.
// Computed on demand from mc_events (the /api/events substrate, which pages
// oldest-first and so cannot serve a "latest" view directly). Session-authenticated
// read, same gate as /api/agent-metrics.

import { route } from "@/lib/api/route";
import { loadRepoActivity } from "@/lib/compliance/activity";
import { requireSessionActor } from "@/lib/routing/mutations/actors";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireSessionActor("task.read");
  return loadRepoActivity();
});
