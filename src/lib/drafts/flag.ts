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

// Review pages (TASK-4135): a frozen version published as a Claude Artifact, its
// comments relayed back as reviews. Off by default (Vince, 2026-10-29); an
// operator sets PLX_MC_DRAFT_PAGES_ENABLED=1 to turn it on, and unsets it to stop
// every render, publish and relay at once.
export const DRAFT_PAGES_FLAG = "PLX_MC_DRAFT_PAGES_ENABLED";

export function draftPagesEnabled(): boolean {
  return (process.env[DRAFT_PAGES_FLAG] ?? "0").trim() === "1";
}

export function assertDraftPagesEnabled(): void {
  if (draftPagesEnabled()) return;
  throw new ApiError("draft_pages_off", `Review pages are off. An operator turns them on with ${DRAFT_PAGES_FLAG}=1.`, 503);
}
