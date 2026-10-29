// INTERIM (TASK-3992), until go-live: shipments Sage has posted that AR hasn't
// invoiced yet. Sage posts a shipment (OESHIH/OESHID) first and AR posts its
// invoice later, so for those days the goods are out but not on the Revenue
// card. One row per posted shipment dated this month (by ship date) whose
// header numinvoice is 0. Sage stores 0 until AR posts the invoice and 1
// after; lastinvnum then holds the invoice number. UAT's invoice header has
// no shinumber (Ricardo Savelli, 2026-10-28), so a join on that column cannot
// see an invoice. Value: each item line's order price x quantity shipped,
// less its discount amount (shidisc), before tax. Line type 2 (charges) and
// zero-quantity lines are left out. Item codes C and MISC stay in: they are
// type-1 lines (custom screening fees, filling service fees, pumps, bottles,
// artwork). The open-order forecast still drops those codes; this query does
// not change that, or the invoiced Revenue card. No cost column is read.
// Confirmed on the UAT Sage copy the same day: the tables are
// sage.oe_shipment_header and sage.oe_shipment_detail, the shipment columns
// are text, shidate is YYYYMMDD, and currency is only CAD or USD. There is
// no void column. NOT_VOIDED stays a placeholder (`true`). Header complete
// is 1 on the uninvoiced rows, so that flag is not a void marker.
// The login reads these only once a DBA runs
// docs/modules/reporting-goals/readonly-grants-shipments-pending.sql; the
// refresh checks PENDING_SHIPMENT_COLUMNS first, so a missing grant (or a
// differently named table) leaves the estimate out, names what's missing and
// never fails the refresh. Turn the whole thing off with
// GOALS_PENDING_SHIPMENTS=off; remove it by deleting this file,
// ../pending-shipments.ts and the lines marked TASK-3992. Params: $1 today.

import type { PendingShipmentRow } from "../types";
import type { ColumnList } from "./read-access";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

/** Exactly the columns the query reads (the grant script grants these). */
export const PENDING_SHIPMENT_COLUMNS = [
  ["sage", "oe_shipment_header", ["shiuniq", "shinumber", "ordnumber", "customer", "bilname", "shidate", "shsourcurr", "numinvoice"]],
  ["sage", "oe_shipment_detail", ["shiuniq", "linetype", "qtyshipped", "unitprice", "shidisc"]],
] as const satisfies ColumnList;

/** Placeholder for a void / deleted flag on the replica (see the header). */
const NOT_VOIDED = "true";

interface Row {
  shipment: string;
  order_no: string | null;
  customer_code: string | null;
  customer: string | null;
  ship_date: string;
  currency: string;
  lines: number;
  product_value: string;
}

export const pendingShipmentsQuery: DatasetQuery<Row, PendingShipmentRow[]> = {
  name: "pending-shipments",
  sql: `${MONTH_WINDOW}
SELECT trim(s.shinumber) AS shipment,
       nullif(trim(s.ordnumber), '') AS order_no,
       nullif(trim(s.customer), '') AS customer_code,
       nullif(trim(s.bilname), '') AS customer,
       to_date(s.shidate, 'YYYYMMDD')::text AS ship_date,
       trim(s.shsourcurr) AS currency,
       count(*)::int AS lines,
       sum(d.unitprice::numeric * d.qtyshipped::numeric - coalesce(d.shidisc::numeric, 0)) AS product_value
FROM sage.oe_shipment_header s
JOIN sage.oe_shipment_detail d ON d.shiuniq = s.shiuniq, cut
WHERE s.shidate >= cut.m0s AND s.shidate < cut.n0s
  AND coalesce(nullif(trim(d.linetype::text), ''), '1') = '1'
  AND d.qtyshipped::numeric <> 0
  AND ${NOT_VOIDED}
  AND trim(s.numinvoice) = '0'
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY ship_date, shipment`,
  map: (rows) =>
    rows.map((r) => ({
      shipment: r.shipment,
      order: r.order_no,
      customerCode: r.customer_code,
      customer: r.customer,
      shipDate: r.ship_date,
      currency: r.currency,
      lines: Number(r.lines),
      productValue: r.product_value,
    })),
};
