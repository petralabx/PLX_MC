// Read-only lookup of MRP finished-good codes for the Goals business-line
// split. The page asks the reporting replica (the same path as a refresh) for
// the item codes on this month's invoices. A failure leaves the code set null:
// the split still runs, nothing is Manufacturing, 3PL charges still count as
// Services, and the card says the list could not be read. Server-only.

import { reportingDatabaseConfigured, reportingMcpConfigured } from "@/lib/secrets";

import { FINISHED_GOOD_COLUMNS, FINISHED_GOOD_MATCH_SQL } from "./queries/finished-goods";
import { missingColumns } from "./queries/read-access";
import { withReportingSnapshot } from "./source-db";
import { withReportingMcp } from "./source-mcp";

const CHUNK = 1_000;
const CACHE_MS = 5 * 60_000;

let cache: { key: string; at: number; codes: ReadonlySet<string> } | null = null;

function normalize(codes: readonly string[]): string[] {
  return [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))].sort();
}

/**
 * The subset of `codes` that are finished goods (`silver.finished_products`
 * code or erp_code). null when the replica can't be read: nothing is
 * Manufacturing, and 3PL charges still count as Services. An empty set
 * means the lookup ran and none of the codes are finished goods.
 */
export async function lookupFinishedGoodCodes(codes: readonly string[]): Promise<ReadonlySet<string> | null> {
  const wanted = normalize(codes);
  if (wanted.length === 0) return new Set();
  if (!reportingDatabaseConfigured()) return null;
  const key = wanted.join("\n");
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.codes;
  try {
    const withSource = reportingMcpConfigured() ? withReportingMcp : withReportingSnapshot;
    const found = await withSource(async (q) => {
      const missing = await missingColumns(q, FINISHED_GOOD_COLUMNS);
      if (missing.length > 0) return null;
      const out = new Set<string>();
      for (let i = 0; i < wanted.length; i += CHUNK) {
        const rows = await q<{ code: string | null }>(FINISHED_GOOD_MATCH_SQL, [wanted.slice(i, i + CHUNK)]);
        for (const row of rows) {
          const code = (row.code ?? "").trim().toUpperCase();
          if (code) out.add(code);
        }
      }
      return out;
    }, 20_000);
    if (found) cache = { key, at: Date.now(), codes: found };
    return found;
  } catch (err) {
    console.warn("[reporting-goals] finished-good lookup failed: %s", err instanceof Error ? err.message : "error");
    return null;
  }
}
