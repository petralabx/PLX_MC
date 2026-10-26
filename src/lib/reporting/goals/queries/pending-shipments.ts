// INTERIM (TASK-3992), until go-live: shipments Sage has posted that AR hasn't
// invoiced yet. Sage posts a shipment (OESHIH/OESHID) first and AR posts its
// invoice later, so for those days the goods are out but not on the Revenue
// card. One row per posted shipment dated this month (by ship date) that no
// posted invoice names yet (oe_invoice_header.shinumber). Value: each item
// line's order price x quantity shipped, less its discount, before tax;
// freight and other charge lines (line type 2) are left out, as on the card
// (TASK-3952). No cost column is read. ASSUMPTION to confirm with the
// replica's owner: OESHIH/OESHID are replicated as sage.oe_shipment_header /
// sage.oe_shipment_detail with Sage's own column names lower-cased
// (README, "Interpretations to confirm"). Sage 300 deletes a cancelled
// shipment rather than flagging it, so NOT_VOIDED is a placeholder: if the
// replica keeps deleted or voided shipments with a flag, put the test there.
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
  ["sage", "oe_shipment_header", ["shiuniq", "shinumber", "ordnumber", "customer", "bilname", "shidate", "shsourcurr"]],
  ["sage", "oe_shipment_detail", ["shiuniq", "linetype", "item", "qtyshipped", "unitprice", "shidisc"]],
  ["sage", "oe_invoice_header", ["shinumber"]],
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
  AND trim(coalesce(d.linetype::text, '1')) = '1'
  AND d.qtyshipped::numeric <> 0
  AND upper(trim(coalesce(d.item, ''))) NOT IN ('C', 'MISC')
  AND ${NOT_VOIDED}
  AND NOT EXISTS (SELECT 1 FROM sage.oe_invoice_header h WHERE trim(h.shinumber) = trim(s.shinumber))
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
