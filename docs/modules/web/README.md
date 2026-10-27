# Module: web

## What

The Next.js (App Router) application shell — the Mission Control UI. Screens
from the design handoff are built (Inbox, Board/List/Timeline, Traceability,
Agent activity, Initiative/Bucket detail, Task detail, Sync console, Files,
Repos) plus surfaces added since the handoff: **Project detail**, **My Tasks**,
**Dashboard** (project and initiative progress under Home, with a live In flight
panel and activity strip polled from `GET /api/in-flight`), **Insights**,
**Meeting Intake**, **Loop Ledgers**, **Governance SOPs**,
**Skills Directory**, **Architecture**, **AI Spend**, and **Ask the Brain** — along with the ⌘K
command palette, New Task / New Initiative / New Project modals, and
PeoplePicker (Petra domain rule enforced in the UI). The screen registry
(`src/components/mc/screens.tsx`) maps twenty-nine `Screen` keys to components;
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

**Zoned sidebar (TASK-3840, default off).** The navigation redesign's sidebar,
built to the shared PLX shell contract (portal ADR-011): My work · Plan ·
Reporting · Knowledge (collapsed by default), then a footer pinned to the
bottom with Help and an Admin & health popover (Operations · Sync and data ·
Engineering). It is 248px wide, with 28px rows for a mouse and 44px on touch.
Its items, URLs, badges and flags are the default sidebar's (`ZONED_NAV_GROUPS`
and `ADMIN_FLYOUT` in `nav-model.ts`). `NEXT_PUBLIC_PLX_MC_NAV_ZONES=1` turns
it on for a build, with no switch. Otherwise each person turns it on with
"Try the new navigation" in the account menu (TASK-3855), and turns it off
there to switch back. The switch lives on the server per person (`GET|PATCH
/api/nav-prefs`, module `nav-prefs`), so it follows them to every device;
this browser keeps a copy in localStorage `mc.nav.zones` ("on" / "off") for
the next load, and drops it when the server holds no switch (another person
signed in). "1" there still opts one browser in by hand for a person who
never used the switch (`nav-zones.ts`). The first time the switch
is on, a one-screen tour names each zone, with Got it and Switch back
(`nav-tour.tsx`); the server keeps that it was seen. Plan's Board, List and Timeline share one All work
row, lit on each view, and the views stay tabs on that screen with their URLs
and g b, g l and g t keys (TASK-3843). The phone tabs are Home, My tasks,
Projects, Search (⌘K) and More; More holds Reporting, Knowledge, Admin &
health's sections and Help. ⌘K keeps the default groups. Plan nests each
initiative under its project (TASK-3841). The v2 sidebar (TASK-3955, portal
ADR-011's v2 amendment) lists every active project A to Z under a filter
that matches projects and initiatives, then a Closed (n) row that opens to the
closed projects; archived ones never show. One + on the Projects row opens New
project or New initiative. Every row shares one grid (icon, label, count,
action); counts are figures in the count column: Home's and Approvals' action
counts, Admin & health's sync count, and each project's and initiative's open
tasks from live data, with a warn square when it is at risk and a hot one
(the brand's off-track colour) when it is off track. Zero and unknown show
nothing. The sidebar is one keyboard tree with one tab stop
(plus the filter): ↑ ↓ Home End move, → and ← open, enter and close, a letter
jumps, Shift F10 opens the Projects row's + menu, and `/` focuses the page's
own filter or else this one. The Projects row, the phone Projects tab and Go
to Projects open the project Dashboard at `projects` (TASK-3996); Reporting
keeps its Dashboard row at `dashboard`, and each row is lit on its own URL.
From 1025px (TASK-3957, portal ADR-011 v2 Width) the person sets the sidebar's
width between 232 and 400px with the splitter on its edge: drag it (the width
shows while dragging), use ← and → (Shift for 64px), Home and End, or
double-click for 248px. Released under 160px, or with Enter, `[` or the top
bar's panel button left of the logo, it collapses to the 56px rail, and
expanding returns the last width. The rail shows the icons with the stars'
digits; Projects opens a flyout with every active project and its filter; an
icon names itself after 300ms of hover or at once on keyboard focus. Beside an
open pane the sidebar gives way so the page keeps 560px. Each browser keeps
the width and rail in localStorage (`mc.side.w`, `mc.side.rail`), and a script
in `<head>` paints them onto `<html>` before the first paint, so the page stays
static (ADR-006). Below 1025px `[` opens and closes the drawer. On project,
initiative and task pages the top bar shows the page path from 1025px
(TASK-3958, portal ADR-011 zone 2): Plan / project / initiative, where the
project opens a menu of every active project A to Z and the initiative a menu
of its project's initiatives, each with its open tasks and the current one
checked. `?` opens the shortcuts sheet, listed from `shortcuts.ts` (the shell
reads its g chords from the same list), and so does the Help and shortcuts
row; the sheet links on to the Help page. Its switch turns the single-key
shortcuts off, per browser (`mc.keys.single`): `[`, `/`, `?`, the g chords and
Shift S (WCAG 2.1.4). ⌘K and the keys inside the tree and the splitter stay. In the
top bar (TASK-3844) the workspace label is the PLX app switcher (Mission
Control, MRP Suite, Admin portal, Customer portal), the mark alone below a
900px bar, and the sync pill names what to resolve ("2 sync conflicts, 1
error"). The switcher and the Admin & health popover share `use-flyout.ts`.
Starred (TASK-3842; v2, TASK-3956) follows My work: copies of the screens,
reports, projects and initiatives the person starred, at most 10, in their
order, never the lit row. Its heading counts them ("3 / 10"). Each copy shows
its kind's icon and the digit g opens it with (1 to 9, then 0); a closed,
archived or deleted one is marked and keeps its slot until removed, and an
eleventh star is refused. Screens carry their zoned label, and Board, List and
Timeline are one All work star. The stars live on the server per person
(`GET|PATCH /api/stars`, module `stars`), so they follow the person to every
device. Every sidebar row has a star in its action column, out of the Tab
order and shown on hover and focus (always on touch); Shift S stars the
focused row, else the page, and the top bar's star toggle stars the page. Drag
a copy by its grip, or press Alt with ↑ or ↓ on it, to move it. The icon rail
shows one Starred button that opens the drawer, and the phone More sheet lists
Starred first. Each change shows at once and goes to the server one at a time;
a refused change is put back with a notice (`use-stars.ts`).
The nav flags live in `nav-flags.ts`. In the zoned shell the ⌘K palette
(TASK-3853) opens on **Recent**, the last 8 screens, projects, initiatives and
tasks opened in this browser, newest first and without the page under the
palette, then **Starred**, each star with its key (g then its digit opens it
from anywhere), closed by Star or Unstar this page and Edit starred, which
focuses the first copy. Typing searches every group, as before. The palette
also offers Go to Projects there. Recents stay in this browser
(`createRecents` in `nav-model.ts`, localStorage `mc.nav.recents`).

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
- Path aliases for sharing: `/tasks/TASK-n` (TASK-3163), `/projects/PRJ-n` and
  `/buckets/BKT-n` (TASK-3442) are server redirects onto the matching
  query-string route (`/?screen=task|project|bucket&…Id=…`); a malformed id goes
  home. MCP returns them as `link` from `taskLink`, `projectLink` and
  `bucketLink` (`src/lib/mcp/envelope.ts`).
- Approvals and My tasks links (TASK-3559): `/?screen=approvals&gate=<apg_id>`
  opens one gate (`gateLink` in `envelope.ts`; `questionLink` does the same
  with `question=`), and `/?screen=my-tasks` is the stable name for My tasks
  (screen `mine`). Neither names a person: the session decides whose approvals
  and tasks show. Both survive the sign-in redirect, which keeps the query.
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
- `src/components/mc/top-bar.tsx` — top bar (slots per tier, workspace label or the zoned PLX app switcher, the page's star toggle, sync pill)
- `src/components/mc/use-stars.ts` — the person's stars: load (and refresh on focus), each change at once then one at a time to the server, a refused one put back with a notice
- `src/components/mc/nav-flags.ts` — the feature flags that gate nav items
- `src/components/mc/star-toggle.tsx` — the star toggle (top bar, sidebar rows)
- `src/components/mc/use-flyout.ts` — a shell control's flyout: top-layer popover, placement, Esc, close on blur, navigating or resize
- `src/components/mc/bottom-tabs.tsx` — phone tabs (with tab memory; the zoned set when the flag is on), group strip, New-task FAB
- `src/components/mc/more-sheet.tsx` — phone More sheet (Starred, Admin & health, All screens, appearance)
- `src/components/mc/context-pane.tsx` — context pane (page <641, overlay <1600, resizable column ≥1600) + live column
- `src/components/mc/use-layer.ts` — layer stack: Esc (topmost only), focus in/back, Tab wrap, scroll lock
- `src/components/mc/shell-prefs.ts` — pane width / hidden, live pin and pick (localStorage + memory), tier hooks
- `src/components/mc/count-badge.tsx` — honest count badge (n · n+ · —)
- `src/components/mc/shortcuts.ts` — every keyboard shortcut in one list (the ? sheet's groups and the shell's g chords), and the single-key switch
- `src/components/mc/shortcuts-sheet.tsx` — the ? sheet: the shortcuts, the single-key switch, and a link to Help
- `src/components/mc/side-boot.ts` — the sidebar's width limits and the `<head>` script that paints the stored width and rail onto `<html>` before the first paint (ADR-006)
- `src/components/mc/side-width.ts` — the width and rail prefs, `paintSide`, and the splitter's key and drag rules
- `src/components/mc/side-resize.tsx` — the splitter, the rail's expand button, and the rail's hover and focus labels
- `src/components/mc/nav-icon.tsx` — Lucide icon map for the nav
- `src/components/mc/nav-model.ts` — nav groups/items, phone tabs, tab memory, stars, recents, pane screens — shared by every nav surface, ⌘K and tests
- `src/components/mc/nav-zones.ts` — who sees the zoned sidebar: the build env, else the person's "Try the new navigation" switch (server, with a copy per browser), else a by-hand opt-in per browser; default off
- `src/components/mc/nav-tour.tsx` — the one-screen tour the first time the switch is on (Got it, Switch back)
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
