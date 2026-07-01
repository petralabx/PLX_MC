// Local skills registry contract + drift detection for ~/.agentic/skills.registry.json.

import type { SkillManifestEntry, SkillsManifest } from "./types";

export const SKILLS_REGISTRY_SCHEMA_VERSION = "agentic-skills-registry.v1";

export interface SkillsRegistrySkill {
  id: string;
  contentSha: string;
  installedAt?: string;
}

export interface SkillsRegistry {
  schemaVersion: typeof SKILLS_REGISTRY_SCHEMA_VERSION;
  catalogVersion: string;
  gitRef: string;
  packageId: string;
  syncedAt: string;
  skills: SkillsRegistrySkill[];
}

export interface RegistryDrift {
  ok: boolean;
  catalogVersionChanged: boolean;
  gitRefChanged: boolean;
  packageIdChanged: boolean;
  missingSkillIds: string[];
  staleSkillIds: string[];
  extraSkillIds: string[];
}

type LegacyRegistry = {
  schema_version?: string;
  catalog_version?: string;
  generated_at_et?: string;
  skills?: Array<{ id?: string; contentSha?: string; content_sha?: string }>;
};

function manifestContentSha(skill: SkillManifestEntry): string | null {
  const maybe = skill as SkillManifestEntry & { contentSha?: unknown; content_sha?: unknown };
  if (typeof maybe.contentSha === "string" && maybe.contentSha) return maybe.contentSha;
  if (typeof maybe.content_sha === "string" && maybe.content_sha) return maybe.content_sha;
  return null;
}

export function parseSkillsRegistryJson(raw: string):
  | { ok: true; registry: SkillsRegistry }
  | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as Partial<SkillsRegistry> & LegacyRegistry;
    const rawSkills = Array.isArray(parsed.skills)
      ? (parsed.skills as Array<{ id?: unknown; contentSha?: unknown; content_sha?: unknown }>)
      : [];
    const skills = rawSkills
      .filter((s) => typeof s.id === "string" && s.id.length > 0)
      .map((s) => ({
        id: s.id as string,
        contentSha:
          typeof s.contentSha === "string"
            ? s.contentSha
            : typeof s.content_sha === "string"
              ? s.content_sha
              : "",
      }));
    return {
      ok: true,
      registry: {
        schemaVersion: SKILLS_REGISTRY_SCHEMA_VERSION,
        catalogVersion:
          typeof parsed.catalogVersion === "string"
            ? parsed.catalogVersion
            : (parsed.catalog_version ?? ""),
        gitRef: typeof parsed.gitRef === "string" ? parsed.gitRef : "",
        packageId: typeof parsed.packageId === "string" ? parsed.packageId : "",
        syncedAt:
          typeof parsed.syncedAt === "string"
            ? parsed.syncedAt
            : (parsed.generated_at_et ?? ""),
        skills,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invalid JSON" };
  }
}

export function buildRegistry(
  manifest: SkillsManifest,
  packageId: string,
  skills: SkillManifestEntry[],
  syncedAt = new Date().toISOString()
): SkillsRegistry {
  return {
    schemaVersion: SKILLS_REGISTRY_SCHEMA_VERSION,
    catalogVersion: manifest.version,
    gitRef: manifest.gitRef,
    packageId,
    syncedAt,
    skills: skills.map((skill) => ({
      id: skill.id,
      contentSha: manifestContentSha(skill) ?? "",
      installedAt: syncedAt,
    })),
  };
}

export function detectRegistryDrift(
  registry: SkillsRegistry | null | undefined,
  manifest: SkillsManifest,
  packageId: string,
  expectedSkills: SkillManifestEntry[]
): RegistryDrift {
  const expectedIds = expectedSkills.map((s) => s.id);
  const actualById = new Map((registry?.skills ?? []).map((s) => [s.id, s]));
  const expectedById = new Map(expectedSkills.map((s) => [s.id, s]));
  const missingSkillIds = expectedIds.filter((id) => !actualById.has(id));
  const staleSkillIds = expectedIds.filter((id) => {
    const actual = actualById.get(id);
    const expectedSha = manifestContentSha(expectedById.get(id)!);
    if (!actual) return false;
    if (!expectedSha) return actual.contentSha.length === 0;
    return actual.contentSha !== expectedSha;
  });
  const extraSkillIds = [...actualById.keys()].filter((id) => !expectedById.has(id));
  const catalogVersionChanged = registry?.catalogVersion !== manifest.version;
  const gitRefChanged = registry?.gitRef !== manifest.gitRef;
  const packageIdChanged = registry?.packageId !== packageId;

  return {
    ok:
      !!registry &&
      !catalogVersionChanged &&
      !gitRefChanged &&
      !packageIdChanged &&
      missingSkillIds.length === 0 &&
      staleSkillIds.length === 0 &&
      extraSkillIds.length === 0,
    catalogVersionChanged,
    gitRefChanged,
    packageIdChanged,
    missingSkillIds,
    staleSkillIds,
    extraSkillIds,
  };
}
