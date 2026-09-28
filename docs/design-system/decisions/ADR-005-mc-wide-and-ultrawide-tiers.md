# ADR-005: Mission Control wide and ultra-wide layout tiers (breakpoint waiver)

**Status:** Proposed (TASK-1994, MC responsive redesign PR 1)
**Date:** 2026-09-25
**Owner:** Vince Alton
**Extends:** ADR-003 (surface-local layout decisions), ADR-004 (MC surface tokens)
**Waives:** `docs/design-system/RESPONSIVE.md` §1 "Do not introduce new breakpoints without a written waiver"

> Not to be confused with the Portal's ADR-005 (design-system authority and propagation), which
> `design-system/README.md`, `scripts/check-ds-pin.py` and `preflight.sh` cite. That decision lives
> upstream in `plx-customer-portal`; this one is Mission Control's local layout decision, numbered in
> this folder's sequence (ADR-001–004).

## Context

RESPONSIVE.md defines three tiers: Phone ≤640, Tablet 641–1024 and Desktop ≥1025. Operators and owners
keep MC open all day on 1920–3440px monitors. Above about 1600px, MC stretches single columns edge to edge.
There is no place to read a task without leaving the list, and reading columns grow past a comfortable
line length. `flex-wrap`, `clamp()` and `minmax()` can't fix this, because what has to change is the number
of panes, not how the content reflows.

On phone, the ≤1024 hamburger drawer (Wave 6) hides every destination behind two taps and puts navigation
at the top of the screen, out of thumb reach.

## Decision

1. **Authoring is mobile-first.** Base styles are the phone. Tiers are `min-width` queries at **641**,
   **1025**, **1600** and **2200**. 641 and 1025 are the existing RESPONSIVE.md pivots, unchanged.
2. **Shell forms per tier.**
   - Phone (<641): top bar (mark, screen title, search, avatar), bottom tabs *My work · Plan · Knowledge ·
     More* (each remembers its last screen), a group strip under the top bar, a More sheet for Admin &
     health and the full drawer (Projects, Initiatives).
   - Tablet (641–1024): a 64px icon rail that expands into a labelled drawer of `--p-drawer-w`.
   - Desktop (≥1025): the 240px labelled sidebar.
3. **Wide, `(min-width: 1600px)`:** on collection screens (Board, List, My tasks, Approvals) the context
   pane becomes a persistent grid column: `nav | main | pane`. The pane is
   `clamp(var(--p-pane-min), var(--p-pane-w), var(--p-pane-max))` (360 / 440 / 640), user-resizable by
   dragging its separator or with ←/→ (16px) and Home/End, and its width is remembered (`mc.pane.w`). It can
   be hidden, and that is remembered too (`mc.pane.hidden`); a selection arriving in the URL (Back, a deep
   link) shows it again rather than opening an overlay. Opening a task from a collection screen fills
   the pane instead of leaving the collection; the page is still one click away ("Open page").
4. **Ultra-wide, `(min-width: 2200px)`:** adds an optional fourth column, `--p-live-w` (340px), that the
   user can pin (`mc.live.pinned`). It holds Agent activity or Approvals — the user picks, Agent activity by
   default (spec Q5; `mc.live.kind`) — and steps aside on the screen it would repeat. The default pane width
   becomes 520px.
5. **Content caps.** Main content is capped at `--p-content-max` (1360px), and reading text at
   `--p-read-max` (72ch). Boards and the timeline are exempt. At ≥1700px of main-container width, the
   9-stage board may use a 168px compact-card floor instead of RESPONSIVE.md §4's 240px pipeline minimum
   (spec Q6). Screens adopt these in PRs 2–7.
6. **Scope of width queries.** Width media queries are allowed only in `src/styles/mc-shell.css`, and only
   for the shell: nav form, tabs, pane persistence, sheets vs dialogs, and top-bar slots. Everything inside
   `main` and the pane uses `@container` (`main`, `pane`), plus capability queries (`hover`, `pointer`,
   `prefers-reduced-motion`). Top-bar slots that pivot at other widths (the workspace label at 900, the
   "Mission Control" wordmark at 1280) use `@container chrome`, not new media queries. The legacy MC
   stylesheets keep their existing max-width blocks until PRs 2–7 convert them; no new width query goes
   anywhere but `mc-shell.css`.
