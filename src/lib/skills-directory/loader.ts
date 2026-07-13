// Loader — catalog list + skill detail from catalog pointer + GitHub source.

import { extractToc, parseMarkdown } from "@/lib/governance-sops";

import { degradedFallbackIds, resolveAllowIds } from "./catalog";
import { pointerFromAllowlist } from "./allowlist";
import { publishedSkills, resolveEffectiveGitRef } from "./manifest";
import type {
  AllowlistConfig,
  CatalogListResult,
  SkillDetailResult,
  SkillSummaryRow,
  SkillsSourceReader,
} from "./types";

function toSummary(skill: {
  id: string;
  name: string;
  description: string;
  status: string;
  tags?: string[];
}): SkillSummaryRow {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    status: skill.status,
    tags: skill.tags ?? [],
  };
}

export async function listSkillCatalog(
  config: AllowlistConfig,
  source: SkillsSourceReader
): Promise<CatalogListResult> {
  const pointer = pointerFromAllowlist(config);
  const fetched = await source.fetchManifest(pointer);

  if (!fetched.ok) {
    const fallback = degradedFallbackIds(config);
    return {
      meta: {
        sourceRepo: pointer.sourceRepo,
        version: "—",
        catalogVersion: "—",
        gitRef: resolveEffectiveGitRef(
          pointer.pinSha,
          pointer.pinTag,
          pointer.sourceBranch
        ),
        pinTag: pointer.pinTag,
        packageId: pointer.packageId,
        state: "degraded",
        note: fetched.note,
      },
      skills: fallback.map((id) => ({
        id,
        name: id,
        description: "",
        status: "unknown",
        tags: [],
      })),
    };
  }

  const allowIds = resolveAllowIds(config, fetched.manifest);
  const entries = publishedSkills(fetched.manifest, pointer.packageId, allowIds);
  return {
    meta: {
      sourceRepo: pointer.sourceRepo,
      version: fetched.manifest.version,
      catalogVersion: fetched.manifest.version,
      gitRef: resolveEffectiveGitRef(
        fetched.manifest.gitRef,
        fetched.ref,
        pointer.pinSha,
        pointer.pinTag,
        pointer.sourceBranch
      ),
      pinTag: pointer.pinTag,
      packageId: pointer.packageId,
      state: "ready",
    },
    skills: entries.map(toSummary).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getSkillDetail(
  config: AllowlistConfig,
  source: SkillsSourceReader,
  skillId: string
): Promise<SkillDetailResult> {
  const pointer = pointerFromAllowlist(config);
  const fetched = await source.fetchManifest(pointer);
  const allowIds = fetched.ok
    ? resolveAllowIds(config, fetched.manifest)
    : new Set(degradedFallbackIds(config));

  if (!allowIds.has(skillId)) {
    return {
      ok: false,
      id: skillId,
      reason: "skill_not_found",
      note: `skill "${skillId}" is not in the company catalog package`,
    };
  }

  if (!fetched.ok) {
    return {
      ok: false,
      id: skillId,
      reason: fetched.reason,
      note: fetched.note,
    };
  }

  const entry = publishedSkills(fetched.manifest, pointer.packageId, allowIds).find(
    (s) => s.id === skillId
  );
  if (!entry) {
    return {
      ok: false,
      id: skillId,
      reason: "skill_not_found",
      note: `skill "${skillId}" is not published in manifest ${fetched.manifest.version}`,
    };
  }

  const content = await source.fetchSkillContent(pointer, entry.contentPath);
  if (!content.ok) {
    return {
      ok: false,
      id: skillId,
      reason: content.reason,
      note: content.note,
    };
  }

  const nodes = parseMarkdown(content.content);
  const toc = extractToc(nodes);
  return {
    ok: true,
    skill: toSummary(entry),
    nodes,
    toc,
    manifestVersion: fetched.manifest.version,
  };
}
