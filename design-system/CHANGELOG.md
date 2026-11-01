# PLX Design System changelog

## 1.7.0 — 2026-10-31

**The vibrant status set, and violet for figures entered by hand.** Decision 9
(Vince, TASK-4387) replaces the earth-toned status palette. Each colour has one
meaning, and every status shows its shape and its word as well. Amber means at
risk and nothing else; forest stays the brand accent and never means a status.
[ADR-012](../docs/design-system/decisions/ADR-012-vibrant-status-set.md)
supersedes ADR-001 §3. Ten value changes and two new tokens, `--p-hand` and
`--p-hand-text`, in `tokens.css` and `tokens.ts`. No renames or removals.

| Token | Was | Now | Shape · meaning |
|---|---|---|---|
| `--p-ok` / `-text` | `#5C7A55` / `#48603F` | `#2BB062` / `#16723C` | circle · on track, ready |
| `--p-warn` / `-text` | `#C99340` / `#7E5C0F` | `#D97A00` / `#8A4B00` | square · at risk, not planned |
| `--p-hot` / `-text` | `#52606E` / `#46535F` | `#A61B1B` / `#A61B1B` | triangle · behind, late; destructive |
| `--p-info` / `-text` | `#5B7B91` / `#476378` | `#2F6FDB` / `#1F56B8` | outlined circle · information, planned |
| `--p-hand` / `-text` | new | `#5B3FD1` / `#4B2FB8` | diagonal hatch · entered by hand |
| `.dark --p-ok` | `#7EA372` | `#9BE9BB` | |
| `.dark --p-warn` | `#D9A85C` | `#FFC57E` | |
| `.dark --p-hot` | `#8FA0B0` | `#FE828D` | |
| `.dark --p-info` | `#7A9DB3` | `#61B0FF` | |
| `.dark --p-hand` | new | `#EDBDFC` | |

Dark text shades stay `var(--p-<status>)`, and `--p-hand-text` follows the same
rule.

**Checks.**

- **Light text.** Every text shade holds 4.5:1 on every light surface and on its
  own 12% chip fill. `--p-ok-text` is one step darker than the proposed
  `#17733D`, which read 4.48:1 on its chip over `--p-rail`.
- **Dark.** Every dark value holds 4.5:1 on every dark surface, MRP's
  `#2A3329` included, and on its own chip. White on the dark destructive
  button's 60% `--p-hot` fill holds 4.54:1 over each of those surfaces.
- **Colour blindness.**
  - Under deuteranopia, violet and blue are ΔE 5.5 apart in light mode, and
    the worst dark pair is ΔE 7.6 (OKLab ×100).
  - The light green and amber fills are 2.7:1 and 3.0:1 on paper.
  - So a status is never colour alone: its shape and its word carry it.

**What changes on screen.** Every surface that uses the status tokens changes
colour. In the portal, 108 places in 23 files coloured text with a base status
token (`color: var(--p-ok)`, `text-[var(--p-ok)]`); they now use the `-text`
shades, as the token comments always said, because green text on the new fill
would read 2.68:1. Fills, borders and marks keep the base tokens. Five solid
badges and buttons that carried a label on a status fill now fill with the
`-text` shade and set the label in `--p-paper`; white on the new green fill is
2.8:1. The chief-of-staff panel and the SoapBox deck pin their own palettes and
keep them. `npm run audit:tokens` now fails on a base status token used as a
text colour outside those pinned files. Inside `.brand-plx`, shadcn's `--destructive` maps to `--p-hot`, so
destructive buttons and errors turn red. Hard-coded status hex values, such as
the email theme, keep their old colours until they move to the tokens. Medium
severity (ADR-003) and Open tickets (ADR-004) still render amber; they move in
follow-ups.

## 1.6.0 — 2026-10-29

**Sizes for the v2 sidebar.** Additive only: 5 new `--p-shell-*` size tokens,
and the same 5 in the `shell` export of `tokens.ts`. No existing value changed,
and no colour was added. The ADR-011 amendment for the v2 sidebar
(`docs/design-system/decisions/ADR-011-plx-shell-contract.md`, Width and Row
grid, revised by TASK-4010) is the contract. TASK-3959 ships it.

| Token | Value | Use |
|---|---|---|
| `--p-shell-sidebar-min` | 232px | narrowest sidebar a person can drag to |
| `--p-shell-sidebar-max` | 400px | widest sidebar |
| `--p-shell-sidebar-snap` | 160px | released below this, the sidebar collapses to the rail |
| `--p-shell-col-count` | 40px | row grid: count column |
| `--p-shell-col-action` | 24px | row grid: action column |

The default width stays `--p-shell-sidebar`, 248px. Until an app pins 1.6.0, it
writes each value as the fallback, for example `var(--p-shell-col-count, 40px)`.

