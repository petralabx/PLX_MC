"use client";

import type { ArchitectureModel } from "@/lib/architecture";

import type { ArchEdge, ArchGroup, ArchNode, ArchView, Selection } from "./layout";

type Props = {
  selection: Selection;
  view: ArchView;
  categories: ArchitectureModel["categories"];
  onClose: () => void;
};

function primaryDocHref(
  claims: Array<{ sources: Array<{ href: string }> }>
): string | null {
  for (const claim of claims) {
    const src = claim.sources[0];
    if (src?.href) return src.href;
  }
  return null;
}

export function DetailPanel({ selection, view, categories, onClose }: Props) {
  if (!selection) return null;

  const catMap = new Map(categories.map((c) => [c.id, c]));
  let kicker = "";
  let title = "";
  let desc = "";
  let note = "";
  let flow = "";
  let docHref: string | null = null;
  let provenance: Array<{ factId: string; claim: string; href: string | null }> =
    [];

  if (selection.kind === "group") {
    const g = view.groups.find((gr) => gr.id === selection.id) as ArchGroup | undefined;
    const sm = g?.summary;
    kicker = sm?.kicker ?? "Boundary";
    title = sm?.title ?? g?.label ?? selection.id;
    desc = sm?.description ?? "";
  } else if (selection.kind === "node") {
    const n = view.nodes.find((node) => node.id === selection.id) as
      | ArchNode
      | undefined;
    if (!n) return null;
    const cat = catMap.get(n.category);
    kicker = n.kicker ?? cat?.label ?? n.category;
    title = n.label;
    desc = n.description;
    note = n.note ?? "";
    docHref = primaryDocHref(n.claims);
    provenance = n.claims.map((c) => ({
      factId: c.factId,
      claim: c.claim,
      href: c.sources[0]?.href ?? null,
    }));
  } else {
    const ed = view.edges.find((e) => e.id === selection.id) as ArchEdge | undefined;
    if (!ed) return null;
    const a = view.nodes.find((n) => n.id === ed.from);
    const b = view.nodes.find((n) => n.id === ed.to);
    kicker = `Connection · ${ed.category}`;
    title = ed.label;
    flow = `${a?.label ?? ed.from}${ed.bidirectional ? "  ⇄  " : "  →  "}${b?.label ?? ed.to}`;
    note = ed.note ?? "";
    desc = note ? "" : "This connection is documented in the repository.";
    docHref = primaryDocHref(ed.claims);
    provenance = ed.claims.map((c) => ({
      factId: c.factId,
      claim: c.claim,
      href: c.sources[0]?.href ?? null,
    }));
  }

  return (
    <aside
      className="arch-detail"
      role="dialog"
      aria-label="Architecture detail"
      data-testid="arch-detail"
      data-no-print
    >
      <div className="arch-detail-head">
        <div
          className="arch-detail-kicker"
        >
          {kicker}
        </div>
        <button
          type="button"
          className="arch-detail-close"
          aria-label="Close detail panel"
          data-testid="arch-detail-close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <h2 className="arch-detail-title">{title}</h2>
      {flow ? <div className="arch-detail-flow">{flow}</div> : null}
      {desc ? <p className="arch-detail-desc">{desc}</p> : null}
      {note ? (
        <div className="arch-detail-note">
          <span className="arch-detail-note-kicker">Behavior &amp; rules</span>
          {note}
        </div>
      ) : null}
      {provenance.length > 0 ? (
        <ul className="arch-detail-claims" data-testid="arch-detail-claims">
          {provenance.map((row) => (
            <li key={row.factId} className="arch-detail-claim">
              <span className="arch-detail-claim-id">{row.factId}</span>
              <span className="arch-detail-claim-text">{row.claim}</span>
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="arch-detail-claim-link"
                >
                  source ↗
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {docHref ? (
        <a
          href={docHref}
          target="_blank"
          rel="noopener noreferrer"
          className="arch-detail-doc"
          data-testid="arch-detail-doc"
        >
          Open repository docs ↗
        </a>
      ) : null}
    </aside>
  );
}
