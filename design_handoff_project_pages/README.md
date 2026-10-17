# Handoff: Mission Control — Project & Initiative pages

Repo: `petralabx/PLX_MC` @ `main` · Screens: `src/components/mc/project-detail.tsx` (+ `project-overview.tsx`, `project-overview.helpers.ts`) and `src/components/mc/bucket-detail.tsx`.

## Overview
Redesign of the two Mission Control record pages — the **Project** page (Overview lens + Initiatives lens) and the **Initiative (bucket) detail** page — fixing the layout failures in the current build (facts strip overflowing the viewport, initiative headers colliding on long names, a flat Documents & links dump) and making both pages first-class at phone, tablet, desktop and ultra-wide widths.

## About the design files
Everything in this bundle is a **design reference built in HTML** (Design Components that open directly in a browser). They show intended look and behaviour; they are **not production code**. Recreate them inside PLX_MC's existing stack — Next.js / React, the `.mc` CSS layers in `src/styles/*.css`, `lucide-react`, and the `--p-*` brand tokens — reusing the existing atoms (`Avatar`, `Pill`, `PrdLinkField`, `NtmField`, `Timeline`, nav shell) wherever they exist. Where the design introduces a new piece (schedule-vs-work strip, task filter, register tiles, spec-in-header), add it in the same style as the surrounding code.

- `Project Page - Redesign.dc.html` · `Initiative Page - Redesign.dc.html` — the target designs (open in a browser; use the Tweaks panel / `forceTier` prop to preview phone · tablet · desktop).
- `reference-current/` — faithful recreations of the **current** pages built from the repo's own CSS (for before/after), and the options canvas that led to the chosen directions (1c strip, 1d docs).
- `screenshots/` — desktop, tablet and phone captures of both redesigned pages.
- `mc-sample-data.js` — the sample data the mocks render; field names mirror `src/lib/mc-data`.

## Fidelity
**High-fidelity.** Colours, type, spacing and states are final and use the PLX brand tokens already in the repo (`src/styles/brand-tokens.css` / portal `design-system/tokens.css`). Match them exactly; use the token names, not the hex values.

---

## Shell (unchanged in intent, tiered)
- **Desktop ≥1025**: 56px top bar; 240px left nav (`.mc-side` today); content on `--p-canvas`.
- **Tablet 641–1024**: nav collapses to a 64px icon rail (icons only, badges float top-right of the icon; hairline between groups). Projects/Initiatives sub-lists hidden in the rail.
- **Phone ≤640**: no side nav; top bar reduces to element mark + page title + search icon + avatar; a fixed 56px bottom tab bar (My work · Plan · Knowledge · More) with 44px targets. Main gets 128px bottom padding so the tab bar never covers content.
- **Ultra-wide ≥1800**: page header, strip and body content centre in a **1560px** column; hairlines remain full-bleed (border on the outer wrapper, content in the inner). Initiative aside caps at 420px.
- All tiering is driven by **main-content width** (`ResizeObserver` on `<main>`), not just viewport — the same page re-tiers when the nav opens/closes.

## Screen 1 — Project page

### Page header
Flex row, `align-items:flex-end`, wraps. Left: `← Back` (mono 9.5px/0.16em), kicker `PROJECT · {id}` (mono 9.5px/0.22em, `--p-muted`), `h1` Mazius 38px/0.98, −0.022em (28px below desktop), description 13px `--p-muted` max 66ch with inline `Edit`. Right: health pill (outline, tone border + 5px dot, mono 9px/0.16em uppercase, AA `*-text` colour), `● SYNCED · 19:11`, lens switcher (Overview | Initiatives; 1px `--p-grid` box, active = `--p-ink` fill / `--p-paper` text; 44px tall below desktop).

### Overview strip  (replaces the 7-cell `.bkfacts` grid)
Grid `340px minmax(0,1fr)` on `--p-paper` with a bottom hairline; stacks to one column below 900px of content width (hairline moves from right edge of the facts to between the zones).

