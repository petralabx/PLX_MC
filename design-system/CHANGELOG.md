# PLX Design System changelog

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
