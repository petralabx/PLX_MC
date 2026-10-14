// Shipments to the truckload customers, this month and last: one row per Sage
// shinumber, summing its invoices' product value (invitmtot − invdiscamt,
// before tax and freight) per currency. An invoice without a shinumber is its
// own shipment ("invoice:<invnumber>"), so blank numbers never merge into one
// load or across months. Shipments with product value ≤ 0 (freight-only, $0)
// are never loads. Codes are space-padded in Sage, so trim.
// Full/partial is decided in rules.ts against the configured minimum.
// Params: $1 today, $2 truckload customer codes (text[]).

import type { TruckloadRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  code: string;
  shipment: string;
  ship_date: string;
  product_usd: string;
  product_cad: string;
  this_month: boolean;
}

export const truckloadsQuery: DatasetQuery<Row, TruckloadRow[]> = {
  name: "truckloads",
  sql: `${MONTH_WINDOW}
SELECT trim(i.customer) AS code,
       coalesce(nullif(trim(i.shinumber), ''), 'invoice:' || trim(i.invnumber)) AS shipment,
       to_date(min(i.shipdate), 'YYYYMMDD')::text AS ship_date,
       coalesce(sum(i.invitmtot::numeric - i.invdiscamt::numeric) FILTER (WHERE trim(i.insourcurr) = 'USD'), 0) AS product_usd,
       coalesce(sum(i.invitmtot::numeric - i.invdiscamt::numeric) FILTER (WHERE trim(i.insourcurr) = 'CAD'), 0) AS product_cad,
       min(i.shipdate) >= min(cut.m0s) AS this_month
FROM sage.oe_invoice_header i, cut
WHERE trim(i.customer) = ANY($2::text[])
  AND i.shipdate >= cut.p0s AND i.shipdate < cut.n0s
GROUP BY 1, 2
HAVING sum(i.invitmtot::numeric - i.invdiscamt::numeric) > 0
ORDER BY 3, 1, 2`,
  map: (rows) =>
    rows.map((r) => ({
      code: r.code,
      shipment: r.shipment,
      shipDate: r.ship_date,
      productUsd: r.product_usd,
      productCad: r.product_cad,
      thisMonth: r.this_month,
    })),
};
