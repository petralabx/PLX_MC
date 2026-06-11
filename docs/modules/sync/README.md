# Module: sync

## What

The system-of-record side of Mission Control: SharePoint provisioning today,
the two-way sync engine next. Owns the canonical tenant schema
(`config/sharepoint-schema.json`), the idempotent provisioner
(`scripts/provision-sharepoint.py`), and — as it lands — the Graph sync
service (outbound push, inbound delta, webhooks, conflict queue, audit log).
It is NOT the UI (web) and NOT the prototype store (which it will replace
behind the same action surface).

## Why

SharePoint is the canonical system of record (SOUL.md non-negotiable); the
tenant shape must be reproducible from the repo, never hand-built. The
provisioning script gives the same evidence discipline as the governance
gates: dry-run by default, `--apply` to mutate, `--verify` to diff the live
tenant against the committed schema with exit codes.

## How

- Schema source: `docs/product/SHAREPOINT_INTEGRATION.md` §2–4 (spec wins) →
  `config/sharepoint-schema.json` (keep aligned with `SP_LISTS` in
  `src/lib/mc-data/data.ts`).
- Auth: Graph client credentials from `MICROSOFT_GRAPH_*` env (AWS Secrets
  Manager via the loader). Site creation uses the Graph beta create-site API
  (`Sites.Create.All`); lists/columns/folders are Graph v1.0.
- Environments: `--env staging` (default, `/sites/plx-mission-control-dev`)
  and `--env production` (`/sites/plx-mission-control`, not yet provisioned).
- Known constraints (verified 2026-06-11): Graph cannot create
  hyperlinkOrPicture columns app-only → `PRD Link` is a text column; Risk
  `Likelihood` choices are `High/Med/Low` BY DESIGN (spec §5.2) — the engine's
  mapping layer normalizes MC's `Medium` → `Med`.
- Persistence (landed 2026-06-11): dedicated `plx_mc` database on the staging
  RDS instance (`plx-postgres-staging`, us-east-1), owned by the app-only
  `plx_mc_app` role — never the trading database or its credentials. Runtime
  URL: `PLX_MC_DATABASE_URL` (AWS Secrets Manager via the loader). Schema via
  numbered migrations in `db/migrations/` (`npm run migrate`,
  `scripts/migrate.mjs`); numbering serialization enforced by
  `scripts/check-migrations.py` in every preflight mode. Tables: `delta_links`,
  `sync_conflicts`, `sync_push_errors`, `sync_audit_log`, `entities`.
- Next increment: outbound/inbound sync engine (runs inside the Next.js app),
  webhooks once the app has a public domain.

## Dependencies

Python 3.12 + `requests` (`requirements.txt`). Microsoft Graph. Depended on
by: web (its store becomes a client of this module's API).

### Key Files

- `config/sharepoint-schema.json` — canonical tenant schema
- `scripts/provision-sharepoint.py` — idempotent provisioner + verifier
- `docs/product/SHAREPOINT_INTEGRATION.md` — the governing spec

## Owner

Vince

## Criticality

Critical
