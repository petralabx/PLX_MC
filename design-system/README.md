# PLX Design System — distributable package

**Authority:** `petralabx/plx-customer-portal`  
**Channel:** `staging`  
**Contract:** ADR-005 (`docs/design-system/decisions/ADR-005-authority-and-propagation.md`)

This directory is the **versioned, integrity-hashed** brand bundle consumers pin to.
The narrative ADRs / inventory stay in `docs/design-system/`. The Next.js runtime
mirror remains `portal/src/styles/brand-tokens.css` (Turbopack cannot import CSS
from outside the app root).

## Contents

| Path | Role |
|---|---|
| `manifest.json` | Semver + per-artifact sha256 + package `integrity` |
| `CHANGELOG.md` | One entry per released version |
| `tokens.css` | Canonical `--p-*` token spec |
| `tokens.ts` | Typed token export |
| `fonts/` | Mazius Display webfonts + OFL license |

## Regenerate integrity

After changing any artifact:

```bash
python3 scripts/design-system-manifest.py
```

Then bump `version` in `manifest.json` and add a `CHANGELOG.md` entry before merge.

## Consume (adopting repos)

1. Record adoption in root `plx-brand.json` (`adopts: true`, `pinnedVersion`, `pinnedIntegrity`).
2. Copy pinned artifacts into the consumer runtime mirror (e.g. MC `src/styles/brand-tokens.css`).
3. Verify sha256 against `manifest.json`.
4. Register in authority `consumers.yaml`.

Opt-out brands set `adopts: false` with rationale — do not pin portal tokens.

## Release gate

`.github/workflows/design-system-release.yml` fails PRs that touch `design-system/**`
unless version/changelog/hashes are consistent.
