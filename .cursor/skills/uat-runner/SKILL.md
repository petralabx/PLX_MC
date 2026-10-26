---
name: uat-runner
description: Run PLX portal User Acceptance Testing (UAT) scenarios and record results as governed evidence. Use when asked to run UAT, execute acceptance tests for the customer portal, validate go-live readiness, or update the portal UAT quality-ledger. Records case results in the portal uat quality-ledger (Mission Control reads it through Loop Ledgers) and follows the per-ticket MC contract for UAT feedback tickets. UAT results are PASS, FAIL or unverified, never Verified.
---

# UAT Runner Skill

Run User Acceptance Testing for the PLX customer portal and land the results where
humans (in Mission Control) and agents both see them. The cross-repo contract is
`PLX_MC/docs/modules/uat/README.md`.

## Two kinds of UAT work

| Work | System of record | MC shape |
|---|---|---|
| **UAT case runs** (SOP scenarios, go-live readiness) | The portal `uat` quality-ledger (`plx-customer-portal/docs/portal/quality-ledger/uat.artifacts.json`, schema `vmc-quality-ledger/v1`). MC reads it through Loop Ledgers. | One governed task for the run. Never a `uat:<feedbackId>` label. |
| **UAT feedback tickets** (a person filed a bug in the portal) | The portal's gold `Feedback` record in Prisma. SharePoint is a projection; MC mirrors it. | One task per ticket attempt in `BKT-UAT`: `kind:code` + `uat:<feedbackId>` (+ `uat-attempt:<n>` from attempt 2). The portal creates it; PLX Steward leases it. |

## Rules for both

- UAT results are **PASS**, **FAIL** or **unverified**. Never write, set or claim **Verified** (Vince, 2026-10-26).
- Only the person who filed a ticket records its re-test result, in the portal. MC refuses `stage: verified` on a UAT ticket task from any agent.
- Do not fabricate a PASS. A case with no evidence is `missing_test`, not a pass.
- Staging only.

## Workflow A: run UAT cases

1. **Govern the run (PLX-MC MCP).** Needs `MC_MCP_API_KEY` and `MC_OPERATOR_EMAIL`.
   - `mc_self_check` to confirm auth.
   - Find the run's task with `mc_search_tasks` by exact title or label. Create one with `mc_create_task` only on a real miss, with labels and an `idempotencyKey`, in the bucket the task belongs to. Never add a `uat:<feedbackId>` label.
   - `mc_checkout_task` with `repo: "petralabx/plx-customer-portal"`. Keep the `MC-Checkout: dsp_…` line for the PR body.
2. **Run the cases.** Use the portal SOP (`plx-customer-portal/docs/UAT-SOP-Customer-Portal.md`). Seed test data with `portal/scripts/create-uat-test-customers.ts`. Capture PASS, FAIL or unverified, with evidence, per case.
3. **Record to the portal ledger.** Update `docs/portal/quality-ledger/uat.artifacts.json`: one artifact per UAT area or case, with a real `status`, `severity` and `safety_class` and non-empty `evidence`. Regenerate the `.md` mirror with the portal's ledger script. The shape is in `PLX_MC/docs/templates/quality-ledger/`.
4. **Close the loop.** Open the portal PR to `staging` with the `MC-Checkout` line in the body at open. Then `mc_complete_task` with a summary, `verificationCommands` and `rollback`.

## Workflow B: fix a UAT feedback ticket

1. **Find the ticket's task by label**, never by free text: `mc_search_tasks` with `label: "uat:<feedbackId>"` (and `uat-attempt:<n>` for a re-attempt). Do not create one: the portal's ticket-task sweep does, with the idempotency key `uat-<feedbackId>` (or `uat-<feedbackId>-a<n>`).
2. **Check it out** with `mc_checkout_task { taskId, repo: "petralabx/plx-customer-portal" }` on a `cursor/uat-*` branch.
3. **Fix and open the PR to `staging`.** The body carries `MC-Checkout: dsp_…` and the `UAT-Feedback:` stamp. A branch push alone is not delivery.
4. **Complete with the PR.** `mc_complete_task` needs `prUrl` on a BKT-UAT ticket task, unless the outcome is `blocked` or `failed`.
5. **Stop there.** The merge moves the task to Merged, which means waiting on the person's re-test. The portal mirrors hold, re-attempt, cancel and the re-test result to MC. If you cannot finish, report `uat-attempt n= outcome=blocked|failed cause=…` with `mc_report_progress`.

## Guardrails

- Do not write UAT results into PLX_MC. MC reads the ledger and mirrors the portal.
- Do not put a `uat:<feedbackId>` label on any task the portal did not create.
- Portal changes go through the normal portal review and merge queue. This skill does not bypass portal governance.

## Reuse

- `vmc-sync`: the general MC checkout, progress and complete pattern.
- `PLX_MC/docs/modules/uat/README.md`: the cross-repo UAT contract.
- `PLX_MC/docs/templates/quality-ledger/`: the `vmc-quality-ledger/v1` template.
