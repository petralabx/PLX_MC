// Day by day for this month: shipped revenue (net before tax) per day by
// currency, this month and last month on the same day of the month. Last-month
// days past this month's length fold into the last day, so last month's running
// total always ends complete. Shipments belong to the month of their shipdate,
// never invdate. Line 1 kg per day comes from the batch list (rules.ts), not
// from here. Params: $1 today.

import type { DailyRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  day: string;
  cad_this: string;
  usd_this: string;
  cad_last: string;
  usd_last: string;
}

export const dailyQuery: DatasetQuery<Row, DailyRow[]> = {
  name: "daily",
  sql: `${MONTH_WINDOW},
cal AS (
  SELECT g.dd::date AS day
  FROM cut, generate_series(cut.m0::timestamp, cut.m1::timestamp, interval '1 day') AS g(dd)
),
inv AS (
  SELECT to_date(h.shipdate, 'YYYYMMDD') AS sd, trim(h.insourcurr) AS cur, h.invnetnotx::numeric AS net
  FROM sage.oe_invoice_header h, cut
  WHERE h.shipdate >= cut.p0s AND h.shipdate < cut.n0s
),
rev AS (
  SELECT LEAST(extract(day FROM inv.sd)::int, extract(day FROM cut.m1)::int) AS dom,
         inv.sd >= cut.m0 AS this_month,
         sum(inv.net) FILTER (WHERE inv.cur = 'CAD') AS cad,
         sum(inv.net) FILTER (WHERE inv.cur = 'USD') AS usd
  FROM inv, cut
  GROUP BY 1, 2
)
SELECT c.day::text AS day,
       coalesce(rt.cad, 0) AS cad_this,
       coalesce(rt.usd, 0) AS usd_this,
       coalesce(rl.cad, 0) AS cad_last,
       coalesce(rl.usd, 0) AS usd_last
FROM cal c
LEFT JOIN rev rt ON rt.dom = extract(day FROM c.day)::int AND rt.this_month
LEFT JOIN rev rl ON rl.dom = extract(day FROM c.day)::int AND NOT rl.this_month
ORDER BY c.day`,
  map: (rows) =>
    rows.map((r) => ({
      day: r.day,
      cadThis: r.cad_this,
      usdThis: r.usd_this,
      cadLast: r.cad_last,
      usdLast: r.usd_last,
    })),
};