**Facts zone** — 2×2 grid (`gap 14px 22px`, padding `16px gutter`), each cell = mono 8px/0.2em label + value:
- Health: `<select>` styled as the outline pill (tone border, dot at left 8px, chevron-down 10px at right 7px). Values `track | risk | off` → "On track" / "At risk" / "Off track" (sage / amber / mineral tones, `*-text` for the label).
- Accountable owner: 18px avatar + name (mono 12px/500) + chevron, transparent border that becomes `--p-grid` on hover (opens the existing owner picker, `NtmField`).
- Started: mono 12px/500 read-only.
- Target: borderless input with dashed `--p-grid` bottom rule + 11px pencil icon; dashed rule darkens to `--p-ink-2` on focus (same `le-input` behaviour as today).

**Schedule-vs-work zone** (`padding 14px gutter 15px`, column gap 10px):
1. Headline row (baseline aligned, wraps): `{pct}%` Mazius 34px (30px when compact) + "of work closed" 12.5px `--p-ink-2` · `VS` mono 9px · `{elapsed}%` Mazius 34px `--p-muted` + "of schedule elapsed" · right-aligned **pace chip** (outline pill with Lucide icon):
   - overdue → amber, `calendar-x`, `TARGET PASSED · {n}D`
   - delta ≥ +3 → sage, `trending-up`, `AHEAD · +{n} PTS`
   - delta ≤ −3 → amber, `trending-down`, `BEHIND · {n} PTS`
   - else → `--p-grid` border / `--p-muted`, `minus`, `ON PACE`
   where `delta = closedPct − elapsedPct`, `elapsedPct = clamp((today − started) / (target − started))`.
2. Two labelled 6px bars (`40px minmax(0,1fr)` grid, gap `8px 12px`): **Work** = segmented flex bar: done `--p-ink` · cancelled `--p-grid` · in-flight `--p-accent` · remainder `--p-grid-2`, 2px gaps, 1px radius. **Time** = `--p-grid-2` track, `--p-muted` fill to elapsed %, 1px × 16px `--p-ink` tick at today.
3. Dates row (mono 8.5px/0.1em uppercase, `--p-muted`, left-padded 52px to align with the bars): `{started} · STARTED` … `TODAY · {date}` (absolute, centred on the tick, `--p-ink`; hidden when compact, overdue, or tick < 12% / > 84%) … `{target} · TARGET`.
4. Subline mono 9px/0.14em: `16 INITIATIVES · 2188 TASKS · 96 IN FLIGHT · 3 AT RISK` (at-risk count in `--p-warn-text`).

Data: `project.started`, `project.target` (today stored `"2026.06.11"`-style in `src/lib/mc-data/data.ts` — parse to Date), rollups from `project-overview.helpers.ts` (`closed / total / done / cancelled / doing`).

### Project resources  (replaces the `/ Documents & links` list)
Kicker `/ PROJECT RESOURCES` + right `● SHAREPOINT · SYNCED 19:11`. A bordered 4px-radius grid of **register tiles** separated by 1px `--p-grid-2` gaps (grid `gap:1px; background:--p-grid-2`, tiles `--p-paper`): Project Plan · Roadmap · Milestone Register · Risk Register · Project Documents. Tile = Lucide icon 15px `--p-accent` (`list-checks`, `map`, `flag`, `triangle-alert`, `folder`) + name 12.5px/500 + meta mono 8px/0.12em (`MS LIST · 23 ROWS`, `LIBRARY · 148 FILES`) + `arrow-up-right` 12px `--p-muted`; min-height 48px; hover `--p-paper-2`. Columns: 5 at ≥1000px content width, 3 at ≥600, else 2. These are the same five SharePoint links `bucket-detail.tsx` renders in its `.doclinks` block today — lift them to project level.

### Overview lens header row
`/ OVERVIEW · 16` kicker · **task filter** (1px `--p-grid` box, three segments, active = ink fill): `OUTSTANDING · {open}` · `✋ NEEDS A HUMAN · {n}` (Lucide `hand`) · `ALL · {total}`; labels shorten to `OPEN · n` / `HUMAN · n` when compact; segments are 44px tall below desktop. Right: `EXPAND ALL` / `COLLAPSE ALL` text buttons.

