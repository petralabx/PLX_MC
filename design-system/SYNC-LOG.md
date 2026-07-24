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
