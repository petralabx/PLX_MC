// GET /api/governance-sops — list all SOP catalog rows (ready, planned, degraded).
// Auth-gated by middleware. Read-only: GET only, no DDL, no writes.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiError, route } from "@/lib/api/route";
import { createSopSource, listSopSummaries, parseSopRegistryJson } from "@/lib/governance-sops";

export const GET = route(async () => {
  const raw = readFileSync(
    join(process.cwd(), "config/governance-sops-registry.json"),
    "utf8"
  );
  const parsed = parseSopRegistryJson(raw);
  if (!parsed.ok) {
    throw new ApiError(
      "invalid_registry",
      `SOP registry config is invalid: ${parsed.error}`,
      500
    );
  }
  return listSopSummaries(parsed.config, createSopSource());
});