7. **Cascade layers.** `@layer mc.tokens, mc.legacy, mc.shell, mc.screens, mc.state`. Every existing MC
   stylesheet is imported into `mc.legacy` in its original order (`src/app/globals.css`), so screens keep
   their exact cascade while the shell layer supersedes them without specificity fights. Screens move to
   `mc.screens` as PRs 2–7 convert them. The order statement sits at the top of `mc-shell.css`, which
   `globals.css` imports first (Turbopack emits `@import`s ahead of the importing file's own rules).
8. **Surface-local layout tokens** are added in `mc-surface.css`: `--p-top-h`, `--p-tabs-h`,
   `--p-safe-t/-b`, `--p-rail-w`, `--p-side-w`, `--p-drawer-w`, `--p-sheet-max`, `--p-pane-w/-min/-max`,
   `--p-live-w`, `--p-content-max`, `--p-read-max`, `--p-banner-h` and `--p-touch`. `mc-shell.css` derives
   `--p-chrome-h` (top bar + safe area + the banner row when present) for everything that sticks under the
   chrome. No colours are added and no Portal token changes.

## Amendments to existing MC rules

- **ADR-004 addendum, `--p-gutter`:** the 26px → 14px step at 640px becomes
  `clamp(14px, 2.4vw + 4px, 26px)` — 14px at 390, 26px from about 916px, with no media query. This is the one
  existing MC token whose value changes; it is MC-local (ADR-004), not a Portal token.
- **RESPONSIVE.md §2 (phone drawer `min(280px, 85vw)`):** the MC drawer is `--p-drawer-w: min(320px, 85vw)`.
- **RESPONSIVE.md §4 (side drawers: desktop "split layout"):** below 1600 the MC pane is an overlay — a
  sheet of at most 560px on tablet, 480px on desktop, a full-screen page on phone; it splits only ≥1600.
- **RESPONSIVE.md §7.2 (desktop-first, two max-width blocks per file):** new MC CSS is mobile-first. Legacy
  files keep their max-width blocks until their PR converts them.
- **RESPONSIVE.md §9 (container queries "later"):** adopted for MC now.
- **Sidebar width:** 240px, the RESPONSIVE.md §2 value (the code had 216; spec Q1).
- **ADR-003 ("RESPONSIVE.md applies unchanged"):** it applies, as amended by this ADR.

## Why 1600 and 2200

- **1600:** 240 (sidebar) + 360 (minimum pane) leaves about 1000px for main. That is the smallest main width
  where the dense List table (min 720) and a 3-band board both fit without scrolling beside a pane.
- **2200:** the fourth column needs 340px more without pushing main below `--p-content-max` × 0.8.

## Rules

- Below 2200, the live column hides. The pin preference is kept but dormant.
- Below 1600, the pane becomes an overlay layer: Esc or the scrim closes it and focus returns to what opened
  it. Below 641 it is a page between the chrome and the tabs: no scrim, the covered page is inert, the top
  bar and offline banner stay visible. Selection lives in the URL (`taskId`), so collapsing it loses no
  state.
- Main never goes below 560px: the pane is clamped to 640, so at 1600 main keeps ≥720; with the live column
  at 2200, 240 + 640 + 340 leaves ≥980.
- Every layer (drawer, More sheet, overlay pane, ⌘K, modals) shares one stack (`use-layer.ts`): Esc closes
  only the topmost — after any field inside it has handled Esc itself — and focus returns to its trigger.
  The shell-owned layers (drawer, More sheet, overlay pane from 641) also wrap Tab and lock the body scroll;
  the ⌘K palette and the New … modals keep their own Esc and focus-in and only join the stack.
- Tests: the shell spec (`e2e/ui-shell-responsive.spec.ts`) asserts the nav form and axe at
  **393 / 820 / 1440 / 2560**, and no horizontal page scroll from 360 to 3440. The existing per-screen
  specs keep their 393 / 820 / 1280 projects.

## Consequences

- RESPONSIVE.md stays authoritative for 640 and 1024, as amended above. This ADR is the only other source of
  width queries for MC.
- The Portal is unaffected. These are MC-only layout tokens under `.mc`, and `brand-tokens.css` is not
  edited.
- **Proposed for upstream:** `--p-gutter` as `clamp()` and `--p-read-max` are surface-agnostic and could
  join the Portal `tokens.css`.
