// Large batches this month: done (Realized, completed this month, sized on
// coalesce(actual, planned, 0)) and still open (Allocated/Committed, planned
// this month), split into scheduled from today and open past their date.
// Past means date_scheduled < today, always (the prototype counted today's
// batches twice when the cutoff was today). Params: $1 today, $2 large-batch kg.

import type { GoalSummaryRow } from "../types";
import { MONTH_WINDOW, type DatasetQuery } from "./shared";

interface Row {
  large_done: number;
  large_scheduled_ahead: number;
  large_open_past_date: number;
}

export const goalSummaryQuery: DatasetQuery<Row, GoalSummaryRow> = {
  name: "goal-summary",
  sql: `${MONTH_WINDOW},
b AS (
  SELECT bt.status, bt.date_scheduled, COALESCE(bt.actual_qty, bt.planned_qty, 0) AS q_done
  FROM silver.batches bt, cut
  WHERE (bt.status = 'Realized' AND bt.date_completed BETWEEN cut.m0 AND cut.m1)
     OR (bt.status IN ('Allocated', 'Committed') AND bt.planned_qty >= $2
         AND bt.date_scheduled BETWEEN cut.m0 AND cut.m1)
)
SELECT
  (SELECT count(*) FROM b WHERE status = 'Realized' AND q_done >= $2)::int AS large_done,
  (SELECT count(*) FROM b, cut WHERE status <> 'Realized' AND date_scheduled >= cut.today)::int AS large_scheduled_ahead,
  (SELECT count(*) FROM b, cut WHERE status <> 'Realized' AND date_scheduled < cut.today)::int AS large_open_past_date`,
  map: (rows) => ({
    largeDone: rows[0]?.large_done ?? 0,
    largeScheduledAhead: rows[0]?.large_scheduled_ahead ?? 0,
    largeOpenPastDate: rows[0]?.large_open_past_date ?? 0,
  }),
};
