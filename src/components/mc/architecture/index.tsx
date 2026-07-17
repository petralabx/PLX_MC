"use client";

// Architecture catalog — calm editorial lens over the C4 diagram pack.
// Wired into the MC shell as Screen "architecture" (System of record group).
// SVGs under public/architecture/ are generated consumers of docs/architecture/
// (canonical truth remains AGENTS.md + docs/modules/*).

import type { ScreenProps } from "../route";

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

  function select(id: ArchitectureDiagram) {
    nav("architecture", { diagram: id });
  }

  return (
    <div className="mc-main" data-testid="arch-screen">
      <div className="ph">
        <div>
          <span className="kk">System of record · architecture</span>
          <h1>Architecture</h1>
          <p className="sub">
            A calm catalog of the maintained C4 guide diagrams — context, containers, and
            task lifecycle. Read-only; the repo docs remain the authority.
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
          These SVGs are exported guides linked to repository documentation. If a diagram
          disagrees with <code className="arch-icode">AGENTS.md</code> or a module
          contract under <code className="arch-icode">docs/modules/</code>, the docs win.
          Canonical pack: <code className="arch-icode">docs/architecture/</code>.
        </p>
      </aside>

      <div className="arch-toolbar">
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

      <figure className="arch-figure" data-testid="arch-figure">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG guide asset */}
        <img
          className="arch-svg"
          src={`/architecture/${diagram}.svg`}
          alt={`${meta.title} architecture diagram`}
          data-testid="arch-svg"
        />
        <figcaption className="arch-caption">
          <span>
            Source Mermaid:{" "}
            <code className="arch-icode">docs/architecture/{diagram}.mmd</code>
          </span>
          <span className="arch-caption-sep" aria-hidden>
            ·
          </span>
          <span>
            Served copy:{" "}
            <code className="arch-icode">public/architecture/{diagram}.svg</code>
          </span>
        </figcaption>
      </figure>

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
        </p>
      </footer>
    </div>
  );
}
