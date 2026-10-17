// Read access to the reporting replica's columns, checked from the catalogs
// inside the refresh's own read-only transaction, never by trying a read (a
// denied read would abort it). The revenue forecast (TASK-3151,
// ./forecast-access.ts) and the shipment lines (TASK-3144, ./shipment-lines.ts)
// each list exactly the columns they read. Until a DBA grants them, the refresh
// skips that dataset, records which columns it lacked, and refreshes everything
// else; the page names them (missingByRelation).

import type { SourceQuery } from "../source-db";

/** Columns by relation, as [schema, table, columns]: what a dataset reads, and so what its grant scripts grant. */
export type ColumnList = readonly (readonly [schema: string, table: string, columns: readonly string[]])[];

// A column is readable with USAGE on its schema and SELECT on it (column or
// table level). A relation or column that doesn't exist is missing too.
const MISSING_SQL = `
SELECT r.schema_name || '.' || r.table_name || '.' || r.column_name AS missing
FROM unnest($1::text[], $2::text[], $3::text[]) WITH ORDINALITY AS r(schema_name, table_name, column_name, n)
WHERE NOT coalesce((
  SELECT has_schema_privilege(ns.oid, 'USAGE') AND has_column_privilege(c.oid, a.attnum, 'SELECT')
  FROM pg_catalog.pg_namespace ns
  JOIN pg_catalog.pg_class c ON c.relnamespace = ns.oid
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  WHERE ns.nspname = r.schema_name AND c.relname = r.table_name
    AND a.attname = r.column_name AND NOT a.attisdropped
), false)
ORDER BY r.n`;

/** The listed columns this login can't read, as schema.table.column, in the list's order (none: all can be read). */
export async function missingColumns(q: SourceQuery, list: ColumnList): Promise<string[]> {
  const wanted = list.flatMap(([schema, table, columns]) => columns.map((column) => [schema, table, column] as const));
  const rows = await q<{ missing: string }>(MISSING_SQL, [
    wanted.map(([schema]) => schema),
    wanted.map(([, table]) => table),
    wanted.map(([, , column]) => column),
  ]);
  return rows.map((r) => r.missing);
}

/** "schema.table.column" names, grouped by relation in the order they came (what a section waiting for access lists). */
export function missingByRelation(missing: readonly string[]): { relation: string; columns: string[] }[] {
  const out: { relation: string; columns: string[] }[] = [];
  for (const name of missing) {
    const cut = name.lastIndexOf(".");
    const relation = name.slice(0, cut);
    const column = name.slice(cut + 1);
    const group = out.find((g) => g.relation === relation);
    if (group) group.columns.push(column);
    else out.push({ relation, columns: [column] });
  }
  return out;
}