Filter semantics (ground in `src/lib/mc-data` + `needs-me.ts`):
- **Outstanding**: `STAGES[stage].band ∉ {done, cancelled}`.
- **Needs a human**: task has a pending runtime approval gate (`task.approvalGates.some(g => g.status === "pending")` — the A2A "input-required" primitive in `src/lib/compliance/approvals.ts`), or is blocked (`gate.blocked` events / `blocked` flag), or lacks a human accountable owner (`!hasHumanAccountableOwner(task)`, as `needs-me.ts` already does). In the mock this is the `human: "verify"` / `blocked` flags.
- **All**: everything, including merged and cancelled.

### Initiative section (one per bucket, `--p-paper`, 1px `--p-grid`, 3px left rule in health tone, 4px radius)
Header (`min-height 48px`, padding `8px 14px 8px 8px`, wraps):
- Chevron toggle 28px (40px below desktop), `chevron-down` / `chevron-right`.
- Title block `flex:1 1 220px; min-width:0`: name 13px/600 clamped to **2 lines** (`-webkit-line-clamp:2`) — never collides with the right cluster; under it a mono 9.5px line: `BKT-WMS  |  📄 wms-uom-genealogy-decision.md ↗` — the bucket's `prd` link (basename of the URL as label; Lucide `file-text`, `square-check` for TASK-* links, `circle-dot` for issues) or `+ ADD SPEC` when `prd` is null. This replaces the project-level doc list: a spec lives with its initiative.
- Right cluster (`flex:0 0 auto` ≥1000px, else wraps to its own full-width row indented 36px): 140px × 3px progress bar (`--p-accent` fill on `--p-grid-2`) + count text mono 8.5px (`4 OUTSTANDING · 118 / 122 CLOSED · 108 DONE · 10 CANCELLED`; shorter below 1000px; `N NEED A HUMAN · N OUTSTANDING` in the human filter) + health pill + `OPEN →` link (`--p-accent`).

Body (hairline-top):
- Table header mono 8px/0.2em. Column grid by content width: ≥1000 `76px 1fr 96px 56px 170px 64px` (ID · Task · Stage · Pri · Executor · Due); 720–999 drops Pri; 600–719 drops ID and Due; **<600 switches to a two-line card row** (title clamped 2 lines + `ID · executor · due` meta line, stage chip right).
- Row: 34px min, `font 12.5px`, hairline-top, hover `--p-paper-2`. ID mono 10px `--p-muted`. Title single-line ellipsis with inline tags: **BLOCKED** (amber outline, `--p-warn-text`) and **✋ VERIFY** (steel outline, `--p-info-text`). Stage chip: 3px radius, 12% tone fill, mono 9px/0.16em (`muted / info / acc / warn / ok` as in `STAGES`). Priority: four 4px bars rising 5.5→10px, filled count = priority level, colour `hot/warn/info/muted`. Executor: 18px avatar (circle for humans `--p-ink`, 1px-radius square `--p-accent` for agents + `MODEL` tag) or dashed `+ ASSIGN`. Due mono 10px right-aligned, amber when blocked.
- Footer rows (full-width buttons, hairline-top, 44px below desktop): `SHOW ALL {n} · {m} MORE ↓` on `--p-paper-2` (row cap default 8 per section) and, in Outstanding mode, `👁 SHOW {closed} CLOSED · {done} MERGED · {cancelled} CANCELLED` which reveals that section's closed rows locally (flips to `HIDE … CLOSED`). Empty states: "Nothing outstanding · all N tasks closed." / "Nothing waiting on a human." — a section with nothing to show starts collapsed.

### Initiatives lens
`repeat(auto-fill, minmax(260px,1fr))` card grid, 14px gap. Card = health left rule, `ID` + health pill row, name 13px/500, meta mono 9.5px `4 OPEN · 2 NEED A HUMAN | 📄 spec`, bottom progress bar + count. Hover darkens border to `--p-ink-2`.

## Screen 2 — Initiative page
Same header pattern; kicker line carries `INITIATIVE · {id}` · `↰ PROJECT · {project}` link · **spec link** (`file-text` + basename + `arrow-up-right`, accent, not uppercased). Views switcher Board | List | Timeline (links). The standalone `/ Spec` block is removed.

