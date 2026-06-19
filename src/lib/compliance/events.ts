// EN-007 P4 — the event-export query contract (the Second-Brain feed, decision
// 13). Pure: parse + clamp the GET /api/events query params. The log is
// append-only and keyset-paginated on the monotonic `seq`, so a consumer pages
// forward with `after=<nextCursor>` and never misses or double-reads an event.

export interface EventsQuery {
  afterSeq: number;
  limit: number;
  kind: string | null;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export function parseEventsQuery(params: URLSearchParams): EventsQuery {
  const after = Number(params.get("after") ?? "0");
  const limit = Number(params.get("limit") ?? String(DEFAULT_LIMIT));
  const kind = params.get("kind");
  return {
    afterSeq: Number.isFinite(after) && after >= 0 ? Math.floor(after) : 0,
    limit: Math.min(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT, MAX_LIMIT),
    kind: kind && kind.length > 0 ? kind : null,
  };
}
