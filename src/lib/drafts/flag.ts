// Draft Projects feature flag (TASK-4059). On unless PLX_MC_DRAFTS_ENABLED=0,
// which is the kill switch: setting it stops every draft tool, route and the
// Drafts screen at once, with no code change. While off, nothing reads or
// writes the drafts tables. Step 2 shipped it off by default; step 3, with the
// screen and Accept, turns it on.

import { ApiError } from "@/lib/api/route";

export const DRAFTS_FLAG = "PLX_MC_DRAFTS_ENABLED";

export function draftsEnabled(): boolean {
  return process.env[DRAFTS_FLAG] !== "0";
}

export function assertDraftsEnabled(): void {
  if (draftsEnabled()) return;
  throw new ApiError("drafts_disabled", `Draft Projects are off (${DRAFTS_FLAG}=0). An operator turns them back on by removing it.`, 404);
}
