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

## Operator flip — log-only (readiness)

This is an operator step. The code default stays unset / `off`, which records
nothing and does not open a database connection. Do not ship the flip in
`vercel.json`, a committed `.env*`, or a GitHub variable.

| Item | Value |
|---|---|
| Variable | `PLX_MC_PERMISSIONS_ENFORCEMENT_MODE` |
| Value | `log-only` |
| Where | Vercel project **`plx-mission-control`**, the environment Vince names (this task's target is **staging**). The app reads it in `permissionsEnforcementMode()` (`src/lib/auth/identity.ts`). |
| Legacy | Leave `PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED` unset. `1` still means `enforce` and would change outcomes. If both are set, the mode variable wins. |

After the flip, allow and deny decisions on mutating MCP, session, compliance,
sync, and cron paths each write one `permissions_decision_log` row with
`allowed` and `reason_code`. `off` writes nothing.

### Sampled day (read-only)

Run against the same environment's database. Replace the date. Do not insert,
update, or delete.

```sql
SELECT ts, site, actor_kind, actor_id, capability, resource_type, resource_id,
       allowed, reason_code, policy_version, enforcement_mode,
       shadow_allowed, shadow_reason_code, audit_label
  FROM permissions_decision_log
 WHERE ts >= TIMESTAMPTZ '2026-10-06 00:00:00+00'
   AND ts <  TIMESTAMPTZ '2026-10-06 00:00:00+00' + INTERVAL '1 day'
 ORDER BY ts;
```

Every mutating tool call that day should have a matching row (`allowed` plus
`reason_code`). Expect sites such as `routing.mcp` (task.create, task.checkout,
task.progress, task.complete, sync.mutate), `routing.suggest`, `sync.service`
(cron sweep / subscriptions / notifications), `routing.maintenance`,
`compliance.checkout`, `compliance.complete`, `compliance.projection`, and
`compliance.routing-propose`. Denials also appear: `mcp.tool-allowlist`
(`tool_not_allowlisted`), `mcp.release-checkout`, `mcp.auth`
(`unknown_actor` / `actor_revoked` once mode is `review` or `enforce`),
`permissions.agent-assignee`, `permissions.project-acl` (restricted projects
only), and `routing.transfer`.

```sql
SELECT site, capability, allowed, reason_code, count(*)
  FROM permissions_decision_log
 WHERE ts >= TIMESTAMPTZ '2026-10-06 00:00:00+00'
   AND ts <  TIMESTAMPTZ '2026-10-06 00:00:00+00' + INTERVAL '1 day'
   AND enforcement_mode = 'log-only'
 GROUP BY 1, 2, 3, 4
 ORDER BY 1, 2;
```

### Roll back

Set `PLX_MC_PERMISSIONS_ENFORCEMENT_MODE` back to `off` (or unset the mode and
the legacy flag). One env change, no deploy, no migration. Recording stops.
Rows already written stay.

## Stage 1 — log-only

1. Ensure migrations 016/022/023 are applied (`npm run migrate`).
2. Seed `mc_users` for every allowlisted operator (entra_oid, email, role).
3. Set `PLX_MC_PERMISSIONS_ENFORCEMENT_MODE=log-only` on the Vercel environment
   named above. Vince's go is required before this step.
4. Done-when: a sampled day of `permissions_decision_log` (query above) shows
   `enforcement_mode='log-only'` rows with `allowed` and `reason_code` for the
   mutating calls that ran, and zero behavior change is reported.

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

Any stage: set `PLX_MC_PERMISSIONS_ENFORCEMENT_MODE` back one rung, or to `off`
(unset both the mode and `PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED` to return to
the code default). The decision log is additive and keeps its history; no data
migration is needed in either direction. `off` records nothing.
