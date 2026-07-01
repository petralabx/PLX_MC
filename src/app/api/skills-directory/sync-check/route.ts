import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import {
  buildSkillsInstallPlan,
  createSkillsSource,
  parseSkillsRegistryJson,
  pointerFromAllowlist,
  readCompanySkillsAllowlist,
  type SkillsRegistry,
} from "@/lib/skills-directory";

const syncCheckSchema = z.object({
  localRegistry: z.unknown().optional(),
});

function parseLocalRegistry(value: unknown): SkillsRegistry | null {
  if (value === undefined || value === null) return null;
  const parsed = parseSkillsRegistryJson(
    typeof value === "string" ? value : JSON.stringify(value)
  );
  if (!parsed.ok) {
    throw new ApiError("invalid_registry", `Local skills registry is invalid: ${parsed.error}`);
  }
  return parsed.registry;
}

export const POST = route(async (req) => {
  const body = await parseBody(req, syncCheckSchema);
  const allowlist = readCompanySkillsAllowlist();
  const source = createSkillsSource();
  const fetched = await source.fetchManifest(pointerFromAllowlist(allowlist));
  if (!fetched.ok) {
    throw new ApiError(
      "catalog_unavailable",
      `Skills catalog unavailable: ${fetched.note}`,
      502
    );
  }
  const plan = buildSkillsInstallPlan({
    mode: "sync",
    allowlist,
    manifest: fetched.manifest,
    localRegistry: parseLocalRegistry(body.localRegistry),
  });
  return {
    mode: plan.mode,
    sourceRepo: plan.sourceRepo,
    gitRef: plan.gitRef,
    packageId: plan.packageId,
    catalogVersion: plan.catalogVersion,
    installSkillIds: plan.installSkillIds,
    missingSkillIds: plan.missingSkillIds,
    staleSkillIds: plan.staleSkillIds,
    drift: plan.drift,
  };
});
