// Registry parser for plx-governance-sops-registry/v1 config objects.
// Pure — accepts a config object or JSON string; no filesystem access here.
// Consumers import through the barrel (src/lib/governance-sops/index.ts).

import { z } from "zod";
import type { SopRegistryConfig } from "./types";

const sopSourceSchema = z.object({ repo_path: z.string().min(1) });

const sopEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase letters/digits/hyphens"),
  title: z.string().min(1),
  description: z.string().min(1),
  audience: z.string().min(1),
  owner: z.string().min(1),
  effective_date: z.string().min(1),
  last_reviewed: z.string().optional(),
  status: z.enum(["active", "draft", "superseded", "planned"]),
  tags: z.array(z.string()).default([]),
  source: sopSourceSchema.optional(),
});

const registryConfigSchema = z
  .object({
    schema_version: z.literal("plx-governance-sops-registry/v1"),
    sops: z.array(sopEntrySchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const s of cfg.sops) {
      if (seen.has(s.slug)) {
        ctx.addIssue({ code: "custom", message: `duplicate slug: ${s.slug}` });
      }
      seen.add(s.slug);
    }
  });

export type SopRegistryParseResult =
  | { ok: true; config: SopRegistryConfig }
  | { ok: false; error: string };

/** Parse + validate a registry config object. Never throws. */
export function parseSopRegistryConfig(raw: unknown): SopRegistryParseResult {
  const result = registryConfigSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: msg };
  }
  return { ok: true, config: result.data as SopRegistryConfig };
}

/** Parse + validate a registry config from a JSON string. Never throws. */
export function parseSopRegistryJson(json: string): SopRegistryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "registry JSON is not parseable" };
  }
  return parseSopRegistryConfig(parsed);
}
