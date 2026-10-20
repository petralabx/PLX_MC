// Sage customers for the manual-entry customer picker (codes are space-padded
// in Sage, so trim). They come back as one row holding a [code, name, currency]
// array per customer, in code order: over 7,000 rows would pass the reporting
// MCP's 5,000-row cap (TASK-3489). No params.

import type { CustomerRow } from "../types";
import type { DatasetQuery } from "./shared";

interface Row {
  customers: [code: string, name: string | null, currency: string | null][];
}

export const customersQuery: DatasetQuery<Row, CustomerRow[]> = {
  name: "customers",
  sql: `
SELECT coalesce(array_agg(ARRAY[trim(c.idcust), trim(c.namecust), nullif(trim(c.codecurn), '')] ORDER BY trim(c.idcust)),
                ARRAY[]::text[]) AS customers
FROM sage.ar_customer c
WHERE trim(coalesce(c.idcust, '')) <> ''`,
  map: (rows) => {
    const seen = new Set<string>();
    return rows
      .flatMap((r) => r.customers)
      .filter(([code]) => !seen.has(code) && seen.add(code))
      .map(([code, name, currency]) => ({ code, name: name ?? code, currency }));
  },
};
