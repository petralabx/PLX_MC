// Which of this month's item codes are finished goods in the MRP (Ricardo,
// 26 Oct 2026). silver.finished_products is already granted to the goals login
// (id, code, erp_code — the forecast reads the same columns). This query reads
// only code and erp_code, and only the codes the caller names, so the result
// stays a handful of rows. No new table and no new grant. Params: $1 text[].

import type { ColumnList } from "./read-access";

/** Exactly the columns the query reads. Both are already in readonly-grants.sql. */
export const FINISHED_GOOD_COLUMNS = [["silver", "finished_products", ["code", "erp_code"]]] as const satisfies ColumnList;

/**
 * Upper-cased, trimmed finished-good codes among $1. A product counts when
 * either its ERP code or its own code matches (the forecast's AO item is the
 * ERP code, else the code). Blank codes never match.
 */
export const FINISHED_GOOD_MATCH_SQL = `
SELECT DISTINCT upper(trim(src.code)) AS code
FROM (
  SELECT erp_code AS code FROM silver.finished_products
  UNION ALL
  SELECT code FROM silver.finished_products
) src
WHERE upper(trim(src.code)) = ANY($1::text[])
  AND src.code IS NOT NULL
  AND trim(src.code) <> ''`;
