// FileMaker assembly orders (AOs) for the revenue forecast (TASK-3151): those
// that can link to an open Sage order line due by month end, and every AO
// scheduled this month (for "production with no order behind it"), each with
// its bulk batch and that batch's status. The exact link (the portal's OE Fix on
// the AO's order list, plus the item code) is made in TypeScript
// (forecast.linkedOrderNumber); the SQL only narrows the AOs with a looser test
// (same item, and the order number's last six characters in the list), which
// every exact match also passes. Params: $1 today.

import { linkedOrderNumber } from "../forecast";
import type { ForecastAoRow } from "../types";
import { OPEN_LINES_CTE } from "./forecast-orders";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

/** A FileMaker number column read defensively (bronze columns can hold text): NULL unless it is a plain number. */
function fmNumberSql(column: string): string {
  return `CASE WHEN trim(${column}::text) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN trim(${column}::text)::numeric END`;
}

/** A FileMaker date column read defensively: NULL unless it starts YYYY-MM-DD (the portal's SAFE_DAY). */
function fmDateSql(column: string): string {
  return `CASE WHEN ${column}::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${column}::text, 10)::date END`;
}

/** The AO's Sage item code: its finished product's ERP code, else its code (the portal's BVCODE). */
export const AO_ITEM_SQL = `COALESCE(NULLIF(TRIM(fp.erp_code::text), ''), NULLIF(TRIM(fp.code::text), ''))`;

/**
 * The AO's order list: the free text oelist_c, else the ERP codes of the
 * FileMaker orders linked to it in order entry (AO_ENTRY_ORDERS_CTE; the
 * portal's Projected Revenue fallback, as AOs created in the portal may not
 * fill oelist_c).
 */
export const AO_ORDER_LIST_SQL = `COALESCE(NULLIF(TRIM(ao.oelist_c::text), ''), eo.erp_list)`;

/**
 * Each AO's orders in FileMaker's order entry as comma-separated ERP codes, in
 * one grouped pass over the link tables (every AO is read, so a lookup per AO
 * would scan them once each). Ids compare as text so a type difference between
 * FileMaker's tables can't fail the refresh.
 */
const AO_ENTRY_ORDERS_CTE = `ao_entry_orders AS (
  SELECT oeia.idassembly::text AS ao_id,
         NULLIF(string_agg(DISTINCT NULLIF(TRIM(oe.erpcode::text), ''), ',' ORDER BY NULLIF(TRIM(oe.erpcode::text), '')), '') AS erp_list
  FROM public.order_entry_item_assembly oeia
  JOIN public.order_entry_item oei ON oei.id::text = oeia.idoeitem::text
  JOIN public.order_entry oe ON oe.id::text = oei.idoe::text
  GROUP BY oeia.idassembly::text
)`;

interface Row {
  id: string;
  ao: string | null;
  status: string | null;
  scheduled: string | null;
  item: string | null;
  oe_list: string | null;
  qty: string | null;
  units_per_box: string | null;
  batch: string | null;
  batch_status: string | null;
  /** Open order numbers of any date with the AO's item and its last six characters in the list (a superset of the exact link). */
  open_orders: string[];
}

export const forecastAosQuery: DatasetQuery<Row, ForecastAoRow[]> = {
  name: "forecast-assembly-orders",
  sql: `${MONTH_WINDOW},
${OPEN_LINES_CTE},
${AO_ENTRY_ORDERS_CTE},
ao AS (
  SELECT ao.id::text AS id,
         NULLIF(TRIM(ao.nameamo_c::text), '') AS ao,
         NULLIF(TRIM(ao.status::text), '') AS status,
         ${fmDateSql("ao.datescheduled")} AS scheduled,
         ${AO_ITEM_SQL} AS item,
         ${AO_ORDER_LIST_SQL} AS oe_list,
         ${fmNumberSql("ao.qtytotal")} AS qty,
         ${fmNumberSql("ao.unitsperbox")} AS units_per_box,
         ao.idbatch::text AS idbatch,
         ao.idbatch_pre::text AS idbatch_pre
  FROM public.assembly_order ao
  LEFT JOIN silver.finished_products fp ON fp.id::text = ao.idfinprod::text
  LEFT JOIN ao_entry_orders eo ON eo.ao_id = ao.id::text
),
cand AS (
  SELECT a.id,
         array_agg(DISTINCT l.order_no ORDER BY l.order_no) AS open_orders,
         bool_or(l.expected <= cut.m1) AS due
  FROM ao a
  JOIN open_lines l ON l.item = a.item AND position(right(l.order_no, 6) IN a.oe_list) > 0
  CROSS JOIN cut
  GROUP BY a.id
)
SELECT a.id, a.ao, a.status, a.scheduled::text AS scheduled, a.item, a.oe_list, a.qty, a.units_per_box,
       COALESCE(bt.display_batch_number, btp.display_batch_number) AS batch,
       CASE WHEN bt.id IS NOT NULL THEN bt.status ELSE btp.status END AS batch_status,
       COALESCE(c.open_orders, ARRAY[]::text[]) AS open_orders
FROM ao a
CROSS JOIN cut
LEFT JOIN cand c ON c.id = a.id
LEFT JOIN silver.batches bt ON bt.id::text = a.idbatch
LEFT JOIN silver.batches btp ON btp.id::text = a.idbatch_pre
WHERE COALESCE(c.due, false) OR a.scheduled BETWEEN cut.m0 AND cut.m1
ORDER BY a.scheduled NULLS FIRST, a.id`,
  map: (rows) =>
    rows.map((r) => ({
      id: r.id,
      ao: r.ao,
      status: r.status,
      scheduled: r.scheduled,
      item: r.item,
      oeList: r.oe_list,
      qty: r.qty,
      unitsPerBox: r.units_per_box,
      batch: r.batch,
      batchStatus: r.batch_status,
      openOrder: r.open_orders.includes(linkedOrderNumber(r.oe_list) ?? ""),
    })),
};
