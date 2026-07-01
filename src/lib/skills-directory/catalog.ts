// Load and parse skills catalog config (v3 pointer-only or legacy v2 allowlist).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiError } from "@/lib/api/route";

import { parseAllowlistJson } from "./allowlist";
import { packageSkillIds } from "./manifest";
import type { AllowlistConfig, SkillsManifest } from "./types";

export const CATALOG_CONFIG_FILES = [
  "config/skills-catalog.json",
  "config/company-skills-allowlist.json",
] as const;

let legacySkillsWarned = false;

/** Read catalog config from repo; prefers skills-catalog.json (v3). */
export function loadCatalogConfigRaw(cwd = process.cwd()): string {
  for (const rel of CATALOG_CONFIG_FILES) {
    const path = join(cwd, rel);
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
  }
  throw new Error("no skills catalog config found (config/skills-catalog.json)");
}

export function parseCatalogConfig(raw: string):
  | { ok: true; config: AllowlistConfig }
  | { ok: false; error: string } {
  return parseAllowlistJson(raw);
}

export function loadCatalogConfig(cwd = process.cwd()):
  | { ok: true; config: AllowlistConfig }
  | { ok: false; error: string } {
  try {
    return parseCatalogConfig(loadCatalogConfigRaw(cwd));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "catalog config missing",
    };
  }
}

/** Throws ApiError when catalog config is invalid (route helper). */
export function readCompanySkillsAllowlist(): AllowlistConfig {
  const parsed = loadCatalogConfig();
  if (!parsed.ok) {
    throw new ApiError(
      "invalid_catalog",
      `Company skills catalog config is invalid: ${parsed.error}`,
      500
    );
  }
  return parsed.config;
}

/** Skill ids for filtering: legacy v2 skills[] or manifest package when v3. */
export function resolveAllowIds(
  config: AllowlistConfig,
  manifest: SkillsManifest | null
): Set<string> {
  if (config.skills.length > 0) {
    if (
      config.schemaVersion.startsWith("plx-company-skills-allowlist/") &&
      !legacySkillsWarned &&
      process.env.NODE_ENV !== "test"
    ) {
      legacySkillsWarned = true;
      console.warn(
        "[skills-directory] config.skills[] is deprecated; use config/skills-catalog.json (manifest package ids)"
      );
    }
    return new Set(config.skills);
  }
  if (manifest && config.packageId) {
    return new Set(packageSkillIds(manifest, config.packageId));
  }
  return new Set();
}

/** Degraded fallback ids when manifest fetch fails (v2 only). */
export function degradedFallbackIds(config: AllowlistConfig): string[] {
  return config.skills.length > 0 ? config.skills : [];
}
