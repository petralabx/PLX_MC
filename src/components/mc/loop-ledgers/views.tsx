"use client";

// Three sub-views for the Loop Ledgers screen.
// Presentational: receive data as props, no direct fetching.
// IndexView — the cross-repo table with filters and stat cards.
// DetailView — the module detail with loud health panel + artifact list.
// DegradedGallery — one card per failure mode, kept loud.

import { useCallback, useEffect, useRef, useState } from "react";

import type { LoaderDetailResult, LoaderSummaryRow } from "@/lib/loop-ledgers";

import {
  LLFilterOptions,
  LLFilterState,
  LLStats,
  applyFilters,
  AttentionCounts,
  buildGalleryObservedSet,
  deriveAttentionCounts,
  deriveFilterOptions,
  freshnessLabel,
  freshnessTone,
  healthLabel,
  healthTone,
  rowFreshness,
  rowHealthCode,
} from "./helpers";

// ─── Shared tiny components ───────────────────────────────────────────────────

function HPill({ code }: { code: string }) {
  const tone = healthTone(code);
  return <span className={`ll-hpill ${tone}`}>{healthLabel(code)}</span>;
}

function FPill({ level }: { level: string }) {
  const tone = freshnessTone(level);
  return <span className={`ll-hpill ${tone}`}>{freshnessLabel(level)}</span>;
}

// ─── Filter popover ───────────────────────────────────────────────────────────

function FilterPopover({
  label,
  options,
  selected,
  onToggle,
  onClose,
}: {
  label: string;
  options: string[];
  optionLabel?: (v: string) => string;
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div className="ll-fpop" ref={ref}>
      <div className="ll-fpop-hd">{label}</div>
      {options.length === 0 ? (
        <div className="ll-fopt" style={{ color: "var(--p-muted)", cursor: "default" }}>
          No options
        </div>
      ) : (
        options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`ll-fopt${selected.has(opt) ? " on" : ""}`}
            onClick={() => onToggle(opt)}
          >
            <span className="ll-fopt-ck" aria-hidden>
              {selected.has(opt) ? "✓" : ""}
            </span>
            {healthLabel(opt) !== opt ? healthLabel(opt) : opt}
          </button>
        ))
      )}
    </div>
  );
}

// ─── Index view ───────────────────────────────────────────────────────────────

interface StatCardProps {
  n: number;
  label: string;
  tone?: "hot" | "warn" | "ok" | "";
}

function StatCard({ n, label, tone = "" }: StatCardProps) {
  return (
    <div className="ll-stat">
      <span className={`ll-stat-n${tone ? ` ${tone}` : ""}`}>{n}</span>
      <span className="ll-stat-label">{label}</span>
    </div>
  );
}

type FilterFacet = "repo" | "health" | "freshness" | "severity" | "safety";

