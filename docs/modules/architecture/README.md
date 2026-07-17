# Module: architecture

## What

The Mission Control **Architecture** screen — a read-only editorial catalog of
the maintained C4 guide diagrams (context, containers, task lifecycle). It owns
the shell screen key `architecture`, the UI under
`src/components/mc/architecture/`, scoped styles in `src/styles/mc-architecture.css`,
and the served SVG copies under `public/architecture/`.

It does **not** own Mermaid sources (those stay in `docs/architecture/*.mmd`),
parity CI (`scripts/check-arch-parity.py`), or canonical architecture prose
(`AGENTS.md`, other module contracts).

## Why

Operators and agents need a calm in-app lens over the diagram pack without
opening the repo. The UI must stay honest: diagrams are **generated consumers**,
not a second system of record. When a diagram disagrees with docs, the docs win.

## How

- Screen registry: `SCREEN_VALUES` / `SCREENS` key `"architecture"`.
- Sidebar under **System of record** (near SOP guide / Skills directory);
  command palette entry "Go to Architecture".
- Deep link: `/?screen=architecture&diagram=context|containers|task-lifecycle`.
- Renders static SVGs from `public/architecture/*.svg` via `<img>` (no Mermaid
  runtime). Source pack: `docs/architecture/` (regen contract in that README).
- Disclosure copy states "generated consumer — not canonical" and points at
  `AGENTS.md` / `docs/modules/` authority paths.
- Verification: `npm run typecheck`; preflight pre-commit gate.

## Dependencies

- **web** — shell routing, chrome, command palette, screen registry
- **design-system** — `--p-*` tokens behind `.brand-plx` / `.mc`
- **docs/architecture** pack — SVG sources copied into `public/architecture/`

Consumers: Mission Control operators (in-app); agents reading the module
contract for scope boundaries.

### Key Files

- `src/components/mc/architecture/index.tsx` — Architecture screen + view switcher
- `src/styles/mc-architecture.css` — scoped editorial catalog styles
- `public/architecture/*.svg` — served generated consumers
- `docs/architecture/` — canonical diagram pack (Mermaid + SVG + source-map)
- `src/components/mc/route.ts` — `architecture` screen + `diagram` query param

## Owner

Vince

## Criticality

Medium
