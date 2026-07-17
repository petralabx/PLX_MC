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
