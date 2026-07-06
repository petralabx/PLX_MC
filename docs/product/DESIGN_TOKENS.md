# Design Tokens & Components

The visual language is the **Petra Lab‑X "Mazius / ledger" system** — warm paper surfaces, an editorial serif for display, mono for data/labels, faint‑forest accents, hairline rules. It reads like a precision instrument panel printed on warm stock, **not** a generic SaaS UI. Source of truth: `prototype/mrp-styles.css` (`:root` + `.dark`) and `prototype/mc-styles.css`.

---

## 1. Color (light)

| Token | Hex | Role |
|---|---|---|
| `--p-rail` | `#EEEBE3` | global rail / inner sidebar / view labels |
| `--p-canvas` | `#F5F3EC` | page background / body |
| `--p-paper` | `#FBFAF6` | cards, primary surfaces (lifted off canvas) |
| `--p-paper-2` | `#ECEFE9` | hovers, active states, sealed bands (faint forest) |
| `--p-ink` | `#1B1A17` | primary text |
| `--p-ink-2` | `#3A3833` | secondary text |
| `--p-muted` | `#807A6F` | tertiary / labels |
| `--p-grid` | `rgba(27,26,23,0.16)` | hairline borders |
| `--p-grid-2` | `rgba(27,26,23,0.08)` | faint inner borders |
| `--p-accent` | `#244A39` | forest green — primary accent, links, active |
| `--p-accent-soft` | `#BCCFBF` | accent wash / soft fills |
| `--p-ok` | `#5C7A55` | on‑track / synced (green) |
| `--p-warn` | `#C99340` | at‑risk / conflict (amber) |
| `--p-info` | `#5B7B91` | review / informational (blue) |
| `--p-hot` | `#52606E` | off‑track / error / urgent (slate) |

## 2. Color (dark — `.dark`)
`--p-rail #16140F` · `--p-canvas #1A1816` · `--p-paper #22201D` · `--p-paper-2 #2A3329` · `--p-ink #F1ECE0` · `--p-ink-2 #C9C2B5` · `--p-muted #827B6F` · `--p-grid rgba(241,236,224,0.12)` · `--p-grid-2 rgba(241,236,224,0.06)` · `--p-accent #7AB18C` · `--p-accent-soft #2D4D3B` · `--p-ok #7A9E6F` · `--p-warn #D9A85C` · `--p-info #7A9DB3` · `--p-hot #8FA0B0`.

> Always reference tokens, never raw hex. Both themes are complete; every surface must work in both.

## 3. Typography

| Family | Token | Use |
|---|---|---|
| **Mazius Display** (400/401) | `--mazius` | display headings (`h1`, modal titles), the one italic accent word |
| **Inter** (400/500/600/700) | `--sans` | body, UI text |
| **JetBrains Mono** (400–700) | `--mono` | kickers, labels, ids, counts, data, tabular numbers |

Recipes:
- **Page `h1`:** Mazius 38px, `line-height:.95`, `letter-spacing:-.022em`, weight 400; one word wrapped in `<em>` → italic + `--p-accent`. (28px ≤1024px.)
- **Kicker (`.kk`/`.kicker`):** mono 9.5px, `letter-spacing:.22em`, uppercase, `--p-muted`.
- **Section header (`.grouphd`, `.bh.sec`):** mono 9.5px, `letter-spacing:.18em`, uppercase; label `--p-ink`, trailing count `--p-muted` pushed right with `margin-left:auto`.
- **Body:** Inter 13px, `line-height:1.5`; subtitle `--p-muted`, `max-width:66ch`.
- **Data/ids:** mono, `font-variant-numeric:tabular-nums`.
- `body` enables `font-feature-settings:"ss01","ss02"`.

## 4. Spacing, radius, motion

