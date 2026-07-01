"use client";

// MC Skills Directory — browse company-tier Cursor/Claude skills from
// plx-cursor-skills. Wired as Screen "skills-directory" (System of record).

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { CatalogListResult, SkillDetailResult, SkillSummaryRow } from "@/lib/skills-directory";

import { DetailView, IndexView } from "./views";

export function SkillsDirectoryView() {
  const [catalog, setCatalog] = useState<CatalogListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"index" | "detail">("index");
  const [detail, setDetail] = useState<SkillDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<CatalogListResult>("/skills-directory")
      .then((data) => {
        if (cancelled) return;
        setCatalog(data);
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

  async function handleSelect(row: SkillSummaryRow) {
    setView("detail");
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const data = await api<SkillDetailResult>(
        "/skills-directory/" + encodeURIComponent(row.id)
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
    <div className="mc-main" data-testid="sk-screen">
      {view === "index" && (
        <>
          <div className="ph">
            <div>
              <span className="kk">System of record · tooling</span>
              <h1>Skills directory</h1>
              <p className="sub">
                Company-approved Cursor and Claude skills from{" "}
                <code className="gs-icode">plx-cursor-skills</code>. Browse here; install
                with <code className="gs-icode">scripts/bootstrap-company-skills.ps1</code>.
              </p>
            </div>
            <div className="r r-gap-2">
              <span className="sk-pill catalog">company</span>
              <span className="gs-pill ro">READ-ONLY</span>
            </div>
          </div>

          {loading && (
            <div className="gs-loading" aria-label="Loading skills catalog">
              Loading skills…
            </div>
          )}
          {error && (
            <div className="gs-err" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && catalog && (
            <IndexView catalog={catalog} onSelect={handleSelect} />
          )}
        </>
      )}

      {view === "detail" && (
        <>
          {detailLoading && (
            <div className="gs-loading" aria-label="Loading skill">
              Loading skill…
            </div>
          )}
          {detailError && (
            <>
              <button type="button" className="gs-back" onClick={handleBack}>
                ← Back to catalog
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
