// GET /api/architecture/provenance?view=context|containers|task-lifecycle
// Slim provenance summary from docs/architecture/source-map.json (no DB).
// Auth-gated by middleware. Read-only.

import { ApiError, route } from "@/lib/api/route";
import {
  buildProvenanceForView,
  isArchitectureViewId,
} from "@/lib/architecture";

export const GET = route(async (req) => {
  const viewParam = new URL(req.url).searchParams.get("view") ?? "context";
  if (!isArchitectureViewId(viewParam)) {
    throw new ApiError(
      "invalid_request",
      "view must be one of: context, containers, task-lifecycle."
    );
  }
  try {
    return buildProvenanceForView(viewParam);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new ApiError(
      "source_map_unavailable",
      `Could not read architecture source-map: ${message}`,
      500
    );
  }
});
