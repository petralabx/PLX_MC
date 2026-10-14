// Day by day for this month: large batches done and still open per day, and
// shipped revenue (net before tax) per day by currency, this month and last
// month on the same day of the month. Last-month days past this month's length
// fold into the last day, so last month's running total always ends complete.
// Shipments belong to the month of their shipdate, never invdate.
// Params: $1 today, $2 large-batch kg.

import type { DailyRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  day: string;
  large_done: number;
  large_open: number;
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
done AS (
  SELECT b.date_completed AS day, count(*) AS n
  FROM silver.batches b, cut
  WHERE b.status = 'Realized' AND b.date_completed BETWEEN cut.m0 AND cut.m1
    AND COALESCE(b.actual_qty, b.planned_qty, 0) >= $2
  GROUP BY 1
),
opn AS (
  SELECT b.date_scheduled AS day, count(*) AS n
  FROM silver.batches b, cut
  WHERE b.status IN ('Allocated', 'Committed') AND b.planned_qty >= $2
    AND b.date_scheduled BETWEEN cut.m0 AND cut.m1
  GROUP BY 1
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
       coalesce(d.n, 0)::int AS large_done,
       coalesce(o.n, 0)::int AS large_open,
       coalesce(rt.cad, 0) AS cad_this,
       coalesce(rt.usd, 0) AS usd_this,
       coalesce(rl.cad, 0) AS cad_last,
       coalesce(rl.usd, 0) AS usd_last
FROM cal c
LEFT JOIN done d ON d.day = c.day
LEFT JOIN opn o ON o.day = c.day
LEFT JOIN rev rt ON rt.dom = extract(day FROM c.day)::int AND rt.this_month
LEFT JOIN rev rl ON rl.dom = extract(day FROM c.day)::int AND NOT rl.this_month
ORDER BY c.day`,
  map: (rows) =>
    rows.map((r) => ({
      day: r.day,
      largeDone: r.large_done,
      largeOpen: r.large_open,
      cadThis: r.cad_this,
      usdThis: r.usd_this,
      cadLast: r.cad_last,
      usdLast: r.usd_last,
    })),
};
