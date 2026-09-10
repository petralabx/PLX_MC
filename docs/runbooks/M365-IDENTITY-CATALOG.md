# M365 identity catalog (fleet)

**Audience:** every agent on a petralabx-tracked repo that needs Microsoft 365.
**Owner:** Vince Alton (`vince@petrasoap.com`)
**Status:** active

Share Graph **code**. Never share Entra **client IDs** across trust boundaries.

Petra-specific app IDs and the **click-by-click** Entra steps for
`PLX Office Add-ins - Staging` live in the portal canonical:

https://github.com/petralabx/plx-customer-portal/blob/staging/docs/runbooks/M365-IDENTITY-CATALOG.md

Until that file is on `staging`, use the feature branch
`docs/m365-identity-catalog` on the same path.

This file is the fleet policy so agents in `PLX_MC`, `skills`, `agentic-swarm`,
and Cloud VMs do not invent a mega-app.

---

## Trust boundaries

| Job | Kind | What agents must do |
|---|---|---|
| Staff Microsoft login | Confidential web, delegated OIDC | Use the **SSO** app only. Authorize scopes stay `openid profile email`. |
| Daemon / agent Graph | Confidential app-only | Use the **Graph daemon** for that product (`PLX_Cursor_Graph` on the portal workstation; MC uses its own Graph app). Never `AZURE_AD_*` first. |
| Directory / group membership writes | Purpose-scoped app-only | Portal RBAC apply has its own client ID. Runtime rejects the shared Graph client. |
| Office add-ins (Outlook now; Excel/Word later) | **Public SPA**, Nested App Auth | New registration: `PLX Office Add-ins - Staging`. SPA redirect `brk-multihub://<origin>`. Delegated `Mail.Read` + `Files.ReadWrite`. **No client secret.** One public client per environment, not one per Office host. |
| Least-privilege VM reads (CursorInbox) | Purpose-scoped `Sites.Selected` | Planned reader app. Do not inject the daemon Graph app into a Cloud VM for a narrow job. |
| Read-only tenant inventory (Claude Code web) | Confidential app-only, six Graph **read** roles | Use **PLX Inventory Reader** (`ce0663b0-…`) via `PLX_INVENTORY_GRAPH_*`. Never widen `PLX_Cursor_Graph`. Never put `AZURE_AD_*` on this path. |
| Cursor IDE staff login | SAML IdP (Enterprise app) | Use **Cursor IDE SSO** (`471fc999-…`) only. No AWS secret. Do not reuse for Graph or Portal SSO. |

Mission Control's **own** Graph contract remains
[`graph-least-privilege.md`](./graph-least-privilege.md) (`Sites.Selected` on
`/sites/plx-mission-control`). That is not the portal daemon and not the
Office add-in.

---

## Forbidden (fleet-wide)

1. One Entra client ID for "all M365".
2. Nested App Auth / `brk-multihub://` / a public SPA on a Graph **daemon**,
   on a NextAuth **SSO** app, on Inventory Reader, on Cursor IDE SSO, or on
   MC's site-sync app.
3. Application (app-only) permissions or a client secret on an Office add-in.
4. Expanding portal SSO authorize scopes beyond `openid profile email`.
5. Injecting `PLX_Cursor_Graph` into an Office task pane "to make Outlook work".
6. Agents creating Entra apps. `Application.ReadWrite.All` is absent on the
   workstation Graph token. Vince (Global Admin) creates registrations.
7. Treating Microsoft's NAA sample (`/common` + personal Microsoft accounts)
   as PLX policy. PLX Office add-ins are **single-tenant** with authority
   `https://login.microsoftonline.com/<petra-tenant-id>`.
8. Reusing **Cursor IDE SSO** (`471fc999-…`) for Graph, Portal SSO
   (`AZURE_AD_*`), or PLX Agent Entra Admin. It is a SAML IdP only.
   No client secret. No AWS secret. Cert stays in Entra.

---

## Outlook live pin (portal)

Blocked on the operator creating `PLX Office Add-ins - Staging`. After Vince
pastes `PLX_OFFICE_ADDIN_CLIENT_ID` and `PLX_OFFICE_ADDIN_TENANT_ID`, a portal
follow-on PR wires `createNestablePublicClientApplication`. Until then the
add-in stays mocked. Details in the portal catalog and
`docs/runbooks/OUTLOOK-PIN-TO-PROJECT.md`.

---

## Why this exists

On 2026-07-26, portal SSO variables (`AZURE_AD_*`) hijacked app-only Graph
resolution. SharePoint returned 401 across the portal. Putting NAA on
`PLX_Cursor_Graph` (daemon + `Mail.Send` as any mailbox) is the same class of
failure: confidential and public clients, delegated and application roles,
and two blast radii on one identity.

