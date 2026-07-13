// Validate company skills manifest.json payloads (petralabx/skills).

import { z } from "zod";

import { SKILL_ID_PATTERN } from "./ids";
import type { SkillsManifest } from "./types";

const SkillEntrySchema = z.object({
  id: z.string().regex(SKILL_ID_PATTERN),
  name: z.string().min(1),
  description: z.string(),
  status: z.string(),
  contentPath: z.string().min(1),
  tags: z.array(z.string()).optional(),
  owner: z.string().optional(),
});

const ManifestSchema = z.object({
  schemaVersion: z.string(),
  version: z.string(),
  publishedAt: z.string(),
  // Optional publisher provenance stamp. Consumers pin via catalog pinSha/pinTag;
  // missing gitRef must not blank the catalog (normalize from fetch ref / pin).
  gitRef: z.string().optional(),
  repo: z.string(),
  defaultBranch: z.string().default("main"),
  packages: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        skillIds: z.array(z.string().regex(SKILL_ID_PATTERN)),
      })
    )
    .default([]),
  skills: z.array(SkillEntrySchema).min(1),
});

/** First non-empty string among publisher stamp, fetch ref, and catalog pin. */
export function resolveEffectiveGitRef(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

export function parseManifestJson(
  raw: string,
  opts: { fallbackGitRef?: string } = {}
): { ok: true; manifest: SkillsManifest } | { ok: false; error: string } {
  try {
    const parsed = ManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    const data = parsed.data;
    return {
      ok: true,
      manifest: {
        ...data,
        gitRef: resolveEffectiveGitRef(data.gitRef, opts.fallbackGitRef),
      } as SkillsManifest,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "invalid JSON",
    };
  }
}

export function packageSkillIds(manifest: SkillsManifest, packageId: string): string[] {
  const pkg = manifest.packages.find((p) => p.id === packageId);
  return pkg?.skillIds ?? [];
}

export function publishedSkills(
  manifest: SkillsManifest,
  packageId: string,
  allowIds: Set<string>
): SkillsManifest["skills"] {
  const effectiveAllow =
    allowIds.size > 0 ? allowIds : new Set(packageSkillIds(manifest, packageId));
  let ids: string[] | null = null;
  if (packageId) {
    const pkg = manifest.packages.find((p) => p.id === packageId);
    if (pkg) ids = pkg.skillIds.filter((id) => effectiveAllow.has(id));
  }
  const pool = manifest.skills.filter(
    (s) => s.status === "published" && effectiveAllow.has(s.id)
  );
  if (!ids) return pool;
  const byId = new Map(pool.map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as SkillsManifest["skills"];
}
