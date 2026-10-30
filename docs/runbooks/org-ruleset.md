# One org ruleset for every repo

Owner: Vince. Decision: 2026-10-25 (TASK-3901).

Every petralabx repo's default branch runs one org ruleset. The JSON in
`config/github/` is the source. Change the JSON in a PR first, then apply it.
`tests/org-ruleset.test.ts` keeps it uniform, merge-commit only and free of
bypass actors.

## What it requires

Phase 1, which every repo meets today:

- A pull request. Merges are merge commits only.
- No force-push, and no deletion of the default branch.
- The compliance gate (`.github/workflows/compliance-gate.yml` on PLX_MC `main`)
  as a required workflow.
- No bypass actors, CIP included. In an emergency, an org owner sets the ruleset
  to Disabled. The audit log records it.

Phase 2 adds:

- The required checks `ci` and `ai-review/verdict`, from GitHub Actions only.
  Each repo reports `ci` from one roll-up job. It needs the repo's required
  jobs and waits for the required checks its other workflows report.
- The org-wide merge-hold workflow (`.github/workflows/org-merge-hold.yml` on
  PLX_MC `main`). It reads the `hold` label live when a PR enters the queue.
- A merge queue: merge commits, all-green groups of up to 5, 60-minute timeout.

A person approves only money, migration and workflow changes, in MC approvals.
The compliance gate checks that approval. The ruleset does not.

## Apply phase 1

1. Check that no automation pushes straight to any repo's default branch.
   Phase 1 makes a pull request mandatory.
2. Open the [org rulesets](https://github.com/organizations/petralabx/settings/rules).
3. Select **New ruleset**, then **Import a ruleset**.
4. Upload `config/github/petralabx-default-branch.phase1.json`.
5. Check the target: all repositories, default branch. Select **Create**.
6. Set the old ruleset "PLX MC Compliance Gate" to Disabled. Phase 1 holds its workflow.
7. In PLX_MC and agentic-swarm, set "cip-only-merge (TASK-3459)" to Disabled.
8. In every repo, open Settings → General → Pull Requests. Keep **Allow merge
   commits** on, and turn **Allow squash merging** and **Allow rebase merging**
   off (Vince, 2026-10-30: never squash anything, TASK-4194). The ruleset covers
   the default branch only. This setting also covers other bases, such as the
   portal's `staging`. Read it back afterwards:
   `gh api repos/petralabx/<repo> --jq '{merge: .allow_merge_commit, squash: .allow_squash_merge, rebase: .allow_rebase_merge}'`.
   It is a repo-setting change, so it needs Vince's OK, typed in the acting
   bot's chat.

## Apply phase 2

Apply phase 2 only after every repo reports `ci` and `ai-review/verdict`, and
runs both on `merge_group`.

1. Open the org ruleset and import `petralabx-default-branch.phase2.json` over it.
2. Delete the repo rulesets that phase 2 replaces: portal `staging-protection`,
   PLX_MC `PLX_MC main required checks`, agentic-swarm `agentic-main-promotion`,
   and both `cip-only-merge`.
3. Delete the old branch protection rules (repo Settings → Branches). The
   rulesets pages do not show them, and they apply to admins too. On
   2026-10-25 they were on PLX_MC `main` (`compliance`), portal `staging`
   (`lint-typecheck-build`, `compliance`, `Validate ledgers (vmc-quality-ledger/v1)`),
   and local-inference and skills `main` (`compliance`, branches up to date).
   agentic-swarm and plx_secondbrain had none. Check every other repo too.
4. In the portal, delete `.github/workflows/merge-hold.yml` in a PR. The org
   workflow reports `merge-hold` now, and two producers of one check confuse
   the queue.

## Roll back

`config/github/rulesets-2026-10-25/` holds each ruleset as it was on
2026-10-25. To restore one, import its JSON in the repo or org ruleset settings.
Disable the org ruleset first.