**Kit fix.** In the brand kits for 1.4.0 and 1.5.0, `tokens.css` had a
secret-scan pragma written as a comment inside the header's comment. Its `*/`
closed the header early, so a browser dropped the first `:root` rule, the light
palette. The 1.6.0 kit writes the pragma as plain text inside the header.
`design-system/tokens.css` and the portal's runtime copy never had it.

## 1.5.0 — 2026-10-24

**Shell sizes for the shared PLX navigation shell.** Additive only: 15 new
`--p-shell-*` size tokens, plus a matching `shell` export in `tokens.ts`. No
existing value changed, and no colour was added. ADR-011
(`docs/design-system/decisions/ADR-011-plx-shell-contract.md`) is the contract
both MRP and Mission Control implement: zones, row states, behaviour, keys and
responsive forms.

| Token | Value | Use |
|---|---|---|
| `--p-shell-topbar` | 48px | top bar |
| `--p-shell-sidebar` | 248px | expanded sidebar |
| `--p-shell-rail` / `-rail-touch` / `-rail-floor` | 56 / 64 / 84px | collapsed rail: pointer, touch, floor mode |
| `--p-shell-row` / `-row-touch` / `-row-floor` | 28 / 44 / 48px | row heights |
| `--p-shell-row-child` / `--p-shell-indent` | 26 / 34px | work-tree child rows |
| `--p-shell-group-head` | 20px | group heading |
| `--p-shell-inset` / `--p-shell-zone-gap` | 8 / 10px | spacing |
| `--p-shell-icon-rail` | 18px | rail icons (row icons keep `--p-icon`) |
| `--p-shell-flyout` | 264px | flyout width |

Consumers pick the tokens up through their pinned bundle. Nothing renders
differently until an app's navigation phase uses them.

## 1.4.0 — 2026-09-01

**Office gets the real brand faces.** No token values changed. The Office
templates previously declared Georgia and Segoe UI, a documented substitution
that existed because the package only shipped web fonts (woff2) that Office
cannot load. `fonts/desktop/` now carries installable cuts of all three brand
families, so the templates name the real faces.

| Face | Role | Cuts |
|---|---|---|
| Mazius Display | headings (`--p-font-serif`) | Regular, Bold, Italic |
| Mazius Display Extra Italic | display accent | Regular, Bold |
| Inter | body (`--p-font-sans`) | Regular, Bold, Italic, Bold Italic |
| JetBrains Mono | data and labels (`--p-font-mono`) | Regular, Bold, Italic, Bold Italic |

The Mazius desktop cuts are lossless sfnt restorations of the shipped woff2
files — outlines untouched, glyph counts identical. Their name tables were
normalized to two RIBBI-clean families; the upstream files disagreed on family
name (the italic called itself `MAZIUS REVIEW 20.09`), which made Office treat
each cut as unrelated and synthesise fake bold and oblique. The SIL OFL
copyright declares no Reserved Font Name, so renaming is permitted. Inter 4.1
and JetBrains Mono 2.304 are upstream desktop releases, both SIL OFL 1.1, with
licences alongside.

Consumers must install the cuts per machine — Office names a family but never
embeds it. Run `fonts/desktop/install-plx-fonts.ps1`. It verifies every cut
against this manifest before touching the system and is safe to re-run.
Machines without the cuts degrade to Georgia / Segoe UI as before.

## 1.3.0 — 2026-08-12

**Dark-scheme WCAG AA remediation.** Three value changes, no additions, removals
or renames. The dark palette was swept exhaustively — every foreground token
against every dark surface, plus the 12% tinted chip fills — and these were the
only failures found. The dark scheme is now AA-clean.

| Token | Was | Now | Failure it fixes |
|---|---|---|---|
| `--p-muted` | `#827B6F` | `#A09789` | below AA on **all six** dark surfaces |
| `--p-accent-soft` | `#2D4D3B` | `#264132` | `--p-accent` on it was 3.80:1 — every dark menu hover |
| `--p-ok` | `#7A9E6F` | `#7EA372` | 4.33:1 on the lightest dark surface |

### `--p-accent-soft` — the widest-reaching of the three

`.brand-plx` maps `--accent` → `--p-accent-soft` and `--accent-foreground` →
`--p-accent`. shadcn uses `bg-accent text-accent-foreground` for hover states in
`dropdown-menu`, `command`, `searchable-combobox`, `badge` and ghost `button` —
so in dark mode *every menu hover* was forest-on-forest at **3.80:1**. Now
4.51:1, with ink on the new fill at 9.45:1.

The **fill** moved rather than `--p-accent`, deliberately: `--p-accent` is the
brand forest used as text on every surface and as `--ring`, so changing it has a
far wider blast radius than darkening a background.

### `--p-ok`

