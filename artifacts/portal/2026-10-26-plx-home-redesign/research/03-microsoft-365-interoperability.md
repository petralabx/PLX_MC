# Microsoft 365 interoperability: what the portal does, and how Home can use it (2026-10-25)

Code inventory read from portal staging on 2026-10-25. External patterns from web search; Microsoft Learn
fetches were blocked by the session proxy, so verify permission names on Learn before granting.

## Done, partial, not started (as of 2026-10-25)

| Capability | State | Evidence |
|---|---|---|
| Entra ID sign-in, single tenant, tid/oid checks | Done | `lib/auth/auth.ts:311-378`, `account-link.ts`. Scopes `openid profile email` only |
| App-only Graph client (daemon app PLX_Cursor_Graph) | Live | Roles Files, Sites, Mail, User.Read.All, Group.Create, User.Invite.All. No Teams, Calendar, Tasks or Presence |
| SharePoint docs, lists, search, form-list sync, Excel export | Live | `lib/m365/sharepoint.ts`, `form-list-sync.ts`, `excel.ts` |
| Graph subscriptions | Partial | Portal Users receiver live; weekly renewal cron; two receivers have no sender |
| Shared-mailbox send (Mail.Send) | Live | `lib/email-hub/graph-transport.ts`; staging in redirect mode |
| Outlook send/draft as the user | Stubbed | `api/m365/outlook/*` hardcode a null user token |
| Delegated Graph for the signed-in user (OBO) | Not available | Tokens not persisted; OBO helper never called |
| Teams channel routing (qc, warehouse, ops-alerts) | Built, off | `lib/teams/routing.ts`; flag false; daemon app lacks a Teams role → **TASK-3899** |
| Teams 1:1 DMs | Live, narrow | Delegated cos@ token. PO approver DM bug **fixed in TASK-3898 (#3015)** |
| Adaptive Cards | Partial | 4 templates, 1 used; actions stripped until a bot exists. Uncalled helpers **removed in TASK-3900** |
| Teams bot, tab or app | Not started | Manifest pointed at a pruned bot; **archived in TASK-3900** |
| Business Central: API v2.0 client, AL extension v0.9.11, 5/15 min crons, admin page | Done | `lib/business-central/*`, `bc-extensions/plx-receipt-bridge` |
| BC approval mirror, role-center embed, BC webhooks | Planned / none | |
| Power Automate, Dataverse, Power BI, Planner, To Do, Viva, Copilot | None | Power Automate retired 2026-10-10 |

## Ranked ways Home can use Microsoft 365

| # | Move | Lands in | Effort |
|---|---|---|---|
| 1 | Teams activity-feed nudge (Graph `sendActivityNotification`) with a deep link to the row. Needs a new Teams app manifest and `TeamsActivity.Send`; no bot | Awaiting you | M |
| 2 | Home as a Teams personal tab with nested app auth (GA May 2025) | Whole page | M |
| 3 | BC cues and record deep links from the snapshot tables the sync fills; later BC webhooks | Cues, sales risk | S → M |
| 4 | SharePoint change notifications into Recent activity (existing subscription service + delta) | Recent activity | M |
| 5 | Shift summaries to a channel via Teams Workflows (incoming webhooks retired May 2026) | Floor | S |
| 6 | Portal Awaiting you inside the BC Role Center via a WebPageViewer card part | Awaiting you, from BC | M |
| 7 | ~~Fix PO approver DM~~ **done, TASK-3898** | | |
| 8 | My next events and tasks (delegated Calendars.Read, Tasks.Read, OBO) | Headline | M → L |
| 9 | Copilot connector indexing portal records | Search | M → L |
| 10 | One-tap approve via Universal Actions (needs a bot) | Awaiting you | L |

Leave out: Microsoft Graph Toolkit (retired Aug 2026); per-seat Power BI embed for floor users; reading Teams chats
via Graph (metered); Business Events as a dependency (preview); Office 365 connectors (gone).

None of moves 1 to 6, 8 to 10 has a Mission Control task yet. They need Vince's priority call before filing.
