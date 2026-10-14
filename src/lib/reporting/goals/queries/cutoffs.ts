// How far each source has caught up. Production: min(today, the latest
// silver.batches update, as a Toronto date). Sage: the latest invoice audit date.
// Params: $1 today.

import type { Cutoffs } from "../types";
import type { DatasetQuery } from "./shared";

interface Row {
  production_cutoff: string | null;
  sage_cutoff: string | null;
}

export const cutoffsQuery: DatasetQuery<Row, Cutoffs> = {
  name: "cutoffs",
  sql: `
SELECT LEAST(CAST($1 AS date), (SELECT max(updated_at) FROM silver.batches)::date)::text AS production_cutoff,
       (SELECT to_date(max(trim(audtdate)), 'YYYYMMDD') FROM sage.oe_invoice_header)::text AS sage_cutoff`,
  map: (rows) => ({
    productionCutoff: rows[0]?.production_cutoff ?? null,
    sageCutoff: rows[0]?.sage_cutoff ?? null,
  }),
};
