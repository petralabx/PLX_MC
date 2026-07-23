// Deterministic 1380px layout helpers — adapted from the design handoff engine.
// Presentation-only; canonical facts live in ArchitectureModel.

import type { CSSProperties } from "react";

import type { ArchitectureModel } from "@/lib/architecture";

export const CANVAS_W = 1380;

export type ArchView = ArchitectureModel["views"][number];
export type ArchNode = ArchView["nodes"][number];
export type ArchEdge = ArchView["edges"][number];
export type ArchGroup = ArchView["groups"][number];
export type ArchCategory = ArchitectureModel["categories"][number];

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "group"; id: string }
  | null;

export type Rect = { x: number; y: number; w: number; h: number };

export type ComputedEdge = {
  id: string;
  d: string;
  categoryId: string;
  dash: string;
  bidirectional?: boolean;
};

export type ComputedLabel = {
  id: string;
  text: string;
  left: number;
  top: number;
  categoryId: string;
};

export function summaryId(groupId: string): string {
  return `__grp_${groupId}`;
}

export function groupCollapsed(
  group: ArchGroup,
  overrides: Record<string, boolean>
): boolean {
  const ov = overrides[group.id];
  if (ov === true) return true;
  if (ov === false) return false;
  return false;
}

export function nodeRendered(
  node: ArchNode,
  group: ArchGroup | undefined,
  collapsed: boolean
): boolean {
  if (group && collapsed) return false;
  return true;
}

export function effectiveEndpoint(
  id: string,
  view: ArchView,
  overrides: Record<string, boolean>
): string | null {
  const node = view.nodes.find((n) => n.id === id);
  if (!node) return null;
  const group = view.groups.find((g) => g.id === node.group);
  if (group && groupCollapsed(group, overrides)) return summaryId(group.id);
  return node.id;
}

export function activeSet(
  renderedId: string,
  view: ArchView,
  overrides: Record<string, boolean>
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([renderedId]);
  const edges = new Set<string>();
  for (const ed of view.edges) {
    const f = effectiveEndpoint(ed.from, view, overrides);
    const t = effectiveEndpoint(ed.to, view, overrides);
    if (f === renderedId || t === renderedId) {
      edges.add(ed.id);
      if (f) nodes.add(f);
      if (t) nodes.add(t);
    }
  }
  return { nodes, edges };
}

export function activeSetEdge(
  edgeId: string,
  view: ArchView,
  overrides: Record<string, boolean>
): { nodes: Set<string>; edges: Set<string> } {
  const ed = view.edges.find((e) => e.id === edgeId);
  if (!ed) return { nodes: new Set(), edges: new Set() };
  const f = effectiveEndpoint(ed.from, view, overrides);
  const t = effectiveEndpoint(ed.to, view, overrides);
  const nodes = new Set<string>();
  if (f) nodes.add(f);
  if (t) nodes.add(t);
  return { nodes, edges: new Set([edgeId]) };
}

export function computeEdges(
  view: ArchView,
  overrides: Record<string, boolean>,
  rects: Record<string, Rect>
): { edges: ComputedEdge[]; labels: ComputedLabel[] } {
  const out: ComputedEdge[] = [];
  const labels: ComputedLabel[] = [];
  const seen: Record<string, boolean> = {};

  for (const ed of view.edges) {
    const f = effectiveEndpoint(ed.from, view, overrides);
    const t = effectiveEndpoint(ed.to, view, overrides);
    if (!f || !t || f === t) continue;

    const folded = f !== ed.from || t !== ed.to;
    if (folded) {
      const k = `${f}|${t}`;
      if (seen[k]) continue;
      seen[k] = true;
    }

    const rf = rects[f];
    const rt = rects[t];
    if (!rf || !rt) continue;

    const rt_ = ed.route ?? {};
    const cf = { x: rf.x + rf.w / 2, y: rf.y + rf.h / 2 };
    const ct = { x: rt.x + rt.w / 2, y: rt.y + rt.h / 2 };
    const dx = ct.x - cf.x;
    const dy = ct.y - cf.y;
    const off = Math.max(40, Math.min(Math.hypot(dx, dy) * 0.4, 150));

    let fx: number;
    let fy: number;
    let tx: number;
    let ty: number;
    let c1: { x: number; y: number };
    let c2: { x: number; y: number };

    if (Math.abs(dy) >= Math.abs(dx)) {
      const down = dy > 0;
      fx = cf.x + (rt_.aShift ?? 0) * rf.w;
      fy = down ? rf.y + rf.h : rf.y;
      tx = ct.x + (rt_.bShift ?? 0) * rt.w;
      ty = down ? rt.y : rt.y + rt.h;
      const n = down ? 1 : -1;
      c1 = { x: fx, y: fy + n * off };
      c2 = { x: tx, y: ty - n * off };
    } else {
      const right = dx > 0;
      fx = right ? rf.x + rf.w : rf.x;
      fy = cf.y + (rt_.aShift ?? 0) * rf.h;
      tx = right ? rt.x : rt.x + rt.w;
      ty = ct.y + (rt_.bShift ?? 0) * rt.h;
      const n = right ? 1 : -1;
      c1 = { x: fx + n * off, y: fy };
      c2 = { x: tx - n * off, y: ty };
    }

    const d = `M${fx},${fy} C${c1.x},${c1.y} ${c2.x},${c2.y} ${tx},${ty}`;
    const cat = ed.category;
    out.push({
      id: ed.id,
      d,
      categoryId: cat,
      dash: "5,4",
      bidirectional: ed.bidirectional,
    });

    if (!folded) {
      const mx =
        0.125 * (fx + 3 * c1.x + 3 * c2.x + tx) + (rt_.lx ?? 0);
      const my =
        0.125 * (fy + 3 * c1.y + 3 * c2.y + ty) + (rt_.ly ?? 0);
      labels.push({ id: ed.id, text: ed.label, left: mx, top: my, categoryId: cat });
    }
  }

  return { edges: out, labels };
}

