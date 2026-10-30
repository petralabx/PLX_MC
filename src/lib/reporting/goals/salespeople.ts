// Read-only lookup of the salespeople on this run's Sage customers, for the
// Goals salesperson filter (TASK-4277). The page asks the reporting replica
// (the same path as a refresh) for the customers its figures name, as it asks
// for the finished-good list. Without the grant the filter waits for read
// access and names the columns; a failed read leaves it unavailable. Either way
// every figure still shows, for every customer. Server-only.

import { reportingDatabaseConfigured, reportingMcpConfigured } from "@/lib/secrets";

import { missingColumns } from "./queries/read-access";
import { CUSTOMER_SALESPEOPLE_SQL, SALESPERSON_COLUMNS } from "./queries/salespeople";
import {
  normalizeCustomerCode,
  salespersonLookupFromRows,
  type SalespersonLookup,
  type SalespersonLookupRow,
} from "./salesperson-filter";
import { withReportingSnapshot } from "./source-db";
import { withReportingMcp } from "./source-mcp";

const CHUNK = 1_000;
const CACHE_MS = 5 * 60_000;

let cache: { key: string; at: number; lookup: SalespersonLookup } | null = null;

/**
 * The salespeople of `customerCodes` (Sage customer codes), from each
 * customer's Sage record. A read or a missing grant is kept for five minutes,
 * so a grant shows within five minutes; a failure is tried again next time.
 */
export async function lookupSalespeople(customerCodes: readonly string[]): Promise<SalespersonLookup> {
  const wanted = [...new Set(customerCodes.map(normalizeCustomerCode).filter(Boolean))].sort();
  if (wanted.length === 0) return { state: "ready", customers: {}, names: {} };
  if (!reportingDatabaseConfigured()) return { state: "unavailable" };
  const key = wanted.join("\n");
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.lookup;
  try {
    const withSource = reportingMcpConfigured() ? withReportingMcp : withReportingSnapshot;
    const lookup = await withSource(async (q): Promise<SalespersonLookup> => {
      const missing = await missingColumns(q, SALESPERSON_COLUMNS);
      if (missing.length > 0) return { state: "waiting_for_access", missing };
      const rows: SalespersonLookupRow[] = [];
      for (let i = 0; i < wanted.length; i += CHUNK) {
        rows.push(...(await q<SalespersonLookupRow>(CUSTOMER_SALESPEOPLE_SQL, [wanted.slice(i, i + CHUNK)])));
      }
      return salespersonLookupFromRows(rows);
    }, 20_000);
    cache = { key, at: Date.now(), lookup };
    return lookup;
  } catch (err) {
    console.warn("[reporting-goals] salesperson lookup failed: %s", err instanceof Error ? err.message : "error");
    return { state: "unavailable" };
  }
}
