# Module: web

## What

The Next.js (App Router) application shell — the Mission Control UI. Screens
from the design handoff are built (Inbox, Board/List/Timeline, Traceability,
Agent activity, Initiative/Bucket detail, Task detail, Sync console, Files,
Repos) plus surfaces added since the handoff: **Project detail**, **My Tasks**,
**Insights**, **Meeting Intake**, **Loop Ledgers**, **Governance SOPs**,
**Skills Directory**, **Architecture**, **AI Spend**, and **Ask the Brain** — along with the ⌘K
command palette, New Task / New Initiative / New Project modals, and
PeoplePicker (Petra domain rule enforced in the UI). The screen registry
(`src/components/mc/screens.tsx`) maps twenty-four `Screen` keys to components;
Board, List, Timeline, and My Tasks share `WorkViews`. State flows through the runtime store
(`src/lib/mc-data/store.ts`) — since 2026-06-11 a client cache over the sync
module's API: it hydrates from `GET /api/state` after mount (the signed-in
viewer comes from `GET /api/viewer`, resolved from the Entra session — no
hardcoded current user) and mirrors every
mutation through the shared fetch wrapper (`src/lib/api`), staying
optimistic-local-first so the UI degrades to the last-synced view offline —
labelled by an app-wide "Offline — showing cached or demo data" banner with
Retry whenever `GET /api/state` fails (store `dataSource()`).
The getter/action surface is unchanged from the prototype port. It owns
routing, screens, and client state only — it is NOT the system of record
(SharePoint is) and NOT the sync engine (the `sync` module is).

**Colleague UX (Wave 6).** Home (`home`) is "What needs me today": approvals
waiting on the viewer, their routing proposals (flagged), their overdue tasks,
and for owners/admins unowned tasks and SharePoint sync issues — one action
per row, each section with loading / error-with-Retry / empty states; the
rules are pure in `needs-me.ts`. The sidebar and the ⌘K Navigate group share
one declarative model (`nav-model.ts`): My work · Plan · Knowledge · Admin &
health (collapsed by default, remembered in localStorage). Items are real
links (`routeToUrl`). "Initiative" is the only user-facing name for a bucket;
the Help screen (`help`) has a glossary.

**Mobile-first shell (ADR-005).** One nav model drives every surface: phone
(<641) bottom tabs My work · Plan · Knowledge · More (each remembers its last
screen), a group strip, a More sheet and the full drawer via More → All
screens; tablet a 64px icon rail that expands into the labelled drawer;
desktop the 240px sidebar; ≥1600 a persistent, resizable context pane on
Board / List / My tasks / Approvals (opening a task fills it; `taskId` stays in
the URL, so narrower windows show it as an overlay); ≥2200 an optional pinned
live column (Agent activity or Approvals, the user's pick). Every layer
(drawer, More sheet, overlay pane, ⌘K, modals) shares `use-layer.ts`: Esc
closes only the topmost, focus returns to its trigger. Nav badges speak one
honest vocabulary (`count-badge.tsx`): n, n+ (lower bound), — (unknown),
hidden only at a confirmed zero.

**Project detail** (`project` screen): rolls up initiatives (buckets) under a
Project with an initiative card grid; inline edit for health, accountable
owner, target, and description via `updateProject` → optimistic
`PATCH /api/projects/{id}` (same contract as `updateBucket` on initiative
detail).

### Hosting

Production web app deploys on Vercel project **`plx-mission-control`** at
**`https://mc.plxcustomer.io`** (see root `README.md` and `vercel.json` for
crons). HTTPS APIs under `/api/*` (including `/api/cursor/*`) ship with that
deploy. The PLX-MC MCP **stdio** client and the agentic swarm (loopback
`127.0.0.1:8900`) are **operator-local** and are not part of the Vercel
deploy — see `AGENTS.md` → Production Hosting and `TOOLS.md`.

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
  (`--p-rail`, `--p-canvas`) per ADR-004 and the size-only layout tokens of
  ADR-005; all color stays in `--p-*`. New width media queries go only in
  `src/styles/mc-shell.css` (min-width 641 / 1025 / 1600 / 2200); every other
  MC stylesheet is imported into `@layer mc.legacy` and keeps its existing
  max-width blocks until its screen is converted to `@container`.
- Verification: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run build` — all wrapped by `scripts/preflight.sh`.

## Dependencies

design-system (tokens + primitives); sync (the API surface per
`docs/product/SHAREPOINT_INTEGRATION.md` §6, consumed via the shared fetch
wrapper in `src/lib/api`); `lucide-react` for nav icons (named imports only,
mapped in `nav-icon.tsx`).

### Key Files

- `src/app/layout.tsx` — root layout: fonts, metadata, global CSS
- `src/app/page.tsx` — renders the Mission Control shell
- `src/app/globals.css` — imports the layer order, brand tokens + the `.mc` surface/skin
- `src/components/mc/shell.tsx` — client shell: brand boundary, dark toggle, route state, composes the chrome
- `src/components/mc/route.ts` — `Screen` union + `Route` / `nav` contract
- `src/components/mc/screens.tsx` — screen registry (`SCREENS`)
- `src/components/mc/chrome.tsx` — Sidebar (drawer · rail · sidebar), nav counts, offline banner, toasts
- `src/components/mc/top-bar.tsx` — top bar (slots per tier, static workspace label, sync pill)
- `src/components/mc/bottom-tabs.tsx` — phone tabs (with tab memory), group strip, New-task FAB
- `src/components/mc/more-sheet.tsx` — phone More sheet (Admin & health, All screens, appearance)
- `src/components/mc/context-pane.tsx` — context pane (page <641, overlay <1600, resizable column ≥1600) + live column
- `src/components/mc/use-layer.ts` — layer stack: Esc (topmost only), focus in/back, Tab wrap, scroll lock
- `src/components/mc/shell-prefs.ts` — pane width / hidden, live pin and pick (localStorage + memory), tier hooks
- `src/components/mc/count-badge.tsx` — honest count badge (n · n+ · —)
- `src/components/mc/nav-icon.tsx` — Lucide icon map for the nav
- `src/components/mc/nav-model.ts` — nav groups/items, phone tabs, tab memory, pane screens — shared by every nav surface, ⌘K and tests
- `src/components/mc/project-detail.tsx` — Project detail + initiative card grid
- `src/components/mc/inbox.tsx` — Home: "What needs me today" (rules in `needs-me.ts`)
- `src/components/mc/help.tsx` — Help: how Mission Control works + glossary
- `src/components/mc/atoms.tsx` — Avatar, Confidence, PMark
- `src/lib/mc-data/` — typed prototype data layer (types, fixtures, helpers)
- `src/styles/mc-shell.css` — mobile-first shell; the layer order; the only MC file allowed new width media queries (ADR-005)
- `src/styles/mc-surface.css`, `src/styles/mc-app.css` — surface + layout tokens, screen skin (`mc.legacy`)
- `src/lib/brain-ask/` — Ask the Brain search/open client. Catalog `document:`
  ids open via VMC `GET /api/vmc/knowledge/agent/document/{id}`; graph ids stay
  on `/agent/node?include=content`.
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`

## Owner

Vince

## Criticality

Critical
