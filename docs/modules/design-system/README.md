# Module: design-system

## What

The PLX brand surface for Mission Control: `--p-*` design tokens (light +
dark), the Mazius/Inter/JetBrains Mono type system, brand primitives
(`BrandBoundary`, `Kicker`, `MonoData`, `PMark`, `AuthStatusBanner`), and the
canonical design governance docs. It owns visual identity only — it is NOT a
component library for product features (those compose on top of it).

## Why

Mission Control is the fourth brand surface under ADR-002 (Portal, MRP,
Homepage being the others). Sharing one token layer with a documented sync
path prevents the two repos from silently forking the Petra Lab-X visual
language. See `docs/design-system/decisions/ADR-003-mission-control-surface.md`.

## How

- Tokens activate only inside a `.brand-plx` / `data-brand="plx"` boundary —
  opt-in by design; wrap branded routes in `<BrandBoundary>`.
- Components consume `--p-*` variables (or remapped shadcn role variables);
  raw hex in components is a contract violation (enforced rule in
  `config/governance-contract.yaml` → code_standards.typescript).
- Brand authority lives upstream in `plx-customer-portal`; token value changes
  sync from there with provenance recorded in
  `docs/design-system/HANDOFF-README.md`. **Anti-drift:** run
  `bash scripts/sync-brand-from-portal.sh` after portal brand changes; preflight
  enforces `config/brand-portal-parity.json` checksums and MC application rules
  (`scripts/check-brand-portal-parity.py`, `scripts/check-mc-brand-application.py`).
  Operator runbook: `docs/runbooks/brand-sync-from-portal.md`.
  may be added here without upstream sign-off — e.g. ADR-004 adds the missing
  `--p-rail`/`--p-canvas` surface tokens for the `.mc` shell without changing
  any existing token value.
- Responsive governance: exactly three breakpoints (≥1025 / 641–1024 / ≤640),
  44px touch targets, tables are the only horizontal-scroll surface.

## Dependencies

`clsx` + `tailwind-merge` (the `cn()` helper in `src/lib/utils/utils.ts`).
Depended on by: web (all screens).

### Key Files

- `src/styles/brand-tokens.css` — runtime tokens (imported by global CSS)
- `src/components/brand/` — primitives + barrel `index.ts`
- `public/brand/`, `public/fonts/mazius/` — logos, favicons, webfonts (OFL 1.1)
- `docs/design-system/` — canonical governance copy (tokens, ADRs, specs)
- `config/brand-portal-parity.json` — SHA-256 manifest (portal upstream checksums)
- `scripts/sync-brand-from-portal.sh` — one-command sync from portal
- `scripts/check-brand-portal-parity.py` — preflight drift gate
- `scripts/check-mc-brand-application.py` — BrandBoundary + raw-color gate
- `docs/runbooks/brand-sync-from-portal.md` — operator sync procedure
- `tests/test_check_brand_portal_parity.py`, `tests/test_check_mc_brand_application.py`

## Owner

Vince

## Criticality

High
