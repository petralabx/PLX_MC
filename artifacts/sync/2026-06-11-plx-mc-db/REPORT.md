# plx_mc database provisioning + first migrations — staging RDS

- **Date:** 2026-06-11 (ET)
- **Operator:** agent session (sync/db-persistence PR)
- **Instance:** `plx-postgres-staging.c2b8m8isksqt.us-east-1.rds.amazonaws.com:5432`

## What was done

1. Created the dedicated `plx_mc_app` login role and `plx_mc` database
   (owner `plx_mc_app`, `REVOKE CONNECT … FROM PUBLIC`) via
   `scripts/provision-plx-mc-db.mjs --apply`, connected as the instance admin.
   The trading database and its credentials were not touched or reused.
2. Applied migrations `001`–`004` with `scripts/migrate.mjs` as `plx_mc_app`,
   then re-ran to prove idempotence.
3. Stored `PLX_MC_DATABASE_URL` in AWS Secrets Manager `prod/ec2-secrets`
   (us-east-1) — additive key; loader fetch verified afterwards (157 keys).

## Evidence

Provisioning (dry-run, then apply):

```
connected as plxadmin (createdb=true createrole=true)
role plx_mc_app: missing
database plx_mc: missing
created role plx_mc_app
created database plx_mc (owner plx_mc_app, PUBLIC connect revoked)
provisioning complete.
```

Migrations (first run, then idempotence re-run):

```
apply  001_delta_links.sql
apply  002_conflict_queue.sql
apply  003_audit_log.sql
apply  004_entity_mirror.sql
migrations complete — 4 applied, 0 already in place.
skip   001_delta_links.sql (already applied)
skip   002_conflict_queue.sql (already applied)
skip   003_audit_log.sql (already applied)
skip   004_entity_mirror.sql (already applied)
migrations complete — 0 applied, 4 already in place.
```

Schema verification, connected as the app role:

```
tables: delta_links, entities, schema_migrations, sync_audit_log, sync_conflicts, sync_push_errors
db/user: plx_mc / plx_mc_app
```

Secrets Manager verification after the write:

```
keys after: 157
new key correct: True
ascii-safe: True
loader fetch ok: True, keys: 157
```

## Incident during secret write

The first merge attempt round-tripped the secret JSON through PowerShell 7's
`ConvertTo-Json`, which de-escaped a `\uE10D` sequence to raw UTF-8 and broke
the AWS CLI's cp1252 output path (every `get-secret-value` failed → the box
loader was down). Fixed by re-storing with `json.dumps(..., ensure_ascii=True)`
via a throwaway boto3 venv; previous versions retained by Secrets Manager
(`AWSPREVIOUS`). Documented in `LESSONS.md` (2026-06-11).

## Rollback

- Drop order: `DROP DATABASE plx_mc` then `DROP ROLE plx_mc_app` (admin).
- Secret: restore `AWSPREVIOUS` version of `prod/ec2-secrets` (removes the
  `PLX_MC_DATABASE_URL` key).
