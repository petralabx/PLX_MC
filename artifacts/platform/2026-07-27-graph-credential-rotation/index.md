# Graph Credential Rotation — 2026-07-27

Evidence bundle for the exposed PLX_Forms app-only Graph client secret (app `c4b5438d`).

- **Date:** 2026-07-27
- **Domain:** platform
- **Status:** Remediated 2026-07-27 — secret revoked, all four copies deleted, no store update required
- **MC tasks:** TASK-742 (rotation), TASK-750 (PLX_Cursor_Graph excess roles), TASK-751 (other plaintext credentials)

## Contents

| File | What |
|---|---|
| [REPORT.md](REPORT.md) | Executive readout — what happened, the three findings that changed the plan, the blocker, and the recommended order of work |
| [RUNBOOK.md](RUNBOOK.md) | Per-store rotation procedure with verification steps for each store |

## Related tooling

The admin scripts referenced by the runbook live in the `plx-graph-mail` skill
(`petralabx/skills`, PR #16): `verify-graph-app.ps1`, `scope-mail-to-mailbox.ps1`,
`diagnose-mail-scope.ps1`, `apply-mail-rbac.ps1`, `revoke-excess-graph-roles.ps1`.

## Caution

No credential values belong in this bundle. A partial GitHub PAT value was redacted from
`RUNBOOK.md` before it was committed; keep it that way.
