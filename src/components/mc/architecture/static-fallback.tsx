"use client";

import type { ArchitectureDiagram } from "./index";

type Props = {
  diagram: ArchitectureDiagram;
  title: string;
};

export function StaticFallback({ diagram, title }: Props) {
  return (
    <figure className="arch-figure" data-testid="arch-figure">
      {/* eslint-disable-next-line @next/next/no-img-element -- degraded static SVG */}
      <img
        className="arch-svg"
        src={`/architecture/${diagram}.svg`}
        alt={`${title} architecture diagram`}
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
  );
}
