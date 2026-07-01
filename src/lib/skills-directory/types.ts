// Types for the skills-directory domain module (MC Skills Directory Phase 3 MVP).

import type { MdNode, TocEntry } from "@/lib/governance-sops";

export type CatalogState = "ready" | "degraded";

export interface CatalogPointer {
  sourceRepo: string;
  sourceBranch: string;
  manifestPath: string;
  pinTag: string;
  pinSha: string;
  packageId: string;
}

export type ManifestFetchReason =
  | "token_missing"
  | "permission_denied"
  | "rate_limit"
  | "not_found"
  | "network_error"
  | "invalid_manifest";

export type ManifestFetchResult =
  | { ok: true; manifest: SkillsManifest; ref: string }
  | { ok: false; reason: ManifestFetchReason; note: string };

export type ContentFetchResult =
  | { ok: true; content: string }
  | { ok: false; reason: ManifestFetchReason; note: string };

export interface SkillsManifest {
  schemaVersion: string;
  version: string;
  publishedAt: string;
  gitRef: string;
  repo: string;
  defaultBranch: string;
  packages: Array<{ id: string; name: string; skillIds: string[] }>;
  skills: SkillManifestEntry[];
}

export interface SkillManifestEntry {
  id: string;
  name: string;
  description: string;
  status: string;
  contentPath: string;
  tags?: string[];
  owner?: string;
}

export interface CatalogMeta {
  sourceRepo: string;
  version: string;
  catalogVersion: string;
  gitRef: string;
  pinTag: string;
  packageId: string;
  state: CatalogState;
  note?: string;
}

export interface SkillSummaryRow {
  id: string;
  name: string;
  description: string;
  status: string;
  tags: string[];
}

export interface CatalogListResult {
  meta: CatalogMeta;
  skills: SkillSummaryRow[];
}

export type SkillDetailResult =
  | {
      ok: true;
      skill: SkillSummaryRow;
      nodes: MdNode[];
      toc: TocEntry[];
      manifestVersion: string;
    }
  | {
      ok: false;
      id: string;
      reason: ManifestFetchReason | "skill_not_found" | "source_empty";
      note: string;
    };

export interface SkillsSourceReader {
  fetchManifest(pointer: CatalogPointer): Promise<ManifestFetchResult>;
  fetchSkillContent(
    pointer: CatalogPointer,
    contentPath: string
  ): Promise<ContentFetchResult>;
}

export interface AllowlistConfig {
  schemaVersion: string;
  sourceRepo: string;
  sourceBranch: string;
  manifestPath: string;
  packageId: string;
  pinTag: string;
  pinSha: string;
  skills: string[];
}
