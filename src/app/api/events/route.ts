// GET /api/events?after=<seq>&limit=<n>&kind=<kind> — the append-only event log
// export (EN-007 decision 13, the Second-Brain feed). Keyset pagination on the
// monotonic `seq`: page forward with `after=<nextCursor>`. Optional `kind` filter.

import { route } from "@/lib/api/route";
import { parseEventsQuery } from "@/lib/compliance/events";
import { filterEventsByProjectAcl } from "@/lib/compliance/events-acl";
import { listEvents } from "@/lib/compliance/service";
import { aclPrincipalFromSession } from "@/lib/routing/mutations/actors";

export const GET = route(async (req) => {
  const q = parseEventsQuery(new URL(req.url).searchParams);
  const page = await listEvents(q);
  // Cursor and hasMore follow the unfiltered page so hidden rows never stall paging.
  const nextCursor = page.length > 0 ? page[page.length - 1].seq : null;
  const events = await filterEventsByProjectAcl(page, await aclPrincipalFromSession());
  // hasMore lets a consumer stop without an extra round-trip (review N9): a
  // partial page (< limit) is the last page even though nextCursor is non-null.
  const hasMore = page.length === q.limit;
  return { events, nextCursor, hasMore };
});
