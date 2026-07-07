# PLX_MC · Design-System Alignment Pass — 2026-07-06

Full-portal alignment of the Mission Control surface against the PLX Design
System (`--p-*` tokens, `docs/design-system/RESPONSIVE.md`,
`docs/product/DESIGN_TOKENS.md`). Branch `cursor/plx-ds-alignment-7c9a`.

## Verification evidence

| Gate | Command | Result |
|---|---|---|
| G1 token conformance | `ui-conformance-scan.sh --files "<changed skin files>"` | PASS — 0 raw-color findings |
| G3 responsive + G4 a11y | `npx playwright test e2e/ui-*.spec.ts` (chromium · tablet 820 · mobile 393) | 93 passed |
| Typecheck / lint | `npm run typecheck && npm run lint` | exit 0 (lint problem count unchanged vs `main`: 225 pre-existing) |
| Preflight | `./scripts/preflight.sh --mode pre-commit` / `--mode pre-push` | exit 0 (see PR) |

Screenshots: `before/` and `after/` in this bundle, one folder per surface,
one PNG per viewport (chromium / tablet / mobile-chrome), captured by the G3
specs from identical fixtures.

## Audit checklist — every module/page reviewed

| Module / surface | File(s) | Issues found | Fix applied |
|---|---|---|---|
| Shell chrome (topbar · sidebar · page header) | `mc-app.css`, `chrome.tsx` | 38 literal font-sizes/trackings; bespoke 900px breakpoint; sidebar/topbar controls ~30px on touch tiers; no branded keyboard-focus baseline; topbar overflow risk at 393px | Tokenized type/tracking; breakpoint → canonical 1024; ≥44px touch targets at ≤1024; `.mc :is(button,a,…):focus-visible` accent-ring baseline; ≤640 topbar collapse (ws switcher hides per RESPONSIVE.md §3) |
| Inbox (home) | `mc-app.css` | Literal sizes; 26px gutter hard-coded | Tokenized; gutter → `var(--p-gutter)` (14px on phone) |
| Board · List · Timeline | `mc-views.css`, `work-views.tsx` | 17 literal sizes/trackings/radii; 26px gutters | Tokenized (`--p-text-ui/-lede/-cap/-cap-2`, `--p-track-*`, `--p-radius*`, `--p-gutter`) |
| Filter bar / saved views | `mc-views.css` | Literal sizes | Tokenized |
| Task detail | `mc-task.css` | 48 literals; bespoke 1100px breakpoint; no phone tier (28px paddings, 2-up conflict/screenshot grids crush) | Tokenized; breakpoint → 1024; new ≤640 block (gutter, stacked `.shots` / `.sor-conflict .scb`) |
| Sync console · Files · Repos · Meeting intake | `mc-record.css` | 36 literals; **zero breakpoints** — 4-up registry grid, 5-col files table, 2-sided conflict rows crushed/overflowed below desktop | Tokenized; new ≤1024 block (regs 2-up, files table = only h-scroll surface, `min-width:680px`); new ≤640 block (regs 1-up, conflict sides stack, repo body indent → gutter) |
| Bucket detail · Traceability · Agent feed | `mc-overview.css` | 28 literals; bespoke 760px breakpoint; 5-up facts strip + 2-col body had no tablet/phone reflow | Tokenized; 760 → canonical 640; new tiers: facts 5→2→1, body 2→1 |
| Insights (KPIs · donut · bars) | `mc-charts.css` | 1 literal tracking | Tokenized (28/30px KPI/donut display sizes kept — one-off data-viz sizes, documented below) |
| Command palette · New Task modal · pickers | `mc-authoring.css`, `command-palette.tsx` | 17 literals; bespoke 840px breakpoint; modals floated mid-screen on phone; ⌘K missing nav entries for 4 sidebar destinations | Tokenized; 840 → 1024; ≤640: modals full-screen, top-anchored, square corners (RESPONSIVE.md §4); nav entries added for Loop ledgers / SOP guide / Skills directory / AI Spend |
| Loop ledgers | `mc-loop-ledgers.css` | Bespoke 960px + 760px breakpoints; 2 literal stat sizes | Breakpoints → 1024 (stats + table h-scroll wrappers, inert when content fits); `--p-text-stat` |
| SOP guide | `mc-governance-sops.css` | 2 literal sizes (already canonical tiers) | `--p-text-stat`; reader sizes kept (editorial serif measure) |
| Skills directory | `mc-skills-directory.css` | `box-shadow: var(--p-shadow-sm)` referenced an **undefined token** — the active-tab lift silently rendered nothing | Defined `--p-shadow-sm` in `mc-surface.css` (elevation family complete) |
| AI Spend | `ai-spend.tsx`, `mc-app.css` | `mc-empty` class never existed — "Coming soon." rendered as a bare unstyled paragraph (see screenshot) | Rebuilt on the standard `.empty` chassis (glyph ◎ + serif h3 + measure-capped p); pruned the orphaned `.mc-empty-spaced` rules |
| Sign-in | `mc-auth.css` | No phone tier (32px paddings at 393px) | ≤640 block: wrapper/card padding tighten per RESPONSIVE.md §2 |
| Tokens / surface layer | `mc-surface.css`, `brand-tokens.css` | Portal mirror untouched (correct); missing shadow-sm; recurring off-scale sizes un-tokenized | ADR-004 addendum tokens (below); phone `--p-gutter` override |
| Docs | `DESIGN_TOKENS.md`, `ADR-004` | Spec still referenced the retired 1100px pivot | Updated to canonical 1024/640; ADR-004 addendum records the new tokens |

