# Design-system sync log (PLX_MC)

Consumer ledger for the portal authority package (`petralabx/plx-customer-portal`
`design-system/`). Pin lives in root `plx-brand.json`. Sync with
`bash scripts/plx-ds-sync.sh`.

## v1.0.0 (baseline pin) — 2026-07-24

- authority: `petralabx/plx-customer-portal` @ staging
- integrity: `sha256-39e28ca756aef25bf4ae55af3da1fd75657353ef603a07911243057e6dd2bb5d`
- portal merge: https://github.com/petralabx/plx-customer-portal/pull/401 (`3b322b88b`)
- diff vs prior MC mirrors: +8 tokens (`--p-hot-text`, `--p-scrim`, `--p-icon*`,
  `--p-z-*`, `--p-field-label-w`, `--p-text-body-compact`); `--p-*-text` status
  colors now alias `var(--p-ok|--p-warn|--p-info)`; Mazius cuts aligned to package
- decision: **ADOPTED** — TASK-684 / ADR-005 consumer pin
- note: portal `BrandStatusBadge` not mirrored yet — depends on shadcn `Badge` / `@/lib/utils` paths MC lacks; pin covers tokens/fonts

## v1.3.0 — 2026-09-02

- authority: `petralabx/plx-customer-portal` @ staging (`c9b8ff828`)
- integrity: `sha256-ce22ba82ba5005ac57d9104e92e9551567b8013ccb96c916fdaca71f34db3d61`
- adopts three portal releases at once (1.1.0, 1.2.0, 1.3.0); MC skipped 1.1 and 1.2
- surface change (ADR-007): `--p-paper` `#FBF9F5` → `#FBFAF6`, `--p-paper-2`
  `#F6F2EA` → `#ECEFE9` (warm cream → cool sage). `--p-card` follows `--p-paper`.
- **retires a local token fork**: `--p-rail` and `--p-canvas` were defined locally in
  `src/styles/mc-surface.css` (MC added them ahead of the authority) and are read by
  18 MC stylesheets. 1.3.0 defines both upstream at identical values, so the local
  pair is now a redundant duplicate. Values match exactly, light and dark — no
  rendering change. Removing the local definitions is deliberate follow-up work,
  not part of this adoption.
- dark-scheme AA remediation: `--p-muted` `#827B6F` → `#A09789`, `--p-accent-soft`
  `#2D4D3B` → `#264132`, `--p-ok` `#7A9E6F` → `#7EA372`
- decision: **ADOPTED** — surface restyle reviewed on its own merits, separate from
  the Office-font bump that follows in 1.4.0
- note: `BrandStatusBadge` still not mirrored — same shadcn `Badge` / `@/lib/utils`
  dependency gap as v1.0.0. The sync script's component list omits it deliberately.
