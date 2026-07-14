// Normalize PR/commit metadata into metadata-only routing evidence.
// Raw PR bodies are parsed in memory for markers/hash, then discarded.

import { parseRoutingMarkers } from "./markers";
import type {
  ParseRoutingMarkersResult,
  RoutingActorKind,
  RoutingEvidenceMeta,
} from "./types";

export interface RoutingEvidenceInput {
  repoId?: string;
  repoFullName?: string;
  changeId?: string;
  headSha?: string;
  baseBranch?: string;
  sourceBranch?: string;
  branch?: string;
  title?: string;
  /** In-memory only — never copied onto the returned evidence object. */
  body?: string;
  changedPaths?: string[];
  labels?: string[];
  actorId?: string;
  actorKind?: RoutingActorKind;
  eventSource?: string;
  eventAction?: string;
  eventAt?: string;
}

export interface NormalizedRoutingEvidence {
  evidence: RoutingEvidenceMeta;
  markers: ParseRoutingMarkersResult;
  /** Task IDs found in branch names (author-controlled; not mutation authority). */
  branchTaskIds: string[];
}

const BRANCH_TASK_RE = /TASK-(\d+)/gi;

export function normalizeTitle(title: string | undefined | null): string | undefined {
  if (title == null) return undefined;
  const collapsed = title.trim().replace(/\s+/g, " ");
  return collapsed.length > 0 ? collapsed : undefined;
}

export function normalizeChangedPaths(paths: string[] | undefined | null): string[] {
  if (!paths?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== "string") continue;
    let path = raw.trim().replace(/\\/g, "/");
    while (path.startsWith("./")) path = path.slice(2);
    while (path.startsWith("/")) path = path.slice(1);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export function normalizeLabels(labels: string[] | undefined | null): string[] {
  if (!labels?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    if (typeof raw !== "string") continue;
    const label = raw.trim().toLowerCase();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function extractBranchTaskIds(branch: string | undefined | null): string[] {
  if (!branch) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of branch.matchAll(BRANCH_TASK_RE)) {
    const id = `TASK-${match[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Build metadata-only evidence. The raw `body` is never placed on `evidence`
 * and must not be persisted by callers — only `bodyContentHash` + markers.
 */
export function normalizeRoutingEvidence(
  input: RoutingEvidenceInput
): NormalizedRoutingEvidence {
  const body = typeof input.body === "string" ? input.body : "";
  const markers = parseRoutingMarkers(body);
  const sourceBranch = input.sourceBranch ?? input.branch;
  const changedPaths = normalizeChangedPaths(input.changedPaths);
  const labels = normalizeLabels(input.labels);
  const title = normalizeTitle(input.title);
  const branchTaskIds = extractBranchTaskIds(sourceBranch);

  const evidence: RoutingEvidenceMeta = {
    repoId: input.repoId,
    repoFullName: input.repoFullName,
    changeId: input.changeId,
    headSha: input.headSha,
    baseBranch: input.baseBranch,
    sourceBranch,
    branch: sourceBranch,
    title,
    bodyContentHash: markers.bodyContentHash,
    changedPaths,
    pathCount: changedPaths.length,
    labels,
    actorId: input.actorId,
    actorKind: input.actorKind,
    eventSource: input.eventSource,
    eventAction: input.eventAction,
    eventAt: input.eventAt,
  };

  return { evidence, markers, branchTaskIds };
}