## The three biggest systemic problems (and root fixes)

1. **The type scale existed but the skin didn't use it.** ~190 declarations in
   `mc-*.css` hard-coded font-sizes/trackings/radii the prototype shipped with.
   Root fix: extended the ADR-004 surface-token layer with the seven
   instrument-panel sizes the spec actually mandates (`--p-text-page/-stat/
   -lede/-ui/-cap/-cap-2`, `--p-text-page-tablet`), then replaced every literal
   with a token. Value-preserving except four deliberate ≤1px snaps
   (13.5→13, 11.5→12, radius 5→6). Result: one source of truth; a future
   scale change is a one-line edit.

2. **Five bespoke breakpoints instead of the canonical two.** 900/960/1100/840/
   760px pivots had accreted per-lane, and two whole lanes (`mc-record`,
   `mc-auth`) had none — the system-of-record screens genuinely broke below
   desktop. Root fix: normalized everything onto the governed 1024/640 pair
   (RESPONSIVE.md §1 forbids new breakpoints), and added the missing tablet +
   phone tiers for record/task/bucket/auth lanes. Tables are now the only
   horizontal-scroll surfaces; the page never scrolls sideways (G3-verified at
   820 and 393px).

3. **Spacing/touch ergonomics were per-screen accidents.** The 26px screen
   gutter was pasted into ~20 padding declarations, phones kept desktop
   padding, touch targets sat around 30px, and keyboard focus styling was
   whichever component remembered to define it. Root fix: `--p-gutter` token
   (26px → 14px at ≤640 via a single override), a ≥44px `min-height` rule for
   all chrome controls at ≤1024, and one `.mc :focus-visible` accent-ring
   baseline that component-specific rings still override.

## New tokens proposed back to the central PLX DS

See the ADR-004 addendum for full rationale. Upstream candidates
(surface-agnostic): `--p-shadow-sm/-md/-lg`, `--p-gutter`. Surface-local (keep
in `mc-surface.css`): the seven MC type-scale tokens. No Portal `--p-*` value
was changed; `brand-tokens.css` (runtime mirror) is untouched.

## Follow-up fixes (same pass, second commit series)

- **Command palette parity with the sidebar** — added the four missing nav
  entries (Loop ledgers ◰ · SOP guide § · Skills directory ◈ · AI Spend ◎) so
  every sidebar destination is reachable from ⌘K.
- **`mrp-design.css` out of the runtime tree** — the MRP surface port was
  never imported by the app but sat in `src/styles/` with 28 raw hex values
  inside the token-scan surface. Relocated to
  `docs/design-system/source-snapshot/mrp/` (with the frozen MRP handoff
  source) and updated all references (mc-surface comment, ADR-004,
  HANDOFF-README). Move it back + import it if MRP chrome is ever adopted.

## Deliberate non-changes (noted, not fixed)

- One-off display sizes kept as literals: 35px New-Task title input, 30px task
  h1, 26px modal h2, 28/30px chart KPI/donut totals, 17px board column count,
  15/15.5px card-title/reader sizes, and sub-8px micro-decorations (7/7.5px
  tags) — each a single deliberate prototype size; blessing them as tokens
  would just relocate the entropy.
