// GET /api/architecture/model
// Validated, deterministic projection of docs/architecture/source-map.json.
// Auth-gated by middleware. Read-only.

import { ApiError, route } from "@/lib/api/route";
import { buildArchitectureModel } from "@/lib/architecture";

export const GET = route(async () => {
  try {
    return buildArchitectureModel();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new ApiError(
      "architecture_model_invalid",
      `Could not build architecture model: ${message}`,
      500
    );
  }
});
