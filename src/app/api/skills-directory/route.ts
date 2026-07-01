// GET /api/skills-directory — company skills catalog from plx-cursor-skills.
// Auth-gated by middleware. Read-only: GET only, no writes.

import { ApiError, route } from "@/lib/api/route";
import {
  createSkillsSource,
  listSkillCatalog,
  loadCatalogConfig,
} from "@/lib/skills-directory";

export const GET = route(async () => {
  const parsed = loadCatalogConfig();
  if (!parsed.ok) {
    throw new ApiError(
      "invalid_catalog",
      `Company skills catalog config is invalid: ${parsed.error}`,
      500
    );
  }
  return listSkillCatalog(parsed.config, createSkillsSource());
});
