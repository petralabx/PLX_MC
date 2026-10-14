// Sage customers for the manual-entry customer picker (codes are space-padded
// in Sage, so trim). No params.

import type { CustomerRow } from "../types";
import type { DatasetQuery } from "./shared";

interface Row {
  code: string;
  name: string | null;
  currency: string | null;
}

export const customersQuery: DatasetQuery<Row, CustomerRow[]> = {
  name: "customers",
  sql: `
SELECT trim(c.idcust) AS code,
       trim(c.namecust) AS name,
       nullif(trim(c.codecurn), '') AS currency
FROM sage.ar_customer c
WHERE trim(coalesce(c.idcust, '')) <> ''
ORDER BY 1`,
  map: (rows) => {
    const seen = new Set<string>();
    return rows
      .filter((r) => !seen.has(r.code) && seen.add(r.code))
      .map((r) => ({ code: r.code, name: r.name ?? r.code, currency: r.currency }));
  },
};
