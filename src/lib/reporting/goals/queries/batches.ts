// The batch list: completed this month (Realized, date_completed, sized on
// coalesce(actual, planned, 0)) and open this month (Allocated/Committed with
// planned_qty > 0, date_scheduled, sized on planned_qty). Also the source for
// size bands and the scheduled tiles. Product comes from cal_title
// ("BC-26281C • Product name"). Params: $1 today.

import type { BatchRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  id: string;
  batch: string;
  product: string | null;
  status: string;
  status_qc: string | null;
  line: string | null;
  day: string;
  kg: string;
}

export const batchesQuery: DatasetQuery<Row, BatchRow[]> = {
  name: "batches",
  sql: `${MONTH_WINDOW}
SELECT b.id::text AS id,
       b.display_batch_number AS batch,
       nullif(trim(split_part(coalesce(b.cal_title, ''), '•', 2)), '') AS product,
       b.status,
       b.status_qc,
       b.line,
       (CASE WHEN b.status = 'Realized' THEN b.date_completed ELSE b.date_scheduled END)::text AS day,
       CASE WHEN b.status = 'Realized' THEN COALESCE(b.actual_qty, b.planned_qty, 0) ELSE b.planned_qty END AS kg
FROM silver.batches b, cut
WHERE (b.status = 'Realized' AND b.date_completed BETWEEN cut.m0 AND cut.m1)
   OR (b.status IN ('Allocated', 'Committed') AND b.planned_qty > 0
       AND b.date_scheduled BETWEEN cut.m0 AND cut.m1)
ORDER BY day, batch`,
  map: (rows) =>
    rows.map((r) => ({
      id: r.id,
      batch: r.batch,
      product: r.product,
      status: r.status,
      statusQc: r.status_qc,
      line: r.line,
      date: r.day,
      kg: r.kg,
    })),
};
