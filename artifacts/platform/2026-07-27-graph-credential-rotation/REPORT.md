# PLX_Forms Graph Credential Rotation — Readout

- **Date:** 2026-07-27
- **Domain:** platform
- **Status:** Remediated 2026-07-27. Exposed secret revoked, all four copies deleted. No store update was required.
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

## Blocker — resolved 2026-07-27

`MICROSOFT_GRAPH_CLIENT_ID` did name **different app registrations depending on the store**.
Resolved by decrypting each Vercel environment with `vercel env pull`; the REST API with
`?decrypt=true` returns the encrypted envelope rather than plaintext, which is why the
earlier attempt failed. Secrets compared by SHA-256 fingerprint, never by value:

| Store | App | Secret fp |
|---|---|---|
| Vercel plx-customer-portal — production | `3013790b` | `93429af766` |
| Vercel plx-customer-portal — preview | `3013790b` | `93429af766` |
| Vercel plx-customer-portal — development | `3013790b` | `93429af766` |
| AWS SM `prod/ec2-secrets` | `3013790b` | `93429af766` |
| AWS SM `staging/ec2-secrets` | `3013790b` | `93429af766` |
| **Exposed PLX_Forms credential** | `c4b5438d` | `77237f1393` |

**No deployed store ever held the exposed credential.** PLX_Forms existed only on the
workstation, because `scripts/bootstrap-windows-secrets.py` prefers the local `PLX_FORMS_*`
files over Secrets Manager. That is the mechanism behind the 2026-07-26 401 outage: the
workstation authenticated as a different app than every server while using identical
variable names.

Two findings recorded earlier in this incident were themselves wrong, and are retracted:

1. "`AZURE_CLIENT_SECRET` holds three different values across environments and differs from
   `MICROSOFT_GRAPH_CLIENT_SECRET`" — false. That compared *ciphertext* lengths, which vary
   with the encryption envelope and say nothing about plaintext. Decrypted, all three portal
   environments hold the same secret, and both variable names point at one credential.
2. "Duplicate preview-scoped entries may resolve to a different credential than production" —
   did not materialise; preview resolves to the same value as production.

## What was actually done

Because no deployed store held the credential, the per-store rotation in `RUNBOOK.md` was
unnecessary. The remediation was containment plus cleanup:

1. Operator deleted client secret `6da1f9b6-168a-4a43-8f3b-4bc15ca1f469` on PLX_Forms.
2. Revocation verified: the exposed secret now returns `invalid_client` / `AADSTS7000215`,
   while a control credential in the same tenant minted a token in the same run. The control
   matters — a blanket failure would look identical to successful revocation.
3. All four plaintext copies deleted. A ripgrep content sweep found one more than the three
   previously known:
   - `~/.aws/forms-api-secret-value.txt`
   - `~/Documents/old-laptop-txt-files/01-sensitive-credentials/.aws/forms-api-secret-value.txt`
   - `~/Documents/old-laptop-organized/01-credentials-and-secrets/text-files/.aws/forms-api-secret-value.txt`
   - `~/.secrets-env.staging.ps1.bak-20260727-graph`
4. Stale `PLX_FORMS_*` identifier files removed from `~/.aws`. Left beside a deleted value
   file, they would have made the bootstrap script emit PLX_Forms IDs paired with
   `3013790b`'s secret — a guaranteed 401.
5. Live loader confirmed unaffected; it resolves PLX_Cursor_Graph from
   `plx/prod/m365/cursor-graph/v1`.

`RUNBOOK.md` is retained as the reference procedure for the next credential rotation. Its
store table was corrected, but its create-new-alongside-old sequence was never exercised.

## Still open

- **`bootstrap-windows-secrets.py`, in two copies**, prefers `PLX_FORMS_*` files over Secrets
  Manager and would also overwrite the PLX_Cursor_Graph wiring. Which app a workstation should
  use is a design decision rather than cleanup, so it is not resolved here.
- **The PLX_Forms app registration still exists**, carrying 21 tenant-wide roles with no valid
  secret. Retire it after the 30-day observation window.
- **Two stores remain unverified.** Vercel `plx-mission-control` and `plx-vmc-preview` hold
  their vars as Vercel *sensitive* type, which cannot be read back by API or dashboard by
  design. PLX_MC's `TOOLS.md` documents its Graph auth as the broad "Vinces MCP" app, matching
  `3013790b` in Secrets Manager, so PLX_Forms is unlikely there — inference, not measurement.
- **GitHub Actions secrets** on `petralabx/plx-customer-portal` could not be enumerated; the
  PAT returns HTTP 403 on that endpoint.
- **Two archived credential dumps** remain on disk under `~/Documents/old-laptop-*`, holding
  material well beyond this credential.

## Lesson

The blast radius was documented as four roles. The token carried 21, including
`CallTranscripts.Read.All`, `Notes.ReadWrite.All`, `Calendars.ReadWrite`, `Tasks.ReadWrite.All`
and `User.Read.All`. Decode the `roles` claim rather than trusting any written inventory, and
never infer a credential's contents from ciphertext metadata.
