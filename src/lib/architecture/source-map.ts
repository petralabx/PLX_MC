// Read + summarize docs/architecture/source-map.json for the provenance panel.
// Server-side only (fs). Does not invent a second SoT — paths come from the map.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ArchitectureProvenance,
  ArchitectureViewId,
  ProvenanceSourceRow,
} from "./types";

export type RawArchitectureSource = {
  path?: unknown;
  start_line?: unknown;
  end_line?: unknown;
  authority_class?: unknown;
  source_commit?: unknown;
};

export type RawArchitectureClaim = {
  fact_id?: unknown;
  canonical_claim?: unknown;
  canonical_summary?: unknown;
  sources?: RawArchitectureSource[];
};

export type RawArchitectureEntity = {
  mermaid_id?: unknown;
  display_label?: unknown;
  status?: unknown;
  claims?: RawArchitectureClaim[];
  from?: unknown;
  to?: unknown;
};

export type RawArchitectureView = {
  nodes?: RawArchitectureEntity[];
  edges?: RawArchitectureEntity[];
  annotations?: RawArchitectureEntity[];
  boundaries?: Record<string, unknown>;
};

export type RawArchitectureSourceMap = {
  schema_version?: unknown;
  notice?: unknown;
  source_commit?: unknown;
  views?: Partial<Record<ArchitectureViewId, RawArchitectureView>>;
};

const VIEW_IDS: ArchitectureViewId[] = ["context", "containers", "task-lifecycle"];

export function isArchitectureViewId(value: string): value is ArchitectureViewId {
  return (VIEW_IDS as string[]).includes(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asLine(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collectClaims(
  entities: RawArchitectureEntity[] | undefined
): RawArchitectureClaim[] {
  if (!entities) return [];
  const out: RawArchitectureClaim[] = [];
  for (const entity of entities) {
    if (Array.isArray(entity.claims)) {
      out.push(...entity.claims);
    }
  }
  return out;
}

function summarizeSources(
  claims: RawArchitectureClaim[]
): ProvenanceSourceRow[] {
  const keyed = new Map<string, ProvenanceSourceRow>();

  for (const claim of claims) {
    if (!Array.isArray(claim.sources)) continue;
    for (const src of claim.sources) {
      const path = asString(src.path);
      if (!path) continue;
      const authority = asString(src.authority_class) ?? "unknown";
      const start = asLine(src.start_line);
      const end = asLine(src.end_line);
      const key = `${path}\0${authority}\0${start ?? ""}\0${end ?? ""}`;
      const existing = keyed.get(key);
      if (existing) {
        existing.claim_count += 1;
      } else {
        keyed.set(key, {
          path,
          authority_class: authority,
          start_line: start,
          end_line: end,
          claim_count: 1,
        });
      }
    }
  }

  return Array.from(keyed.values()).sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    const aStart = a.start_line ?? 0;
    const bStart = b.start_line ?? 0;
    return aStart - bStart;
  });
}

export function loadSourceMapJson(cwd = process.cwd()): RawArchitectureSourceMap {
  const raw = readFileSync(join(cwd, "docs/architecture/source-map.json"), "utf8");
  return JSON.parse(raw) as RawArchitectureSourceMap;
}

export function buildProvenanceForView(
  view: ArchitectureViewId,
  map: RawArchitectureSourceMap = loadSourceMapJson()
): ArchitectureProvenance {
  const viewData = map.views?.[view];
  if (!viewData) {
    return {
      view,
      schema_version: asString(map.schema_version) ?? "unknown",
      notice: asString(map.notice) ?? "Source map view missing.",
      source_commit: asString(map.source_commit) ?? "",
      node_count: 0,
      edge_count: 0,
      sources: [],
    };
  }

  const claims = [
    ...collectClaims(viewData.nodes),
    ...collectClaims(viewData.edges),
    ...collectClaims(viewData.annotations),
  ];

  return {
    view,
    schema_version: asString(map.schema_version) ?? "unknown",
    notice:
      asString(map.notice) ??
      "Generated guide — not official. Architecture authority remains in AGENTS.md and docs/modules/*.",
    source_commit: asString(map.source_commit) ?? "",
    node_count: Array.isArray(viewData.nodes) ? viewData.nodes.length : 0,
    edge_count: Array.isArray(viewData.edges) ? viewData.edges.length : 0,
    sources: summarizeSources(claims),
  };
}
