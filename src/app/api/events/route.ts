// GET /api/events?after=<seq>&limit=<n>&kind=<kind> — the append-only event log
// export (EN-007 decision 13, the Second-Brain feed). Keyset pagination on the
// monotonic `seq`: page forward with `after=<nextCursor>`. Optional `kind` filter.

import { route } from "@/lib/api/route";
import { parseEventsQuery } from "@/lib/compliance/events";
import { filterEventsByProjectAcl } from "@/lib/compliance/events-acl";
import { listEvents } from "@/lib/compliance/service";
import { aclPrincipalFromSession } from "@/lib/routing/mutations/actors";

// Vercel caps responses at 4.5 MB; task.updated diffs can carry 64 KB each.
const PAGE_BYTE_BUDGET = 3_000_000;

export const GET = route(async (req) => {
  const q = parseEventsQuery(new URL(req.url).searchParams);
  const full = await listEvents(q);
  // Cut the page at the byte budget (always keep one row) so the cursor
  // resumes at the first unsent event instead of skipping or overflowing.
  let bytes = 0;
  let keep = 0;
  for (const event of full) {
    bytes += Buffer.byteLength(JSON.stringify(event));
    if (keep > 0 && bytes > PAGE_BYTE_BUDGET) break;
    keep++;
  }
  const page = full.slice(0, keep);
  // Cursor and hasMore follow the unfiltered page so hidden rows never stall paging.
  const nextCursor = page.length > 0 ? page[page.length - 1].seq : null;
  const events = await filterEventsByProjectAcl(page, await aclPrincipalFromSession());
  // hasMore lets a consumer stop without an extra round-trip (review N9): a
  // partial page (< limit) is the last page even though nextCursor is non-null.
  const hasMore = full.length === q.limit || keep < full.length;
  return { events, nextCursor, hasMore };
});
