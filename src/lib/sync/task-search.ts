// Read-only search of the canonical JSONB mirror. A single statement supplies
// the count and page from the same MVCC snapshot; no OFFSET or seed writes.
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { query } from "@/lib/db";
import type { Task } from "@/lib/mc-data";

export type TaskSearchFilter = {
  query?: string;
  bucket?: string;
  stage?: string;
  assignee?: string;
  label?: string;
  limit: number;
  cursor?: string;
  searchComments?: boolean;
  in?: ("title" | "description" | "comments" | "notes")[];
  fields?: "full" | "compact";
};

const keySchema = z.tuple([z.string().regex(/^\d{1,128}$/), z.string().min(1).max(256)]);
const cursorSchema = z.object({
  v: z.literal(1),
  scope: z.string().length(64),
  at: z.string().datetime(),
  after: keySchema,
  upper: keySchema,
}).strict();
type Key = z.infer<typeof keySchema>;

export type CompactTask = Pick<Task, "id" | "title" | "stage" | "bucket" | "labels" | "prs"> & {
  updatedAt: string;
  completedAt?: string | null;
};
export type SearchTaskRow = (Task | CompactTask) & { matchFields?: string[] };

// Immutable expression shared verbatim with migration 031's GIN index.
export const TASK_DISCUSSION_VECTOR = `jsonb_to_tsvector('simple'::regconfig,
  jsonb_path_query_array(data, '$.comments[*].body') ||
  jsonb_path_query_array(data, '$.activity[*].what'), '["string"]'::jsonb)`;
const numericId = "COALESCE(substring(id FROM '^TASK-([0-9]+)$')::numeric, 0)";

