# Bundle index — 2026-06-11-plx-mc-db

- `REPORT.md` — provisioning + migration evidence for the dedicated `plx_mc`
  database on the staging RDS instance, including the Secrets Manager
  encoding incident and rollback notes.

Related repo files: `scripts/provision-plx-mc-db.mjs`, `scripts/migrate.mjs`,
`scripts/check-migrations.py`, `db/migrations/001–004`,
`config/governance-contract.yaml` (database section re-added).
