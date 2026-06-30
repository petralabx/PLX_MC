"use client";

// Presentational views for MC-SOP-Guide.
// IndexView   — scannable, filterable SOP catalog (hairline table chassis).
// DetailView  — folio metadata strip + PLX-styled markdown reader + sticky TOC.
// MarkdownReader — renders the MdNode token tree to React (text is auto-escaped
//                  by React; no raw HTML is ever injected).

import { createElement, useState } from "react";

import type {
  MdInline,
  MdNode,
  SopDetailResult,
  SopStatus,
  SopSummaryRow,
} from "@/lib/governance-sops";

import {
  GSFilterState,
  applyFilters,
  degradedReasonLabel,
  deriveCategories,
  deriveStats,
  deriveStatuses,
  hasActiveFilters,
  statusLabel,
  statusTone,
  stateTone,
} from "./helpers";

// ─── Markdown rendering ───────────────────────────────────────────────────────

function Inline({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <span key={i}>{n.value}</span>;
          case "strong":
            return (
              <strong key={i}>
                <Inline nodes={n.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inline nodes={n.children} />
              </em>
            );
          case "code":
            return (
              <code key={i} className="gs-icode">
                {n.value}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                className="gs-link"
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Inline nodes={n.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ node }: { node: MdNode }) {
  switch (node.type) {
    case "heading":
      return createElement(
        `h${node.level}`,
        { id: node.id, className: `gs-h gs-h${node.level}` },
        <Inline nodes={node.text} />
      );
    case "paragraph":
      return (
        <p className="gs-p">
          <Inline nodes={node.text} />
        </p>
      );
    case "hr":
      return <hr className="gs-hr" />;
    case "code":
      // Focusable + labelled so the horizontal scroll on long code lines is
      // reachable by keyboard (axe scrollable-region-focusable).
      return (
        <pre
          className="gs-pre"
          data-lang={node.lang ?? undefined}
          tabIndex={0}
          role="group"
          aria-label={node.lang ? `Code block (${node.lang})` : "Code block"}
        >
          <code>{node.value}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote className="gs-callout">
          {node.children.map((c, i) => (
            <Block key={i} node={c} />
          ))}
        </blockquote>
      );
    case "list": {
      const items = node.items.map((it, i) => (
        <li key={i} className={`gs-li${it.checked !== null ? " gs-task" : ""}`}>
          {it.checked !== null && (
            <span className={`gs-check${it.checked ? " on" : ""}`} aria-hidden>
              {it.checked ? "✓" : ""}
            </span>
          )}
          <span className="gs-li-body">
            <Inline nodes={it.lead} />
            {it.children.map((c, j) => (
              <Block key={j} node={c} />
            ))}
          </span>
        </li>
      ));
      return node.ordered ? (
        <ol className="gs-ol">{items}</ol>
      ) : (
        <ul className="gs-ul">{items}</ul>
      );
    }
    case "table":
      return (
        <div
          className="gs-table-wrap"
          tabIndex={0}
          role="group"
          aria-label="Table (scrolls horizontally on narrow screens)"
        >
          <table className="gs-table">
            <thead>
              <tr>
                {node.headers.map((h, i) => (
                  <th key={i} style={{ textAlign: node.align[i] ?? undefined }}>
                    <Inline nodes={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} style={{ textAlign: node.align[ci] ?? undefined }}>
                      <Inline nodes={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownReader({ nodes }: { nodes: MdNode[] }) {
  return (
    <div className="gs-reader" data-testid="gs-reader">
      {nodes.map((n, i) => (
        <Block key={i} node={n} />
      ))}
    </div>
  );
}

// ─── Index view ───────────────────────────────────────────────────────────────

function StatCard({ n, label, tone = "" }: { n: number; label: string; tone?: "hot" | "" }) {
  return (
    <div className="gs-stat">
      <span className={`gs-stat-n${tone ? ` ${tone}` : ""}`}>{n}</span>
      <span className="gs-stat-label">{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: SopStatus }) {
  return <span className={`gs-badge ${statusTone(status)}`}>{statusLabel(status)}</span>;
}

export function IndexView({
  rows,
  onSelect,
}: {
  rows: SopSummaryRow[];
  onSelect: (row: SopSummaryRow) => void;
}) {
  const [filter, setFilter] = useState<GSFilterState>({});
  const stats = deriveStats(rows);
  const categories = deriveCategories(rows);
  const statuses = deriveStatuses(rows);
  const filtered = applyFilters(rows, filter);

  function toggleCategory(c: string) {
    const cur = filter.categories ?? [];
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    setFilter({ ...filter, categories: next.length ? next : undefined });
  }
  function toggleStatus(s: SopStatus) {
    const cur = filter.statuses ?? [];
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    setFilter({ ...filter, statuses: next.length ? next : undefined });
  }

  return (
    <div>
      {stats.degraded > 0 && (
        <div className="gs-banner" role="alert">
          <span className="dot" aria-hidden />
          <span className="gs-banner-body">
            <span className="gs-banner-ct">{stats.degraded}</span> SOP
            {stats.degraded === 1 ? "" : "s"} configured but unreadable — fix the source path
            in <code className="gs-icode">config/governance-sops-registry.json</code>.
          </span>
        </div>
      )}

      <div className="gs-stats">
        <StatCard n={stats.total} label="SOPs" />
        <StatCard n={stats.active} label="Active" />
        <StatCard n={stats.planned} label="Coming soon" />
        <StatCard n={stats.degraded} label="Degraded" tone={stats.degraded > 0 ? "hot" : ""} />
      </div>

      <div className="gs-toolbar">
        <div className="gs-search">
          <span className="gs-search-mag" aria-hidden>
            ⌕
          </span>
          <input
            className="gs-search-input"
            value={filter.text ?? ""}
            placeholder="Search SOPs…"
            aria-label="Search SOPs"
            onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })}
          />
        </div>

        <div className="gs-chips" role="group" aria-label="Filter by category">
          {categories.map((c) => {
            const on = filter.categories?.includes(c) ?? false;
            return (
              <button
                key={c}
                type="button"
                className={`gs-chip${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => toggleCategory(c)}
              >
                {c}
              </button>
            );
          })}
        </div>

        <div className="gs-chips" role="group" aria-label="Filter by status">
          {statuses.map((s) => {
            const on = filter.statuses?.includes(s) ?? false;
            return (
              <button
                key={s}
                type="button"
                className={`gs-chip status${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => toggleStatus(s)}
              >
                {statusLabel(s)}
              </button>
            );
          })}
        </div>

        {hasActiveFilters(filter) && (
          <button type="button" className="gs-chip clear" onClick={() => setFilter({})}>
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="gs-empty">
          {rows.length === 0
            ? "No SOPs are configured. Add entries to config/governance-sops-registry.json."
            : "No SOPs match the current filters."}
        </div>
      ) : (
        <div className="gs-table-catalog" data-testid="gs-index-table">
          <div className="gs-cat-head" aria-hidden>
            <span>SOP</span>
            <span>Owner</span>
            <span>Effective</span>
          </div>
          {filtered.map((row) => (
            <button
              key={row.meta.slug}
              type="button"
              className={`gs-row ${stateTone(row.state)}`}
              onClick={() => onSelect(row)}
              data-testid="gs-row"
              data-slug={row.meta.slug}
              data-state={row.state}
            >
              <span className="gs-row-main">
                <span className="gs-row-top">
                  <span className={`gs-dot ${stateTone(row.state)}`} aria-hidden />
                  <span className="gs-row-title">{row.meta.title}</span>
                  <StatusBadge status={row.meta.status} />
                </span>
                <span className="gs-row-desc">
                  {row.state === "degraded" ? row.note ?? row.meta.description : row.meta.description}
                </span>
                {row.meta.tags.length > 0 && (
                  <span className="gs-row-cats">
                    {row.meta.tags.map((t) => (
                      <span key={t} className="gs-cat">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="gs-cell gs-cell-owner gs-mono">{row.meta.owner}</span>
              <span className="gs-cell gs-cell-eff gs-mono">{row.meta.effective_date}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function NoContentPanel({ result }: { result: Extract<SopDetailResult, { ok: false }> }) {
  const planned = result.reason === "planned";
  return (
    <div
      className={`gs-nocontent${planned ? " planned" : " degraded"}`}
      role={planned ? "status" : "alert"}
      data-testid="gs-nocontent"
    >
      <div className="gs-nocontent-hd">
        <span className={`gs-dot ${planned ? "muted" : "hot"}`} aria-hidden />
        <span className="gs-nocontent-code">{degradedReasonLabel(result.reason)}</span>
      </div>
      <p className="gs-nocontent-note">{result.note}</p>
      <p className="gs-nocontent-where">
        Catalog config: <code className="gs-icode">config/governance-sops-registry.json</code>
        {result.meta.source && (
          <>
            {" · "}Source: <code className="gs-icode">{result.meta.source.repo_path}</code>
          </>
        )}
      </p>
    </div>
  );
}

export function DetailView({
  result,
  onBack,
}: {
  result: SopDetailResult;
  onBack: () => void;
}) {
  const { meta } = result;
  const hasToc = result.ok && result.toc.length > 1;

  return (
    <div data-testid="gs-detail-view">
      <button type="button" className="gs-back" onClick={onBack}>
        ← Back to index
      </button>

      <div className="ph">
        <div>
          <span className="kk">
            System of record · doctrine{meta.tags[0] ? ` · ${meta.tags[0]}` : ""}
          </span>
          <h1 className="gs-doc-title">{meta.title}</h1>
          <p className="sub">{meta.description}</p>
        </div>
        <div className="r">
          <StatusBadge status={meta.status} />
        </div>
      </div>

      {/* Folio metadata strip */}
      <div className="gs-folio">
        <span className="gs-folio-chip">
          Owner <strong>{meta.owner}</strong>
        </span>
        <span className="gs-folio-chip">
          Effective <strong>{meta.effective_date}</strong>
        </span>
        {meta.last_reviewed && (
          <span className="gs-folio-chip">
            Reviewed <strong>{meta.last_reviewed}</strong>
          </span>
        )}
        <span className="gs-folio-chip">
          Audience <strong>{meta.audience}</strong>
        </span>
        <span className="gs-folio-chip">
          Slug <strong>{meta.slug}</strong>
        </span>
        {meta.source && (
          <span className="gs-folio-chip">
            Source <strong>{meta.source.repo_path}</strong>
          </span>
        )}
        {result.ok && (
          <span className="gs-folio-chip">
            <strong>{result.bytes.toLocaleString()}</strong> bytes
          </span>
        )}
      </div>

      {!result.ok ? (
        <NoContentPanel result={result} />
      ) : (
        <div className={`gs-detail-grid${hasToc ? "" : " no-toc"}`}>
          {hasToc && (
            <aside className="gs-toc" aria-label="On this page">
              <div className="gs-toc-hd">On this page</div>
              <nav>
                {result.toc.map((t) => (
                  <a key={t.id} href={`#${t.id}`} className={`gs-toc-link lvl${t.level}`}>
                    {t.text}
                  </a>
                ))}
              </nav>
            </aside>
          )}
          <article className="gs-reader-col">
            <MarkdownReader nodes={result.nodes} />
          </article>
        </div>
      )}
    </div>
  );
}
