# Tracked-repo scaffold templates

Owner: Vince. `scripts/scaffold-tracked-repo.sh` uses these templates alongside
local generators and helper scripts. The
[onboarding file contract](../runbooks/REPO-ONBOARDING.md#scaffold-file-contract)
lists every file written or skipped, validation requirements and side effects.

- `mc-routing-manifest.json` is copied to `.github/plx-mc-routing-manifest.json`
  in full and routing-only modes.
- `CONTRIBUTING.repo-stub.md` becomes `CONTRIBUTING.md` for full non-hub tiers.
  Full hub skips this template and preserves existing CONTRIBUTING content.
- `quality-ledger/` contains separate ledger templates; scaffold does not copy them.

Routing-only overwrites exactly the routing workflow and two routing manifests
(three files). Workflows-only overwrites the routing workflow and two helper scripts
(three files), skipping both manifests. Full scaffold overwrites seven files for
`product_app`, `product_platform`, `skills`, `tooling` and `sandbox`.
**Full hub scaffold is not a no-op:** it overwrites the routing workflow, both helper
scripts, both routing manifests and `docs/GOVERNANCE.md` (six files), then
exits before CONTRIBUTING. It can overwrite hub files with downstream content.
Existing output files are not protected; use routing-only for hub routing refreshes.
Scaffolding makes no network calls, git writes or registry writes.
