# MC responsive redesign — PR 1: Shell, layout tokens, ADR-005

**Task:** TASK-1994 · **Checkout:** `dsp_muhhh40fqjvhlp` · **Accountable owner:** Vince Alton
**Spec:** MC responsive spec v2.0-draft (`mc-responsive-spec.json` → `prs[0]`), grounded in `main` @ 2faa2a2
**Decision record:** `docs/design-system/decisions/ADR-005-mc-wide-and-ultrawide-tiers.md`

## What changed

| Tier | Before (`main`) | After |
|---|---|---|
| <641 | Top bar wraps to two rows; hamburger → 280px drawer | 52px top bar (mark · title · search · avatar); bottom tabs My work · Plan · Knowledge · More with tab memory; group strip; New-task FAB; More sheet; drawer via More → All screens |
| 641–1024 | Hamburger → 280px drawer | 64px icon rail (every group's icons, accessible names) → 320px labelled drawer |
| ≥1025 | 216px sidebar | 240px sidebar (spec Q1) |
| ≥1600 | Single stretched column; a task always leaves the list | Persistent, resizable context pane on Board / List / My tasks / Approvals; opening a task fills it; selection in the URL |
| ≥2200 | — | Optional pinned Agent activity column (spec Q5) |

Plus: one layer stack (Esc closes only the topmost layer; focus returns to its trigger; Tab wraps;
scroll locks), skip link, static workspace label (Q9), ⌘K hint hidden on touch, a fixed-height
offline banner whose slot is reserved while the store is on seed data, honest nav badges
(n · n+ · —), a sync pill that never says "Synced" before the server answers, Lucide nav icons (Q8).

CSS: `src/styles/mc-shell.css` is the only MC file with width media queries (min-width
641 / 1025 / 1600 / 2200). Every existing MC stylesheet is imported into `@layer mc.legacy` in its
original order; the shell lives in `@layer mc.shell`.

## Verification

| Check | Command | Result |
|---|---|---|
| Layer wrap is pixel-neutral | scratch Playwright sweep, 25 screens × 393/820/1440 + /signin, /welcome, dark, open palette, `maxDiffPixels: 0` vs `main` | 96 / 96 identical (after fixing one cascade inversion, see LESSONS 2026-09-25) |
| Layers hold in the production build | `npm run build`, then `next start` + a computed-style probe on `.mc-top .search` (legacy rule has higher specificity than the shell rule) | shell value wins (`--p-canvas`) |
| New shell e2e | `npm run test:e2e -- e2e/ui-shell-responsive.spec.ts` | 25 passed |
| Drawer e2e | `npm run test:e2e -- e2e/nav-drawer.spec.ts` | 3 passed |
| Full e2e (3 projects) | `npm run test:e2e` | 252 passed, 5 skipped, 0 failed (baseline `main`: 227 passed, 5 skipped) |
| Unit | `npx vitest run` | 1855 passed; 3 failed = `tests/routing-postgres.test.ts` (needs Docker; fails identically on `main` in this container) |
| Python | `.venv/bin/python -m pytest -q` | 132 passed |
| Preflight | `./scripts/preflight.sh --mode pre-commit` | all checks passed (policy gates, ruff, format, canary, typecheck, lint) |
| Typecheck / lint | `npm run typecheck` · `npm run lint` | exit 0 · 0 errors (11 pre-existing warnings, same as `main`) |

The e2e runs above used a scratch Playwright config that points `launchOptions.executablePath` at the
container's preinstalled Chromium (the pinned Playwright expects a newer headless-shell revision than
the container ships); the repo's config is unchanged.

What `e2e/ui-shell-responsive.spec.ts` asserts: nav form at 393 / 820 / 1440 / 2560; axe
(wcag2a/aa, 21a/aa) on the shell chrome at all four widths, with the More sheet and drawer open, and
in dark mode, allowlist key `/shell` absent (strict); no horizontal page scroll at
360 / 393 / 820 / 1024 / 1440 / 1600 / 1920 / 2560 / 3440; skip link first and focusing main at every
tier; Esc closes the palette over an open drawer without closing the drawer, then the drawer, focus
back on its toggle; More sheet Tab trap and focus return; overlay pane Esc + focus back to the card
after narrowing from 1920 to 1440; pane resize by keyboard (16px, Home/End, 360–640) and persistence;
pane hide/show persistence; live column pin/unpin persistence and dormancy below 2200; tab memory;
≥44×44 shell targets on phone and tablet; `aria-current` on sidebar, rail, tabs and strip; offline
banner sits under the top bar, is 44px, and causes CLS < 0.01.

## Open questions assumed (spec `questions[]`)

- **Q1** sidebar 240 · **Q2** no phone index routes — Projects / Initiatives are in the drawer
  (More → All screens) · **Q5** live column = Agent activity · **Q8** Lucide in PR 1
  (`lucide-react` added, named imports) · **Q9** static workspace label.
- Not exercised by PR 1: Q3, Q4, Q6, Q7, Q10.

## Deviations from the handoff reference code (deliberate)

- No `@media (min-width: 900px / 1280px)`: those top-bar pivots are `@container chrome` queries.
- No app-wide `.mc .av`, `.mc .ic`, `.mc .badge` rules: shell rules on generic class names are scoped
  to shell surfaces (screens already use `.ic`).
- No `--p-focus` shorthand token (the repo already uses `--p-focus` as a colour).
- The shell's `<main>` is `main#mc-main.mc-stage`: every screen already renders `div.mc-main` as its
  root.
- Preferences use `useSyncExternalStore` (the repo lints `react-hooks/set-state-in-effect` as an error).
- `role="separator"` is on a focusable `div`, not a `<button>`.
- The pane width is inline only once the user has chosen one, so the ≥2200 default (520) applies.
- Theme preference (system / light / dark, persisted, pre-paint) stays in PR 8; the More sheet exposes
  the existing dark-mode toggle.

## Known follow-ups (not in PR 1's scope)

- **Board toolbar at 360px:** the Group-by segmented control is 3px wider than the viewport — on
  `main` too (measured). PR 3 (Board).
- **Task detail in the pane** uses a pane-scoped single-column override until PR 4 moves it to
  `@container pane`; **Agent activity** keeps its page header in the live column until PR 7.
- **Offline-banner slot and the live path:** reserving the slot while the store is on seed data makes
  the offline path shift-free (tested). When the first load *succeeds*, the slot collapses as the
  seed fixtures give way to live data; screens that show skeletons while loading (PRs 2–7) will make
  that collapse coincide with the skeleton swap.
- **Badge exactness:** PR 1 renders unknown as "—" and the needs badge as a lower bound when routing
  proposals are fetched separately; per-source exactness is PR 2 (needs-me).
- **Desktop collapse-to-rail** (spec `shell.perTier` Desktop) is not built; not a PR 1 acceptance item.
- **ADR number:** "ADR-005" also names the Portal's authority ADR; the new ADR says so. Renumber if
  preferred.
