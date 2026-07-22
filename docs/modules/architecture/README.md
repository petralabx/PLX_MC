# Module: architecture

## What

The Mission Control **Architecture** screen — a read-only interactive C4
catalog over the maintained diagram pack (context, containers, task lifecycle).
It owns the shell screen key `architecture`, the UI under
`src/components/mc/architecture/`, scoped styles in `src/styles/mc-architecture.css`,
the typed model adapter in `src/lib/architecture/`, read APIs under
`src/app/api/architecture/`, and the served SVG fallback copies under
`public/architecture/`.

It does **not** own Mermaid sources (those stay in `docs/architecture/*.mmd`),
parity CI (`scripts/check-arch-parity.py`), or canonical architecture prose
(`AGENTS.md`, other module contracts).

## Why

Operators and agents need a calm in-app lens over the architecture without
opening the repo. The UI must stay honest: diagrams and the interactive model
are **generated consumers**, not a second system of record. When a diagram
disagrees with docs, the docs win.

## How

- Screen registry: `SCREEN_VALUES` / `SCREENS` key `"architecture"`.
- Sidebar under **System of record** (near SOP guide / Skills directory);
  command palette entry "Go to Architecture".
- Deep link: `/?screen=architecture&diagram=context|containers|task-lifecycle`
  (selection hashes supported by the interactive renderer).
- **Primary path:** interactive canvas fed by `GET /api/architecture/model`
  (validated projection of `docs/architecture/source-map.json`).
- **Fallback path:** static SVGs from `public/architecture/*.svg` when model
  validation fails; copies must match `docs/architecture/*.svg` (gate enforced).
- Disclosure copy states "generated consumer — not canonical" and points at
  `AGENTS.md` / `docs/modules/` authority paths.
- **Validation gate:** `scripts/check-architecture-diagrams.py` in preflight
  pre-commit — honesty phrases, source-map invariants, SVG fallback parity.
- **Operator workflow:** edit canonical docs → refresh `source-map.json` claims
  → re-export Mermaid SVGs → copy to `public/architecture/` → run gate.
- **Developer guide:** repo docs only (`docs/architecture/README.md`, this
  contract) — no separate in-app developer guide page.
- Verification: `npm run typecheck`; `tests/architecture-model.test.ts`;
  `tests/test_check_architecture_diagrams.py`; preflight pre-commit gate.

## Dependencies

- **web** — shell routing, chrome, command palette, screen registry
- **design-system** — `--p-*` tokens behind `.brand-plx` / `.mc`
- **docs/architecture** pack — Mermaid/SVG sources, `source-map.json`, gate

Consumers: Mission Control operators (in-app); agents reading the module
contract for scope boundaries.

### Key Files

- `src/components/mc/architecture/index.tsx` — Architecture screen + view switcher
- `src/styles/mc-architecture.css` — scoped interactive catalog styles
- `src/lib/architecture/model.ts` — Zod schema + invariants (30-node cap, etc.)
- `src/lib/architecture/model-adapter.ts` — deterministic source-map projection
- `src/app/api/architecture/model/route.ts` — validated model API
- `src/app/api/architecture/provenance/route.ts` — slim provenance summary API
- `public/architecture/*.svg` — static fallback copies (must match docs pack)
- `docs/architecture/source-map.json` — provenance index for nodes/edges
- `scripts/check-architecture-diagrams.py` — diagram + source-map + fallback gate
- `src/components/mc/route.ts` — `architecture` screen + `diagram` query param

## Owner

Vince

## Criticality

Medium
