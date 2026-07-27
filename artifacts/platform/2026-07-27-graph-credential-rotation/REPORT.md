# PLX_Forms Graph Credential Rotation — Readout

- **Date:** 2026-07-27
- **Domain:** platform
- **Status:** Runbook filed. Rotation **not started** — blocked on app identity.
- **MC tasks:** TASK-742 (this rotation), TASK-750 (PLX_Cursor_Graph excess roles), TASK-751 (three other plaintext credentials in the same loader)

## What happened

The PLX_Forms app-only Graph client secret (app `c4b5438d`) was stored in plaintext in
`~/.secrets-env.staging.ps1` and was read into an AI agent session transcript on
2026-07-27. The credential carries tenant-wide `Sites.FullControl.All`,
`Files.ReadWrite.All`, `Mail.ReadWrite` and `Mail.Send`, so it must be rotated.

Separately and in the same session, a dedicated credential (`PLX_Cursor_Graph`,
`34cd4ff8`) was stood up for Cursor IDE and Cloud Agents, backed by AWS Secrets Manager
`plx/prod/m365/cursor-graph/v1`. That app is scoped to `cos@` for mail and is **not** in
scope for this rotation.

## Findings that changed the plan

1. **Business Central is not at risk from this rotation.** `business-central/config.ts`
   falls back `BC_CLIENT_SECRET || AZURE_CLIENT_SECRET || MICROSOFT_GRAPH_CLIENT_SECRET`.
   `BC_CLIENT_SECRET` is unset, but `AZURE_CLIENT_SECRET` is set on all three Vercel
   environments and takes precedence, so `/api/cron/bc-sync` never reaches the Graph
   fallback. The inverse is the real hazard: rotating `AZURE_CLIENT_SECRET` would break BC.
2. **PLX_Forms mail was never tenant-wide.** Probing showed `cos@` 200, `vince@` 200,
   `ricardo@` 403, stable across 18 minutes. A refused third-party mailbox proves a
   `RestrictAccess` policy is already bound, and the stability rules out propagation. The
   app is scoped to a group broader than it should be, but not tenant-wide. The original
   claim was inferred from a documentation gap rather than measured.
3. **Six stores, not five.** `plx-mission-control` was missing from the inventory,
   `plx-vmc-preview` holds `AZURE_*` rather than `MICROSOFT_GRAPH_*` names, and
   `plx-customer-portal` holds duplicate `MICROSOFT_GRAPH_*` entries — one set covering
   development+preview+production and a second preview-only set — so preview can silently
   resolve to a different credential than production.

## Blocker

`MICROSOFT_GRAPH_CLIENT_ID` names **different app registrations depending on the store**.
The workstation loader assigned PLX_Forms (`c4b5438d`); portal and swarm docs assign
`3013790b`, the Teams SSO resource, to the same variable name. Vercel values are encrypted
at rest, so which app each store holds is unconfirmed. This is the likely mechanism behind
the 2026-07-26 app-only Graph 401 outage recorded in Internal-SOP v8.40.

## Recommendation

1. Resolve app identity per store first: mint a client-credentials token from each store's
   values and decode the `appid` claim. This identifies the app without the plaintext secret.
2. Then run the runbook create-new-alongside-old, updating and verifying every store before
   deleting the old secret. Rollback is only possible before that final delete.
3. Narrowing PLX_Forms mail is a separate change from rotation: because a policy already
   exists, `scope-mail-to-mailbox.ps1` skips creation, so narrowing requires editing the
   bound group's membership directly. Read the membership first — every member is a mailbox
   this credential can both read and send as.