export async function searchTaskPage(filter: TaskSearchFilter, hiddenBuckets: string[] = [], actorScope = "") {
  const rawCursor = filter.cursor;
  const criteria = {
    query: filter.query, bucket: filter.bucket, stage: filter.stage,
    assignee: filter.assignee, label: filter.label,
    searchComments: filter.searchComments, in: filter.in,
  };
  const scope = createHash("sha256").update(JSON.stringify([criteria, [...hiddenBuckets].sort(), actorScope])).digest("hex");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (rawCursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new Error("encoding");
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")));
      if (cursor.scope !== scope) throw new Error("scope");
    } catch {
      throw new ApiError("invalid_request", "Invalid search cursor or changed filters/identity; restart without cursor.");
    }
  }
  const params: unknown[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const where = ["entity_type = 'task'"];
  if (hiddenBuckets.length) where.push(`NOT (COALESCE(data->>'bucket', '') = ANY(${bind(hiddenBuckets)}::text[]))`);
  for (const field of ["bucket", "stage", "label"] as const) {
    if (!filter[field]) continue;
    where.push(field === "label"
      ? `COALESCE(data->'labels', '[]'::jsonb) ? ${bind(filter.label)}`
      : `data->>'${field}' = ${bind(filter[field])}`);
  }
  if (filter.assignee) where.push(`lower(btrim(COALESCE(data->>'assignee', ''))) = lower(${bind(filter.assignee)})`);

  const matches: string[] = [];
  if (filter.query) {
    const text = bind(filter.query.toLowerCase());
    const tsQuery = `plainto_tsquery('simple'::regconfig, ${text})`;
    const selected = new Set(filter.in ?? (filter.searchComments ? ["title", "description", "comments", "notes"] : ["title", "description"]));
    // ID substring search is retained for every caller, including scoped text search.
    matches.push(`CASE WHEN strpos(lower(id), ${text}) > 0 THEN 'id' END`);
    for (const field of ["title", "description"] as const) {
      if (selected.has(field)) matches.push(`CASE WHEN strpos(lower(COALESCE(data->>'${field}', '')), ${text}) > 0 THEN '${field}' END`);
    }
    const discussion: string[] = [];
    if (selected.has("comments")) {
      discussion.push(`CASE WHEN jsonb_to_tsvector('simple'::regconfig, jsonb_path_query_array(data, '$.comments[*].body'), '["string"]'::jsonb) @@ ${tsQuery} THEN 'comments' END`);
      discussion.push(`CASE WHEN jsonb_to_tsvector('simple'::regconfig, jsonb_path_query_array(data, '$.activity[*].what'), '["string"]'::jsonb) @@ ${tsQuery} THEN 'activity' END`);
    }
    if (selected.has("notes")) {
      // mc_report_progress stores note bodies as mcp-* comments, not mc_events.
      discussion.push(`CASE WHEN jsonb_to_tsvector('simple'::regconfig, jsonb_path_query_array(data, '$.comments[*] ? (@.id like_regex "^mcp-").body'), '["string"]'::jsonb) @@ ${tsQuery} THEN 'notes' END`);
    }
    const ordinary = `cardinality(array_remove(ARRAY[${matches.join(", ")}], NULL)) > 0`;
    where.push(discussion.length
      ? `(${ordinary} OR (${TASK_DISCUSSION_VECTOR} @@ ${tsQuery} AND cardinality(array_remove(ARRAY[${discussion.join(", ")}], NULL)) > 0))`
      : ordinary);
    matches.push(...discussion);
  }
  const at = bind(cursor?.at ?? null);
  const upper = cursor ? `${bind(cursor.upper[0])}::numeric, ${bind(cursor.upper[1])}::text COLLATE "C"` : null;
  const after = cursor ? `${bind(cursor.after[0])}::numeric, ${bind(cursor.after[1])}::text COLLATE "C"` : null;
  const pageLimit = bind(filter.limit + 1);
  const projection = filter.fields === "compact"
    ? `jsonb_build_object('id', id, 'title', data->'title', 'stage', data->'stage',
        'bucket', data->'bucket', 'labels', COALESCE(data->'labels', '[]'::jsonb),
        'prs', COALESCE(data->'prs', '[]'::jsonb),
        'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
        || CASE WHEN data ? 'completedAt' THEN jsonb_build_object('completedAt', data->'completedAt') ELSE '{}'::jsonb END`
    : "data";
  const rows = await query<{
    total: string;
    at: string;
    upper: Key | null;
    page: { task: SearchTaskRow; key: Key }[];
  }>(`WITH horizon AS (
      SELECT COALESCE(${at}::timestamptz, statement_timestamp()) AS at
    ), filtered AS MATERIALIZED (
      SELECT id, ${numericId} AS n, ${projection}${matches.length ? ` || jsonb_build_object('matchFields', array_remove(ARRAY[${matches.join(", ")}], NULL))` : ""} AS task
      FROM entities, horizon
      WHERE ${where.join(" AND ")} AND created_at <= horizon.at
        ${upper ? `AND (${numericId}, id COLLATE "C") <= (${upper})` : ""}
    ), page AS (
      SELECT * FROM filtered ${after ? `WHERE (n, id COLLATE "C") > (${after})` : ""}
      ORDER BY n, id COLLATE "C" LIMIT ${pageLimit}
    ) SELECT (SELECT count(*)::text FROM filtered) AS total,
      to_char(horizon.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
      (SELECT jsonb_build_array(n::text, id) FROM filtered ORDER BY n DESC, id COLLATE "C" DESC LIMIT 1) AS upper,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('task', task, 'key', jsonb_build_array(n::text, id)) ORDER BY n, id COLLATE "C") FROM page), '[]'::jsonb) AS page
    FROM horizon`, params);
  const result = rows[0];
  if (!result) throw new Error("Task search returned no count row");
  const page = result.page.slice(0, filter.limit);
  const nextCursor = result.page.length > filter.limit && result.upper
    ? Buffer.from(JSON.stringify({ v: 1, scope, at: cursor?.at ?? result.at, upper: cursor?.upper ?? result.upper, after: page[page.length - 1].key })).toString("base64url")
    : null;
  return { tasks: page.map((row) => row.task), total: Number(result.total), nextCursor };
}
