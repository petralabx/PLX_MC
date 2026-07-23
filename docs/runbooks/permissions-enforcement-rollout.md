# Permissions Enforcement Rollout (TASK-618)

Staged production rollout of the deny-by-default permissions kernel.
Owner: Vince (accountable: cos@petrasoap.com). Module contract:
`docs/modules/permissions/README.md`.

## Mode ladder

`PLX_MC_PERMISSIONS_ENFORCEMENT_MODE` (Vercel env, production):

| Mode | Humans | Service principals | Decision audit |
|---|---|---|---|
| `off` (default) | synthesized `admin` | assumed active | none (DB-free) |
| `log-only` | synthesized `admin`; real identity recorded as shadow verdict | assumed active; durable status recorded as shadow | every decision |
| `review` | synthesized `admin`; shadow recorded | **fail-closed** on `service_principals` (existence + revocation) | every decision |
| `enforce` | **fail-closed** on `mc_users` (role + revocation) | fail-closed | every decision |

Legacy `PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED=1` still means `enforce`; the
mode variable wins when set. Kill switch: set mode to `off` (or unset both) —
one env change, no deploy.

## Stage 1 — log-only

1. Ensure migrations 016/022/023 are applied (`npm run migrate`).
2. Seed `mc_users` for every allowlisted operator (entra_oid, email, role).
3. Set `PLX_MC_PERMISSIONS_ENFORCEMENT_MODE=log-only`.
4. Done-when: `permissions_decision_log` accumulates rows with
   `enforcement_mode='log-only'` and zero behavior change is reported.

## Stage 2 — review (after ≥1 week clean log-only)

1. Verify no `shadow_allowed = false` rows for legitimate traffic:
   `SELECT site, capability, shadow_reason_code, count(*) FROM permissions_decision_log
    WHERE shadow_allowed IS FALSE GROUP BY 1,2,3;`
   Fix identity seeding (missing `mc_users` rows → `unknown_actor`) first.
2. Set mode to `review`. Service principals now fail closed — confirm the five
   durable principals plus the MCP agent principals exist and are `active`.
3. Done-when: cron sweeps, MCP calls, and compliance projection all run green
   for a week with decisions recorded.

## Stage 3 — enforce

1. Re-run the shadow-denial query — it must return only genuinely unauthorized
   attempts.
2. Set mode to `enforce`.
3. Done-when: production traffic is authorized from hydrated identities, denials
   return 403 with a reason code, and every decision lands in
   `permissions_decision_log` with `enforcement_mode='enforce'`.

## Rollback

Any stage: set the mode back one rung (or `off`). The decision log is additive
and keeps its history; no data migration is needed in either direction.
