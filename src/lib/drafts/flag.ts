// Draft Projects feature flag (TASK-4059). Off unless PLX_MC_DRAFTS_ENABLED=1,
// which is also the kill switch: setting it back off stops every draft tool
// and route at once, with no code change. While off, nothing reads or
// writes the drafts tables.

import { ApiError } from "@/lib/api/route";

export const DRAFTS_FLAG = "PLX_MC_DRAFTS_ENABLED";

export function draftsEnabled(): boolean {
  return process.env[DRAFTS_FLAG] === "1";
}

export function assertDraftsEnabled(): void {
  if (draftsEnabled()) return;
  throw new ApiError("drafts_disabled", `Draft Projects are off. An operator turns them on with ${DRAFTS_FLAG}=1.`, 404);
}
