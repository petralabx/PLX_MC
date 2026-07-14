// GET /api/routing/inbox — session-authenticated proposal queue list.

import { ApiError, route } from "@/lib/api/route";
import {
  assertRoutingInboxEnabled,
  requireInboxActor,
} from "./_lib/guard";
import { listInboxProposals } from "./_lib/queries";
import type { InboxScope } from "./_lib/types";

const SCOPES = new Set<InboxScope>(["personal", "project", "bucket", "unrouted"]);

export const GET = route(async (req) => {
  assertRoutingInboxEnabled();
  const authorized = await requireInboxActor("routing.resolve");

  const url = new URL(req.url);
  const rawScope = (url.searchParams.get("scope") ?? "personal").toLowerCase();
  if (!SCOPES.has(rawScope as InboxScope)) {
    throw new ApiError("invalid_request", "scope must be personal|project|bucket|unrouted.", 400);
  }
  const scope = rawScope as InboxScope;
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const bucketId = url.searchParams.get("bucketId") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    return await listInboxProposals({
      scope,
      actorId: authorized.actorId,
      projectId,
      bucketId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  } catch (err) {
    // Offline / no Postgres — fail closed with empty queue rather than 500 in
    // local E2E without DATABASE_URL; real misconfig still surfaces.
    const message = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|databaseUrl|DATABASE|password authentication|does not exist/i.test(message)) {
      return {
        proposals: [],
        counts: { personal: 0, project: 0, bucket: 0, unrouted: 0 },
        offline: true,
      };
    }
    throw err;
  }
});
