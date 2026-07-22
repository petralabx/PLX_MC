"use client";

// Sources / provenance panel — bound to docs/architecture/source-map.json
// via GET /api/architecture/provenance. Generated-consumer lens; docs remain authority.

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type {
  ArchitectureProvenance,
  ArchitectureViewId,
} from "@/lib/architecture";

type Props = {
  view: ArchitectureViewId;
};

function lineRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "";
  if (start != null && end != null && start !== end) return `:${start}–${end}`;
  if (start != null) return `:${start}`;
  return end != null ? `:${end}` : "";
}

export function ProvenancePanel({ view }: Props) {
  const [data, setData] = useState<ArchitectureProvenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const kick = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      api<ArchitectureProvenance>(
        `/architecture/provenance?view=${encodeURIComponent(view)}`
      )
        .then((payload) => {
          if (cancelled) return;
          setData(payload);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setError(err.message);
          setData(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(kick);
    };
  }, [view]);

  return (
    <section
      className="arch-provenance"
      aria-labelledby="arch-provenance-title"
      data-testid="arch-provenance"
    >
      <div className="arch-provenance-head">
        <h2 id="arch-provenance-title" className="arch-provenance-title">
          Sources / provenance
        </h2>
        <p className="arch-provenance-lead">
          Path-and-line bindings from{" "}
          <code className="arch-icode">docs/architecture/source-map.json</code>{" "}
          for this view. Generated consumer index — not a second system of
          record.
        </p>
      </div>

      {loading ? (
        <p className="arch-provenance-status" data-testid="arch-provenance-loading">
          Loading provenance…
        </p>
      ) : null}

      {error ? (
        <p
          className="arch-provenance-status arch-provenance-error"
          role="alert"
          data-testid="arch-provenance-error"
        >
          Provenance unavailable (degraded): {error}. Canonical docs remain at{" "}
          <code className="arch-icode">AGENTS.md</code> and{" "}
          <code className="arch-icode">docs/modules/</code>.
        </p>
      ) : null}

      {!loading && !error && data ? (
        <>
          <p className="arch-provenance-meta">
            <span>
              View <code className="arch-icode">{data.view}</code>
            </span>
            <span className="arch-caption-sep" aria-hidden>
              ·
            </span>
            <span>
              {data.node_count} nodes / {data.edge_count} edges
            </span>
            {data.source_commit ? (
              <>
                <span className="arch-caption-sep" aria-hidden>
                  ·
                </span>
                <span>
                  map commit{" "}
                  <code className="arch-icode">
                    {data.source_commit.slice(0, 12)}
                  </code>
                </span>
              </>
            ) : null}
          </p>

          {data.sources.length === 0 ? (
            <p className="arch-provenance-status">
              No source rows for this view (show-missing).
            </p>
          ) : (
            <ul
              className="arch-provenance-list"
              data-testid="arch-provenance-list"
              tabIndex={0}
              aria-label="Provenance source rows"
            >
              {data.sources.map((row) => (
                <li
                  key={`${row.path}:${row.start_line ?? ""}:${row.end_line ?? ""}:${row.authority_class}`}
                  className="arch-provenance-row"
                >
                  <code className="arch-icode">
                    {row.path}
                    {lineRange(row.start_line, row.end_line)}
                  </code>
                  <span className="arch-provenance-class">
                    {row.authority_class}
                  </span>
                  <span className="arch-provenance-count">
                    ×{row.claim_count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