- **Page padding:** main screens pad `22px 26px 16px` (header) then content at `26px` horizontal — keep 26px as the screen gutter.
- **Radius:** `--p-radius 4px` (default) · `--p-radius-sm 3px` · `--p-radius-lg 6px` (modals). Status dots/avatars: circle or square per actor kind.
- **Borders:** 1px hairlines using `--p-grid`; faint inner dividers `--p-grid-2`. The UI leans on rules, not shadows.
- **Shadows:** used sparingly — modal `0 18px 56px rgba(27,26,23,.22)`; command palette `0 16px 48px rgba(27,26,23,.18)`. No ambient card shadows (cards are defined by surface + border).
- **Motion:** `--p-ease cubic-bezier(.2,.8,.2,1)`; durations `--p-dur-fast 120ms` · `--p-dur 180ms` · `--p-dur-slow 320ms`. Animate transform/position; keep opacity at rest for elements that must survive print/reduced‑motion. Honor `prefers-reduced-motion`.

## 5. Layout shell
- **Topbar:** sticky, `~52px`, `--p-paper`, bottom hairline. Brand left (nowrap), tools right.
- **Sidebar:** fixed `232px`, `--p-rail`, sectioned (Inbox · Views · Buckets · System of record).
- **Main:** `.mc-main` flex column, `min-width:0`, fluid. Each screen = page header + content.
- Layout is **desktop‑first** (internal cockpit). Responsive tiers follow the canonical pair in `docs/design-system/RESPONSIVE.md`: tablet ≤1024px (single-column shell, h1 28px, touch targets ≥44px) and phone ≤640px (14px gutter, stacked grids).

## 6. Components (recipes in `mc-styles.css` / `mc-atoms.jsx`)

- **Buttons:** `.btn` (default, hairline) · `.btn.acc` (filled `--p-accent`, paper text) · `.btn.ghost` (transparent) · `.btn.sm` (compact). Mono label option for utility actions.
- **Pills / tags:** mono 8px, `letter-spacing:.14em`, uppercase, hairline border; semantic color variants (`.approval` ok, `.conflict` warn, `.review` info).
- **Sync tick (`SyncTick`, `.sync`):** dot + state word; color by state (synced=ok, pending=muted, conflict=warn, error=hot). Topbar variant `.topsync`.
- **Status tick (sidebar bucket health):** a **2px vertical bar** (not a dot) — `11px` tall, grows to `13px` on hover/active; green/amber/slate via `--p-ok`/`--p-warn`/`--p-hot`.
- **Avatar (`Avatar`):** initials box. **Round** for humans, **squared** for agents; agent shows a model badge.
- **Confidence (`Confidence`):** small segmented bar for task confidence.
- **Segmented control (`.seg`):** hairline group; active segment filled `--p-ink` w/ paper text (used for priority, board mode).
- **Gantt bar:** `7px` rounded pill; state classes **namespaced `seg-track` / `seg-risk` / `seg-blocked` / `seg-done`** (done = ghost outline). Urgent `.crit` = `9px` + soft amber halo. (Namespacing avoids colliding with global `.track`/`.risk` rules — preserve this.)
- **Picker drawer (`.picker`, `.pi`, `.pg`):** floating list; group headers `.pg` (mono), rows `.pi` with avatar + name + meta; active `.on`. The **PeoplePicker** extends this with a search field, invite row, and domain‑block message.
- **Modal (`.ntm`):** `--p-radius-lg`, paper, header (kicker + Mazius title) / scroll body / footer; overlay `rgba(27,26,23,.34)`. Animates transform only.
- **Embedded SP list (`.splist`) & Documents links (`.doclinks`):** MS‑List‑styled table + link rows with a mono "MS List"/"Library"/"GitHub" source chip and `↗`.

## 7. Iconography
No icon font — unicode glyphs carry semantics: `▦` list/ToDos · `◷` roadmap · `◆` milestone · `△` risk · `❒` documents · `❮❯` repo · `↔ → ←` sync direction · `↻` sync now · `↗` external. Swap for your icon set if you prefer, keeping meaning + weight consistent.
