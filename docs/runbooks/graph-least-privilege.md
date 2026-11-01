# Graph App Registration — Least Privilege (TASK-621)

Retire the broad app-only Graph roles in favor of `Sites.Selected` scoped to
`/sites/plx-mission-control` (sync) and `/sites/PLXSite` (evidence store, see
[PLXSite](#plxsite-evidence-store-task-4422)). Contract: `config/graph-app-permissions.json`;
drift audit: `scripts/audit-graph-app-permissions.mjs`.
Owner: Vince (accountable: cos@petrasoap.com).

This is **Mission Control's** Graph daemon only. Portal SSO, `PLX_Cursor_Graph`,
and Office Nested App Auth are different registrations. Fleet policy:
[`M365-IDENTITY-CATALOG.md`](./M365-IDENTITY-CATALOG.md).

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
  Column-only runs against an existing site (e.g. the ToDos `CompletedAt`
  column) use MC's own sync identity instead: at deploy, before this PR's code
  goes live, run `scripts/provision-sharepoint.py --env staging --apply`
  (/sites/plx-mission-control-dev), then `--env production --apply`
  (/sites/plx-mission-control), with the same app identity the sync engine
  uses, not a personal account.

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

## PLXSite evidence store (TASK-4422)

`mc_upload_evidence` and `mc_upload_draft_artifact` write to the
`Mission Control` library on `https://petrasoap.sharepoint.com/sites/PLXSite`
(`PLX_EVIDENCE_STORE` in `src/lib/compliance/evidence-artifacts.ts`). The app
uses a client secret (`MICROSOFT_GRAPH_CLIENT_SECRET`); its rotation date is
not recorded.

State on 2026-11-01:

- The library exists (seen in the PLXSite navigation, 2026-11-01).
- A per-site `write` grant on `/sites/PLXSite` was recorded on 2026-10-26.
- The app still holds `Sites.ReadWrite.All`. Its `retireBy` (2026-08-21) has
  passed and is not extended. A credentialed audit run fails on it by design.
- Whether `PLX_MC_EVIDENCE_STORE_ENABLED=1` is on in production is unconfirmed.

### Grant needed

1. `Sites.Selected` application role on the `MICROSOFT_GRAPH_CLIENT_ID`
   registration, with admin consent (shared with the sync engine).
2. A site permission on PLXSite, granted by a tenant admin:
   `GET /sites/petrasoap.sharepoint.com:/sites/PLXSite` for the site id, then
   `POST /sites/{siteId}/permissions` with `roles: ["write"]` and the app id
   in `grantedToIdentities`. `write` covers creating folders, uploading files
   and upload sessions in the library. Do not grant `owner` or `fullcontrol`.

### Verify

1. As a tenant admin, run `GET /sites/{siteId}/permissions`. Confirm one entry
   for the app id with `roles: ["write"]`. The app cannot read this itself:
   that needs `Sites.FullControl.All`, which is forbidden.
2. Run `node scripts/audit-graph-app-permissions.mjs`. It fails (exit 1) when
   any site the code writes to has no `siteGrants` entry in
   `config/graph-app-permissions.json`. This check is static and runs without
   credentials. It does not read live grants.
3. Run the TASK-4421 upload probe with both roles present. Confirm healthy
   uploads to `Mission Control` before you remove the broad role.

### Remove `Sites.ReadWrite.All`

Removing a Graph app permission needs a signed MC approval with scope `flags`.
Vince decides it; send it to CoS, which batches it for him. Agents never
change the registration.

1. Wait for the TASK-4421 probe to show healthy PLXSite uploads, and for the
   sync sweep and subscription checks above to pass with both roles.
2. After the flags approval, a tenant admin removes `Sites.ReadWrite.All` and
   re-consents.
3. Re-run the TASK-4421 probe and a sync sweep. On failure, re-add the role
   (see Rollback).
4. In the same change, move `Sites.ReadWrite.All` to `forbiddenRoles` in the
   manifest. The audit must exit 0 with no transitional warnings.

## Audit cadence

Run the audit script after any app-registration change and in incident review.
Exit codes: 0 compliant, 1 drift (fail the check: a role, or a missing site
grant), 2 credentials not configured and the site-grant check passed (roles
skipped, e.g. local dev).

## Rollback

Re-add `Sites.ReadWrite.All` and re-consent (one portal action); the manifest's
transitional entry documents that state. No code change required — the sync
engine is role-agnostic as long as one of the two roles grants site write.
