// GET /api/governance-sops/[slug] — one SOP rendered to a node tree, or a loud
// degraded result. Auth-gated by middleware. Read-only: GET only, no writes.
// Degraded/planned detail is returned in { data: { ok: false, ... } } at 200 —
// visible, never hidden. An unknown slug is a 404.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiError, route } from "@/lib/api/route";
import { createSopSource, getSopDetail, parseSopRegistryJson } from "@/lib/governance-sops";

export const GET = route(async (_req, ctx) => {
  const { slug } = await ctx.params;

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

  const meta = parsed.config.sops.find((s) => s.slug === slug);
  if (!meta) {
    throw new ApiError("not_found", `No SOP registered with slug '${slug}'.`, 404);
  }
  return getSopDetail(meta, createSopSource());
});
