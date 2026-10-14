// Shipped revenue this month and last, by currency: invnetnotx (net before tax,
// including freight and other charges) for invoices whose shipdate is in the
// month. Conversion to CAD happens in rules.ts at the Bank of Canada rate —
// never Sage's own inrate. Params: $1 today.

import type { RevenueRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  currency: string;
  this_month: boolean;
  invoices: number;
  net_before_tax: string;
}

export const revenueByCurrencyQuery: DatasetQuery<Row, RevenueRow[]> = {
  name: "revenue-by-currency",
  sql: `${MONTH_WINDOW}
SELECT trim(h.insourcurr) AS currency,
       h.shipdate >= cut.m0s AS this_month,
       count(*)::int AS invoices,
       sum(h.invnetnotx::numeric) AS net_before_tax
FROM sage.oe_invoice_header h, cut
WHERE h.shipdate >= cut.p0s AND h.shipdate < cut.n0s
GROUP BY 1, 2
ORDER BY 2 DESC, 1`,
  map: (rows) =>
    rows.map((r) => ({
      currency: r.currency,
      thisMonth: r.this_month,
      invoices: r.invoices,
      netBeforeTax: r.net_before_tax,
    })),
};
