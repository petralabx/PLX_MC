# Architecture diagrams (generated consumers)

These Mermaid sources and SVG exports are **generated consumers** of canonical
architecture truth. They are a guide for humans and agents — **not** a second
system of record.

## Canonical source of truth

| Authority | Role |
|---|---|
| `AGENTS.md` | Canonical architecture, runtime entry points, production hosting, module index |
| `docs/modules/*` | Module contracts (sync maturity, MCP, web, routing, …) |

If a diagram disagrees with those docs, **the docs win**. Update the docs first
(or in the same change), then regenerate diagrams.

## Interactive model (read-only projection)

The in-app Architecture screen renders a **typed, Zod-validated interactive
model** projected from `source-map.json` — not a second authority.

| Layer | Location | Role |
|---|---|---|
| Canonical prose | `AGENTS.md`, `docs/modules/*` | Architecture facts and module contracts |
| Provenance index | `docs/architecture/source-map.json` | Per-node/edge claims with repo paths and line ranges |
| Typed model | `src/lib/architecture/` | Deterministic adapter + `ArchitectureModel` schema |
| Read API | `GET /api/architecture/model` | Validated model in the shared `{ data }` envelope |
| Provenance API | `GET /api/architecture/provenance?view=…` | Slim source summary for the detail panel |
| Interactive UI | `src/components/mc/architecture/` | C4 canvas (context / containers / task-lifecycle) |
| Static fallback | `public/architecture/*.svg` | Degraded `<img>` copies when model validation fails |

**Validation:** `scripts/check-architecture-diagrams.py` (preflight pre-commit)
checks Mermaid honesty phrases, `source-map.json` structure (view IDs, unique
IDs, boundaries, referenced sources, line ranges, 30-node cap), and that
`public/architecture/*.svg` matches `docs/architecture/*.svg`.

**Developer system guide:** operator workflow, layout contract, and schema notes
live in repo docs (`docs/modules/architecture/README.md`, this README) — not
as an in-app page.

## Consumer disclaimer

- **Generated guide — not official.** Labels and arrows must stay linked to
  repository documentation (`source-map.json`).
- Do not invent hosting, sync maturity, or deployment claims in `.mmd` files
  that are absent from `AGENTS.md` / module contracts.
- Sync maturity (honesty-oracle): **delta engine current**; **Graph
  change-notifications deferred (P11)**.
- Production hosting (P1): web app on **Vercel** at
  `https://mc.plxcustomer.io`; PLX-MC MCP stdio and agentic swarm are
  **operator-local** (not part of the Vercel deploy).

## Tool pin

SVG exports MUST use:

```bash
npx --yes @mermaid-js/mermaid-cli@11.16.0 -i <file.mmd> -o <file.svg>
```

Pin: `@mermaid-js/mermaid-cli@11.16.0` (do not float to latest without an
intentional bump + visual check).

## How to re-export SVGs

From the repository root (or this directory):

```bash
cd docs/architecture
npx --yes @mermaid-js/mermaid-cli@11.16.0 -i context.mmd -o context.svg
npx --yes @mermaid-js/mermaid-cli@11.16.0 -i containers.mmd -o containers.svg
npx --yes @mermaid-js/mermaid-cli@11.16.0 -i task-lifecycle.mmd -o task-lifecycle.svg
```

Then refresh `source-map.json` claims/line ranges if `AGENTS.md` or module
READMEs moved, and set `source_commit` to the commit that holds the authority
text you mapped.

After updating maintained SVGs, copy them into `public/architecture/` so the
static fallback stays in sync:

```bash
cp docs/architecture/context.svg public/architecture/context.svg
cp docs/architecture/containers.svg public/architecture/containers.svg
cp docs/architecture/task-lifecycle.svg public/architecture/task-lifecycle.svg
```

Run `python scripts/check-architecture-diagrams.py` before commit.

## Pack contents

| File | View |
|---|---|
| `context.mmd` / `.svg` | System context (C4-style) |
| `containers.mmd` / `.svg` | Responsibilities / ownership |
| `task-lifecycle.mmd` / `.svg` | Task interaction map (not a runtime sequence) |
| `source-map.json` | Per-node/edge provenance into repo docs |
| `README.md` | This regen contract |

Pilot history (superseded as canonical pack location):
`artifacts/platform/2026-07-15-plx-architecture-visual-pilot/`.
Canonical maintained pack: **this directory**.
