// GET /api/loop-ledgers/bucket/[bucketId] — project the ledgers bound to one
// initiative bucket (config/bucket-ledger-map.json) onto Milestone/Trace shapes.
// Auth-gated by middleware. Read-only: GET only, no DDL, no writes.
// Degraded bindings are returned in data.sources (200) — visible, never hidden.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, route } from "@/lib/api/route";
import {
  bindingsForBucket,
  createSource,
  listLedgerSummaries,
  parseBucketLedgerMapJson,
  parseRegistryJson,
  projectBucketFromRows,
} from "@/lib/loop-ledgers";
import type { BucketProjection } from "@/lib/loop-ledgers";

export const GET = route(async (_req, ctx): Promise<BucketProjection> => {
  const { bucketId } = await ctx.params;

  const mapRaw = readFileSync(
    join(process.cwd(), "config/bucket-ledger-map.json"),
    "utf8"
  );
  const mapParsed = parseBucketLedgerMapJson(mapRaw);
  if (!mapParsed.ok) {
    throw new ApiError(
      "invalid_bucket_ledger_map",
      `Bucket-ledger map is invalid: ${mapParsed.error}`,
      500
    );
  }

  const bindings = bindingsForBucket(mapParsed.config, bucketId);
  if (bindings.length === 0) return { bound: false };

  const registryRaw = readFileSync(
    join(process.cwd(), "config/loop-ledgers-registry.json"),
    "utf8"
  );
  const registryParsed = parseRegistryJson(registryRaw);
  if (!registryParsed.ok) {
    throw new ApiError(
      "invalid_registry",
      `Registry config is invalid: ${registryParsed.error}`,
      500
    );
  }

  // Only the repos this bucket is bound to need fetching. A bound repo that is
  // absent from the registry yields no rows and surfaces as a degraded source.
  const boundRepos = new Set(bindings.map((b) => b.repo));
  const registry = {
    ...registryParsed.config,
    repos: registryParsed.config.repos.filter((r) => boundRepos.has(r.repo)),
  };

  const source = createSource();
  const rows = await listLedgerSummaries(registry, source);
  return projectBucketFromRows(bucketId, bindings, rows);
});
