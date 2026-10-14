// Completed batches in the three full months before this one, for the
// size-band history chart (banded in rules.ts). Params: $1 today.

import type { BatchHistoryRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  id: string;
  batch: string;
  day: string;
  kg: string;
  status_qc: string | null;
}

export const batchHistoryQuery: DatasetQuery<Row, BatchHistoryRow[]> = {
  name: "batch-history",
  sql: `${MONTH_WINDOW}
SELECT b.id::text AS id,
       b.display_batch_number AS batch,
       b.date_completed::text AS day,
       COALESCE(b.actual_qty, b.planned_qty, 0) AS kg,
       b.status_qc
FROM silver.batches b, cut
WHERE b.status = 'Realized'
  AND b.date_completed >= (cut.m0 - interval '3 months')::date
  AND b.date_completed < cut.m0
ORDER BY day, batch`,
  map: (rows) =>
    rows.map((r) => ({ id: r.id, batch: r.batch, date: r.day, kg: r.kg, statusQc: r.status_qc })),
};
