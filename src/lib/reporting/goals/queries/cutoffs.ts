// How far each source has caught up. Production: min(today, the latest
// silver.batches update, as a Toronto date). Sage: the latest invoice audit date.
// The update comes back as epoch seconds and becomes a Toronto date here, so the
// cutoff doesn't depend on the session time zone: the reporting MCP path can't
// set it, and its restricted mode refuses AT TIME ZONE (TASK-3489).
// Params: $1 today.

import { torontoDate } from "../calendar";
import type { Cutoffs } from "../types";
import type { DatasetQuery } from "./shared";

interface Row {
  today: string;
  batches_updated_epoch: string | null;
  sage_cutoff: string | null;
}

export const cutoffsQuery: DatasetQuery<Row, Cutoffs> = {
  name: "cutoffs",
  sql: `
SELECT CAST($1 AS date)::text AS today,
       extract(epoch FROM (SELECT max(updated_at) FROM silver.batches))::text AS batches_updated_epoch,
       (SELECT to_date(max(trim(audtdate)), 'YYYYMMDD') FROM sage.oe_invoice_header)::text AS sage_cutoff`,
  map: (rows) => {
    const row = rows[0];
    if (!row) return { productionCutoff: null, sageCutoff: null };
    // As SQL's LEAST did: no update at all leaves today.
    const updated = row.batches_updated_epoch === null ? null : torontoDate(new Date(Number(row.batches_updated_epoch) * 1000));
    return {
      productionCutoff: updated !== null && updated < row.today ? updated : row.today,
      sageCutoff: row.sage_cutoff,
    };
  },
};
