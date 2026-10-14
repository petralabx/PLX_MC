// This month's Sage invoices, one row each (the Shipments sheet and the
// truckload drill-down). Params: $1 today.

import type { ShipmentRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  invoice: string;
  shipment: string | null;
  order_no: string | null;
  po: string | null;
  customer_code: string | null;
  customer: string | null;
  ship_date: string;
  currency: string;
  product_value: string;
  other_charges: string;
  net_before_tax: string;
}

export const shipmentsQuery: DatasetQuery<Row, ShipmentRow[]> = {
  name: "shipments",
  sql: `${MONTH_WINDOW}
SELECT trim(h.invnumber) AS invoice,
       nullif(trim(h.shinumber), '') AS shipment,
       nullif(trim(h.ordnumber), '') AS order_no,
       nullif(trim(h.ponumber), '') AS po,
       nullif(trim(h.customer), '') AS customer_code,
       nullif(trim(h.bilname), '') AS customer,
       to_date(h.shipdate, 'YYYYMMDD')::text AS ship_date,
       trim(h.insourcurr) AS currency,
       h.invitmtot::numeric - h.invdiscamt::numeric AS product_value,
       h.invmisc::numeric AS other_charges,
       h.invnetnotx::numeric AS net_before_tax
FROM sage.oe_invoice_header h, cut
WHERE h.shipdate >= cut.m0s AND h.shipdate < cut.n0s
ORDER BY ship_date, invoice`,
  map: (rows) =>
    rows.map((r) => ({
      invoice: r.invoice,
      shipment: r.shipment,
      orderNo: r.order_no,
      po: r.po,
      customerCode: r.customer_code,
      customer: r.customer,
      shipDate: r.ship_date,
      currency: r.currency,
      productValue: r.product_value,
      otherCharges: r.other_charges,
      netBeforeTax: r.net_before_tax,
    })),
};
