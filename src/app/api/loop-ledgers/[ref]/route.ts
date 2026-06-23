// GET /api/loop-ledgers/[ref] — fetch one validated ledger or a degraded result.
// ref param: URL-safe base64url of JSON { repo, branch, path }.
// Auth-gated by middleware. Read-only: GET only, no DDL, no writes.
// Degraded detail results are returned in { data } (200) — visible, never hidden.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, route } from "@/lib/api/route";
import {
  createSource,
  getLedgerDetail,
  parseRegistryJson,
} from "@/lib/loop-ledgers";
import type { LedgerRef } from "@/lib/loop-ledgers";

function decodeRef(refParam: string): LedgerRef {
  let json: string;
  try {
    json = Buffer.from(refParam, "base64url").toString("utf8");
  } catch {
    throw new ApiError("invalid_ref", "ref param is not valid base64url.", 400);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new ApiError("invalid_ref", "ref param decoded to invalid JSON.", 400);
  }
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof (obj as Record<string, unknown>).repo !== "string" ||
    typeof (obj as Record<string, unknown>).branch !== "string" ||
    typeof (obj as Record<string, unknown>).path !== "string"
  ) {
    throw new ApiError(
      "invalid_ref",
      "ref param missing required fields (repo, branch, path).",
      400
    );
  }
  return obj as LedgerRef;
}

export const GET = route(async (_req, ctx) => {
  const { ref: refParam } = await ctx.params;
  const ref = decodeRef(refParam);

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
  return getLedgerDetail(ref, parsed.config, source);
});
