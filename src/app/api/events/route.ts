// GET /api/events?after=<seq>&limit=<n>&kind=<kind> — the append-only event log
// export (EN-007 decision 13, the Second-Brain feed). Keyset pagination on the
// monotonic `seq`: page forward with `after=<nextCursor>`. Optional `kind` filter.

import { route } from "@/lib/api/route";
import { parseEventsQuery } from "@/lib/compliance/events";
import { listEvents } from "@/lib/compliance/service";

export const GET = route(async (req) => {
  const q = parseEventsQuery(new URL(req.url).searchParams);
  const events = await listEvents(q);
  const nextCursor = events.length > 0 ? events[events.length - 1].seq : null;
  // hasMore lets a consumer stop without an extra round-trip (review N9): a
  // partial page (< limit) is the last page even though nextCursor is non-null.
  const hasMore = events.length === q.limit;
  return { events, nextCursor, hasMore };
});
