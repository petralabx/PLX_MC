// GET /api/loop-ledgers — list all ledger summaries (including degraded sources).
// Auth-gated by middleware. Read-only: GET only, no DDL, no writes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, route } from "@/lib/api/route";
import {
  createSource,
  listLedgerSummaries,
  parseRegistryJson,
} from "@/lib/loop-ledgers";

export const GET = route(async () => {
  const raw = readFileSync(
    join(process.cwd(), "config/loop-ledgers-registry.json"),
    "utf8"
  );
  const parsed = parseRegistryJson(raw);
  if (!parsed.ok) {
    throw new ApiError(
      "invalid_registry",
      `Registry config is invalid: ${parsed.error}`,
      500
    );
  }
  const source = createSource();
  return listLedgerSummaries(parsed.config, source);
});
