# Brand Sync from PLX Customer Portal

**Owner:** Vince  
**Applies to:** PLX Mission Control (`PLX_MC`)  
**Authority:** ADR-003 / ADR-005 — Portal is upstream; MC consumes, never forks.

## Pin (ADR-005)

Root `plx-brand.json` records adoption + `pinnedVersion` / `pinnedIntegrity`.
The pin cache is `design-system/` (mirrors the portal package). Ledger:
`design-system/SYNC-LOG.md`.

Preflight runs `scripts/check-ds-pin.py` whenever `plx-brand.json` is present.

## When to run

Run after any of these events:

- Portal cuts a new `design-system/` release and you decide to **adopt** (bump pin first).
- Portal merges shared brand artifacts (runtime `brand-tokens.css`, brand components, logos).
- MC visual review shows typography/color drift vs Portal.
- `scripts/preflight.sh` fails with design-system pin or brand portal parity FAIL.

## One-command sync (preferred)

```bash
# Requires plx-brand.json pin to match portal design-system/manifest.json
PLX_PORTAL_ROOT=/path/to/plx-customer-portal bash scripts/plx-ds-sync.sh
```

This:

1. Verifies the portal package version/integrity against `plx-brand.json`.
2. Copies `design-system/**` into MC's pin cache and mirrors tokens/fonts.
3. Syncs runtime brand components/assets and refreshes `config/brand-portal-parity.json`.
4. Runs `check-ds-pin.py` + `check-brand-portal-parity.py`.

Legacy helper (parity refresh only; no pin verify):

```bash
PLX_PORTAL_ROOT=/path/to/plx-customer-portal bash scripts/sync-brand-from-portal.sh
```

## Verify locally

```bash
python3 scripts/check-brand-portal-parity.py
python3 scripts/check-mc-brand-application.py
./scripts/preflight.sh --mode pre-commit
```

## What the parity manifest covers

| Category | Paths |
|----------|-------|
| Token spec | `docs/design-system/tokens.css`, `tokens.ts` |
| Runtime mirror | `src/styles/brand-tokens.css` |
| Brand primitives | `src/components/brand/*` |
| Runtime assets | `public/brand/*`, `public/fonts/mazius/*` (production cuts) |
| Design archive | `docs/design-system/assets/fonts/mazius/*` |

**Not in manifest** (MC-local by ADR-003/004): `src/styles/mc-*.css`, MC ADRs, surface chrome.

## Application rules (enforced in preflight)

- Main shell and sign-in must wrap content in `<BrandBoundary>` (`.brand-plx`).
- `src/components/mc/**/*.tsx` must have zero raw color literals — use `--p-*` tokens only.

## CI / preflight

Both gates run on every commit via `scripts/preflight.sh`:

- `scripts/check-brand-portal-parity.py` — manifest checksums
- `scripts/check-mc-brand-application.py` — boundary + component colors

No live Portal clone is required in CI; the committed manifest is the contract.

## After syncing

1. Update provenance in `docs/design-system/HANDOFF-README.md` if portal commit changed materially.
2. Run `./scripts/preflight.sh --mode pre-push` before push.
3. Visual smoke: sign-in + main MC shell (Mazius headings, JetBrains kickers, Inter body).
4. For per-route polish, run the ui/ux loop (`ui-loop.config.json`) on affected surfaces.

## Rollback

Restore prior `config/brand-portal-parity.json` and synced files from git. The manifest makes drift binary — either checksums match or preflight blocks merge.
