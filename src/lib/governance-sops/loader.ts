// Loader — turns the registry + a source reader into UI-ready summaries and
// detail results. One bad SOP source never kills the batch; degraded and
// planned rows stay visible (the index is a loud lens, never a silent filter).
// Consumers import through the barrel.

import { extractToc, parseMarkdown } from "./markdown";
import type {
  SopDetailResult,
  SopRegistryConfig,
  SopRegistryEntry,
  SopSourceReader,
  SopState,
  SopStatus,
  SopSummaryRow,
} from "./types";

const PLANNED_NOTE =
  "Planned — this SOP's content is not wired into Mission Control yet. It appears here so the catalog is complete; it opens once its source is registered.";

// Degraded first (loud, needs attention), then ready doctrine, then planned.
const STATE_RANK: Record<SopState, number> = { degraded: 0, ready: 1, planned: 2 };
// Within "ready", active doctrine outranks draft/superseded.
const STATUS_RANK: Record<SopStatus, number> = {
  active: 0,
  draft: 1,
  superseded: 2,
  planned: 3,
};

function sortRows(rows: SopSummaryRow[]): SopSummaryRow[] {
  return [...rows].sort((a, b) => {
    const s = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (s !== 0) return s;
    const st = STATUS_RANK[a.meta.status] - STATUS_RANK[b.meta.status];
    if (st !== 0) return st;
    return a.meta.title.localeCompare(b.meta.title);
  });
}

function isPlanned(meta: SopRegistryEntry): boolean {
  return meta.status === "planned" || !meta.source;
}

export async function listSopSummaries(
  config: SopRegistryConfig,
  source: SopSourceReader
): Promise<SopSummaryRow[]> {
  const rows: SopSummaryRow[] = [];
  for (const meta of config.sops) {
    if (isPlanned(meta)) {
      rows.push({ meta, state: "planned", note: PLANNED_NOTE });
      continue;
    }
    const res = await source.read(meta.source!.repo_path);
    if (res.ok) {
      rows.push({ meta, state: "ready" });
    } else {
      rows.push({ meta, state: "degraded", reason: res.reason, note: res.note });
    }
  }
  return sortRows(rows);
}

export async function getSopDetail(
  meta: SopRegistryEntry,
  source: SopSourceReader
): Promise<SopDetailResult> {
  if (isPlanned(meta)) {
    return { ok: false, meta, reason: "planned", note: PLANNED_NOTE };
  }
  const res = await source.read(meta.source!.repo_path);
  if (!res.ok) {
    return { ok: false, meta, reason: res.reason, note: res.note };
  }
  const nodes = parseMarkdown(res.content);
  const toc = extractToc(nodes);
  return {
    ok: true,
    meta,
    nodes,
    toc,
    bytes: Buffer.byteLength(res.content, "utf8"),
  };
}