export function IndexView({
  rows,
  stats,
  onSelectRow,
}: {
  rows: LoaderSummaryRow[];
  stats: LLStats;
  onSelectRow: (row: LoaderSummaryRow) => void;
}) {
  const [filter, setFilter] = useState<LLFilterState>({});
  const [openFacet, setOpenFacet] = useState<FilterFacet | null>(null);

  const filteredRows = applyFilters(rows, filter);
  const options: LLFilterOptions = deriveFilterOptions(rows);
  const attention: AttentionCounts = deriveAttentionCounts(rows);
  const needsAttention = attention.invalid + attention.unreachable + attention.stale;

  const toggleFacet = useCallback(
    (facet: FilterFacet) => setOpenFacet((prev) => (prev === facet ? null : facet)),
    []
  );
  const closePopover = useCallback(() => setOpenFacet(null), []);

  function toggleValue(key: keyof LLFilterState, value: string) {
    const current = (filter[key] as string[] | undefined) ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setFilter({ ...filter, [key]: next.length ? next : undefined });
  }

  function clearAll() {
    setFilter({});
  }

  const hasActiveFilters =
    !!(filter.text?.trim()) ||
    !!(filter.repo?.length) ||
    !!(filter.health?.length) ||
    !!(filter.freshness?.length) ||
    !!(filter.severity?.length) ||
    !!(filter.safety?.length);

  const facetConfig: Array<{
    key: FilterFacet;
    label: string;
    opts: string[];
  }> = [
    { key: "repo", label: "Repo", opts: options.repos },
    { key: "health", label: "Health", opts: options.health },
    { key: "freshness", label: "Freshness", opts: options.freshness },
    { key: "severity", label: "Severity", opts: options.severity },
    { key: "safety", label: "Safety", opts: options.safety },
  ];

  return (
    <div>
      {/* Attention banner */}
      {needsAttention > 0 && (
        <div className="ll-banner" role="status">
          <span className="dot" aria-hidden />
          <span className="ll-banner-body">
            {attention.invalid > 0 && (
              <>
                <span className="ll-banner-ct">{attention.invalid} invalid</span>
                {(attention.unreachable > 0 || attention.stale > 0) && " · "}
              </>
            )}
            {attention.unreachable > 0 && (
              <>
                <span className="ll-banner-ct">{attention.unreachable} unreachable</span>
                {attention.stale > 0 && " · "}
              </>
            )}
            {attention.stale > 0 && (
              <span className="ll-banner-ct">{attention.stale} stale</span>
            )}
            {" "}need attention
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="ll-stats">
        <StatCard n={stats.repos} label="Repos" />
        <StatCard n={stats.ledgers} label="Ledgers" />
        <StatCard n={stats.degraded} label="Degraded" tone={stats.degraded > 0 ? "hot" : ""} />
        <StatCard n={stats.stale} label="Stale" tone={stats.stale > 0 ? "warn" : ""} />
        <StatCard n={stats.critical} label="Critical" tone={stats.critical > 0 ? "hot" : ""} />
        <StatCard n={stats.redSafety} label="Red safety" tone={stats.redSafety > 0 ? "hot" : ""} />
      </div>

      {/* Toolbar: search + filters */}
      <div className="ll-toolbar">
        <div className="ll-search">
          <span className="ll-search-mag" aria-hidden>⌕</span>
          <input
            className="ll-search-input"
            value={filter.text ?? ""}
            placeholder="Search ledgers…"
            aria-label="Search ledgers"
            onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })}
          />
        </div>

        <div className="ll-filter-pills">
          {facetConfig.map(({ key, label, opts }) => {
            const sel = new Set<string>((filter[key] as string[] | undefined) ?? []);
            const isActive = sel.size > 0;
            return (
              <div key={key} className="ll-fpill">
                <button
                  type="button"
                  className={`ll-fpill-btn${isActive ? " active" : ""}${openFacet === key ? " on" : ""}`}
                  onClick={() => toggleFacet(key)}
                >
                  + {label}
                  {isActive ? ` (${sel.size})` : ""}
                </button>
                {openFacet === key && (
                  <FilterPopover
                    label={label}
                    options={opts}
                    selected={sel}
                    onToggle={(v) => toggleValue(key, v)}
                    onClose={closePopover}
                  />
                )}
              </div>
            );
          })}
          {hasActiveFilters && (
            <button type="button" className="ll-fpill-btn" onClick={clearAll}>
              Clear filters
            </button>
          )}
        </div>

        <span className="ll-sort-hint">sort ↓ scariest-first</span>
      </div>

      {/* Hairline table */}
      {filteredRows.length === 0 ? (
        <div className="ll-empty">No ledgers match the current filters.</div>
      ) : (
        <div className="ll-table" data-testid="ll-index-table">
          <div className="ll-table-head" aria-hidden>
            <span>Source / module</span>
            <span>Health</span>
            <span>Freshness</span>
            <span>Artifacts</span>
            <span>Safety</span>
            <span>Next action</span>
          </div>
          {filteredRows.map((row, i) => {
            const hc = rowHealthCode(row);
            const isDegraded = row.kind === "degraded-source" || !row.validationResult?.valid;
            const dotCls =
              hc === "valid"
                ? "valid"
                : hc === "partial" || hc === "no_ledgers"
                ? "warn"
                : "degraded";
            const artCount =
              row.kind === "ledger"
                ? (row.validationResult.ledger?.summary.total_artifacts ?? "—")
                : "—";
            const redCount =
              row.kind === "ledger"
                ? (row.validationResult.ledger?.summary.by_safety_class?.red ?? 0)
                : 0;
            const freshLevel = rowFreshness(row);
            const nextAction =
              row.kind === "ledger"
                ? (row.validationResult.ledger?.artifacts
                    .find((a) => a.next_action)
                    ?.next_action ?? "—")
                : row.note;
            const ledgerModule =
              row.kind === "ledger"
                ? (row.validationResult.ledger?.module ?? row.ref.path.split("/").pop() ?? "")
                : "";

            return (
              <button
                key={i}
                type="button"
                className={`ll-row${isDegraded ? " degraded" : " valid"}`}
                onClick={() => onSelectRow(row)}
                data-testid="ll-row"
                data-repo={row.repo}
                data-health={hc}
                data-fresh={freshLevel}
              >
                <span className="ll-row-nm">
                  <span className={`ll-row-dot ${dotCls}`} aria-hidden />
                  <span>
                    <span className="ll-row-title">{row.repoDisplayName}</span>
                    {ledgerModule && (
                      <span className="ll-row-sub"> / {ledgerModule}</span>
                    )}
                  </span>
                </span>
                <span className="ll-cell">
                  <HPill code={hc} />
                </span>
                <span className="ll-cell">
                  <FPill level={freshLevel} />
                </span>
                <span className="ll-cell ll-mono">{artCount}</span>
                <span className="ll-cell ll-mono">
                  {redCount > 0 ? (
                    <span style={{ color: "var(--p-hot)", fontWeight: 700 }}>
                      {redCount} red
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
                <span
                  className="ll-cell ll-mono"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                >
                  {nextAction}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

export function DetailView({
  result,
  onBack,
}: {
  result: LoaderDetailResult;
  onBack: () => void;
}) {
  const hc = result.ok ? result.validationResult.healthCode : result.reason;
  const tone =
    !result.ok
      ? "hot"
      : hc === "valid"
      ? "valid"
      : hc === "partial" || hc === "no_ledgers"
      ? "warn"
      : "hot";

  const ghUrl =
    result.ok && result.ref
      ? `https://github.com/${result.repo}/blob/${result.ref.branch}/${result.ref.path}`
      : `https://github.com/${result.repo}`;

  const freshnessLvl = result.ok
    ? result.validationResult.freshnessInfo.level
    : "unknown";
  const freshnessAge = result.ok
    ? result.validationResult.freshnessInfo.ageDays
    : null;

  const errors = result.ok ? result.validationResult.errors : [];
  const ledger = result.ok ? result.validationResult.ledger : null;
  const artifacts = ledger?.artifacts ?? [];

  return (
    <div data-testid="ll-detail-view">
      <button type="button" className="ll-back" onClick={onBack}>
        ← Back to index
      </button>

      {/* Page header */}
      <div className="ph">
        <div>
          <span className="kk">Loop ledger · {result.repoDisplayName}</span>
          <h1 style={{ fontSize: "var(--p-text-h2)", margin: "4px 0 8px" }}>
            {ledger?.module ?? result.repo}
          </h1>
        </div>
        <div className="r">
          <a
            href={ghUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ll-gh-link"
          >
            ↗ View on GitHub
          </a>
        </div>
      </div>

      {/* Meta row */}
      <div className="ll-detail-meta">
        {result.ok && result.ref && (
          <>
            <span className="ll-meta-chip">
              Branch: <strong>{result.ref.branch}</strong>
            </span>
            <span className="ll-meta-chip">
              Path: <strong style={{ fontFamily: "var(--mono)", fontSize: "var(--p-text-meta)" }}>{result.ref.path}</strong>
            </span>
          </>
        )}
        {result.ok && result.commitSha && (
          <span className="ll-meta-chip">
            Commit: <strong style={{ fontFamily: "var(--mono)", fontSize: "var(--p-text-meta)" }}>{result.commitSha.slice(0, 7)}</strong>
          </span>
        )}
        {ledger?.generated_at && (
          <span className="ll-meta-chip">
            Generated: <strong>{ledger.generated_at}</strong>
          </span>
        )}
        <span className="ll-meta-chip">
          Freshness:{" "}
          <strong>
            <FPill level={freshnessLvl} />
          </strong>
          {freshnessAge !== null && (
            <span style={{ color: "var(--p-muted)", marginLeft: 4 }}>
              ({freshnessAge}d)
            </span>
          )}
        </span>
        {ledger?.schema_version && (
          <span className="ll-meta-chip">
            Schema: <strong style={{ fontFamily: "var(--mono)", fontSize: "var(--p-text-meta)" }}>{ledger.schema_version}</strong>
          </span>
        )}
      </div>

      {/* Loud health panel */}
      <div className={`ll-health-panel ${tone}`} data-testid="ll-health-panel">
        <div className="ll-health-panel-hd">
          <span className={`ll-row-dot ${tone === "valid" ? "valid" : tone === "warn" ? "warn" : "degraded"}`} aria-hidden />
          <span className={`ll-health-panel-code ${tone}`}>{healthLabel(hc)}</span>
          {result.ok && ledger && (
            <span style={{ fontFamily: "var(--mono)", fontSize: "var(--p-text-small)", color: "var(--p-muted)" }}>
              · {ledger.summary.total_artifacts} artifacts
            </span>
          )}
        </div>

        {!result.ok && (
          <p style={{ fontFamily: "var(--mono)", fontSize: "var(--p-text-small)", color: "var(--p-hot)", marginTop: "var(--p-space-2)" }}>
            {result.note}
          </p>
        )}

        {errors.length > 0 && (
          <div className="ll-health-panel-errors">
            {errors.map((err, i) => (
              <span key={i} className="ll-health-panel-err">
                [{err.code}] {err.message}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Artifact list — keyboard-focusable so the horizontal scroll (narrow
          viewports) is reachable without a pointer; its rows are non-interactive
          (unlike the index table whose rows are buttons), so the container itself
          carries keyboard access (axe scrollable-region-focusable). */}
      {artifacts.length > 0 && (
        <div
          className="ll-artifacts"
          data-testid="ll-artifacts"
          tabIndex={0}
          role="group"
          aria-label="Ledger artifacts (scrolls horizontally on narrow screens)"
        >
          <div className="ll-artifacts-head" aria-hidden>
            <span>#</span>
            <span>Title</span>
            <span>Status</span>
            <span>Severity</span>
            <span>Safety</span>
            <span>Next action</span>
          </div>
          {artifacts.map((a, i) => (
            <div key={a.artifact_id} className="ll-artifact-row">
              <span className="ll-artifact-id">{i + 1}</span>
              <span className="ll-artifact-title">{a.title}</span>
              <span className="ll-mono" style={{ fontSize: "var(--p-text-small)", color: "var(--p-muted)" }}>{a.status}</span>
              <span className="ll-mono" style={{ fontSize: "var(--p-text-small)", color: a.severity === "critical" ? "var(--p-hot)" : "var(--p-ink-2)" }}>
                {a.severity}
              </span>
              <span className="ll-mono" style={{ fontSize: "var(--p-text-small)", color: a.safety_class === "red" ? "var(--p-hot)" : "var(--p-ink-2)" }}>
                {a.safety_class}
              </span>
              <span className="ll-mono" style={{ fontSize: "var(--p-text-small)", color: "var(--p-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.next_action ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Degraded gallery ─────────────────────────────────────────────────────────

interface GalleryCard {
  code: string;
  title: string;
  description: string;
  example?: string;
}

const GALLERY_CARDS: GalleryCard[] = [
  {
    code: "permission_denied",
    title: "Permission denied",
    description:
      "HTTP 403 — the GitHub App installation (or PAT fallback) lacks read access to this repo. Most common when the wrong org installation is selected or the App is not installed on the private repo.",
    example: "petralabx/plx-customer-portal → 403 Forbidden",
  },
  {
    code: "token_missing",
    title: "Token missing",
    description:
      "No GitHub auth configured (GitHub App credentials or GITHUB_TOKEN). All GitHub API reads produce this degraded result instead of crashing. Configure the App (preferred) or a PAT and restart.",
    example: "All repos → degraded (GitHub auth absent)",
  },
  {
    code: "not_found",
    title: "Not found",
    description:
      "HTTP 404 — the repo, branch, or ledger path does not exist, or the selected App installation cannot see a private repo. Check the registry repo slug/default_branch and owner-aware installation routing.",
    example: "petralabx/wrong-repo → 404 Not Found",
  },
  {
    code: "rate_limit",
    title: "Rate limited",
    description:
      "HTTP 429 or HTTP 403 with x-ratelimit-remaining=0. GitHub API rate limit hit. The batch continues; this repo is marked degraded. Retry after the reset window.",
    example: "Burst fetch → 429 Too Many Requests",
  },
  {
    code: "network_error",
    title: "Network error",
    description:
      "fetch() threw — DNS failure, TCP timeout, or host unreachable. Check network connectivity and proxy settings.",
    example: "fetch('https://api.github.com/…') threw ECONNREFUSED",
  },
  {
    code: "no_ledgers",
    title: "No ledgers",
    description:
      "Repo is reachable and authorized, but the configured glob matched zero files. The repo has not committed any vmc-quality-ledger/v1 artifacts yet.",
    example: "glob 'docs/portal/quality-ledger/*.artifacts.json' → 0 matches",
  },
  {
    code: "truncated",
    title: "Tree truncated",
    description:
      "The Git Trees API returned truncated=true (repo too large), so the ledger glob could not be matched against the complete tree. Surfaced loudly instead of trusting a partial listing that could silently drop ledgers.",
    example: "git/trees/main?recursive=1 → truncated: true",
  },
  {
    code: "invalid_json",
    title: "Invalid JSON",
    description:
      "The file was fetched but JSON.parse failed. The ledger file is corrupted or not valid JSON. Fix the file content.",
    example: "loop-ledgers.artifacts.json → SyntaxError: Unexpected token",
  },
  {
    code: "schema_mismatch",
    title: "Schema mismatch",
    description:
      "File is parseable JSON but schema_version is not 'vmc-quality-ledger/v1'. The file was written by a different schema version. Update it or commit a v1-compatible ledger.",
    example: "schema_version: 'risk-engine/v2' ≠ vmc-quality-ledger/v1",
  },
  {
    code: "count_mismatch",
    title: "Count mismatch",
    description:
      "The ledger's summary.total_artifacts or per-bucket counts don't match the actual artifact array. The ledger was modified incorrectly. Regenerate it.",
    example: "summary.total_artifacts=5 but artifacts.length=4",
  },
  {
    code: "enum_violation",
    title: "Enum violation",
    description:
      "An artifact has an invalid status, severity, safety_class, or artifact_type value. Correct the artifact and regenerate the ledger.",
    example: "severity: 'extreme' is not in [critical, high, medium, low]",
  },
  {
    code: "verified_no_evidence",
    title: "Verified without evidence",
    description:
      "An artifact has status='verified' but no evidence paths. Every verified artifact must link to a .txt evidence file. Add evidence or revert the status.",
    example: "artifact_id: 'T-007' — status=verified but evidence=[]",
  },
];

export function DegradedGallery({ rows }: { rows: LoaderSummaryRow[] }) {
  // Which codes are actually observed in the current data (for emphasis).
  // Folds error.code entries from validator errors (which collapse to healthCode="partial")
  // so individual codes like count_mismatch/enum_violation highlight correctly.
  const observed = buildGalleryObservedSet(rows);

  return (
    <div data-testid="ll-gallery">
      <p className="ll-gallery-hd">
        Every degraded state, kept loud — one card per failure mode. Codes currently
        observed in this workspace are highlighted.
      </p>
      <div className="ll-gallery">
        {GALLERY_CARDS.map((card) => {
          const live = observed.has(card.code);
          return (
            <div
              key={card.code}
              className={`ll-gcard${live ? " live" : ""}`}
              data-testid="ll-gallery-card"
              data-code={card.code}
            >
              <div className="ll-gcard-code">
                <span className="dot" aria-hidden />
                {card.code}
                {live && (
                  <span
                    style={{
                      fontFamily: "var(--sans)",
                      fontSize: "var(--p-text-meta)",
                      textTransform: "none",
                      letterSpacing: 0,
                      fontWeight: 400,
                      color: "var(--p-hot)",
                      marginLeft: "auto",
                    }}
                  >
                    ● live
                  </span>
                )}
              </div>
              <div className="ll-gcard-title">{card.title}</div>
              <div className="ll-gcard-desc">{card.description}</div>
              {card.example && (
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: "var(--p-text-meta)",
                    color: "var(--p-muted)",
                    marginTop: "var(--p-space-2)",
                    padding: "3px 6px",
                    background: "color-mix(in srgb, var(--p-ink) 4%, transparent)",
                    borderRadius: "var(--p-radius-sm)",
                  }}
                >
                  {card.example}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
