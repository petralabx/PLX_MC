"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ArchitectureModel } from "@/lib/architecture";

import { DetailPanel } from "./detail-panel";
import {
  CANVAS_W,
  activeSet,
  activeSetEdge,
  buildBands,
  computeEdges,
  parseSelectionHash,
  selectionToHash,
  summaryId,
  type Band,
  type BandCell,
  type ComputedEdge,
  type ComputedLabel,
  type Rect,
  type Selection,
} from "./layout";

type Props = {
  model: ArchitectureModel;
  viewId: string;
  diagramLabel: string;
};

function categoryDashed(
  categories: ArchitectureModel["categories"],
  id: string
): boolean {
  return categories.find((c) => c.id === id)?.dashed ?? false;
}

function categoryToken(
  categories: ArchitectureModel["categories"],
  id: string
): string {
  return categories.find((c) => c.id === id)?.colorToken ?? "--p-ink-2";
}

export function ArchitectureCanvas({ model, viewId, diagramLabel }: Props) {
  const view = model.views.find((v) => v.id === viewId) ?? model.views[0];
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const [hoverSet, setHoverSet] = useState<{
    nodes: Set<string>;
    edges: Set<string>;
  } | null>(null);
  const [scale, setScale] = useState(0.28);
  const [wrapH, setWrapH] = useState(0);
  const [layoutReady, setLayoutReady] = useState(false);
  const [edges, setEdges] = useState<ComputedEdge[]>([]);
  const [labels, setLabels] = useState<ComputedLabel[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const outerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const bands = useMemo(
    () => buildBands(view, model.categories, overrides),
    [view, model.categories, overrides]
  );

  const highlightSet =
    hoverSet ??
    (selection
      ? selection.kind === "edge"
        ? activeSetEdge(selection.id, view, overrides)
        : activeSet(
            selection.kind === "group"
              ? summaryId(selection.id)
              : selection.id,
            view,
            overrides
          )
      : null);

  const syncHash = useCallback(
    (sel: Selection) => {
      const hash = selectionToHash(sel);
      try {
        const base = `${window.location.pathname}${window.location.search}`;
        history.replaceState(null, "", hash ? `${base}#${hash}` : base);
      } catch {
        /* ignore */
      }
    },
    []
  );

  const select = useCallback(
    (sel: Selection) => {
      setSelection(sel);
      syncHash(sel);
    },
    [syncHash]
  );

  const clearFocus = useCallback(() => select(null), [select]);

  const toggleGroup = useCallback((groupId: string) => {
    setOverrides((prev) => {
      const collapsed = prev[groupId] ?? false;
      return { ...prev, [groupId]: !collapsed };
    });
    setSelection(null);
    syncHash(null);
  }, [syncHash]);

  const computeLayout = useCallback(() => {
    const root = canvasRef.current;
    const outer = outerRef.current;
    if (!root || !outer) return;

    const rootRect = root.getBoundingClientRect();
    const applied = root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
    const rects: Record<string, Rect> = {};
    root.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => {
      const r = el.getBoundingClientRect();
      rects[el.dataset.node ?? ""] = {
        x: (r.left - rootRect.left) / applied,
        y: (r.top - rootRect.top) / applied,
        w: r.width / applied,
        h: r.height / applied,
      };
    });

    const computed = computeEdges(view, overrides, rects);
    setEdges((prev) =>
      JSON.stringify(prev) === JSON.stringify(computed.edges) ? prev : computed.edges
    );
    setLabels((prev) =>
      JSON.stringify(prev) === JSON.stringify(computed.labels) ? prev : computed.labels
    );
    setSvgSize((prev) =>
      prev.w === root.offsetWidth && prev.h === root.offsetHeight
        ? prev
        : { w: root.offsetWidth, h: root.offsetHeight }
    );

    const availW = outer.clientWidth;
    const nextScale = Math.min(1, availW / CANVAS_W);
    setScale((prev) => (prev === nextScale ? prev : nextScale));
    const nextWrapH = root.offsetHeight * nextScale;
    setWrapH((prev) => (prev === nextWrapH ? prev : nextWrapH));
    setLayoutReady(true);
  }, [view, overrides]);

  useLayoutEffect(() => {
    computeLayout();
    const t1 = window.setTimeout(computeLayout, 140);
    const t2 = window.setTimeout(computeLayout, 420);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [computeLayout, bands.length, overrides]);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const ro = new ResizeObserver(() => computeLayout());
    ro.observe(outer);
    window.addEventListener("resize", computeLayout);
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => computeLayout());
    }
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", computeLayout);
    };
  }, [computeLayout]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const parsed = parseSelectionHash(hash, view);
    if (parsed) {
      const kick = window.setTimeout(() => setSelection(parsed), 0);
      return () => window.clearTimeout(kick);
    }
    return undefined;
  }, [view]);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseSelectionHash(window.location.hash.slice(1), view);
      setSelection(parsed);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selection) clearFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, clearFocus]);

  const exportSvg = () => {
    const root = canvasRef.current;
    if (!root) return;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.style.transform = "none";
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const bg = getComputedStyle(document.documentElement).getPropertyValue(
      "--p-paper"
    ).trim() || "transparent";
    const src = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;background:${bg};font-family:sans-serif;">${clone.outerHTML}</div></foreignObject></svg>`;
    const blob = new Blob([src], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const commit = model.meta.source.commit.slice(0, 12);
    a.download = `plx-architecture-${viewId}-${commit}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const printPage = () => window.print();

  const prov = model.meta.source;
  const provChips = [
    "READ-ONLY · GENERATED FROM GIT",
    prov.path,
    `${prov.commit.slice(0, 12)}`,
  ];

  function nodeOpacity(id: string): number {
    if (!highlightSet) return 1;
    return highlightSet.nodes.has(id) ? 1 : 0.28;
  }

  function edgeOpacity(id: string): number {
    if (!highlightSet) return 1;
    return highlightSet.edges.has(id) ? 1 : 0.12;
  }

  function edgeWidth(id: string): number {
    if (!highlightSet) return 1.8;
    return highlightSet.edges.has(id) ? 3 : 1.8;
  }

  function labelOpacity(id: string): number {
    if (!highlightSet) return 1;
    return highlightSet.edges.has(id) ? 1 : 0.18;
  }

  function onNodeClick(cell: BandCell) {
    if (cell.isSummary && cell.groupId) {
      select({ kind: "group", id: cell.groupId });
      return;
    }
    select({ kind: "node", id: cell.id });
  }

  function cardClass(cell: BandCell): string {
    const parts = ["arch-card"];
    if (cell.emphasis) parts.push("emphasis");
    if (cell.isSummary) parts.push("summary");
    const cat = model.categories.find((c) => c.id === cell.categoryId);
    if (cat?.dashed) parts.push("dashed");
    parts.push(`accent-${cat?.accent ?? "top"}`);
    return parts.join(" ");
  }

  return (
    <div className="arch-canvas-root" data-testid="arch-canvas">
      <div className="arch-canvas-header" data-no-print>
        <div className="arch-canvas-header-main">
          <div className="arch-canvas-kicker">{model.meta.kicker}</div>
          <div className="arch-canvas-title">{model.meta.title}</div>
          <div className="arch-canvas-sub">{model.meta.subtitle}</div>
          <div className="arch-prov-chips" data-testid="arch-prov-chips">
            {provChips.map((text) => (
              <span key={text} className="arch-prov-chip">
                {text}
              </span>
            ))}
          </div>
        </div>
        <div className="arch-canvas-controls">
          <div className="arch-canvas-ctl-row">
            <span className="arch-canvas-level" data-testid="arch-level-label">
              {diagramLabel}
            </span>
            <button
              type="button"
              className="arch-ctl-btn"
              data-testid="arch-export-svg"
              onClick={exportSvg}
            >
              SVG
            </button>
            <button
              type="button"
              className="arch-ctl-btn"
              data-testid="arch-print"
              onClick={printPage}
            >
              Print
            </button>
            <button
              type="button"
              className="arch-ctl-btn"
              data-testid="arch-clear-focus"
              onClick={clearFocus}
              disabled={!selection}
            >
              Clear focus
            </button>
          </div>
          <div className="arch-legend" data-testid="arch-legend">
            {model.categories.map((c) => (
              <span key={c.id} className="arch-legend-item">
                <span
                  className="arch-legend-swatch"
                  style={{ background: `var(${c.colorToken})` }}
                />
                {c.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="arch-canvas-section">
        <div ref={outerRef} className="arch-canvas-outer">
          <div
            className="arch-canvas-scale-wrap"
            style={{
              width: layoutReady ? `${CANVAS_W * scale}px` : "100%",
              maxWidth: "100%",
              height: wrapH ? `${wrapH}px` : "240px",
              opacity: layoutReady ? 1 : 0,
            }}
          >
            <div
              ref={canvasRef}
              className="arch-canvas-inner"
              style={{
                width: `${CANVAS_W}px`,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
              data-testid="arch-canvas-inner"
            >
              <svg
                width={svgSize.w}
                height={svgSize.h}
                className="arch-edge-svg"
                aria-hidden
              >
                <defs>
                  {model.categories.map((c) => (
                    <marker
                      key={c.id}
                      id={`ah-${c.id}`}
                      viewBox="0 0 10 10"
                      refX="8.5"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path
                        d="M0,0 L10,5 L0,10 z"
                        fill={`var(${c.colorToken})`}
                      />
                    </marker>
                  ))}
                </defs>
                {edges.map((e) => {
                  const dashed = categoryDashed(model.categories, e.categoryId);
                  return (
                    <path
                      key={e.id}
                      d={e.d}
                      data-edge={e.id}
                      fill="none"
                      stroke={`var(${categoryToken(model.categories, e.categoryId)})`}
                      strokeWidth={edgeWidth(e.id)}
                      strokeDasharray={dashed ? "5,4" : undefined}
                      markerEnd={`url(#ah-${e.categoryId})`}
                      markerStart={
                        e.bidirectional ? `url(#ah-${e.categoryId})` : undefined
                      }
                      style={{ opacity: edgeOpacity(e.id) }}
                    />
                  );
                })}
              </svg>

              <div className="arch-bands">
                {bands.map((band, bi) => (
                  <BandBlock
                    key={band.groupId ?? `free-${bi}`}
                    band={band}
                    categories={model.categories}
                    nodeOpacity={nodeOpacity}
                    onNodeClick={onNodeClick}
                    onNodeEnter={(id) =>
                      setHoverSet(activeSet(id, view, overrides))
                    }
                    onNodeLeave={() => setHoverSet(null)}
                    onGroupToggle={toggleGroup}
                    cardClass={cardClass}
                  />
                ))}
              </div>

              {labels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  data-edge={l.id}
                  className="arch-edge-label"
                  style={{
                    left: `${l.left}px`,
                    top: `${l.top}px`,
                    opacity: labelOpacity(l.id),
                    borderColor: `var(${categoryToken(model.categories, l.categoryId)})`,
                  }}
                  onClick={() => select({ kind: "edge", id: l.id })}
                >
                  {l.text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="arch-canvas-footer">
        <div className="arch-canvas-footer-left">
          {model.meta.footer.left.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
        <div className="arch-canvas-footer-right">
          {model.meta.footer.right.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      </footer>

      {selection ? (
        <DetailPanel
          selection={selection}
          view={view}
          categories={model.categories}
          onClose={clearFocus}
        />
      ) : null}
    </div>
  );
}

type BandBlockProps = {
  band: Band;
  categories: ArchitectureModel["categories"];
  nodeOpacity: (id: string) => number;
  onNodeClick: (cell: BandCell) => void;
  onNodeEnter: (id: string) => void;
  onNodeLeave: () => void;
  onGroupToggle: (groupId: string) => void;
  cardClass: (cell: BandCell) => string;
};

function BandBlock({
  band,
  categories,
  nodeOpacity,
  onNodeClick,
  onNodeEnter,
  onNodeLeave,
  onGroupToggle,
  cardClass,
}: BandBlockProps) {
  const toneClass =
    band.groupId && !band.collapsed
      ? "arch-boundary"
      : "";

  return (
    <div
      className={`arch-band ${toneClass}${band.collapsed ? " collapsed" : ""}`}
      style={band.boxStyle}
    >
      {band.hasCaption && band.groupId ? (
        <button
          type="button"
          className="arch-band-caption"
          data-group={band.groupId}
          data-testid={`arch-group-${band.groupId}`}
          onClick={(e) => onGroupToggle(e.currentTarget.dataset.group ?? "")}
        >
          {band.caption}
        </button>
      ) : null}
      {band.rows.map((row, ri) => (
        <div key={ri} style={row.rowStyle}>
          {row.cells.map((cell) => {
            const token = categoryToken(categories, cell.categoryId);
            return (
              <div
                key={cell.id}
                data-node={cell.id}
                role="button"
                tabIndex={0}
                aria-label={cell.label}
                data-testid={`arch-node-${cell.id}`}
                className={cardClass(cell)}
                style={{
                  width: `${cell.width}px`,
                  opacity: nodeOpacity(cell.id),
                  ["--arch-accent" as string]: `var(${token})`,
                }}
                onClick={() => onNodeClick(cell)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onNodeClick(cell);
                  }
                }}
                onMouseEnter={() => onNodeEnter(cell.id)}
                onMouseLeave={onNodeLeave}
              >
                <div className="arch-card-kicker">{cell.kicker}</div>
                <div className="arch-card-title">{cell.label}</div>
                {cell.tagline ? (
                  <div className="arch-card-tagline">{cell.tagline}</div>
                ) : null}
                {cell.desc ? (
                  <div className="arch-card-desc">{cell.desc}</div>
                ) : null}
                {cell.badges?.length ? (
                  <div className="arch-card-badges">
                    {cell.badges.map((b) => (
                      <span
                        key={b.label}
                        className={`arch-badge arch-badge-${b.tone}`}
                      >
                        {b.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
