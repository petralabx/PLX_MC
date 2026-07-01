"use client";

// MC-SOP-Guide screen — a read-only governance-doctrine lens.
// Wired into the MC shell as Screen "governance-sops" (System of record group).
// Index ↔ detail; the repo markdown is the source, MC is the lens (no mutation).

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { SopDetailResult, SopSummaryRow } from "@/lib/governance-sops";

import { DetailView, IndexView } from "./views";

export function GovernanceSopsView() {
  const [rows, setRows] = useState<SopSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"index" | "detail">("index");
  const [detail, setDetail] = useState<SopDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<SopSummaryRow[]>("/governance-sops")
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSelect(row: SopSummaryRow) {
    setView("detail");
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const data = await api<SopDetailResult>(
        "/governance-sops/" + encodeURIComponent(row.meta.slug)
      );
      setDetail(data);
    } catch (err) {
      setDetailError((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleBack() {
    setView("index");
    setDetail(null);
    setDetailError(null);
  }

  return (
    <div className="mc-main" data-testid="gs-screen">
      {view === "index" && (
        <>
          <div className="ph">
            <div>
              <span className="kk">System of record · doctrine</span>
              <h1>SOP guide</h1>
              <p className="sub">
                Operator-facing governance doctrine — compliance gates, PR discipline, audit
                mirrors, repo hygiene. Read-only; the repo markdown is the source of record.
              </p>
            </div>
            <div className="r r-gap-2">
              <span className="gs-pill doctrine">doctrine</span>
              <span className="gs-pill ro">READ-ONLY</span>
            </div>
          </div>

          {loading && (
            <div className="gs-loading" aria-label="Loading SOPs">
              Loading SOPs…
            </div>
          )}
          {error && (
            <div className="gs-err" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && <IndexView rows={rows} onSelect={handleSelect} />}
        </>
      )}

      {view === "detail" && (
        <>
          {detailLoading && (
            <div className="gs-loading" aria-label="Loading SOP">
              Loading SOP…
            </div>
          )}
          {detailError && (
            <>
              <button type="button" className="gs-back" onClick={handleBack}>
                ← Back to index
              </button>
              <div className="gs-err" role="alert">
                {detailError}
              </div>
            </>
          )}
          {!detailLoading && detail && !detailError && (
            <DetailView result={detail} onBack={handleBack} />
          )}
        </>
      )}
    </div>
  );
}
