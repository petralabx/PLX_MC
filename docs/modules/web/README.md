# Module: web

## What

The Next.js (App Router) application shell — the Mission Control UI. Screens
from the design handoff are built (Inbox, Board/List/Timeline, Traceability,
Agent activity, Initiative/Bucket detail, Task detail, Sync console, Files,
Repos) plus surfaces added since the handoff: **Project detail**, **My Tasks**,
**Insights**, **Meeting Intake**, **Loop Ledgers**, **Governance SOPs**,
**Skills Directory**, and **AI Spend** — along with the ⌘K command palette,
New Task / New Initiative / New Project modals, and PeoplePicker (Petra domain
rule enforced in the UI). The screen registry (`src/components/mc/screens.tsx`)
maps nineteen `Screen` keys to components; Board, List, Timeline, and My Tasks
share `WorkViews`. State flows through the runtime store
(`src/lib/mc-data/store.ts`) — since 2026-06-11 a client cache over the sync
module's API: it hydrates from `GET /api/state` after mount and mirrors every
mutation through the shared fetch wrapper (`src/lib/api`), staying
optimistic-local-first so the UI degrades to the last-synced view offline.
The getter/action surface is unchanged from the prototype port. It owns
routing, screens, and client state only — it is NOT the system of record
(SharePoint is) and NOT the sync engine (the `sync` module is).

**Project detail** (`project` screen): rolls up initiatives (buckets) under a
Project with an initiative card grid; inline edit for health, accountable
owner, target, and description via `updateProject` → optimistic
`PATCH /api/projects/{id}` (same contract as `updateBucket` on initiative
detail).

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
- Routing is in-client: `MissionControlShell` (`shell.tsx`) holds a `Route`
  (`src/components/mc/route.ts`) and navigates with `nav(screen, extra?)` where
  `extra` may carry `projectId`, `bucketId`, `taskId`, or an Insights
  `filter`. The shell renders `SCREENS[route.screen]` from the registry.
- Screens are URL-addressable: `nav()` mirrors the route to query params on `/`
  (`/?screen=task&taskId=…`) via shallow `history.pushState`; a `popstate`
  listener replays back/forward and the shell adopts the URL post-mount, so
  reloads and deep links restore the screen. The transient Insights `filter`
  is deliberately not serialized (see `routeToUrl`/`urlToRoute` in `route.ts`).
- The screens live in `src/components/mc/`; they read the typed data layer in
  `src/lib/mc-data/` (faithful to `docs/product/DATA_MODEL.md`) whose store is
  now API-backed; fixtures remain the SSR/offline baseline. Each new screen is rebuilt
  from the handoff spec — treat `docs/product/prototype/` as the look/behavior
  spec, never as code to lift verbatim — and adds its own data + CSS block.
- The `.mc` shell opts into the PLX brand boundary and adds two surface tokens
  (`--p-rail`, `--p-canvas`) per ADR-004; all color stays in `--p-*`.
- Verification: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run build` — all wrapped by `scripts/preflight.sh`.

## Dependencies

design-system (tokens + primitives); sync (the API surface per
`docs/product/SHAREPOINT_INTEGRATION.md` §6, consumed via the shared fetch
wrapper in `src/lib/api`).

### Key Files

- `src/app/layout.tsx` — root layout: fonts, metadata, global CSS
- `src/app/page.tsx` — renders the Mission Control shell
- `src/app/globals.css` — imports brand tokens + the `.mc` surface/skin
- `src/components/mc/shell.tsx` — client shell: brand boundary, dark toggle, route state
- `src/components/mc/route.ts` — `Screen` union + `Route` / `nav` contract
- `src/components/mc/screens.tsx` — screen registry (`SCREENS`)
- `src/components/mc/chrome.tsx` — Topbar + Sidebar (Projects group)
- `src/components/mc/project-detail.tsx` — Project detail + initiative card grid
- `src/components/mc/inbox.tsx` — the Inbox/home screen
- `src/components/mc/atoms.tsx` — Avatar, Confidence, PMark
- `src/lib/mc-data/` — typed prototype data layer (types, fixtures, helpers)
- `src/styles/mc-surface.css`, `src/styles/mc-app.css` — surface tokens + skin
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`

## Owner

Vince

## Criticality

Critical