**Strip**: same component as the project, facts grid 3×2 (Health · Owner · Project · Started · Target; Project is a dashed-underline picker showing the project name), left zone 440px, subline `122 TASKS · 108 DONE · 10 CANCELLED · 3 IN FLIGHT · 1 BLOCKED`.

**Body**: two columns ≥1100px content width — `minmax(0,1fr) minmax(320px,420px)`; the aside is `--p-paper` with a left hairline. Stacks below 1100px (aside gets a top hairline, transparent bg).
- Left: `/ TASKS · 122 · SHAREPOINT MIRROR` + the same three-way filter + `OPEN BOARD →`; table with the same column tiers (driven by the left column width); footers as above; mirror footnote `Mirrors two-way to the ToDos list columns · Last sync Today · 19:11`. Then `/ DISCUSSION` (composer card + stream; comments as cards, events as one-liners) — unchanged in behaviour from `timeline.tsx`.
- Aside: `/ DOCUMENTS & LINKS` (bordered list rows 38px: accent icon, name, `MS LIST`/`LIBRARY`/`GITHUB` source tag, arrow — includes `bucket.repos`), `/ MILESTONES · n` (dotted-rule rows, outline pill Active/At risk/Done/Upcoming), `/ RISKS · n` (title, mitigation 11px, likelihood/impact/owner tags, `● SYNCED`), `/ TRACEABILITY` (satisfied / in flight / gap outline pills + `Quality Ledger · read-only`).

## Interactions & state
- `lens: "overview" | "initiatives"` (project only).
- `filter: "open" | "human" | "all"` — default `open`; switching clears per-section overrides and expands all sections.
- `collapsed: Record<bucketId, boolean>` (default: collapsed only when the filtered pool is empty); `more: Record<bucketId, boolean>` (row cap 8); `closedOpen: Record<bucketId, boolean>` (per-section closed reveal, Outstanding mode only).
- Health select / target input / owner picker use the existing mutation hooks (`setHealth`, `setTarget`, owner `NtmField`); `prd` uses `PrdLinkField`.
- Hover: cards/tiles darken border or fill `--p-paper-2`; links underline with 2px offset; no shadows, no motion beyond 120–180ms colour transitions (`--p-ease`).
- Focus: 2px `--p-accent` outline, 1px offset.

## Design tokens (all existing — `--p-*`)
Surfaces `--p-paper #FBFAF6` · `--p-paper-2 #ECEFE9` · `--p-canvas #F5F3EC` · `--p-rail #EEEBE3`. Ink `--p-ink #1B1A17` · `--p-ink-2 #3A3833` · `--p-muted #6B665B`. Hairlines `--p-grid rgba(27,26,23,.16)` · `--p-grid-2 rgba(27,26,23,.08)`. Accent `--p-accent #244A39` (`--p-accent-soft #BCCFBF`). Status `--p-ok #5C7A55 / --p-ok-text #48603F` · `--p-warn #C99340 / --p-warn-text #7E5C0F` · `--p-info #5B7B91 / --p-info-text #476378` · `--p-hot #52606E / --p-hot-text #46535F` (destructive only — Blocked uses warn, not hot). Type: Mazius Display (numbers, h1), Inter (body 12.5–13px), JetBrains Mono (labels/IDs, uppercase 0.12–0.22em tracking). Radii: cards 4px, chips 3px, pills/buttons 0. Spacing rhythm 4 · 8 · 14 · 22 · 26.

## Assets
Lucide icons only (`hand`, `file-text`, `square-check`, `circle-dot`, `list-checks`, `map`, `flag`, `triangle-alert`, `folder`, `arrow-up-right`, `chevron-down/right`, `pencil`, `trending-up/down`, `calendar-x`, `minus`, `eye`, `eye-off`, `corner-left-up`). Brand mark + wordmark from `public/brand/`. Mazius webfonts from `public/fonts/mazius/`.

## Known deltas from the sample data
- Sample `project.target` is Dec 18 and WMS target Nov 20 so the pace chip reads "Ahead"; the repo seed has earlier targets — the chip will show `TARGET PASSED` there, which is the intended behaviour.
- "Needs a human" in the mock uses `human: "verify"` + `blocked` flags; map to `approvalGates` / `gate.blocked` / `hasHumanAccountableOwner` in the real model.