4.33:1 on MRP's forked dark `paper-2` (`#2A3329`) — the lightest dark surface in
the product. Now 4.59:1 there, 6.21:1 on canonical dark paper, 5.18:1 on its own
12% chip fill.

### `--p-muted`

- **This was a live WCAG AA failure, not a cosmetic tweak.** The old value fell
  below 4.5:1 on **every** dark surface:

  | Surface | Was | Now |
  |---|---:|---:|
  | `--p-rail` `#16140F` | 4.39 | 6.38 |
  | `--p-paper` / `--p-canvas` `#1A1816` | 4.23 | 6.14 |
  | `--p-paper-2` `#22201D` | 3.88 | 5.64 |
  | MRP forked dark `paper-2` `#2A3329` | 3.12 | **4.54** |

- `--p-muted` maps to `--muted-foreground` under `.brand-plx`, which shadcn uses
  for secondary body text throughout — so this was real copy, not decoration.
  And `providers.tsx` sets `enableSystem`, so dark mode activates from OS
  preference with no in-app opt-out outside Teams embeds: any user on a dark OS
  was getting sub-AA text without having chosen dark mode.
- The value is deliberately chosen to clear AA on the **lighter MRP dark
  hierarchy** as well, not just canonical. That unblocks ADR-007 §Deferred —
  promoting MRP's dark paper values is now a pure paper change with no further
  contrast work.
- Type hierarchy preserved: muted 6.14:1 / ink-2 10.00:1 / ink 15.02:1 on dark
  paper, with 1.63:1 separation between muted and ink-2.
- **Light scheme untouched.** `--p-muted` stays `#6B665B` (5.47:1 on paper,
  4.92:1 on paper-2).

## 1.2.0 — 2026-08-06

- **Minor (value changes, no additions/removals/renames):** the light-scheme paper hierarchy adopts the values the MRP surface has been running, resolving the ADR-002 fork. See `docs/design-system/decisions/ADR-007-paper-hierarchy-promotion.md`.

  | Token | Was | Now |
  |---|---|---|
  | `--p-paper` | `#FBF9F5` | `#FBFAF6` |
  | `--p-paper-2` | `#F6F2EA` | `#ECEFE9` |
  | `--p-card` (deprecated alias) | `#FBF9F5` | `#FBFAF6` |

- `--p-paper-2` is the substantive change: the recess moves from warm cream to a cool sage tint. `--p-paper` / `--p-card` shift by one hex digit and are perceptually identical.
- **Consumer impact:** visual only, no API change. Adopting consumers (`consumers.yaml`) re-pin at their own pace; `petralabx/PLX_MC` remains pinned at `1.0.0`.
- **Accessibility:** no WCAG AA regressions. Worst light-scheme delta is `--p-muted` on `--p-paper-2` at 5.12:1 → 4.92:1, still above 4.5:1. All status `*-text` shades gain contrast. Dark scheme is unchanged by this release.
- **Not included:** the dark-scheme paper values remain forked under `.dark .mrp-shell`, blocked on a dark `--p-muted` contrast fix — see ADR-007 §Deferred.

## 1.1.2 — 2026-07-24

- **Patch (automation proof):** no token changes. Cuts a version bump so `design-system-release.yml` can fan-out `plx-ds-update` to adopting consumers (TASK-685). Dispatch script + workflow land with this release.

## 1.1.1 — 2026-07-24

- **Patch (selector scoping, no token changes):** the accent grammar rule's `.p-serif em` selector is now `.brand-plx .p-serif em`, so the italic-forest `<em>` treatment cannot leak outside brand boundaries — matching the other three selectors in the rule, the archived bundle's `.plx .serif em` scoping, and `PATTERN-REGISTRY` §5.

## 1.1.0 — 2026-07-24

- **Minor (token additions, design-system v0.8 handoff adoption):** `--p-rail` (light `#EEEBE3` / dark `#16140F`) and `--p-canvas` (light `#F5F3EC` / dark `#1A1816`) — brand-bundle surface steps for rails/sidebars and dense-surface page backgrounds. Added to `tokens.css` (both schemes) and `tokens.ts` (`lightTokens`/`darkTokens`).
- **Accent grammar rule** appended to `tokens.css`: one italic forest `<em>` word inside a serif headline (`.brand-plx h1/h2/h3 em`, `.p-serif em`) — rationing documented in `docs/design-system/PATTERN-REGISTRY.md` §5.
- No removals, renames, or value changes; existing consumers are unaffected until they re-pin.

## 1.0.0 — 2026-07-24

- Baseline authority package cut from `staging` @ `8cbc140ef`.
- Artifacts: `tokens.css`, `tokens.ts`, Mazius Display font set (+ OFL license).
- Establishes `manifest.json` integrity contract for consumer pins (ADR-005).
- No intentional token value changes vs prior portal `docs/design-system` / runtime mirror at cut time.
