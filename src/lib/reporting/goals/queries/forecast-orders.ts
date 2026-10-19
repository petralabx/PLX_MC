// Open Sage order lines expected to ship by the end of this month, overdue lines
// included: the revenue forecast's order book (TASK-3151), one row per line, each
// with what the order's later lines of its item still need.
// Each reading of Sage's order entry is one named fragment below, so it is one
// edit after the operator reconciles a few orders against Sage's own screens
// (README, "Interpretations to confirm"). Sage text is space-padded and dates are
// YYYYMMDD (0 = none). The COMPLETE flags are never read: completion is decided
// from the quantity still to ship. Params: $1 today. Sage's item category on the
// line (CATEGORY, TASK-3177) is read only once the login may read it
// (forecast-access.ts); until then the query reads NULL in its place.

import type { ForecastLineRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

/** A Sage YYYYMMDD date column as a date; 0, blank or malformed is NULL. */
export function sageDateSql(column: string): string {
  return `CASE WHEN trim(${column}::text) ~ '^[12][0-9]{7}$' THEN to_date(trim(${column}::text), 'YYYYMMDD') END`;
}

/**
 * Still to ship, in the line's order unit: ordered less shipped, as the portal
 * reads open quantity. Sage lowers QTYORDERED as shipments post (ORIGQTY keeps
 * the original, QTYSHPTODT the total shipped); QTYSHIPPED is a shipment entered
 * on the order but not posted yet.
 */
export const QTY_TO_SHIP_SQL = `GREATEST(d.qtyordered::numeric - d.qtyshipped::numeric, 0)`;

/** Sales orders: type 1 Active and 2 Future. 3 Standing (a template for repeat orders) and 4 Quote are not. */
export const COUNTED_ORDER_TYPES_SQL = `trim(h.type::text) IN ('1', '2')`;

/** The line's expected ship date, else the order's. */
export const EXPECTED_DATE_SQL = `COALESCE(${sageDateSql("d.expdate")}, ${sageDateSql("h.expdate")})`;

/**
 * Item lines of real orders, as the portal's Projected Revenue counts them:
 * line type 1 (blank counts as 1; 2 is a miscellaneous charge), not the C or
 * MISC items, and no order whose reference or description says TEST.
 */
export const ITEM_LINES_SQL = `trim(coalesce(h.ordnumber::text, '')) <> ''
    AND coalesce(nullif(trim(d.linetype::text), ''), '1') = '1'
    AND trim(coalesce(d.item::text, '')) NOT IN ('', 'C', 'MISC')
    AND coalesce(h.reference::text, '') NOT ILIKE '%TEST%'
    AND coalesce(h."desc"::text, '') NOT ILIKE '%TEST%'`;

/** The line's item category as Sage keeps it (PLABEL, AMEN…), upper case; blank is NULL. */
export const CATEGORY_SQL = `nullif(upper(trim(d.category::text)), '')`;

/** Every open item line of a sales order, of any expected date (this query and the AO query's link); category is its SQL. */
function openLinesCte(category: string): string {
  return `open_lines AS (
  SELECT trim(h.ordnumber) AS order_no,
         CASE WHEN trim(d.linenum::text) ~ '^[0-9]+$' THEN trim(d.linenum::text)::int END AS line_no,
         nullif(trim(h.customer), '') AS customer_code,
         nullif(trim(h.bilname), '') AS customer,
         nullif(trim(h.ponumber), '') AS po,
         trim(d.item) AS item,
         nullif(trim(d."desc"), '') AS description,
         ${EXPECTED_DATE_SQL} AS expected,
         ${QTY_TO_SHIP_SQL} AS qty,
         nullif(trim(d.ordunit), '') AS unit,
         d.unitprice::numeric AS unit_price,
         trim(h.orsourcurr) AS currency,
         ${category} AS category
  FROM sage.oe_order_header h
  JOIN sage.oe_order_detail d ON d.orduniq = h.orduniq
  WHERE ${COUNTED_ORDER_TYPES_SQL}
    AND ${ITEM_LINES_SQL}
    AND ${QTY_TO_SHIP_SQL} > 0
)`;
}

/** The open lines without their category: the AO query's link never needs it. */
export const OPEN_LINES_CTE = openLinesCte("NULL::text");

/**
 * Still to ship on the order's open lines of the same item due after month end
 * or undated, beside each line due by then: the AO output those lines need
 * isn't shipped yet (forecast.forecastRows).
 */
export const LATER_QTY_SQL = `COALESCE(sum(o.qty) FILTER (WHERE o.expected IS NULL OR o.expected > cut.m1) OVER (PARTITION BY o.order_no, o.item), 0)`;

interface Row {
  order_no: string;
  line_no: number | null;
  customer_code: string | null;
  customer: string | null;
  po: string | null;
  item: string;
  description: string | null;
  expected: string;
  qty: string;
  unit: string | null;
  unit_price: string;
  currency: string;
  category: string | null;
  later_qty: string;
}

/** The query, with each line's category when the login may read it, else NULL in its place. */
export function forecastOrdersQuery(withCategory: boolean): DatasetQuery<Row, ForecastLineRow[]> {
  return {
    name: "forecast-orders",
    sql: `${MONTH_WINDOW},
${openLinesCte(withCategory ? CATEGORY_SQL : "NULL::text")},
lines AS (
  SELECT o.*, ${LATER_QTY_SQL} AS later_qty
  FROM open_lines o, cut
)
SELECT l.order_no, l.line_no, l.customer_code, l.customer, l.po, l.item, l.description,
       l.expected::text AS expected, l.qty, l.unit, l.unit_price, l.currency, l.category, l.later_qty
FROM lines l, cut
WHERE l.expected <= cut.m1
ORDER BY l.expected, l.order_no, l.line_no`,
    map: (rows) =>
      rows.map((r) => ({
        orderNo: r.order_no,
        lineNo: r.line_no,
        customerCode: r.customer_code,
        customer: r.customer,
        po: r.po,
        item: r.item,
        description: r.description,
        expected: r.expected,
        qty: r.qty,
        unit: r.unit,
        unitPrice: r.unit_price,
        currency: r.currency,
        category: r.category,
        laterQty: r.later_qty,
      })),
  };
}
