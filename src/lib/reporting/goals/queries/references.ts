// References for manual-entry matching: every Realized batch number (any date),
// and every invoice, shipment, order and PO number from the last 120 days of
// Sage invoices (blank ones ignored). rules.normalizeRef finishes the key
// (spaces removed) before it is stored. They come back as one row of two arrays:
// over 12,000 rows would pass the reporting MCP's 5,000-row cap (TASK-3489).
// Params: $1 today.

import { normalizeRef } from "../rules";
import type { ReferenceKind, ReferenceRow } from "../types";
import type { DatasetQuery } from "./shared";

interface Row {
  filemaker: string[];
  sage: string[];
}

export const referencesQuery: DatasetQuery<Row, ReferenceRow[]> = {
  name: "references",
  sql: `
WITH refs AS (
  SELECT 'filemaker' AS kind, lower(trim(b.display_batch_number)) AS ref
  FROM silver.batches b
  WHERE b.status = 'Realized' AND trim(coalesce(b.display_batch_number, '')) <> ''
  UNION
  SELECT 'sage' AS kind, lower(trim(v.x)) AS ref
  FROM sage.oe_invoice_header h,
       LATERAL (VALUES (h.invnumber), (h.shinumber), (h.ordnumber), (h.ponumber)) AS v(x)
  WHERE h.shipdate >= to_char(CAST($1 AS date) - 120, 'YYYYMMDD')
    AND trim(coalesce(v.x, '')) <> ''
)
SELECT coalesce(array_agg(ref) FILTER (WHERE kind = 'filemaker'), ARRAY[]::text[]) AS filemaker,
       coalesce(array_agg(ref) FILTER (WHERE kind = 'sage'), ARRAY[]::text[]) AS sage
FROM refs`,
  map: (rows) => {
    const seen = new Set<string>();
    const out: ReferenceRow[] = [];
    for (const row of rows) {
      for (const kind of ["filemaker", "sage"] as const satisfies readonly ReferenceKind[]) {
        for (const raw of row[kind]) {
          const ref = normalizeRef(raw);
          const key = `${kind}:${ref}`;
          if (!ref || seen.has(key)) continue;
          seen.add(key);
          out.push({ kind, ref });
        }
      }
    }
    return out;
  },
};
