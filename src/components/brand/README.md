# PLX Brand Components

Net-new brand components that have no shadcn equivalent. Live here so
they are easy to find, easy to delete if the brand layer is rolled
back, and isolated from `components/ui/` (which is shadcn-managed).

For shadcn primitives that just get a brand-flavored variant added to
their cva (Button, Badge, etc.), see the file in `components/ui/`
directly. That's the shadcn-intended extension pattern, not a fork.

---

## What is here today (v0.2 login-first consumed subset)

| Component | Source | Use for |
|---|---|---|
| `<AuthStatusBanner>` | [AuthStatusBanner.tsx](AuthStatusBanner.tsx) | Auth success/info/warning/error feedback with correct `role="status"` / `role="alert"` behavior. |
| `<BrandBoundary>` | [BrandBoundary.tsx](BrandBoundary.tsx) | Route-local `.brand-plx` activation when a screen should opt into the PLX token remap without global restyling. |
| `<Kicker>` | [Kicker.tsx](Kicker.tsx) | Tiny mono uppercase eyebrow text above a section heading. Wraps the `.p-kicker` utility from `tokens.css`. |
| `<MonoData>` | [MonoData.tsx](MonoData.tsx) | Inline numeric / code values that need monospace + tabular-nums (table cells, IDs, codes). Wraps the `.p-data` utility from `tokens.css`. |
| `<PMark>` | [PMark.tsx](PMark.tsx) | Periodic-table-style glyph for auth instrumentation, project workbench rows, and durable design-system review examples. |

### Companion shadcn variants (live in `components/ui/`)

| Variant | File | Use for |
|---|---|---|
| `<Button variant="brand">` | [../ui/button.tsx](../ui/button.tsx) | Primary action: ink-on-paper filled, mono uppercase, 3px corners. |
| `<Button variant="brand-ghost">` | [../ui/button.tsx](../ui/button.tsx) | Secondary action: outlined hairline, mono uppercase. |
| `<Badge variant="chassis">` | [../ui/badge.tsx](../ui/badge.tsx) | Square 3px corners, 10px mono uppercase, neutral palette. Override `text-*` / `border-*` for status tones. |

---

## What is deferred (deed / sign-off compounds)

The full design system specifies 11 net-new compounds in
[`docs/design-system/COMPONENT-INVENTORY.md`](../../../docs/design-system/COMPONENT-INVENTORY.md).
The login/auth lane only promotes components that are consumed now or in
the next workbench lane. The deed/sign-off components remain deferred
until the sign-off / projects rollout actually needs them, so we do not
pay the review-and-test cost on components that will sit unused.

| Component | Used in spec for | Why deferred |
|---|---|---|
| `<ChassisFolio>` | Every major deed section | Sign-off / project detail only |
| `<ChassisTicks>` | Reused inside `<ChassisFolio>` and standalone | Co-deferred with `<ChassisFolio>` |
| `<WritStamp>` | Top of deed | Sign-off only |
| `<AttestationChip>` | Deed formula attestations | Sign-off only |
| `<OpenFlagRow>` | Deed flags row | Sign-off only |
| `<RunningHead>` | Folio header strip | Sign-off / project detail only |
| `<SignBlock>` | Bottom of deed | Sign-off only |
| `<SlateFrame>` | Pilot pour / artwork placeholders | Sign-off only |

When a future feature lane needs one of these, the right move is:

1. Lift the JSX from the relevant spec mock at `docs/design-system/specs/portal/`.
2. Rebuild against `tokens.css` and shadcn primitives -- never copy `<style>` blocks verbatim (see [`docs/design-system/REFERENCE.md`](../../../docs/design-system/REFERENCE.md)).
3. Add the file alongside `Kicker.tsx` and `MonoData.tsx` in this folder.
4. Export from `index.ts`.
5. Update this README.

---

## Conventions

- **Imports.** Consume via the barrel: `import { Kicker, MonoData, PMark } from "@/components/brand"`.
- **Styling.** Components in this folder consume `--p-*` tokens via the utility classes defined in `docs/design-system/tokens.css`. They do not redefine values.
- **Brand scoping.** These components render anywhere they are mounted. Their typographic styling depends on `--p-*` tokens, which are defined globally in `:root`, so they look the same in every route. The `--background` / `--primary` / `--card` shadcn token remap that gives the warm paper backdrop is scoped to `.brand-plx` ancestors only.
- **Discipline.** If `components/brand/` grows past ~20 files, that is a smell -- something is being built brand-specific that should be inheriting tokens via shadcn instead. Re-read [`docs/design-system/COMPONENT-INVENTORY.md`](../../../docs/design-system/COMPONENT-INVENTORY.md) sections 5 ("What we explicitly do NOT build") and 6 ("Total surface area") before adding more.
