// GET /api/sync/freshness — required-register freshness for the conflict console.
// Fail-closed consumer: Sync console pauses resolutions when code is sync_stale.
// Reuses checkRoutingFreshness → evaluateSyncFreshness (no engine rewrite).

import { route } from "@/lib/api/route";
import { checkRoutingFreshness } from "@/lib/sync";

export const GET = route(async () => checkRoutingFreshness());