export type BandRow = {
  rowStyle: CSSProperties;
  cells: BandCell[];
};

export type BandCell = {
  id: string;
  label: string;
  kicker: string;
  tagline?: string;
  desc?: string;
  width: number;
  emphasis?: boolean;
  categoryId: string;
  badges?: Array<{ label: string; tone: "ok" | "warn" | "info" }>;
  isSummary?: boolean;
  groupId?: string;
};

export type Band = {
  groupId?: string;
  hasCaption: boolean;
  caption?: string;
  collapsed?: boolean;
  boxStyle: CSSProperties;
  captionStyle?: CSSProperties;
  rows: BandRow[];
};

export function buildBands(
  view: ArchView,
  categories: ArchCategory[],
  overrides: Record<string, boolean>
): Band[] {
  const bands: Band[] = [];
  const bandIdx = new Set<number>();
  for (const n of view.nodes) {
    if (!n.group) bandIdx.add(n.band);
  }
  for (const g of view.groups) bandIdx.add(g.band ?? 99);
  const order = [...bandIdx].sort((a, b) => a - b);
  let first = true;

  const catMap = new Map(categories.map((c) => [c.id, c]));

  function nodeCell(node: ArchNode): BandCell {
    const cat = catMap.get(node.category);
    return {
      id: node.id,
      label: node.label,
      kicker: node.kicker ?? cat?.label ?? node.category,
      tagline: node.tagline,
      width: node.width ?? 230,
      emphasis: node.emphasis,
      categoryId: node.category,
      badges: node.badges,
    };
  }

  function summaryCell(group: ArchGroup): BandCell {
    const s = group.summary;
    return {
      id: summaryId(group.id),
      label: s?.title ?? group.label,
      kicker: s?.kicker ?? "Boundary",
      desc: s?.description,
      width: s?.width ?? 520,
      categoryId: "internal",
      isSummary: true,
      groupId: group.id,
    };
  }

  function rowsFrom(nodes: ArchNode[]): BandRow[] {
    const byLayer: Record<number, ArchNode[]> = {};
    for (const n of nodes) {
      const L = n.layer ?? 0;
      (byLayer[L] ??= []).push(n);
    }
    const keys = Object.keys(byLayer)
      .map(Number)
      .sort((a, b) => a - b);
    return keys.map((L, idx) => {
      const cells = byLayer[L].map(nodeCell);
      return {
        rowStyle: {
          display: "flex",
          gap: "24px",
          justifyContent: cells.length === 1 ? "center" : "space-between",
          alignItems: "stretch",
          marginTop: idx === 0 ? "0" : "64px",
        },
        cells,
      };
    });
  }

  for (const bi of order) {
    const free = view.nodes.filter(
      (n) => !n.group && n.band === bi && nodeRendered(n, undefined, false)
    );
    if (free.length) {
      bands.push({
        hasCaption: false,
        boxStyle: {
          position: "relative",
          padding: "0 40px",
          marginTop: first ? "0" : "92px",
        },
        rows: rowsFrom(free),
      });
      first = false;
    }

    for (const g of view.groups.filter((gr) => (gr.band ?? 99) === bi)) {
      const collapsed = groupCollapsed(g, overrides);
      const rows = collapsed
        ? [
            {
              rowStyle: { display: "flex", justifyContent: "center" },
              cells: [summaryCell(g)],
            },
          ]
        : rowsFrom(
            view.nodes.filter(
              (n) =>
                n.group === g.id &&
                nodeRendered(n, g, collapsed)
            )
          );
      bands.push({
        groupId: g.id,
        hasCaption: true,
        collapsed,
        caption: `${collapsed ? "▸" : "▾"} ${g.label}`,
        boxStyle: {
          position: "relative",
          marginTop: first ? "0" : "92px",
          borderRadius: "14px",
          padding: collapsed ? "30px 44px" : "64px 44px 52px",
        },
        rows,
      });
      first = false;
    }
  }

  return bands;
}

export function parseSelectionHash(raw: string, view: ArchView): Selection {
  if (!raw) return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const nid = p.get("node");
  const eid = p.get("edge");
  const gid = p.get("group");
  if (nid && view.nodes.some((n) => n.id === nid)) return { kind: "node", id: nid };
  if (eid && view.edges.some((e) => e.id === eid)) return { kind: "edge", id: eid };
  if (gid && view.groups.some((g) => g.id === gid)) return { kind: "group", id: gid };
  return null;
}

export function selectionToHash(sel: Selection): string {
  if (!sel) return "";
  return `${sel.kind}=${sel.id}`;
}
