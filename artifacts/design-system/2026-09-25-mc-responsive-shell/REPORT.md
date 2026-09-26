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
| ≥2200 | — | Optional pinned live column — Agent activity or Approvals, the user's pick (spec Q5, `mc.live.kind`); steps aside on the screen it would repeat |

Plus: one layer stack (`use-layer.ts`) — Esc closes only the topmost layer, after any field inside it
has handled Esc; focus returns to its trigger; the shell-owned layers (drawer, More sheet, overlay pane
from 641) also wrap Tab and lock scroll, while ⌘K and the modals keep their own focus handling and only
join the stack. Also: skip link, static workspace label (Q9), ⌘K hint hidden on touch, a fixed-height
offline banner whose slot is reserved while the store is on seed data, honest nav badges
(n · n+ · —; Needs and Approvals are lower bounds until PR 2), a sync pill that is a real link and never
says "Synced" before the server answers, Lucide nav icons (Q8).

CSS: `src/styles/mc-shell.css` is the only MC file allowed new width media queries (min-width
641 / 1025 / 1600 / 2200); legacy files keep their max-width blocks until PRs 2–7 convert them. Every
existing MC stylesheet is imported into `@layer mc.legacy` in its original order; the shell lives in
`@layer mc.shell`.

## Adversarial review

Three rounds, every finding refuted-or-kept by an independent skeptic agent; each confirmed defect was
fixed with a regression test that failed first.

- **Round 1** (5 reviewers: TSX correctness, CSS, a11y, spec compliance, tests/governance) — 8 fixed in
  `a739942`: phone pane under its own scrim; hiding the pane with a selection opened an overlay; offline
  counts treated as confirmed; pre-adoption render overwrote tab memory; FAB over the phone pane; phone
  drawer lists laid out as one clipped row (`.mc .sub` collision); `:is()` specificity shrank icons;
  doubled desktop current-item rule.
- **Round 2** — 13 fixed in `7a955e8` (+ `24a2e27`): Esc in the overlay pane pre-empted fields (mention
  list, comment edit); phone pane covered the chrome and left the page focusable (now `inert`); focus
  dropped after closing the empty pane / unpinning; g-chords fired under open layers; toast dismiss and
  shell buttons under 44px on touch (the dismiss target is a pseudo-element so toasts keep their size);
  Needs / Approvals badges claimed exact; sync pill was a button; Q5 picker; docs accuracy; spec
  hardening.
- **Round 3** (focused re-review of rounds 1–2) — 7 fixed in `db15926`: the pane layer re-pushed itself
  when crossing 641 (rotation); Back to a selection after hiding the pane opened an overlay; the live
  picker could hide its own column; the live column mounted (and fetched) below 2200; a decision in the
  live Approvals column left Home's section stale; `/` pulled focus out of layers; badge `:where()`.

## Verification

| Check | Command | Result |
|---|---|---|
| Layer wrap is pixel-neutral | scratch Playwright sweep, 25 screens × 393/820/1440 + /signin, /welcome, dark, open palette, `maxDiffPixels: 0` vs `main` | 96 / 96 identical (after fixing one cascade inversion, see LESSONS 2026-09-25) |
| Layers hold in the production build | `npm run build`, then `next start` + a computed-style probe on `.mc-top .search` (legacy rule has higher specificity than the shell rule) | shell value wins (`--p-canvas`) |
| New shell e2e | `npm run test:e2e -- e2e/ui-shell-responsive.spec.ts` | (final run pending) |
| Drawer e2e | `npm run test:e2e -- e2e/nav-drawer.spec.ts` | 3 passed |
| Full e2e (3 projects) | `npm run test:e2e` | (final run pending; baseline `main`: 227 passed, 5 skipped) |
| Unit | `npx vitest run` | (final run pending); 3 Docker-only failures expected = `tests/routing-postgres.test.ts` (needs Docker; fails identically on `main` in this container) |
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
  (More → All screens) · **Q5** one live column, the user picks — Agent activity by default, or
  Approvals · **Q8** Lucide in PR 1 (`lucide-react` added, named imports) · **Q9** static workspace
  label.
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
- The layer Esc listener is on the document bubble phase (fields inside a layer get Esc first).
- The pane width is inline only once the user has chosen one, so the ≥2200 default (520) applies.
- Theme preference (system / light / dark, persisted, pre-paint) stays in PR 8; the More sheet exposes
  the existing dark-mode toggle.

## Known follow-ups (not in PR 1's scope)

- **Board toolbar at 360px:** the Group-by segmented control is 3px wider than the viewport — on
  `main` too (measured). PR 3 (Board).
- **Task detail in the pane** uses a pane-scoped single-column override until PR 4 moves it to
  `@container pane`; **Agent activity / Approvals** keep their page headers in the live column until
  PR 7.
- **Offline-banner slot and the live path:** reserving the slot while the store is on seed data makes
  the offline path shift-free (tested). When the first load *succeeds*, the slot collapses as the
  seed fixtures give way to live data; screens that show skeletons while loading (PRs 2–7) will make
  that collapse coincide with the skeleton swap.
- **Badge exactness:** Needs and Approvals are lower bounds (`n+`, or `—` for a lower bound of 0)
  because their pages read other endpoints; per-source exactness is PR 2 (needs-me).
- **Desktop collapse-to-rail** (spec `shell.perTier` Desktop) is not built; not a PR 1 acceptance item.
- **ADR number:** "ADR-005" also names the Portal's authority ADR; the new ADR says so. Renumber if
  preferred.
