// GET /api/skills-directory/[id] — one skill rendered from SKILL.md, or a loud
// degraded result. Auth-gated by middleware. Read-only: GET only, no writes.
// Degraded detail is returned in { data: { ok: false, ... } } at 200.
// An unknown catalog id is a 404.

import { ApiError, route } from "@/lib/api/route";
import {
  createSkillsSource,
  getSkillDetail,
  loadCatalogConfig,
} from "@/lib/skills-directory";

export const GET = route(async (_req, ctx) => {
  const { id } = await ctx.params;

  const parsed = loadCatalogConfig();
  if (!parsed.ok) {
    throw new ApiError(
      "invalid_catalog",
      `Company skills catalog config is invalid: ${parsed.error}`,
      500
    );
  }

  if (parsed.config.skills.length > 0 && !parsed.config.skills.includes(id)) {
    throw new ApiError("not_found", `No company skill registered with id '${id}'.`, 404);
  }

  const detail = await getSkillDetail(parsed.config, createSkillsSource(), id);
  if (!detail.ok && detail.reason === "skill_not_found") {
    throw new ApiError("not_found", `No company skill registered with id '${id}'.`, 404);
  }
  return detail;
});
