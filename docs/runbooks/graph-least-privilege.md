# Graph App Registration — Least Privilege (TASK-621)

Retire the broad app-only Graph roles in favor of `Sites.Selected` scoped to
`/sites/plx-mission-control`. Contract: `config/graph-app-permissions.json`;
drift audit: `scripts/audit-graph-app-permissions.mjs`.
Owner: Vince (accountable: cos@petrasoap.com).

## Current vs target

- Current (transitional): `Sites.ReadWrite.All` — tenant-wide write to every
  SharePoint site. Retire-by is tracked in the manifest.
- Target: `Sites.Selected` application role + a per-site `write` permission
  grant on `/sites/plx-mission-control` only. The sync engine (lists delta,
  item PATCH/POST, change-notification subscriptions) works on site-scoped
  `Sites.Selected` write.
- Forbidden (never grant to this registration): `Sites.FullControl.All`,
  `Sites.Manage.All`, `Sites.Create.All`, `User.Read.All`, `Mail.Send`,
  `ChannelMessage.Send`, `Directory.*`. Site provisioning
  (`scripts/provision-sharepoint.py`, needs `Sites.Create.All`) must use a
  separate short-lived registration, not the runtime credential.

## Migration steps (Azure portal or Graph API, tenant admin)

1. Add the `Sites.Selected` application permission to the
   `MICROSOFT_GRAPH_CLIENT_ID` registration; grant admin consent.
2. Grant the site permission:
   `POST /sites/{siteId}/permissions` with
   `roles: ["write"]` for the app id (use an admin credential — apps cannot
   self-grant).
3. Verify runtime behavior with both roles present: run a full sweep and a
   subscription create/renew against staging
   (`PLX_MC_SHAREPOINT_SITE_PATH` override).
4. Remove `Sites.ReadWrite.All` from the registration; re-consent.
5. Run `node scripts/audit-graph-app-permissions.mjs` — must exit 0 with no
   transitional warnings.
6. Move `Sites.ReadWrite.All` from `transitionalRoles` to `forbiddenRoles` in
   `config/graph-app-permissions.json` in the same change.

## Audit cadence

Run the audit script after any app-registration change and in incident review.
Exit codes: 0 compliant, 1 drift (fail the check), 2 credentials not configured
(skip, e.g. local dev).

## Rollback

Re-add `Sites.ReadWrite.All` and re-consent (one portal action); the manifest's
transitional entry documents that state. No code change required — the sync
engine is role-agnostic as long as one of the two roles grants site write.
