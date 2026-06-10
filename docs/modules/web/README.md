# Module: web

## What

The Next.js (App Router) application shell — the Mission Control UI. All
eleven screens from the design handoff are built: Inbox, Board/List/Timeline,
Traceability, Agent activity, Bucket detail, Task detail (evidence bundle +
TaskRecord), Sync console (registers, review queue, audit log), Files, and
Repos — plus the ⌘K command palette, New Task modal, and PeoplePicker (Petra
domain rule enforced in the UI). State flows through the runtime store
(`src/lib/mc-data/store.ts`), the prototype stand-in for the sync engine. It
owns routing, screens, and client state only — it is NOT the system of record
(SharePoint is) and NOT the sync engine (a future `sync` module per
`docs/product/SHAREPOINT_INTEGRATION.md`).

## Why

The product is a fast, opinionated lens over the SharePoint record. The
screens to build (Inbox, Board/List/Timeline, Traceability, Agent activity,
Bucket detail, Task detail, Sync console, Files, New Task modal) are specified
pixel-precisely in `docs/product/README.md` §6 and
`docs/product/screenshots/SCREENS.md`.

## How

- App Router under `src/app/`; brand wiring per
  `docs/design-system/HANDOFF-README.md` §5 (three font families as CSS
  variables on `<html>`, tokens imported in `globals.css`, branded routes
  wrapped in `<BrandBoundary>`).
- The screens live in `src/components/mc/`; they read a typed prototype data
  layer in `src/lib/mc-data/` (faithful to `docs/product/DATA_MODEL.md`) that is
  swapped for the API at the sync-engine milestone. Each new screen is rebuilt
  from the handoff spec — treat `docs/product/prototype/` as the look/behavior
  spec, never as code to lift verbatim — and adds its own data + CSS block.
- The `.mc` shell opts into the PLX brand boundary and adds two surface tokens
  (`--p-rail`, `--p-canvas`) per ADR-004; all color stays in `--p-*`.
- Verification: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run build` — all wrapped by `scripts/preflight.sh`.

## Dependencies

design-system (tokens + primitives). Future: the sync module's API surface
(`docs/product/SHAREPOINT_INTEGRATION.md` §6) replaces the prototype's
`window.MC_*` mutations.

### Key Files

- `src/app/layout.tsx` — root layout: fonts, metadata, global CSS
- `src/app/page.tsx` — renders the Mission Control shell
- `src/app/globals.css` — imports brand tokens + the `.mc` surface/skin
- `src/components/mc/shell.tsx` — client shell: brand boundary, dark toggle, screen state
- `src/components/mc/chrome.tsx` — Topbar + Sidebar
- `src/components/mc/inbox.tsx` — the Inbox/home screen
- `src/components/mc/atoms.tsx` — Avatar, Confidence, PMark
- `src/lib/mc-data/` — typed prototype data layer (types, fixtures, helpers)
- `src/styles/mc-surface.css`, `src/styles/mc-app.css` — surface tokens + skin
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`

## Owner

Vince

## Criticality

Critical
