// Registry loader/validator for plx-loop-ledger-registry/v1 config objects.
// Pure — accepts a config object or JSON string; no filesystem access here.
// Consumers must import through the barrel (src/lib/loop-ledgers/index.ts).

import { z } from "zod";
import type { RegistryConfig } from "./types";

// ─── Zod schema ───────────────────────────────────────────────────────────────

const freshnessConfigSchema = z.object({
  warn_after_days: z.number().int().positive(),
  stale_after_days: z.number().int().positive(),
});

const repoEntrySchema = z.object({
  repo: z.string().min(1),
  display_name: z.string().min(1),
  default_branch: z.string().min(1),
  ledger_glob: z.string().min(1),
  human_ledger_glob: z.string().optional(),
  route_inventory_glob: z.string().optional(),
  evidence_dir: z.string().optional(),
  freshness: freshnessConfigSchema.optional(),
});

const registryConfigSchema = z.object({
  schema_version: z.literal("plx-loop-ledger-registry/v1"),
  freshness: freshnessConfigSchema,
  repos: z.array(repoEntrySchema).min(1),
});

// ─── Public API ───────────────────────────────────────────────────────────────

export type RegistryParseResult =
  | { ok: true; config: RegistryConfig }
  | { ok: false; error: string };

/**
 * Parse and validate a registry config object.
 * Returns a typed result — never throws.
 */
export function parseRegistryConfig(raw: unknown): RegistryParseResult {
  const result = registryConfigSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: msg };
  }
  return { ok: true, config: result.data as RegistryConfig };
}

/**
 * Parse and validate a registry config from a JSON string.
 * Returns a typed result — never throws.
 */
export function parseRegistryJson(json: string): RegistryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "registry JSON is not parseable" };
  }
  return parseRegistryConfig(parsed);
}
