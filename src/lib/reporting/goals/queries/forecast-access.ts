// Read access for the revenue forecast (TASK-3151). The login mc_goals_ro can
// read these columns only once a DBA runs
// docs/modules/reporting-goals/readonly-grants-forecast.sql. Until then the
// refresh skips both forecast datasets, records which columns it lacked, and
// refreshes everything else. Checked from the catalogs inside the refresh's own
// read-only transaction, never by trying a read (a denied read would abort it).

import type { SourceQuery } from "../source-db";

/** Exactly the columns the forecast's two queries read, by relation (the grant scripts grant these). */
export const FORECAST_COLUMNS = [
  ["sage", "oe_order_header", ["orduniq", "ordnumber", "customer", "bilname", "ponumber", "type", "expdate", "orsourcurr", "reference", "desc"]],
  ["sage", "oe_order_detail", ["orduniq", "linenum", "linetype", "item", "desc", "expdate", "qtyordered", "qtyshipped", "ordunit", "unitprice"]],
  ["public", "assembly_order", ["id", "nameamo_c", "status", "datescheduled", "idfinprod", "idbatch", "idbatch_pre", "oelist_c", "qtytotal", "unitsperbox"]],
  ["public", "order_entry_item_assembly", ["idoeitem", "idassembly"]],
  ["public", "order_entry_item", ["id", "idoe"]],
  ["public", "order_entry", ["id", "erpcode"]],
  ["silver", "finished_products", ["id", "code", "erp_code"]],
  ["silver", "batches", ["id", "display_batch_number", "status"]],
] as const satisfies readonly (readonly [schema: string, table: string, columns: readonly string[]])[];

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

/** The forecast columns this login can't read, as schema.table.column (none: both datasets can be read). */
export async function missingForecastAccess(q: SourceQuery): Promise<string[]> {
  const wanted = FORECAST_COLUMNS.flatMap(([schema, table, columns]) => columns.map((column) => [schema, table, column] as const));
  const rows = await q<{ missing: string }>(MISSING_SQL, [
    wanted.map(([schema]) => schema),
    wanted.map(([, table]) => table),
    wanted.map(([, , column]) => column),
  ]);
  return rows.map((r) => r.missing);
}
