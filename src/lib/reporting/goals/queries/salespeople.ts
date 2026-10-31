// The salespeople (account managers) on this run's Sage customers, for the
// salesperson filter (TASK-4277). A customer's salespeople are the five slots
// on its Sage customer record (sage.ar_customer codeslsp1–codeslsp5), named
// from sage.ar_salesperson. Read live at page load for the codes the caller
// names, as the finished-good list is, so nothing new is stored. Codes are
// space-padded in Sage, so trim; customer codes are compared upper-cased.
// One row per customer and salesperson, a few hundred a month, well under the
// reporting MCP's 5,000-row cap. Params: $1 customer codes (text[]).

import type { ColumnList } from "./read-access";

/** Exactly the columns the query reads: what readonly-grants-salespeople.sql grants. */
export const SALESPERSON_COLUMNS = [
  ["sage", "ar_customer", ["idcust", "codeslsp1", "codeslsp2", "codeslsp3", "codeslsp4", "codeslsp5"]],
  ["sage", "ar_salesperson", ["codeslsp", "nameempl"]],
] as const satisfies ColumnList;

export const CUSTOMER_SALESPEOPLE_SQL = `
SELECT upper(trim(c.idcust)) AS customer,
       s.slot,
       upper(trim(s.code)) AS salesperson,
       nullif(trim(p.nameempl), '') AS name
FROM sage.ar_customer c
CROSS JOIN LATERAL (VALUES (1, c.codeslsp1), (2, c.codeslsp2), (3, c.codeslsp3), (4, c.codeslsp4), (5, c.codeslsp5)) AS s(slot, code)
LEFT JOIN sage.ar_salesperson p ON upper(trim(p.codeslsp)) = upper(trim(s.code))
WHERE upper(trim(c.idcust)) = ANY($1::text[])
  AND trim(coalesce(s.code, '')) <> ''
ORDER BY 1, 2`;
