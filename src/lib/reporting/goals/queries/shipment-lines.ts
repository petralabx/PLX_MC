// What shipped (TASK-3144): every line of exactly the invoices the shipments
// dataset reads (queries/shipments.ts: shipped this month by the header's ship
// date), item lines and miscellaneous charges alike, by invoice and Sage's line
// number. Each line joins its invoice on INVUNIQ (OEINVD.INVUNIQ →
// OEINVH.INVUNIQ). Sage text is space-padded, so trim; numbers are read as
// numeric, keeping Sage's own decimals. Each reading of Sage is one named
// fragment, so a correction after the operator reconciles a few invoices
// (README, "Interpretations to confirm") is one edit. The login reads these
// columns only once a DBA runs
// docs/modules/reporting-goals/readonly-grants-shipment-lines.sql: the refresh
// checks SHIPMENT_LINE_COLUMNS first (./read-access.ts). Params: $1 today.

import type { ShipmentLineKind, ShipmentLineRow } from "../types";
import type { ColumnList } from "./read-access";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

/** Exactly the columns the query reads, by relation (the grant scripts grant these; the header's number and ship date come with the report). */
export const SHIPMENT_LINE_COLUMNS = [
  ["sage", "oe_invoice_header", ["invuniq", "invnumber", "shipdate"]],
  ["sage", "oe_invoice_detail", ["invuniq", "linenum", "linetype", "item", "misccharge", "desc", "qtyshipped", "invunit", "unitprice", "extinvmisc", "invdisc"]],
] as const satisfies ColumnList;

/** A miscellaneous charge such as freight is Sage line type 2; 1 (or blank, as the portal reads order lines) is an item. */
export const CHARGE_LINE_SQL = `trim(coalesce(d.linetype::text, '')) = '2'`;

/** The line's code: the item's, or the charge's (MISCCHARGE, else ITEM when Sage left that blank). */
export const LINE_CODE_SQL = `CASE WHEN ${CHARGE_LINE_SQL}
            THEN coalesce(nullif(trim(d.misccharge), ''), nullif(trim(d.item), ''))
            ELSE nullif(trim(d.item), '') END`;

interface Row {
  invoice: string;
  line_no: number | null;
  kind: ShipmentLineKind;
  code: string | null;
  description: string | null;
  qty: string;
  unit: string | null;
  unit_price: string;
  amount: string;
  discount: string;
}

export const shipmentLinesQuery: DatasetQuery<Row, ShipmentLineRow[]> = {
  name: "shipment-lines",
  sql: `${MONTH_WINDOW}
SELECT trim(h.invnumber) AS invoice,
       CASE WHEN trim(d.linenum::text) ~ '^[0-9]+$' THEN trim(d.linenum::text)::int END AS line_no,
       CASE WHEN ${CHARGE_LINE_SQL} THEN 'charge' ELSE 'item' END AS kind,
       ${LINE_CODE_SQL} AS code,
       nullif(trim(d."desc"), '') AS description,
       d.qtyshipped::numeric AS qty,
       nullif(trim(d.invunit), '') AS unit,
       d.unitprice::numeric AS unit_price,
       d.extinvmisc::numeric AS amount,
       d.invdisc::numeric AS discount
FROM sage.oe_invoice_header h
JOIN sage.oe_invoice_detail d ON d.invuniq = h.invuniq
CROSS JOIN cut
WHERE h.shipdate >= cut.m0s AND h.shipdate < cut.n0s
ORDER BY invoice, h.invuniq, line_no`,
  map: (rows) =>
    rows.map((r) => ({
      invoice: r.invoice,
      lineNo: r.line_no,
      kind: r.kind,
      code: r.code,
      description: r.description,
      qty: r.qty,
      unit: r.unit,
      unitPrice: r.unit_price,
      amount: r.amount,
      discount: r.discount,
    })),
};
