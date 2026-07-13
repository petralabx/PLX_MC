# Production SharePoint SoR cutover

- **Date:** 2026-07-13 (ET)
- **Task:** TASK-396
- **Accountable owner:** Vince

## Done-when

1. Production Graph site `/sites/plx-mission-control` exists and matches
   `config/sharepoint-schema.json`.
2. Runtime points at the production site (`PLX_MC_SHAREPOINT_SITE_PATH` and/or
   code default).
3. Sync refs cleared so the next sweep re-mirrors by TaskID (not stale staging
   list-item IDs).
4. ToDos sync verified on the production site.
5. `docs/modules/sync/README.md` updated.

## Provision evidence

```text
python scripts/provision-sharepoint.py --env production --apply   # EXIT=0
  site created: https://petrasoap.sharepoint.com/sites/plx-mission-control
  lists + columns + document folders created per schema

python scripts/provision-sharepoint.py --env production --verify  # EXIT=0
  verification clean — tenant matches config/sharepoint-schema.json
```

Site id (Graph):
`petrasoap.sharepoint.com,c4860ce4-f225-437d-8a5a-a140ecf42fc7,5fe9aa28-1440-42f1-b037-2ec7f6189075`

Staging sandbox retained:
`https://petrasoap.sharepoint.com/sites/plx-mission-control-dev`

## Pre-cutover mirror inventory (plx_mc on plx-postgres-staging)

| Table | with sp_item_id | total |
|---|---:|---:|
| entities (tasks) | 185 | 185 |
| entities (risks) | 3 | 3 |
| entities (files) | 0 | 9 |
| buckets | 10 | 10 |
| repos | 7 | 7 |
| projects | 1 | 1 |
| delta_links | todos, risks, roadmap | — |

## Cutover steps executed

1. Set Vercel Production `PLX_MC_SHAREPOINT_SITE_PATH=/sites/plx-mission-control`
   (env id `6Hozp8SEY0WaSOKt`).
2. Production-target redeploy `dpl_8j87tYACDaGsoDpZeR55XAycCaNG` → aliases
   include `mc.plxcustomer.io` (READY).
3. `node scripts/cutover-sharepoint-site.mjs --apply` — cleared 188 entity /
   10 bucket / 7 repo / 1 project `sp_item_id`s + todos/risks/roadmap cursors.
4. Cron sweeps on `https://mc.plxcustomer.io/api/cron/sweep` (first hit
   FUNCTION_INVOCATION_TIMEOUT at 60s after partial push; follow-up sweep
   `pushed=27`, todos `synced=185`, risks `synced=3`).
5. Graph verify: production ToDos item **176** = `TASK-396`
   (`https://petrasoap.sharepoint.com/sites/plx-mission-control/Lists/ToDos/176_.000`).
   `TASK-397` → item **177**.

## Rollback

1. Set `PLX_MC_SHAREPOINT_SITE_PATH=/sites/plx-mission-control-dev` on Vercel
   Production (or revert the code default in `src/lib/sync/graph.ts`).
2. Re-run `node scripts/cutover-sharepoint-site.mjs --apply` so production
   item IDs are cleared.
3. Redeploy production-target + sweep. Staging sandbox still holds the prior
   mirror (engine never deletes SP items).
4. Verify: Graph GET on staging ToDos still lists TaskIDs; MC sync pill recovers.

## Code / docs in this change

- `src/lib/sync/graph.ts` — default site path → production
- `scripts/cutover-sharepoint-site.mjs` — sync-ref reset
- `docs/modules/sync/README.md` — environments + cutover
- `TOOLS.md` — Graph integration status
- `artifacts/sync/2026-07-13-prod-site-cutover/` — this evidence bundle
