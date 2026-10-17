// Read access for the revenue forecast (TASK-3151). The login mc_goals_ro can
// read these columns only once a DBA runs
// docs/modules/reporting-goals/readonly-grants-forecast.sql. Until then the
// refresh skips both forecast datasets, records which columns it lacked, and
// refreshes everything else. The catalog check is shared (./read-access.ts).
// Sage's item category on the order line (TASK-3177) is checked on its own:
// without it the forecast still reads, and only the category filter waits.

import type { SourceQuery } from "../source-db";
import { missingColumns, type ColumnList } from "./read-access";

/** Exactly the columns the forecast's two queries read, by relation (the grant scripts grant these). */
export const FORECAST_COLUMNS = [
  ["sage", "oe_order_header", ["orduniq", "ordnumber", "customer", "bilname", "ponumber", "type", "expdate", "orsourcurr", "reference", "desc"]],
  ["sage", "oe_order_detail", ["orduniq", "linenum", "linetype", "item", "desc", "expdate", "qtyordered", "qtyshipped", "ordunit", "unitprice"]],
  ["public", "assembly_order", ["id", "nameamo_c", "status", "datescheduled", "idfinprod", "idbatch", "idbatch_pre", "oelist_c", "qtytotal", "unitsperbox"]],
  ["public", "order_entry_item_assembly", ["idoeitem", "idassembly"]],
  ["public", "order_entry_item", ["id", "idoe"]],
  ["public", "order_entry", ["id", "erpcode"]],
  ["silver", "finished_products", ["id", "code", "erp_code"]],
  ["silver", "batches", ["id", "display_batch_number", "status"]],
] as const satisfies ColumnList;

/** The forecast columns this login can't read, as schema.table.column (none: both datasets can be read). */
export function missingForecastAccess(q: SourceQuery): Promise<string[]> {
  return missingColumns(q, FORECAST_COLUMNS);
}

/** The item category column the forecast's category filter reads (TASK-3177); the same grant scripts grant it. */
export const FORECAST_CATEGORY_COLUMNS = [["sage", "oe_order_detail", ["category"]]] as const satisfies ColumnList;

/** The category columns this login can't read (none: lines carry their category). */
export function missingForecastCategoryAccess(q: SourceQuery): Promise<string[]> {
  return missingColumns(q, FORECAST_CATEGORY_COLUMNS);
}
