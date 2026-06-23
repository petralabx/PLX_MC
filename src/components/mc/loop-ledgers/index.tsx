"use client";

// Loop Ledgers screen — read-only cross-repo hardening-ledger observatory.
// Wired into the MC shell as Screen "loop-ledgers".
// Three sub-views: Cross-repo index | Module detail | Degraded gallery.
// NO mutation controls anywhere — this is a read-only observatory.

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { LoaderDetailResult, LoaderSummaryRow } from "@/lib/loop-ledgers";

import { LLStats, deriveIndexStats, encodeRef } from "./helpers";
import { DegradedGallery, DetailView, IndexView } from "./views";

// ─── Tab type ─────────────────────────────────────────────────────────────────

type LLTab = "index" | "detail" | "gallery";

// ─── Main screen component ────────────────────────────────────────────────────

// This screen manages its own tab/selection state and consumes neither `route`
// nor `nav`; the registry types it as ComponentType<ScreenProps>, which accepts
// a zero-arg component.
export function LoopLedgersView() {
  const [rows, setRows] = useState<LoaderSummaryRow[]>([]);
  const [stats, setStats] = useState<LLStats>({
    repos: 0,
    ledgers: 0,
    degraded: 0,
    stale: 0,
    critical: 0,
    redSafety: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LLTab>("index");
  const [detailResult, setDetailResult] = useState<LoaderDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch the index on mount. `loading` initialises to true so the loading
  // state is present before the effect runs, avoiding a flash of empty content.
  useEffect(() => {
    let cancelled = false;
    api<LoaderSummaryRow[]>("/loop-ledgers")
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setStats(deriveIndexStats(data));
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Navigate to the detail view for a row
  async function handleSelectRow(row: LoaderSummaryRow) {
    if (row.kind === "degraded-source") {
      // DegradedSourceRow has no ledger ref — synthesize a detail result from what we know
      const synthetic: LoaderDetailResult = {
        ok: false,
        ref: { repo: row.repo, branch: "—", path: "—" },
        repo: row.repo,
        repoDisplayName: row.repoDisplayName,
        reason: row.reason,
        note: row.note,
      };
      setDetailResult(synthetic);
      setDetailError(null);
      setActiveTab("detail");
      return;
    }

    // LedgerRow — fetch full detail via API
    setDetailLoading(true);
    setDetailError(null);
    setActiveTab("detail");
    try {
      const result = await api<LoaderDetailResult>(
        "/loop-ledgers/" + encodeRef(row.ref)
      );
      setDetailResult(result);
    } catch (err) {
      setDetailError((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleBack() {
    setActiveTab("index");
    setDetailResult(null);
    setDetailError(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mc-main" data-testid="ll-screen">
      {/* Page header */}
      <div className="ph">
        <div>
          <span className="kk">System of record · READ-ONLY</span>
          <h1>Loop ledgers</h1>
          <p className="sub">
            Cross-repo hardening-ledger observatory. Scariest-first. Every missing,
            stale, or invalid source is visible and loud.
          </p>
        </div>
        <div className="r" style={{ gap: "var(--p-space-2)", alignItems: "center" }}>
          <span className="ll-pill source">source</span>
          <span className="ll-pill ro">READ-ONLY</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="ll-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "index"}
          className={`ll-tab${activeTab === "index" ? " active" : ""}`}
          onClick={() => setActiveTab("index")}
        >
          Cross-repo index
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "detail"}
          className={`ll-tab${activeTab === "detail" ? " active" : ""}`}
          onClick={() => {
            if (detailResult) setActiveTab("detail");
          }}
          disabled={!detailResult}
          title={!detailResult ? "Click a row in the index to open detail" : undefined}
        >
          Module detail
          {detailResult && (
            <span style={{ marginLeft: 4, color: "var(--p-muted)", fontSize: "var(--p-text-small)" }}>
              · {detailResult.repoDisplayName}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "gallery"}
          className={`ll-tab${activeTab === "gallery" ? " active" : ""}`}
          onClick={() => setActiveTab("gallery")}
        >
          Degraded gallery
        </button>
      </div>

      {/* Loading / error state */}
      {loading && activeTab === "index" && (
        <div className="ll-loading" aria-label="Loading ledgers">
          Loading ledgers…
        </div>
      )}
      {error && activeTab === "index" && (
        <div className="ll-err" role="alert">
          {error}
        </div>
      )}

      {/* Index view */}
      {!loading && !error && activeTab === "index" && (
        <IndexView
          rows={rows}
          stats={stats}
          onSelectRow={handleSelectRow}
        />
      )}

      {/* Detail view */}
      {activeTab === "detail" && (
        <>
          {detailLoading && (
            <div className="ll-loading" aria-label="Loading ledger detail">
              Loading detail…
            </div>
          )}
          {detailError && (
            <div className="ll-err" role="alert">
              {detailError}
            </div>
          )}
          {!detailLoading && detailResult && !detailError && (
            <DetailView result={detailResult} onBack={handleBack} />
          )}
          {!detailLoading && !detailResult && !detailError && (
            <div className="ll-empty">
              Click a row in the cross-repo index to open its detail view.
            </div>
          )}
        </>
      )}

      {/* Degraded gallery */}
      {activeTab === "gallery" && <DegradedGallery rows={rows} />}
    </div>
  );
}
