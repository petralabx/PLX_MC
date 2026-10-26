# TASK-3899 — Entra admin step: operator prompt

Paste the block below as the first message of a fresh agent session on a trusted
workstation with Entra admin rights (Cursor, Claude Code or Codex with the
PLX-MC-Hub connector). The agent must stop and ask before granting anything in Entra.

```text
You are doing Mission Control task TASK-3899 for petralabx/plx-customer-portal: confirm the daemon app's Teams roles and enable Teams channel routing on staging. This is an operator/admin task (kind admin-setup), not a code task. Do not invent values. Never print a secret. Stop and ask me if a step needs a consent you cannot grant.

Check out the task first: mc_checkout_task on PLX-MC-Hub with repo "petralabx/plx-customer-portal" and taskId "TASK-3899". Confirm actor.repo is petralabx/plx-customer-portal and taskId is a non-null string. Keep the dsp_* stamp for the completion step.

Background (read, do not re-verify unless something looks wrong):
- Teams channel routing is built in portal/src/lib/teams/routing.ts (qc, warehouse, ops-alerts channels) but TEAMS_NOTIFICATIONS_ENABLED is false.
- The daemon app PLX_Cursor_Graph (client id in env MICROSOFT_GRAPH_CLIENT_ID) has application roles Files, Sites, Mail, User.Read.All, Group.Create, User.Invite.All only. No Teams role. See docs/projects/manufacturing-suite/tenant-inventory-report.md:47 and tasks/ms365-comms-todo.md:224-228.
- Microsoft documents app-only POST to channel messages as migration-only (Teamwork.Migrate.All). Normal channel posting needs a delegated identity. The portal already runs one delegated identity for DMs: a refresh token for cos@ with ChatMessage.Send and Chat.ReadWrite (portal/src/lib/m365/auth.ts:233-298, env TEAMS_DM_DELEGATED_REFRESH_TOKEN).
- Teams Incoming Webhooks were retired in May 2026. Do not create one.
- PO approver DMs were fixed in PR #3015 (TASK-3898): they now pass User.entraObjectId.

Steps:
1. Source the staging secrets on this machine (~/.secrets-env.staging, or the PowerShell equivalent). Confirm MICROSOFT_GRAPH_CLIENT_ID and MICROSOFT_GRAPH_TENANT_ID are set without printing them.
2. Sign in to Azure CLI or Microsoft Graph PowerShell as an Entra admin. List the application roles granted to PLX_Cursor_Graph (az ad app permission list --id $MICROSOFT_GRAPH_CLIENT_ID, or GET /servicePrincipals/{id}/appRoleAssignments). Paste the role names into your notes. Confirm there is no ChannelMessage.Send or Teamwork.Migrate.All.
3. Decide the posting path and tell me before you act:
   Option A (recommended, matches the DM path): grant ChannelMessage.Send as a DELEGATED permission on the app, admin-consent it, mint a refresh token for the cos@ service identity with offline_access ChannelMessage.Send, and store it as TEAMS_CHANNEL_DELEGATED_REFRESH_TOKEN on the staging Vercel project. If the code expects a different variable name, grep portal/src/lib/m365/teams.ts and portal/src/lib/teams/routing.ts and use that name; if the channel post path is app-only today, stop and report that a small code change is needed before this task can finish.
   Option B: keep app-only and confirm on Microsoft Learn whether app-only channel POST works outside migration. Only pick B if Learn says it works today.
4. Get the three channel ids with Graph: GET /teams/{TEAMS_TEAM_ID}/channels. Pick the qc, warehouse and ops-alerts channels. Set on the staging Vercel project only, never production: TEAMS_CHANNEL_QC_ID, TEAMS_CHANNEL_WAREHOUSE_ID, TEAMS_CHANNEL_OPS_ALERTS_ID. Then set TEAMS_NOTIFICATIONS_ENABLED=true on staging only. Redeploy staging or wait for the next deploy.
5. Trigger one reorder alert on staging. Find the caller of sendTeamsAlert in portal/src/lib/services/reorder-alerts.ts and the cron or admin route that runs it; call it with the staging CRON_SECRET from the sourced env. Confirm a post lands in the warehouse channel. Take a screenshot of the post.
6. Record the decision: which option, which roles were granted, which variables were set (names only). Put it in docs/modules/m365-integration/README.md through a small PR on a branch from staging, stamped with this same checkout (MC-Checkout line in the PR body, the three commit trailers Agent: / On-Behalf-Of: vince@petrasoap.com / MC-Checkout:). If you cannot open a PR from this machine, put the same text in the completion summary instead.
7. Upload the screenshot with mc_upload_evidence (kind screenshot) on TASK-3899. Then mc_complete_task with: an STE-lite summary (at most 6 sentences per paragraph, 25 words per sentence), verificationCommands (the Graph role listing command, the reorder-alert trigger command, and "open the warehouse channel in Teams and confirm the post"), filesChanged if a PR was opened, and rollback: "Set TEAMS_NOTIFICATIONS_ENABLED=false on staging. Remove the delegated permission granted in step 3 if Option A was chosen. Production was never changed."

Acceptance: a reorder alert posts to the warehouse channel on staging; the README or completion summary names the posting path and the granted roles; the production flag stays off until UAT signs off.
```
