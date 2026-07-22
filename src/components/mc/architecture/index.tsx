"use client";

// Architecture screen — interactive C4 canvas with static SVG degraded fallback.
// Wired into the MC shell as Screen "architecture" (System of record group).

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { ArchitectureModel } from "@/lib/architecture";

import type { ScreenProps } from "../route";
import { ArchitectureCanvas } from "./canvas";
import { ProvenancePanel } from "./provenance-panel";
import { StaticFallback } from "./static-fallback";

import "./architecture.css";

export type ArchitectureDiagram = "context" | "containers" | "task-lifecycle";

const DIAGRAMS: {
  id: ArchitectureDiagram;
  label: string;
  title: string;
  blurb: string;
}[] = [
  {
    id: "context",
    label: "Context",
    title: "System context",
    blurb: "People, systems, and trust boundaries around Mission Control.",
  },
  {
    id: "containers",
    label: "Containers",
    title: "Containers & ownership",
    blurb: "Major runtime pieces and who owns each responsibility.",
  },
  {
    id: "task-lifecycle",
    label: "Task lifecycle",
    title: "Task interaction map",
    blurb: "How work moves through tasks — not a runtime sequence diagram.",
  },
];

function isDiagram(value: string | undefined): value is ArchitectureDiagram {
  return value === "context" || value === "containers" || value === "task-lifecycle";
}

export function ArchitectureView({ route, nav }: ScreenProps) {
  const diagram: ArchitectureDiagram = isDiagram(route.diagram) ? route.diagram : "context";
  const meta = DIAGRAMS.find((d) => d.id === diagram) ?? DIAGRAMS[0];

  const [model, setModel] = useState<ArchitectureModel | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const kick = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setModelError(null);
      api<ArchitectureModel>("/architecture/model")
        .then((payload) => {
          if (cancelled) return;
          setModel(payload);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setModelError(err.message);
          setModel(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(kick);
    };
  }, []);

  function select(id: ArchitectureDiagram) {
    const base = `${window.location.pathname}?screen=architecture&diagram=${id}`;
    try {
      history.replaceState(null, "", base);
    } catch {
      /* ignore */
    }
    nav("architecture", { diagram: id });
  }

  const useFallback = !loading && (!model || modelError);

  return (
    <div className="mc-main" data-testid="arch-screen">
      <div className="ph">
        <div>
          <span className="kk">System of record · architecture</span>
          <h1>Architecture</h1>
          <p className="sub">
            Interactive C4 projection of the maintained architecture pack — context,
            containers, and task lifecycle. Read-only; the repo docs remain the
            authority.
          </p>
        </div>
        <div className="r r-gap-2">
          <span className="arch-pill guide">guide</span>
          <span className="arch-pill ro">READ-ONLY</span>
        </div>
      </div>

      <aside className="arch-disclosure" role="note" data-testid="arch-disclosure">
        <p className="arch-disclosure-lead">
          Generated consumer — <strong>not canonical</strong>.
        </p>
        <p className="arch-disclosure-body">
          This renderer projects{" "}
          <code className="arch-icode">docs/architecture/source-map.json</code>. If
          a diagram disagrees with <code className="arch-icode">AGENTS.md</code> or a
          module contract under <code className="arch-icode">docs/modules/</code>, the
          docs win. Canonical pack:{" "}
          <code className="arch-icode">docs/architecture/</code>.
        </p>
      </aside>

      {modelError ? (
        <div
          className="arch-error-banner"
          role="alert"
          data-testid="arch-error-banner"
        >
          <strong>Model unavailable</strong> — {modelError}. Showing static SVG
          fallback.
        </div>
      ) : null}

      <div className="arch-toolbar" data-no-print>
        <div className="arch-switcher" role="tablist" aria-label="Architecture diagram">
          {DIAGRAMS.map((d) => {
            const on = d.id === diagram;
            return (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`arch-tab${on ? " on" : ""}`}
                data-testid={`arch-tab-${d.id}`}
                onClick={() => select(d.id)}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <p className="arch-view-meta">
          <span className="arch-view-title">{meta.title}</span>
          <span className="arch-view-blurb">{meta.blurb}</span>
        </p>
      </div>

      <hr className="arch-rule" />

      {loading ? (
        <p className="arch-loading" data-testid="arch-loading">
          Loading architecture model…
        </p>
      ) : useFallback ? (
        <StaticFallback diagram={diagram} title={meta.title} />
      ) : model ? (
        <ArchitectureCanvas
          key={diagram}
          model={model}
          viewId={diagram}
          diagramLabel={meta.label}
        />
      ) : null}

      <ProvenancePanel view={diagram} />

      <footer className="arch-footer">
        <p>
          Authority paths: <code className="arch-icode">AGENTS.md</code>
          <span className="arch-caption-sep" aria-hidden>
            ·
          </span>
          <code className="arch-icode">docs/modules/architecture/README.md</code>
          <span className="arch-caption-sep" aria-hidden>
            ·
          </span>
          <code className="arch-icode">docs/architecture/README.md</code>
          <span className="arch-caption-sep" aria-hidden>
            ·
          </span>
          Hub seed: <code className="arch-icode">docs/architecture/knowledge-entry.json</code>
        </p>
      </footer>
    </div>
  );
}