---

## Operator handoff (Vince)

Follow the portal catalog section **Create PLX Office Add-ins - Staging**.
Paste back:

```text
PLX_OFFICE_ADDIN_CLIENT_ID=<Application (client) ID>
PLX_OFFICE_ADDIN_TENANT_ID=<Directory (tenant) ID>
adminConsent=granted
assignmentRequired=yes
staffTestGroup=<group name>
```

No client secret.

---

## PLX Inventory Reader (fleet mirror)

Canonical click-path and matrix: portal
`docs/runbooks/M365-IDENTITY-CATALOG.md`.

| Field | Value |
|---|---|
| Display name | `PLX Inventory Reader` |
| Application (client) ID | `ce0663b0-7321-4e1c-b3d1-d0bf6e186148` |
| Tenant | `dc28356c-e440-4a9e-b8e6-e40967bfee06` |
| Kind | Single-tenant confidential, app-only, no redirect, no SPA/NAA |
| Application roles | `Application.Read.All`, `Directory.Read.All`, `Device.Read.All`, `Organization.Read.All`, `Printer.Read.All`, `DeviceManagementManagedDevices.Read.All` |
| Env | `PLX_INVENTORY_GRAPH_TENANT_ID` / `_CLIENT_ID` / `_CLIENT_SECRET` in `staging/ec2-secrets` (staging = yes) |
| Purpose | Read-only tenant inventory for Claude Code web |

Does not see the Concord LAN printer fleet. Do not load this client ID into `MICROSOFT_GRAPH_*`.

---

## Identity matrix (fleet mirror)

Canonical matrix: portal `docs/runbooks/M365-IDENTITY-CATALOG.md`
(PR #1188 / staging `9bbfb39`). Public IDs only — no secrets/PEM.

| Display name | Application (client) ID | Kind | Secret in AWS | Notes |
|---|---|---|---|---|
| Cursor IDE SSO | `471fc999-76da-44b0-815c-cdf3e04b1581` | SAML IdP (non-gallery Enterprise app) | none | Cursor IDE staff SSO. Not Portal SSO, not Graph. |

### Cursor IDE SSO

Registered 2026-09-09/10 by CoS. Not Portal SSO, not `PLX_Cursor_Graph`,
not PLX Agent Entra Admin.

| Field | Value |
|---|---|
| Display name | `Cursor IDE SSO` |
| Application (client) ID | `471fc999-76da-44b0-815c-cdf3e04b1581` |
| Object ID | `1258a6a0-f461-41d8-9ff9-42c5e45d7c01` |
| Tenant | `dc28356c-e440-4a9e-b8e6-e40967bfee06` | <!-- pragma: allowlist secret -->
| Kind | SAML IdP (non-gallery Enterprise app) |
| App Federation Metadata URL | `https://login.microsoftonline.com/dc28356c-e440-4a9e-b8e6-e40967bfee06/federationmetadata/2007-06/federationmetadata.xml?appid=471fc999-76da-44b0-815c-cdf3e04b1581` | <!-- pragma: allowlist secret -->
| Login URL | `https://login.microsoftonline.com/dc28356c-e440-4a9e-b8e6-e40967bfee06/saml2` | <!-- pragma: allowlist secret -->
| SP Entity ID | `hgSFPXLi2cp7UtZ4HOw0wDsw8` |
| SP ACS | `https://authenticate.cursor.sh/sso/saml/acs/hgSFPXLi2cp7UtZ4HOw0wDsw8` |
| Secret in AWS | none (SAML IdP; cert in Entra only) |
| Operator status | App created; no user assignments; SSO not enforced in Cursor; domain verify `petrasoap.com` still required |

Do not load this client ID into `AZURE_AD_*`, `MICROSOFT_GRAPH_*`, or
`PLX_INVENTORY_GRAPH_*`.

---

## What already exists

Do not register a second app for a job that already has an identity.
Full list: portal `docs/runbooks/M365-IDENTITY-CATALOG.md`.

| Display name | Application (client) ID | Kind | Do not |
|---|---|---|---|
| Cursor IDE SSO | `471fc999-76da-44b0-815c-cdf3e04b1581` | SAML IdP (non-gallery Enterprise app) | Recreate; attach Graph roles; store a secret in AWS |
| PLX Inventory Reader | `ce0663b0-7321-4e1c-b3d1-d0bf6e186148` | App-only Graph read | Widen `PLX_Cursor_Graph`; put on `AZURE_AD_*` |
