# Frontier stack — implementation spec

```
status: r13 draft, Vince's yes received 2026-09-29T18:09:35Z ("yes r13, D5 as r13"), pending round 10; r12 approved 28 Sep 2026, and that approval stands for every phase r13 does not change (approval_covers)
revision: r13 (28 Sep 2026, a draft under D13, after PLX_MC PR #255 merged at 22:11 UTC as f6d2bab7670a: F1, F2, F6, F10, F11, F23 and F24 re-derived at PLX_MC fc7ceef3d123 and portal 2b656d8adf33, and F13's portal test lines re-cited; D2 and D4 re-derived with the same defaults; P4 and P16 re-derived against the merged code, and every test line they cite re-cited; the P16 portal half gains the portal mc-compliance.mdc lines that forbid the edited trigger and name three trigger types, after P8 and P10 on the portal and within P10's caps; P15 records the merged #255 and the generator's trigger types, and runs again under r13 before P16 starts, because an r12 run of P15 does not satisfy r13; the P16 PLX_MC acceptance reads P15's two r13 lines; D5, D14, F26, P13 and P14 follow swarm retirement r12 section 10: a brain key from BRAIN_API_KEYS, the address from R6a, and the R6 routes stay. r13 needs Vince's yes, because D5 is a changed default: the form is "yes r13, D5 as r13"; the phrase "D5 as r13" may instead come with the P14 later yes, and P14 records it. Round 10 reviews every r13 change, P4, P15 and P16 and D5, D14, F26, P13 and P14. The r13 changes run only after that yes and that review: P4's code branch, the P15 re-run, P16 and P14. The r12 approval stands for the phases r13 does not change, and they keep running under it. r12: swarm retirement applied, so P7 and the swarm halves of P8, P9 and P10 are withdrawn; P14 waits for the brain's own address; PLX_MC PR #255 gates P4 and P16; round 9 reviewed the r12 changes. Editorial, after approval on 28 Sep 2026: approval recorded, the spec committed to PLX_MC `docs/specs/`, and F25, F26, D10, D14 and SC-12 aligned with swarm retirement r4, where the trading lab keeps the repo and the old host; no phase, gate, acceptance or default changed. r11: adversarial review, 27 Sep 2026; D1 and D12 confirmed 28 Sep 2026. Record: frontier-review-log.md)
approved_by: vince@petrasoap.com (r12)
approved_at: 2026-09-28T14:23:22Z (r12)
approval_covers: r12: every phase r13 does not change (P1, P2, P3, P5, P6, P8, P9, P10, P11, P12), and the first-yes gate of P13 and P15
r13_yes: yes (vince@petrasoap.com, 2026-09-29T18:09:35Z, "yes r13, D5 as r13")
d5_r13_yes: yes (the same answer includes the phrase "D5 as r13"; P14 still records it in brain-register.md)
pending_r13_changes: P4's code branch, the P15 re-run and P16 (D13); D5, D14, F26, the P13 r13 line and P14 (retirement section 10). r13_yes and d5_r13_yes are recorded; each change still waits for round_10; P14 also for its later yes
round_10: pending (the independent critic reviews every r13 change, blind, then the author verifies: P4, P15, P16 under D13; D5, D14, F26, P13, P14 under retirement section 10. Logged in frontier-review-log.md; its findings are applied before any pending r13 change starts)
accountable_human: vince@petrasoap.com
```

Vince approved r12 on 28 Sep 2026 (the approval question is at the end). Setup runs on that yes.

r13 (28 Sep 2026) is a draft revision written under D13, after PLX_MC PR #255 merged.
It changes P4, P15 and P16, and the facts and decisions they rest on (F1, F2, F6, F10,
F11, F23, F24, D2, D4, D13). It also applies swarm retirement r12 section 10 to D5, D14,
F26, P13 and P14. D5 is a changed default, not a re-derived one: r12's yes covered r12's
D5, and the rule under "Decisions a yes confirms" puts a changed default to Vince. Vince
answered on 2026-09-29T18:09:35Z: `yes r13, D5 as r13`. The header records that yes.
The phrase `D5 as r13` confirms D5. P14 still records it in `brain-register.md` and
does not start without that record (D5, D14, SC-8). The header says what r13 leaves
pending. Round 10 reviews every r13 change: P4, P15 and P16 (D13), and D5, D14, F26,
P13 and P14 (retirement section 10). The r13 changes run only after that review:
P4's code branch, the P15 re-run, P16 and P14 (D13, SC-13). Until then, the r12
approval stands for the phases r13 does not change, and they run under it. P13 and P15
keep their first-yes gate. An r12 run of P15 does not satisfy r13: P15 runs again under
r13 before P16 starts (its D13 note), and the P16 PLX_MC acceptance reads its r13 lines.
A P13 run under either revision is valid, because r13 changes only one fact P13 records.
r13 adds no first-yes phase.

Operator decision on 27 Sep 2026: "I want it all." That decision puts all five
frontier workstreams into this spec, plus the two cloud proofs. It overrides the
earlier choice to leave the fleet diet on its own draft. The override covers the
non-Jev slices only. Jev products stay out. `docs/jev-fleet-implementation-spec.md`
remains the record of that rejection, and it still owns skill packs and enforcement.
In this file, "the fleet spec" means that draft, not the agent fleet spec below.

Operator decisions on 28 Sep 2026: retire the swarm (swarm retirement spec r2) and
build the agent fleet on the portal registry (agent fleet spec r4). r12 applies them:
- No phase edits `petralabx/agentic-swarm` any more. P7 (the swarm writer lock) is
  withdrawn: the writers write only the swarm repo, which no phase edits now (F25).
- P8, P9 and P10 drop their swarm halves. The context diet covers the portal, PLX_MC
  and plx_secondbrain. P5 and P6 still read the swarm as a measured baseline.
- P14 becomes a later yes that names the brain's own address from the retirement
  spec's R7 (D14).
- PLX_MC PR #255 changed how stamps expire and release (F24). P4's code branch and
  P16 waited until it merged or closed (D13). It merged on 28 Sep 2026 at 22:11 UTC as
  `f6d2bab7670a`; r13 applies it.

## Does an approved plan exist?

Yes. This file: r12, approved by Vince on 28 Sep 2026. The r13 draft changes to P4, P15
and P16 (D13) and to D5, D14, F26, P13 and P14 (retirement section 10) are pending
Vince's yes on r13 (`yes r13, D5 as r13`; D5 is a changed default) and round 10. Before
the r12 answer, nothing in the project was an approved implementation plan. The
documents below are not approved plans.

| Document | Status | What it is |
|---|---|---|
| `docs/jev-fleet-implementation-spec.md` | Draft. Independent review NOT_APPROVED / NO-GO on full execution. AGREE on rejecting Jev. | Context diet. This spec takes its meter, complete-order sentence, loader canary, and guide trim (r12 dropped the swarm writer lock). Skill packs and enforcement stay on that draft. |
| `internal/frontier-package-fit.md` | Strategy note. Loop verdict NOT_APPROVED because there is no code change. | Exclusive checkout, the brain connector, and the merge-queue stall are named there. This spec is the plan that contains them. |
| `docs/parity-plan.md`, `docs/project-context.md` | Inventory, 25 Sep 2026. | Capability matrix. They do not authorize edits. |
| Swarm retirement spec, r12 (`docs/specs/swarm-retirement-spec.md` in PLX_MC) | D1–D13 confirmed; reviewed in seven rounds, then closed by the operator on 28 Sep 2026. | Retires the swarm; moves the brain to plx_secondbrain at `brain.plxcustomer.io`; leaves the trading lab untouched. Its section 10 lists the r12 changes and what r13 picks up. |
| Agent fleet spec, r13 (`docs/specs/agent-fleet-spec.md` in PLX_MC) | D1–D26 confirmed; reviewed in seven rounds plus one pass on r13 (28 Sep 2026). | Agents in the portal registry, a runner, and COS as the chief of staff. It adds no guide roster. |

The first four documents live in the Cursor project store. The last two, and this spec,
are in PLX_MC `docs/specs/`.

## Facts this spec relies on

Checked on 27 Sep 2026 against these heads: portal `95276888b6ed` (= `origin/staging`),
PLX_MC `2faa2a2c9633`, agentic-swarm `35ed5034eddf`, plx_secondbrain `af0b3ea3c9f8`.
A phase that finds a fact changed stops and reports. It does not work around it.
r12 adds F24–F26, checked on 28 Sep 2026. r13 re-checks F1, F2, F6, F11, F23 and F24
against PLX_MC `fc7ceef3d123` (the pin for this revision; it includes #255's merge commit
`f6d2bab7670a`; later commits on `main` do not move the pin), and F10 and F13's portal test lines against portal `2b656d8adf33`
(the pin for this revision, portal `staging` on 28 Sep 2026; later commits do not move the pin). Between `2faa2a2c9633` and `fc7ceef3d123`
no other PLX_MC file cited in F3, F8, F13, F17, F18 or F22 changed (`git diff --stat`),
so those citations hold. At portal `2b656d8adf33` the F14 sweep finds the same 19
lines in the same 15 files; only `prompts/workbench-readonly-build-prompt.md:354`
moved to `:359`. Several F14 files gained `workbench-api` in their required-checks
line (TASK-2037), which moved no F14 line.

| # | Fact | Evidence |
|---|---|---|
| F1 | `checkout()` mints a new id on every call. It does not look up a live dispatch first. `mc_dispatch` has only a non-unique `task_id` index; migration `026` adds `released_at` and `released_reason` and no constraint. Code prediction for a second call on the same task and repo: a second stamp. Re-checked at `fc7ceef3d123`, after #255. | PLX_MC `src/lib/compliance/service.ts:198-266`; `src/lib/compliance/repo.ts:198-213`; `db/migrations/008_compliance.sql:25-37`, `026_dispatch_release.sql:3-4` |
| F2 | Nothing sets `revoked`. `complete()` validates the stamp and appends `task.completed` with `payload.checkoutId`; it rejects an unknown, revoked, released or expired stamp, and it does not release the stamp. Since #255 (TASK-2011), the PR lifecycle releases a stamp: on `closed`, `ingestPullRequest` sets `released_at` and `released_reason` (`merged` or `closed`) after attribution and projection and appends `checkout.released`; on `reopened`, it clears the release of an unrevoked, repo-matching stamp. In the ledger and the checkout listing, "live" means `NOT revoked AND released_at IS NULL AND expires_at > now()`; the TTL is still `issued_at + 480 min`. For verify, an expired, unrevoked, unreleased, repo-bound stamp still passes when GitHub shows its PR open, the live body carries the stamp, and its task exists and is not `verified`. That GitHub read happens once per PR and only on expiry; a GitHub failure fails closed. A stamp with no PR (P2, P3) has no such exception. `resolveDispatchForMerge` accepts an expired, unrevoked, repo-bound stamp when the gate passed that exact PR head for its task; it does not test release, so attribution survives release. | PLX_MC `service.ts:57-59,113-158,169-180`, `complete()` `:278-324`, `ingestPullRequest()` `:812-819,919-925`; `repo.ts:253-299,301-326`; `db/migrations/026_dispatch_release.sql`; `docs/product/SYSTEM_OF_RECORD.md:45-51` |
| F3 | The MCP tool `mc_self_check` returns `ok`, operator, counts, and honesty fields. It returns no principal. `GET /api/cursor/self-check` returns the same `data` plus `meta.actor`, which includes `servicePrincipalId` (derived from the API key) and `repo` (echoed from the `x-mc-repo` header). `parse_error` is not a server field. Every `/api/cursor/*` call needs the headers `x-mc-operator-email` and `x-mc-repo`. `x-mc-runtime` is self-asserted and defaults to `cursor`. | PLX_MC `src/lib/mcp/actions.ts:61-72`; `src/app/api/cursor/self-check/route.ts`; `src/lib/mcp/envelope.ts:49`; `src/lib/mcp/auth.ts:120-140` |
| F4 | This Claude account lists two environments. On 28 Sep 2026 the operator renamed `env_01SVX8gUwth13dQuc5G2wRDQ` (formerly `PLX`) to `PLX Portal + MC`. The other is `Default` (`env_011f8FzdosCcNnecSTiXrX2U`), which carries the runbook variables. The review session cannot read the renamed environment's variables or network policy. | `list_environments` on 27 and 28 Sep 2026; portal `docs/runbooks/CLAUDE-CODE-WEB-MC-SETUP.md:110,117-125` |
| F5 | A multi-repo Claude web session starts in `/home/user`. That folder has no `.mcp.json`, so no PLX-MC tools load even with the key set. | Review session: six repos, `Default` environment, no `mc_*` tools |
| F6 | The source of `~/bin/plx-mc-stamp` is not committed in any of the six repos. The runbook documents env vars and output fields only. The Codex key maps to `sp_mcp_codex`. The checkout response carries no issue or expiry time. `GET /api/cursor/checkouts?taskId=&repo=&active=` returns rows with no raw id: each has `checkoutRef` (`dsp_…` plus the id's last 4 chars), `issuedAt`, `expiresAt`, `releasedAt`, `releasedReason`, and `active`. Since #255, `active` is false for a released stamp; it is a ledger-only flag and ignores the open-PR exception (F2). | portal `docs/runbooks/CODEX-CLOUD.md:33-51`; PLX_MC `actions.ts:357-384`, `src/app/api/cursor/checkouts/route.ts:1-25`, `src/lib/mcp/read-actions.ts:47-87,203-206` |
| F7 | Appendix A reproduces the baseline numbers exactly: portal cursor 129113 at `b75477d9c85d`, PLX_MC cursor 52966 at `2faa2a2c9633`, and swarm codex `bytes_dropped` 44171 at `35ed5034eddf`. Portal Claude is 15862 raw bytes; the old 15861 dropped the trailing newline. At the heads above: portal cursor 130138, swarm cursor 117574 (the old 117875 had no SHA). | Appendix A run in the review session |
| F8 | PLX_MC: `scripts/generate-governance-surfaces.py` writes one block (including "Agent Task & PR Workflow", from `agent_workflow`) into AGENTS, CLAUDE, CODEX, GROK, GEMINI, and HERMES, and rewrites `.cursor/rules/governance.mdc`. Drift is checked by `--check` in `preflight.sh:103`. **Swarm:** the same-named generator writes only CLAUDE, CODEX, GROK, GEMINI, and HERMES marker blocks (`agent_behavior` + `writing_style`) plus `governance.mdc`; it does not touch AGENTS.md. `agent_behavior` is also injected into every swarm agent's runtime prompt, and `tests/test_governance_gates.py:89` pins 12 rules. Swarm AGENTS.md's only generated part is the `sync_cursor_rules_to_agents.py` embed of every `alwaysApply` rule, whose marker line starts at byte 33026, past the 32768-byte Codex cap. The hand-written Mission Control handshake section starts near byte 466. | PLX_MC `config/governance-contract.yaml:23-31,108`; swarm `scripts/generate-governance-surfaces.py:32,202-220`, `src/governance_preamble.py:25-40`, `.github/workflows/test.yml:129-134`, `tests/test_sync_cursor_rules_to_agents.py:76-79` |
| F9 | Swarm has two Lobster writers that push to `main` from `/home/ubuntu/agentic-swarm-8`. **(a)** `governance_repo_sync.py`: nightly at 01:30 ET, `dry_run: false`. Its allowlist permits AGENTS, CLAUDE, CODEX, GROK, GEMINI, HERMES, SOUL, TOOLS, `.cursor/rules/`, and `config/` (which includes `config/governance-contract.yaml`). **(b)** `lessons_rule_promote.py`: weekly. It writes `lessons/auto/promoted.md`, `.cursor/rules/operational-lessons.mdc` (`alwaysApply`), the `lessons:auto` blocks in CLAUDE, CODEX, GROK, and GEMINI, and `config/lessons.yaml`. `sync_to_sharepoint.py` writes SharePoint lists only. The phrase "lobster path" does not exist. Swarm CI runs on push to `main`, PRs to `main`, and `merge_group` only. | swarm `src/pipelines/governance_repo_sync.py:143-203`; `config/pipelines.yaml:421-431`; `src/pipelines/lessons_rule_promote.py:1-35,171-176`; `config/vmc-web-crontab:82`; `src/tools/sync_to_sharepoint.py:312-317`; `.github/workflows/test.yml:3-8` |
| F10 | Portal `plx-mc-compliance.yml` triggers on `pull_request` only, types `opened, synchronize, reopened` (job `compliance`). It is the copy pinned at `GEN_SHA` `1339f1196d4e…`, which predates #255, so it has no `edited`. `compliance-merge-group.yml` (TASK-2008) emits job `compliance` on `merge_group` and calls portal-only `scripts/merge-group-prs.mjs`. Its header says: once the generator grows `merge_group`, regenerate, bump `GEN_SHA`, and delete this file. `ci-staged-gate.test.mjs:871-956` pins that stopgap layout and runs in required CI; `:20` imports `scripts/merge-group-prs.mjs` and `:958-980` tests it. `lint-typecheck-build`, `Validate ledgers` and, since 28 Sep 2026, `workbench-api` (TASK-2037) already trigger on `merge_group`. The queue is not on for ruleset `18632985`; the planned `max_entries_to_merge` is 1. The drift check runs in each consumer against a pinned `GEN_SHA`. Re-checked at portal `2b656d8adf33`. | portal `.github/workflows/plx-mc-compliance.yml:8-10`; `compliance-merge-group.yml:1-19,168`; `scripts/ci-staged-gate.test.mjs:20,871-956,958-980`; `ci.yml:98,114,216-217,248`; `mc-quality-ledger.yml:20-33`; `compliance-gate-drift.yml:22-28`; `docs/runbooks/BRANCH-PROTECTION-STAGING.md:44-46,305-385` |
| F11 | `/api/compliance/verify` takes `repo`, `repoFullName`, `prNumber`, `headSha`, `changedPaths`, `labels`, `checkoutId` and `checkoutIds`. It takes no PR body and no `event`. OIDC tokens from events other than `pull_request` are rejected. Only `plx-mc-compliance.yml` and `compliance-gate.yml` are allowed. Bearer `COMPLIANCE_CI_TOKEN` has no binding. Since #255, `verifyPr` resolves each stamp with `prDispatchResolver`: `resolveDispatch` first (unknown, revoked, released, repo mismatch, expired, in that order); on `expired` only, one `loadPrState` GitHub read per PR, then `resolveDispatchForOpenPr` (PR open, stamp in the live body, task present and not `verified`). A GitHub failure throws, so `verifyPrOrQueue` answers `pending` and queues the verify (fail closed). The merge-queue rule in D4 is stricter and makes no GitHub read. | PLX_MC `src/app/api/compliance/verify/route.ts:24-33,51-64,88-102,137-147`; `service.ts:108-158,407-460,1010-1023`; `github-pr.ts:19-39` |
| F12 | Each of the four nested portal guides opens with "Auto-generated … by `scripts/sync-agents-md.py`. Do not edit manually." All four name retired agents, "Factory" among them (always the agent, never the plant). `components/AGENTS.md` lacks the consumer-copy banner the SOP requires. `scripts/sync-agents-md.py` still exists at the repo root; nothing in CI runs it. | portal `portal/src/*/AGENTS.md:3-10`, `portal/prisma/AGENTS.md`; `docs/runbooks/PLX-PORTAL-GOVERNANCE-SOP.md:165-173`; `scripts/audit-module-coverage.sh:211-229,333` |
| F13 | Portal required CI (`ci.yml:139` runs all of `scripts/ci-staged-gate.test.mjs`) reads real guide text in several places. The TASK-2004 test (`:766-828` at portal `2b656d8adf33`; its loop at `:820-827` requires root AGENTS.md, CLAUDE.md, GEMINI.md, and `.cursorrules` to carry the staging-merge sentence) bans phrases in AGENTS.md, CLAUDE.md, and `mc-compliance.mdc`, and pins exact strings in `.cursor/rules/auto-merge-after-push.mdc`, `.cursor/rules/pr-watch-until-green.mdc`, and two `.cursor/skills/*/SKILL.md`. The TASK-2008 test (`:871-956`) pins `auto-merge-after-push.mdc` and the branch-protection runbook. Swarm CI (`test.yml:167,170`) runs `check-flag-doc-parity.py` (the `### Feature Flags` table in AGENTS.md) and `check-config-drift.py` (the `| Module | Owner | Criticality |` table); local preflight does not run them. PLX_MC `check-arch-parity.py` pins two AGENTS.md architecture cells. `verify-claude-web-mc-wiring.test.mjs` tests fixtures only. The real-file checker `verify-claude-web-mc-wiring.mjs` (which wants `repo: petralabx/plx-customer-portal` and no `Never Hub` in AGENTS.md) is not in CI and fails today on an unrelated check. PLX_MC `tests/test_canary.py` pins strings in AGENTS.md, CLAUDE.md, and `governance.mdc` (for example "Mission First", `MC-Checkout: pending`, `verificationCommands`). | portal `ci.yml:139,173`; `scripts/ci-staged-gate.test.mjs:766-956`; `scripts/verify-claude-web-mc-wiring.mjs:103,114`; swarm `.github/workflows/test.yml:167,170`; PLX_MC `tests/test_canary.py:60-115`, `scripts/check-arch-parity.py:28-31` |
| F14 | Portal `.cursor/rules/mc-compliance.mdc` is 19778 bytes and holds all 7 needles. The `sweep` check (Appendix B) over every `INSTR_FILES` file (root guides, rules, skills, prompts, runbooks) in the four repos finds exactly these competing complete-order lines. No test pins any of them. **Portal (19 lines, 15 files):** `AGENTS.md:29`, `CLAUDE.md:169`, `GEMINI.md:14`, `.cursorrules:101`, `.github/copilot-instructions.md:14`, `.cursor/rules/mc-compliance.mdc:21,230,344`, `.cursor/rules/mc-delegation.mdc:24,54-55`, `.cursor/skills/babysit/SKILL.md:24`, `.cursor/skills/mc-sync/SKILL.md:30-32`, `prompts/uat-agent/v2/CONTRACT.md:15`, `prompts/uat-agent/v2/SYSTEM.md:25`, `prompts/workbench-readonly-build-prompt.md:359`, `docs/runbooks/CLAUDE-CODE-WEB-MC-SETUP.md:212`, `docs/runbooks/CLOUD-AGENT-ENVIRONMENT.md:155`, `docs/runbooks/CONTRIBUTING.md:293`. Most say "Last commit, then freeze. Completing releases the checkout."; the second sentence contradicts F2. **PLX_MC:** `docs/AGENT-PR-SOP.md:325`; `config/cloud-agent-fleet-always-apply.md:118-120` wraps across lines, so the sweep misses it and P8 checks it by name. **Swarm:** `AGENTS.md:20`, `CLAUDE.md:32`. **Secondbrain:** none. `INSTR_FILES` excludes `tasks/`: portal `tasks/lessons.md:15` ("`mc_complete_task` must land BEFORE the PR is opened") matches `COMPETING`, agrees with the locked order, and stays out of scope. | `sweep` in the review session; portal `node scripts/uat-agent/verify-agent-contract.mjs` passes today |
| F15 | plx_secondbrain is tracked with `compliance_mode: soft` ("Stays soft; do not flip hard"), default bucket `BKT-KNOWLEDGE-HUB`, and base `main`. It has no AGENTS.md, no CLAUDE.md, and no `.cursor/rules/`. `docs/GOVERNANCE.md:14` says "**Do not duplicate** agent rules or MC-Checkout discipline in this repo." (with bold marks) | PLX_MC `config/tracked-repos-registry.json:185-205`; secondbrain tree |
| F16 | The brain HTTP route exists. It exposes 11 tools, including `brain_self_check`. Two tools write: `brain_ingest` (up to 100000 chars into `memory.items`, namespace `swarm/brain-ingest`) and `brain_propose_relation` (confidence at most 0.7). Writes are limited to 30 per minute per tenant. Every valid key has the same write access. `X-Agent-Name` is self-asserted. The committed swarm `.cursor/mcp.json` and `.mcp.json`, and portal `.mcp.json` and `.cursor/mcp.json.example`, have no `plx-brain` key. | swarm `docs/runbooks/brain-mcp.md:15-42`; `apps/vmc-web/src/app/api/vmc/knowledge/mcp/route.ts`; `apps/vmc-web/src/lib/vmc/knowledge/mcp-http-{auth,server,tools}.ts` |
| F17 | `.github/workflows/` paths are high tier by path. The label `risk:high` forces high tier. High tier needs `testRun` or `shots`, a rollback, and a bucket PRD. The gate reads the task's bucket row: `prd` set gives `present`; `prd: null` gives `absent`, which **blocks**; only a missing bucket gives `unknown` (advisory). The seed rows for `BKT-PROD` and `BKT-INFRA` have `prd: null`. `mc_update_bucket { id, prd }` sets it. | PLX_MC `src/lib/compliance/risk.ts:8-20,35-50`; `src/lib/compliance/verify.ts:36-86`; `src/lib/compliance/bucket-prd.ts:10-16`; `src/lib/mc-data/data.ts:160,164`; `src/lib/mcp/create-http-server.ts:212` |
| F18 | Base branches: portal `staging`; PLX_MC, swarm, and secondbrain `main`. Default buckets: portal `BKT-PROD`; PLX_MC and swarm `BKT-INFRA`; secondbrain `BKT-KNOWLEDGE-HUB`. | registry; `origin/*` refs |
| F19 | Portal `.githooks/pre-push` blocks a push without a local stamp only for agent pushes: a `cursor/` or `cloud-agent/` branch, `CURSOR_AGENT` or `CURSOR_AGENT_PR_BODY` set, git email `cursoragent@cursor.com`, or git name "Cursor Agent". Other pushes count as human and pass. PLX_MC, swarm, and secondbrain have no `.githooks/`. | portal `scripts/lib/mc-pre-push-handshake.mjs:44-75,334-361` |
| F20 | Swarm deploy runs after `Test` on `main` only when `vars.SWARM_DEPLOY_ENABLED == 'true'`. `deploy-swarm.sh` runs `git reset --hard origin/main` in `/home/ubuntu/agentic-swarm-8`, which leaves untracked files in place. | swarm `.github/workflows/deploy-swarm.yml:11-16,40`; `scripts/deploy-swarm.sh:65-74` |
| F21 | 23 portal shims under `portal/src/lib` carry `module-shim — remove after 2026-09-30`. From 30 Sep 2026, `npm run audit:hygiene` prints its `Score:` line and then exits 2 ("CRITICAL: expired/invalid shim metadata detected") on unchanged `staging`. No phase in this plan owns those shims. | portal `scripts/audit-module-coverage.sh:158-202,333,370-373`; `grep -rl 'remove after 2026-09-30' portal/src/lib` |
| F23 | PLX_MC `src/lib/compliance/service.ts:98` (`:96` before #255) and `scripts/generate-compliance-gate.py:132` carry `module-shim — remove after 2026-10-15` comments. The generated workflow copies that comment at `.github/workflows/compliance-gate.yml:77`. No PLX_MC script or CI job enforces that date. | `grep -rn 'remove after'` over PLX_MC `scripts/`, `.github/workflows/`, `src/lib/compliance/` at `fc7ceef3d123` |
| F22 | PLX_MC deploys to the Vercel project `plx-mission-control` at `https://mc.plxcustomer.io`. PLX_MC has no version route. | PLX_MC `AGENTS.md:59`; `vercel.json` |
| F24 | PLX_MC PR #255 (TASK-2011) merged on 2026-09-28T22:11:09Z as `f6d2bab7670a` (PR head `5f0419367467`); `main` at `fc7ceef3d123` includes it. It changed 17 files. What it does: an expired stamp passes verify while GitHub shows its PR open and the live body carries it (one GitHub read per PR, on expiry only; a GitHub failure fails closed); closing or merging the PR releases the stamp (`released_at`, `released_reason`, migration `026`, event `checkout.released`) after attribution and projection; reopening clears the release; `complete()` and the active-checkout listing treat a released stamp as invalid; the gate workflow and its generator also trigger on `pull_request` type `edited`, in both variants, and `tests/test_generate_compliance_gate.py:49-55` pins the four types. The PR body records that migrations 022–026 were applied to the production `plx_mc` database. Files P4 or P16 edit or cite: `src/lib/compliance/service.ts`, `src/lib/compliance/repo.ts` (`DispatchRow` gains `releasedAt` and `releasedReason`; the active filter adds `released_at IS NULL`; new `releaseDispatches` and `unreleaseDispatches`), `src/lib/compliance/github-pr.ts` (new `loadPrState`), `scripts/generate-compliance-gate.py`, `.github/workflows/compliance-gate.yml`, `docs/modules/compliance/README.md:47-54`, `tests/compliance-server.test.ts` (a `loadPrState` mock at `:10-11`, a TASK-2011 block at `:139-251`, and `:462-473` now expects an expired stamp on an open PR to pass), `tests/test_generate_compliance_gate.py`, and `src/lib/mcp/read-actions.ts`. P2 and P3 are unaffected: they open no PR, so the open-PR exception and release never apply, and the 8-hour rule stands because `complete()` still rejects expired stamps. Whether `mc.plxcustomer.io` has deployed `f6d2bab7670a` is not verified here; no phase gate depends on it, because P4 and the P16 PLX_MC half deploy on top of it. | `gh pr view 255 --repo petralabx/PLX_MC` (`state: MERGED`, `mergeCommit: f6d2bab7670a`); `git -C PLX_MC log --oneline -3 fc7ceef3d123`; the files above at `fc7ceef3d123` |
| F25 | The swarm is being retired (swarm retirement spec r2). After its R0 usage audit, its R1 plans to turn off both writers: `governance-repo-sync` (Lobster) and `lessons-rule-promote` (a VMC cron). The repo is not archived: at the end (S7, then T3) it is pruned of non-trading code and renamed for the trading lab. The writers write only the swarm repo, so once no phase edits the swarm they cannot undo any frontier change. P7's withdrawal rests on that, not on R1. | swarm retirement spec r4 §8 (R0, R1, S7, T3); F9 |
| F26 | The brain moves to plx_secondbrain under the same spec, onto its own EC2 host at `brain.plxcustomer.io` (retirement D5; Q1 answered 28 Sep 2026). R6 routes the 11 key paths, `/api/vmc/knowledge/mcp` among them, on `missioncontrol.tayloralton.com` to the new service; R6a gives the brain its own name and TLS; R7 moves each caller to it. The R6 Caddy block stays for good (retirement D4): a caller left on the old host still reaches the brain, and from R11 the block forwards only requests that carry a brain key. The old host stays for the trading lab (retirement D8, S6). The brain accepts the `VMC_API_KEY` value only during the lift (retirement D3): R4 creates `BRAIN_API_KEYS` (every brain key starts with `brn_`), R7 issues each caller its `BRAIN_API_KEY`, and R11 stops accepting `VMC_API_KEY` and department keys. The frontier `BRAIN_URL` is the same value as the retirement `BRAIN_BASE_URL`. No key limits what the connector can read or write until R11 wires key scopes, which agrees with F16. | swarm retirement spec r12 (D3, D4, D5, D8, execution contract, R4, R6, R6a, R7, R11, S6, Q1, section 10) |

## Mission

- Prove the two saved cloud forms.
- Record whether a second checkout of the same task and repo mints a second stamp on the deployed Hub. Change `checkout()` only when that record shows a second stamp.
- Cut always-on context with the non-Jev diet on the portal, PLX_MC and plx_secondbrain: one short root guide per repo, long rules only when the task needs them, a meter, one complete-order sentence, a loader canary, then a trim.
- Correct the nested portal AGENTS.md files so they name the current roster.
- Register the brain MCP connector the runbook describes, at the brain's own address once the swarm retirement gives it one (R6a), with a brain key from `BRAIN_API_KEYS` (D5).
- Teach the compliance-gate generator and the verify service `merge_group`, so the one required `compliance` check can join the merge queue without the hand-written stopgap.

## Stage 0 — intent

- **Do:** one plan Vince can approve or reject. The plan holds the two proofs and the five workstreams. A live measurement that must precede a code change is its own phase inside this plan.
- **Success looks like:** the question at the end is one yes or one no. A yes starts the two proofs and the read-only audits. Each later phase names its repo and waits on the evidence in `depends_on`.
- **Already true, so this spec does not rebuild it:**
  - Cursor Cloud Mission Control.
  - Hermes local-only.
  - The fleet spec's rejection of Jev products.
  - The HTTP brain route and its runbook.
  - The compliance job id `compliance`.
  - `merge_group` on `lint-typecheck-build` and `Validate ledgers`.
  - The merge-attribution rule for expired stamps.
  - PLX_MC PR #255 (TASK-2011): an expired stamp on an open PR passes verify, and closing or merging the PR releases the stamp (F24).
  - The decision to retire the swarm (swarm retirement spec r2), whose R1 plans to turn off both swarm writers.
  - The agent fleet spec (r4). It registers agents in the existing portal registry and adds no roster to any guide.

## Decisions a yes confirms

**Confirmed:** D1 and D12 (Vince, 28 Sep 2026), then all the defaults below with the approval on 28 Sep 2026. **Withdrawn in r12:** D6 and D10, with the swarm work. **Re-derived in r13** after #255 merged, with the same defaults: D2, D4 and D13. D4's re-derivation already includes two readings written in P16: `merge_group` never calls `loadPrState`, and a released stamp blocks. Those readings are the same default, not a new one. Round 10 reviews them. They do not need a separate yes. **Changed in r13** on the swarm retirement spec's instruction (its section 10, D3, R7, R11): D5's key source and D14's step name. D5 is a changed default. Vince answered `yes r13, D5 as r13` on 2026-09-29T18:09:35Z. P14 records that phrase, and round 10 reviews D5, D14, F26, P13 and P14 before P14 starts (D13, SC-13). D14's rule is unchanged; only its step name and its quiet window changed.

A yes accepts every default below. To change one, answer "yes, except D<n>: …".
That answer is still one yes. Before any phase that the exception touches runs, the
orchestrator writes the next revision of this spec with the exception applied, and
re-runs the review on the changed phases.

| # | Decision | Default in this spec | Why |
|---|---|---|---|
| D1 | P1 environment | **Confirmed 28 Sep 2026.** P1 runs on `PLX Portal + MC` (`env_01SVX8gUwth13dQuc5G2wRDQ`), renamed on 28 Sep 2026. The operator confirmed it carries the runbook variables; P1 proves them live. | F4: the name is in place; its variables cannot be read from the review session. |
| D2 | Lease contract (P4) | The lease key is task + repo. The holder is the authenticated principal recorded on the `checkout` event (`permissionActorId`; null counts as its own value), never a header. A stamp holds the lease while it is live (F2 after #255: unrevoked, unreleased, unexpired) and its task has no `task.completed` event for that stamp. So a merged or closed PR releases its stamp and frees the lease, and a reopened PR takes the lease back while its stamp is unexpired. Same holder: return the held stamp and append a `checkout.reused` event, not a second `checkout`, so checkout counts and announcements do not inflate. Different holder: HTTP 409 `checkout_held`. No migration and no revoke. **Re-derived in r13; the default is unchanged.** | F2, F3: the runtime is self-asserted, and a revoke would break merge attribution. #255 adds release, which the lease reads and never writes. |
| D3 | Second brain guides (P8) | Add the guides, and change `docs/GOVERNANCE.md:14` to point at them. | F15: the repo's own doc forbids a duplicate today. |
| D4 | Merge queue (P15, P16) | The generator learns `merge_group` inline, with no repo-local script, and keeps the four `pull_request` types #255 set (`opened, synchronize, reopened, edited`). The verify route accepts `merge_group` OIDC with `prNumber` bound to the queue ref. In merge-group mode, verify accepts an expired stamp only when the gate already passed that PR head for its task; it makes no GitHub read, and it rejects a revoked or released stamp as `pull_request` mode does. `pull_request` mode keeps #255's open-PR exception (F11). The portal regenerates, bumps `GEN_SHA`, updates its CI test, and deletes the stopgap; `scripts/merge-group-prs.mjs` stays, because the CI test imports it (F10). Turning on the queue stays a repo-admin action outside this plan. **Re-derived in r13; the default is unchanged.** | F10, F11. Adding `merge_group` to `plx-mc-compliance.yml` alone would make two workflows emit `compliance` and fail CI. The queue only re-confirms a head that already passed, so it needs no GitHub read, and the bearer path stays safe (P16). |
| D5 | Brain key (P14) | **Changed in r13** on the swarm retirement spec's instruction (its section 10, D3, R7, R11). Use a brain key: a `BRAIN_API_KEY` issued for the Cursor Team MCP registration, from the brain's `BRAIN_API_KEYS` (every brain key starts with `brn_`). Never the `VMC_API_KEY` value, and never a `VMC_SCOPED_API_KEYS` department key: those are VMC and trading keys, and R11 stops the brain from accepting them. Record the key name, never the value. Until R11, no key limits what the connector reads or writes. **Vince's yes, recorded:** r12's yes covered r12's default. Vince answered `yes r13, D5 as r13` on 2026-09-29T18:09:35Z (the header's `r13_yes` and `d5_r13_yes`). The yes to this change has one form, the phrase `D5 as r13` (r13 is the revision that changed D5, whatever revision the yes is given against). Vince gives it once: in a yes on r13 (`yes r13, D5 as r13`) or in the P14 later yes (`yes P14, BRAIN_URL=…, D5 as r13`). P14 records it in `brain-register.md` (`d5_confirmed`, `d5_confirmed_at`, `d5_confirmed_in`) and its acceptance checks the phrase as a fixed line; round 10 reviews D5, D14, F26, P13 and P14 first (D13, SC-13). | F26: the brain holds only hashes of VMC's keys, and its own keys rotate alone. r12's default (a VMC department key, else `VMC_API_KEY`) would send a trading-capable key to the brain's own name (retirement D3, B26). |
| D6 | Writer lock scope (P7) | **Withdrawn in r12,** with P7. The retirement spec's R1 plans to turn both writers off. | F25: the writers touch only the swarm repo, which no phase edits now. |
| D7 | High-tier bundle for P4 | P4 sends the high-tier bundle (`testRun` plus rollback) to `mc_complete_task`, even though its paths classify as standard. No PR relies on a label to set the tier. | `gh pr create` adds labels after `opened`, and the gate does not run on `labeled`, so a `risk:high` label may never reach it (F17). The P16 PRs are high tier by path (`.github/workflows/`). |
| D8 | Failed canary | A repo whose P9 canary fails does not enter P10. Vince decides its next step separately. | A safety section on a slice that does not load cannot help. |
| D9 | Meter views | `cursor`, `claude`, `codex`, `hermes`. `cursor-min` is dropped. | No document defines `cursor-min`, and no phase uses it. |
| D11 | Bucket PRD for high-tier PRs (P16) | P15 records whether `BKT-INFRA` and `BKT-PROD` have a PRD (read with `mc_get_context { depth: "full" }`). If either is absent, P16 does not open that PR. Vince either sets `prd` on the bucket with `mc_update_bucket` and confirms it with the same read, (for example, a link to the approved copy of this spec), or names another path. No agent edits a bucket. | F17: `prd: null` blocks every high-tier PR, and both P16 PRs are high tier by path. |
| D12 | Portal complete-order fix (P8) | **Confirmed 28 Sep 2026.** P8 gains a portal half. It replaces each F14 portal line with the locked sentence, keeping the rest of that line, including on-demand skills, prompts, and runbooks. Line-scoped: no other edit. P10 then only trims. | The fix should not wait on the portal canary (D8). Two of those files (`mc-sync`, `babysit`) sit on the PR-open path. |
| D10 | Swarm handshake carrier (P8) | **Withdrawn in r12,** with the swarm half of P8. | F25: the swarm is retiring; its own complete-order lines (F14) stay; the trading lab owns that repo after the retirement spec renames it. |
| D13 | PLX_MC PR #255 (P4, P15, P16) | **Applied in r13.** #255 merged on 28 Sep 2026 as `f6d2bab7670a` (F24). P4's code branch and P16 start only under r13 or later, after Vince's yes on r13, and only after round 10 has reviewed the r13 changes to P4, P15 and P16 and its findings are applied. Round 10 also reviews the r13 changes that swarm retirement r12 section 10 required (D5, D14, F26, P13, P14); P14 starts only after that review, its later yes and Vince's `D5 as r13` (D5). P4's no-code branch (P3 outcome `same-stamp` or `409`) never waited. r13 re-derives F1, F2, F6, F10, F11, D2 and D4, and every test-file line P4 and P16 cite, against PLX_MC `main` `fc7ceef3d123` and portal `2b656d8adf33`. P16's former test "`pull_request` with an expired stamp still blocks" no longer holds and is replaced. The P16 portal half also owns the portal `.cursor/rules/mc-compliance.mdc` lines that say "Do not add `edited` in this repo" and name the three trigger types (`:128-131` and `:301-309` at `2b656d8adf33`), wherever P8 and P10 leave them; that half runs after P8 and P10 on the portal. Its rewrite stays within P10's caps and keeps every needle and P8's carrier rule, and its acceptance re-runs those checks, so it cannot undo either phase unseen. P15 records `pr255: merged f6d2bab7670a` and `gate_pr_types`. An r12 run of P15 does not satisfy r13: P15 runs again under r13 before P16 starts, and the P16 PLX_MC acceptance reads both r13 lines from `merge-queue-audit.md`. P4 and P16 record `pr255:` and `spec_revision:` in their evidence. | F24: #255 changed what "live" means for a stamp, and it edited files that P4 and P16 edit or cite. |
| D14 | Brain registration address (P14) | P14 is a later yes that names `BRAIN_URL`, the brain's own address from the retirement spec's R6a (its Q1 answered the host on 28 Sep 2026: `brain.plxcustomer.io`; `BRAIN_URL` equals the retirement `BRAIN_BASE_URL`). It registers that address, not `missioncontrol.tayloralton.com`. It starts after P13, once `brain_self_check` answers at `BRAIN_URL` with a brain key (D5); the rest of R7 (caller PRs) need not be done. **r13 names the step R6a, not R7, and drops the quiet window:** the R6 routes on the old host stay for good (F26). | F26: the brain's callers move to the new name in R7, so a registration at the old host would have to be done twice. The first yes cannot approve a host nobody has named; the later yes names it. |

## Success Criteria

- **SC-1:** this file stays `status: draft` until Vince answers the approval question. `approved_by` stays empty until that answer.
- **SC-2:** P1 evidence shows a fresh single-repo Claude web session on `PLX Portal + MC` with `ok: true`, `principal: sp_mcp_claude_code` (from `meta.actor`), and `parse_error: no`. No checkout and no pull request.
- **SC-3:** P2 evidence shows one Codex stamp from `PLX portal staging`:
  - a `TASK-N` taskId
  - `actor.repo: petralabx/plx-customer-portal` (from the checkout response)
  - `principal: sp_mcp_codex`
  - one `MC-Checkout: dsp_*` line
  - `checkout_calls: 1`, `issued_at` and `expires_at` from the checkouts API
  - `pr: none`

  The proof does not call `mc_complete_task`.
- **SC-4:** the first yes starts P1, P2, P5, P11, P13, and P15. P3, P4, P6, P8, P10, P12, P14, and P16 wait for a later yes. P9 starts when the evidence named in `depends_on` is on disk. P7 is withdrawn.
- **SC-5:** no repo and no home directory gains `jev-rules`, `jevgrep`, `jev-code`, or a Typesafe/Jev plugin entry.
- **SC-6:** this spec is the contract for the meter, the complete-order sentence, the loader canary, and the guide trim. The fleet spec remains the contract for skill packs, enforcement, and the Jev rejection.
- **SC-7:** the four nested portal AGENTS.md files name exactly the roster in root AGENTS.md (`:10` plus colleague IDEs), and no retired agent. They carry the consumer-copy banner and no "Auto-generated" header.
- **SC-8:** the brain registration uses the name and headers in `docs/runbooks/brain-mcp.md`, the brain's own address from the retirement spec's R6a (D14), and a brain key from `BRAIN_API_KEYS` (D5, confirmed by Vince as `D5 as r13`). `brain-register.md` records the key name, the later yes that named `BRAIN_URL`, the `D5 as r13` yes and where Vince gave it, and the two write tools, and never a VMC key. The review and writing sessions do not register it.
- **SC-9:** exactly one portal workflow defines job `compliance` and triggers on `merge_group`: the generated `plx-mc-compliance.yml`. `compliance` stays required. `COMPLIANCE_MODE` is unchanged.
- **SC-10:** T3, Hindsight, a new agent roster, Hermes cloud, a Grok cloud environment, an AWS `--apply` bootstrap, and turning on the merge queue stay out of every phase.
- **SC-11:** every code-phase PR carries a live `MC-Checkout: dsp_*` line at open. That stamp's `actor.repo` equals the PR's repo, and the PR's `compliance` check ends SUCCESS.
- **SC-12:** no phase edits `petralabx/agentic-swarm`. Its own competing lines (F14: `AGENTS.md:20`, `CLAUDE.md:32`) stay: the trading lab owns that repo after the retirement spec renames it.
- **SC-13:** P4's code branch, the P15 re-run, P14 and P16 start only under r13 or later, after Vince's yes on r13 and after round 10 has reviewed the r13 changes to P4, P15 and P16 (D13) and to D5, D14, F26, P13 and P14 (retirement section 10). P16 also waits for the P15 re-run: an r12 run of P15 does not satisfy r13. P14 also waits for the later yes that names `BRAIN_URL` and for Vince's `D5 as r13` (given in a yes on r13 or in that later yes), and `brain-register.md` records both. #255 merged on 28 Sep 2026 as `f6d2bab7670a`.

## Scope

- **In:**
  - P1: a fresh Claude web proof on `PLX Portal + MC`.
  - P2: one Codex Cloud stamp on `PLX portal staging` via `~/bin/plx-mc-stamp`, repo `petralabx/plx-customer-portal`. Search before creating a task.
  - P3: a double-checkout record on the deployed Hub. P4: a lease in `petralabx/PLX_MC`, base `main`, only when that record is `second-stamp`.
  - Context diet on three governed repos (portal, PLX_MC, plx_secondbrain): one short root guide, and long rules load only when the task needs them. The swarm is measured only. Slices: measurement (P5), meter (P6), complete-order sentence (P8), loader canary (P9), guide trim (P10).
  - P11, P12: correct `portal/src/app/AGENTS.md`, `portal/src/components/AGENTS.md`, `portal/src/lib/AGENTS.md`, and `portal/prisma/AGENTS.md` on `petralabx/plx-customer-portal`, base `staging`.
  - P13, P14: register Team MCP server `plx-brain`, with the name and headers from `petralabx/agentic-swarm` `docs/runbooks/brain-mcp.md`, the URL from the retirement spec's R6a (D14), and a brain key from `BRAIN_API_KEYS` (D5).
  - P15, P16: `merge_group` support in the PLX_MC generator and the verify service, then regenerate the portal gate and retire the stopgap.
- **Non-goals:**
  - Jev products: `jev-rules`, `jevgrep`, `jev-code`, and Typesafe/Jev plugin entries.
  - T3. Hindsight. A new agent roster. Hermes cloud. A Grok cloud environment. An AWS `--apply` bootstrap.
  - Turning on "Require merge queue" in ruleset `18632985`, or changing org ruleset `18679471`.
  - Editing a compliance workflow or the generator to force a green check. Making `compliance` optional.
  - Skill packs and the `agent-context.yml` enforcement check (these stay on the fleet draft).
  - Deleting `scripts/sync-agents-md.py` in the portal. Any edit to `petralabx/agentic-swarm` (SC-12).
  - Calling `mc_complete_task` on the P2 or P3 checkout.
  - Opening a pull request in P1, P2, P3, P5, P9, P11, P13, P14, or P15.

## Execution contract (every phase)

### Setup (once, on the first yes)

1. The orchestrator writes Appendix A to `$TOOLS/measure_ref.py` and Appendix B to `$TOOLS/accept.sh`, verbatim.
2. It records both sha256 values in `$PROOFS/tools.md` as `measure_ref_sha256: <hex>` and `accept_sha256: <hex>`.
3. It sets `status: approved`, `approved_by`, and `approved_at` in this file.

### Paths and variables

```
STORE=/cursor/stores/bc-8a3b01c6-f288-49a1-ac0f-67e6e1ec3914
PROOFS=$STORE/docs/frontier-proofs      # evidence files; no product branch
TOOLS=$STORE/docs/frontier-tools        # measure_ref.py, accept.sh
PORTAL_REPO=<abs path>                  # full clone, petralabx/plx-customer-portal
PLX_MC_REPO=<abs path>                  # full clone, petralabx/PLX_MC
SWARM_REPO=<abs path>                   # full clone, petralabx/agentic-swarm (read-only: P5, P6, P14 checks)
SECONDBRAIN_REPO=<abs path>             # full clone, petralabx/plx_secondbrain
WT=<abs path>                           # the phase worktree (code phases)
SLUG=<repo name>                        # P10 only: plx-customer-portal | PLX_MC
BRAIN_URL=<https://host>                # P14 only: the brain's own address (retirement spec R6a = BRAIN_BASE_URL; D14)
```

Code-phase guards compare against the branch point, not the moving base: they use three-dot diffs (`git diff origin/<base>...HEAD`) and `git merge-base HEAD origin/<base>`. Code-phase acceptance runs on the frozen PR head in the phase worktree, before CIP merges. The phase is done when that acceptance passed and the PR is merged.

Each phase refreshes every clone it reads before it starts: `git -C "$X" fetch origin`,
then `git -C "$X" checkout --detach origin/<base>`. Clones must be full; run
`git fetch --unshallow` where `git rev-parse --is-shallow-repository` prints `true`.
Acceptance reads pinned SHAs such as portal `b75477d9c85d`.

### Acceptance blocks

- Every acceptance block is a bash script. Run it as `bash -u <file>` (no `-e`, no `pipefail`), with cwd set as the phase states.
- The script's first line is `. "$TOOLS/accept.sh"` (Appendix B).
- Each check ends in `|| fail …`, so the script exits non-zero on the first failed check and 0 when all pass.
- A command whose own exit code matters is captured first (`OUT=$(cmd) || fail …`). It is never piped straight into `grep -q`.

### Evidence files

- Evidence files are plain `key: value` lines: one key per line, no quotes, no YAML nesting.
- Timestamps are UTC, `YYYY-MM-DDTHH:MM:SSZ`, with optional fractional seconds.
- Raw tool output goes under a final `## raw` heading. Remove secrets before pasting. Never paste a key.
- **Operator phases** run where the orchestrator cannot: Claude web, Codex Cloud, Cursor surfaces, the cursor.com dashboard, EC2, and repo-admin settings. They are P1, P2, P3, P9, P14, the admin lines of P15, the P8 Team Rules re-paste, and the deploy confirmations after P4 and the P16 PLX_MC half.
- **Deploy confirmation (P4, P16):** in Vercel, the production deployment of project `plx-mission-control` for the merge commit shows Ready (dashboard Deployments list, or the GitHub deployment status on that commit). Record `deployed_sha: <first 12 hex of the merge commit>`. The operator pastes the output. The orchestrator writes the evidence file verbatim from that paste and runs the acceptance.
- A phase is done when its acceptance exits 0. A code phase is also done only when its PR is merged to base, because `depends_on` counts merged code only.

### Scheduling

- Parallelism cap: two orchestrator agents. Operator phases, and orchestrator phases waiting on an operator, do not hold a slot.
- First-yes queue for orchestrator slots: P5, P15, P11, P13. P5 goes first because P6 waits on it.
- P4's code branch and the PLX_MC half of P16 waited for PLX_MC PR #255, which merged on 28 Sep 2026. Both start only under r13 or later, after Vince's yes on r13 and its round-10 review (D13, SC-13). P15 runs again under r13 on the same terms, before P16: an r12 run of P15 does not satisfy r13. P14 also starts only under r13 or later, after that yes, after round 10 has reviewed D5, D14, F26, P13 and P14, and after Vince's `D5 as r13`, given in the yes on r13 or in the P14 later yes (SC-13).
- A swarm-retirement PR that edits the same files as a frontier phase never runs alongside it on the same repo; the second branches from base after the first merges. Known overlaps: retirement R7 edits PLX_MC `config/governance-contract.yaml` and regenerates its guides (P8 and P10 on PLX_MC); retirement S7 edits portal `CLAUDE.md` and PLX_MC guides (P8 and P10); retirement R7's portal PR edits `.cursor/rules/session-knowledge-artifact.mdc`, which P10 portal owns through `.cursor/rules/**`. Retirement R7's operator step also says to update the Cursor team MCP registration (retirement `:546`); that registration is P14's (D14, SC-8): R7 adds no `plx-brain` entry to the Team MCP list, and P14 registers it once its gate is met, so the entry exists once and never at the old host.
- P4 and the PLX_MC half of P16 never run at the same time, because both edit `src/lib/compliance/service.ts`. Whichever starts second branches from `main` after the first merges.
- The P8 portal half merges before P10 portal starts, because both edit root guides and rules. The P16 portal half branches from `staging` after the P8 and P10 portal PRs have merged, because all three edit `.cursor/rules/mc-compliance.mdc`, and P10 and P16 both edit `.cursor/rules/auto-merge-after-push.mdc` (D13). The P16 portal acceptance re-runs P10's cap and needle checks and P8's carrier rule on the rules it edits, so its rewrite cannot undo either phase unseen. P12 touches only the four nested guides, so it is independent of all three.
- Globs are gitignore-style, relative to the root of the repo the phase names. The Jev globs apply in every repo and in `$HOME`: `**/jev-rules/**`, `**/jevgrep/**`, `**/jev-code/**`.

### Code-phase contract (P4, P6, P8, P10, P12, P16)

Do these steps in order, once per repo the phase touches:

1. **Worktree.** Create a worktree from the refreshed base, on the branch in the table below. Never share a worktree between phases. Install dependencies there (the table below).
2. **Handshake on PLX-MC-Hub.** Do it only when that repo's PR can open within 8 hours.
   1. Search with `mc_search_tasks` (HTTP: `GET /api/cursor/tasks?q=`) for the exact title in the table below, and for the branch.
   2. Only on a real miss, create the task with `mc_create_task` in the registry default bucket (F18).
   3. Call `mc_checkout_task { taskId, repo: "petralabx/<repo>" }`. Confirm the `taskId` is non-null and `actor.repo` equals the repo. Copy `prBodyLine` exactly.
   4. Portal only: run `node scripts/compliance-checkout.mjs --write-receipt --checkout dsp_… --task TASK-N`.
   5. Never invent a `dsp_*`, and never write `MC-Checkout: pending`. If the Hub tools and the HTTP fallback both fail, stop; CoS or CIP pastes `prBodyLine`.
   6. If the stamp expires before the PR opens, check out the **same** task again and use the new `prBodyLine`. Never create a new task for this. #255 does not change this: the open-PR exception starts only once the PR is open, and `complete()` still rejects an expired stamp (F2).
   7. After contract step 8, record the gate's `tier` for the PR (from the `compliance` run log) in the phase evidence file as `gate_tier: <low|standard|high>`.
   8. If a checkout returns 409 `checkout_held` (after P4 deploys), stop and report the holder and expiry to Vince. Never create a new task to get around it.
3. **Failing test first.** When the phase changes existing behavior (P4, P16), commit a failing test first. Record `failing_first: <sha> fail` in the phase evidence file. New tooling (P6) and docs (P8, P10, P12) have no failing-first step.
4. **Validate.** Run the repo validation below until it is clean. Never use `--no-verify`.
5. **Critic.** The critic (`gpt-5.6-sol-high`) reviews the full diff at `threshold: high`, `max_iter: 3`, `strict_approve: true`. The critic brief says that pre-existing debt outside `owns` is out of scope, including the shims dated 2026-09-30 (F21) and 2026-10-15 (F23). If the critic has not approved after 3 iterations, stop, open no PR, and report to Vince.
6. **Complete, then freeze.** After the last commit, call `mc_complete_task` with `summary`, `verificationCommands`, `rollback`, and, for high tier, `testRun`. Then freeze: no more commits.
7. **Open the PR.** Open a draft PR into base. Put `prBodyLine` in the body at open. Sections, in order:
   - `## Summary`
   - `## Review links` (portal PRs that change something a human reads; absolute URLs only)
   - `## Rollback Plan`
   - the accountable owner (vince@petrasoap.com)

   CIP lands the PR. Agents never merge.
8. **Wait for green.** Wait for `compliance` SUCCESS (`node scripts/compliance-pr-verify.mjs --wait` exits 0 where the repo has it).
   - If the gate reports "high-risk change requires a linked bucket PRD" or "high-risk change requires the task on an initiative with a linked bucket PRD", stop and ask Vince. Do not change the bucket.
   - If any required check fails after the freeze, stop and report the failing check to Vince. Do not push. Vince or CIP decides whether the same task is checked out again for a fix.

| Repo | Install | Pre-commit | Pre-push |
|---|---|---|---|
| plx-customer-portal | `cd portal && npm ci` | `cd portal && npm run typecheck && npm run lint` | pre-commit + `node --test scripts/ci-staged-gate.test.mjs` + `hygiene_gate origin/staging` (Appendix B; an exit 2 from shims that also fail on the base is pre-existing, F21) |
| PLX_MC | `npm ci && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` | `./scripts/preflight.sh --mode pre-commit` | `./scripts/preflight.sh --mode pre-push` |
| plx_secondbrain | `npm ci` | `npm run typecheck && npm test` | same |

In acceptance blocks, `.venv/bin/python` is the repo venv from the install row. `python3` is used only for stdlib scripts (the meter, the generators' `--emit`, and the evidence checks).

Task titles and branches (search these exact titles before creating):

| Phase | MC task title | Branch |
|---|---|---|
| P2 | `Frontier P2: Codex stamp proof (plx-customer-portal)` | none |
| P4 | `Frontier P4: exclusive checkout lease (PLX_MC)` | `proj/frontier-stack/phase-4-lease` |
| P6 | `Frontier P6: agent-context meter (PLX_MC)` | `proj/frontier-stack/phase-6-meter` |
| P8 | `Frontier P8: complete-order handshake (<repo>)`, one per repo | `proj/frontier-stack/phase-8-handshake` |
| P10 | `Frontier P10: guide trim (<repo>)` | `proj/frontier-stack/phase-10-trim` |
| P12 | `Frontier P12: nested roster fix (plx-customer-portal)` | `proj/frontier-stack/phase-12-roster` |
| P16 | `Frontier P16: merge_group gate (<repo>)`, one per repo | `proj/frontier-stack/phase-16-merge-group` |

## Phases

The orchestrator skill has one human gate: the question at the end. The gates below
are phase gates inside that plan.

- **First yes:** P1, P2, P5, P11, P13, P15.
- **Later yes** (the phase mints a second stamp, edits PLX_MC, a compliance workflow, or governed guides, or registers a write-capable connector): P3, P4, P6, P8, P10, P12, P14, P16. Name the phase in that yes. For P10, also name the repo. For P14, also name `BRAIN_URL`.
- **Starts on evidence, no second question:** P9 after the P8 close block passes.
- **Withdrawn in r12:** P7.

### P1 — Prove Claude web

- **gate:** first yes · **executor:** operator · **recorder:** orchestrator (mechanical) · **repo:** none
- **depends_on:** `[]`
- **owns:** `$PROOFS/claude-web.md`
- **forbidden:** any repo edit; `mc_checkout_task`; any PR; Jev globs
- **pre-step (D1, confirmed 28 Sep 2026):** environment `PLX Portal + MC` (`env_01SVX8gUwth13dQuc5G2wRDQ`) carries the runbook variables (`CLAUDE-CODE-WEB-MC-SETUP.md:117-125`); it also needs network access to `mc.plxcustomer.io`, which P1 proves.
- **steps:**
  1. Start a new Claude web session on `PLX Portal + MC` with **only** `petralabx/plx-customer-portal` selected, base `staging`. One repo keeps the start folder at the repo root, so `.mcp.json` loads (F5).
  2. Watch session start. Record `parse_error: yes` if any MCP "JSON parse error", HTML help page, or OAuth 307 notice appears. Otherwise record `parse_error: no`.
  3. Call `get_session` and record `environment_id`.
  4. Call `mc_self_check` on server `PLX-MC-Portal` and record `ok`.
  5. Run the command below. It prints two fields and never prints the key. The principal comes from the key, so it is not an echo of a header.
     ```
     curl -sS "$MC_BASE_URL/api/cursor/self-check" \
       -H "Authorization: Bearer $MC_MCP_API_KEY" -H "x-mc-operator-email: $MC_OPERATOR_EMAIL" \
       -H "x-mc-repo: petralabx/plx-customer-portal" -H "x-mc-runtime: claude-code" \
     | python3 -c 'import json,sys; d=json.load(sys.stdin); a=(d.get("meta") or {}).get("actor") or {}; print("principal:", a.get("servicePrincipalId")); print("rest_ok:", str((d.get("data") or {}).get("ok")).lower())'
     ```
- **evidence template:**
  ```
  environment: PLX Portal + MC
  environment_id: env_01SVX8gUwth13dQuc5G2wRDQ
  session_repos: petralabx/plx-customer-portal
  mcp_server: PLX-MC-Portal
  ok: true
  rest_ok: true
  principal: sp_mcp_claude_code
  parse_error: no
  checkout: none
  pr: none
  ```
- **if it fails:** record the failing line and change nothing. The operator fixes the environment per the runbook and runs P1 again in a new session. No phase depends on P1.

Acceptance (P1):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/claude-web.md
for l in 'environment: PLX Portal + MC' 'session_repos: petralabx/plx-customer-portal' 'mcp_server: PLX-MC-Portal' \
         'ok: true' 'rest_ok: true' 'principal: sp_mcp_claude_code' 'parse_error: no' 'checkout: none' 'pr: none'; do
  line "$l" "$F"
done
line 'environment_id: env_01SVX8gUwth13dQuc5G2wRDQ' "$F"
```

### P2 — Prove the Codex stamp

- **gate:** first yes (it mints one stamp) · **executor:** operator in Codex Cloud, environment `PLX portal staging` · **recorder:** orchestrator · **repo:** none
- **depends_on:** `[]`
- **owns:** `$PROOFS/codex-stamp.md`
- **forbidden:** any repo edit; `mc_complete_task`; any PR; a second checkout call; Jev globs
- **headers:** every HTTP call uses the Codex key and the headers in the read-back script below (`Authorization`, `x-mc-operator-email`, `x-mc-repo`).
- **steps:**
  1. Record the helper: `sha256sum ~/bin/plx-mc-stamp`, then `~/bin/plx-mc-stamp --help | head -5`. The source is not in any repo (F6). If the help does not show how to pass a task id, stop before step 4.
  2. Search with `GET $MC_BASE_URL/api/cursor/tasks?q=Frontier%20P2`. Reuse an open task titled `Frontier P2: Codex stamp proof (plx-customer-portal)`.
  3. Only on a real miss, create that task with `POST /api/cursor/tasks` in bucket `BKT-PROD` (the portal registry default).
  4. Call `~/bin/plx-mc-stamp` once for that task and repo `petralabx/plx-customer-portal`. Record `taskId`, `actor.repo`, and the `MC-Checkout` line from its output.
  5. Paste the P2 read-back script below into one shell, with `TASK` and `STAMP` set from step 4. It mints nothing. It prints `issued_at`, `expires_at`, and `principal`.
  6. Do not call `mc_complete_task`. P2 has no work to complete, and completing would append `task.completed` evidence. It would not release the stamp either (F2). Do not open a PR.
- **evidence template:**
  ```
  environment: PLX portal staging
  helper_sha256: <64 hex>
  search: Frontier P2 -> <hit|miss>
  taskId: TASK-<n>
  actor.repo: petralabx/plx-customer-portal
  principal: sp_mcp_codex
  MC-Checkout: dsp_<id>
  issued_at: <UTC>
  expires_at: <UTC>
  checkout_calls: 1
  mc_complete_task: not-called
  pr: none
  ```
- An `actor.repo` of `petralabx/PLX_MC` (a Hub-default stamp) fails this phase.

P2 read-back script (operator, Codex shell; one paste):
```bash
TASK=TASK-0000; STAMP=dsp_REPLACE   # replace both with the step 4 output before running
if [ "$STAMP" = dsp_REPLACE ]; then echo "STOP: set TASK and STAMP first"; else
H=(-H "Authorization: Bearer $MC_MCP_API_KEY" -H "x-mc-operator-email: $MC_OPERATOR_EMAIL" -H "x-mc-repo: petralabx/plx-customer-portal")
curl -sS "${H[@]}" "$MC_BASE_URL/api/cursor/checkouts?taskId=$TASK&repo=petralabx/plx-customer-portal&active=true" \
| python3 -c '
import json, sys
ref = "dsp_\u2026" + sys.argv[1][-4:]
def walk(o):
    if isinstance(o, dict):
        if o.get("checkoutRef") == ref: yield o
        for v in o.values(): yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
rows = list(walk(json.load(sys.stdin)))
assert len(rows) == 1, f"expected exactly one active row for {ref}, got {len(rows)}"
print("issued_at:", rows[0]["issuedAt"]); print("expires_at:", rows[0]["expiresAt"])' "$STAMP"
curl -sS "${H[@]}" "$MC_BASE_URL/api/cursor/self-check" \
| python3 -c 'import json,sys; a=(json.load(sys.stdin).get("meta") or {}).get("actor") or {}; print("principal:", a.get("servicePrincipalId"))'
fi
```
- **rollback:** none is possible. Nothing revokes a stamp (F2). It expires at `expires_at`. Nobody pastes it on a PR.

Acceptance (P2):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/codex-stamp.md
for l in 'environment: PLX portal staging' 'actor.repo: petralabx/plx-customer-portal' 'principal: sp_mcp_codex' \
         'checkout_calls: 1' 'mc_complete_task: not-called' 'pr: none'; do line "$l" "$F"; done
rline 'taskId: TASK-[0-9]+' "$F"
rline 'MC-Checkout: dsp_[A-Za-z0-9]+' "$F"
rline 'helper_sha256: [0-9a-f]{64}' "$F"
rline "issued_at: $TS" "$F"
rline "expires_at: $TS" "$F"
```

### P3 — Record the double-checkout result on the deployed Hub

- **gate:** later yes · **executor:** operator, with the same Codex environment, key, helper, task, and repo as P2 · **recorder:** orchestrator · **repo:** none
- **depends_on:** `[P2]`
- **timing:** P3 must run before P2's `expires_at`. Give the P3 yes within 8 hours of P2's `issued_at`. After that, P3 is void, because the first stamp is no longer live. Running it then needs a new yes that allows two calls and two stamps.
- **code prediction:** `second-stamp` (F1). The live call tests the deployed Hub, which may not run PLX_MC `main`.
- **owns:** `$PROOFS/double-checkout.md`
- **forbidden:** any repo edit; `mc_complete_task`; any PR; a third checkout call; Jev globs
- **steps:**
  1. Call the helper exactly once more, with the same task and repo. Record what it returns.
  2. Run the P3 read-back script below. It prints `active_rows: <n>` and one `active_ref:` line per active row. The Hub's rows decide the outcome, not the helper's output (F6).
  3. If a second id exists, stop.
- **evidence template:**
  ```
  first_id: dsp_<id from P2>
  second_call_at: <UTC>
  outcome: <second-stamp|same-stamp|409>
  second_id: <second-stamp: the new dsp_ id | same-stamp: the P2 id | 409: none>
  active_rows: <n>
  active_ref: dsp_…<last 4>   (one line per active row)
  code_prediction: second-stamp
  code_edit: no
  pr: none
  ```
- **rollback:** none is possible. Both stamps expire 480 minutes after issue (F2). Nobody pastes either stamp on a PR.

P3 read-back script (operator, Codex shell; one paste; mints nothing):
```bash
TASK=TASK-0000   # replace with the P2 taskId before running
if [ "$TASK" = TASK-0000 ]; then echo "STOP: set TASK first"; else
H=(-H "Authorization: Bearer $MC_MCP_API_KEY" -H "x-mc-operator-email: $MC_OPERATOR_EMAIL" -H "x-mc-repo: petralabx/plx-customer-portal")
curl -sS "${H[@]}" "$MC_BASE_URL/api/cursor/checkouts?taskId=$TASK&repo=petralabx/plx-customer-portal&active=true" \
| python3 -c '
import json, sys
def walk(o):
    if isinstance(o, dict):
        if "checkoutRef" in o and o.get("active", True): yield o
        for v in o.values(): yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
rows = list(walk(json.load(sys.stdin)))
print("active_rows:", len(rows))
for r in rows: print("active_ref:", r["checkoutRef"])'
fi
```

Acceptance (P3):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/double-checkout.md
rline 'outcome: (same-stamp|409|second-stamp)' "$F"
line 'code_edit: no' "$F"; line 'pr: none' "$F"
python3 - "$PROOFS/codex-stamp.md" "$F" <<'EOF' || fail "P3 timing or ids"
import sys, re, datetime as d
kv = lambda p: dict(re.findall(r'^([\w.-]+): (.*)$', open(p).read(), re.M))
a, b = kv(sys.argv[1]), kv(sys.argv[2])
t = lambda s: d.datetime.fromisoformat(re.sub(r'\.\d+', '', s).replace('Z', '+00:00'))
assert b['first_id'] == a['MC-Checkout'], 'first_id must equal the P2 stamp'
assert t(b['second_call_at']) < t(a['expires_at']), 'P3 ran after the P2 stamp expired'
o, sid = b['outcome'], b['second_id']
if o == 'second-stamp': assert sid.startswith('dsp_') and sid != b['first_id'], 'second-stamp needs a new dsp_ id'
elif o == 'same-stamp': assert sid == b['first_id'], 'same-stamp must repeat the P2 id'
else: assert sid == 'none', '409 has no second id'
n = int(b['active_rows']); refs = re.findall(r'^active_ref: (\S+)$', open(sys.argv[2]).read(), re.M)
assert len(refs) == n, 'one active_ref line per active row'
assert (n == 2) == (o == 'second-stamp'), 'second-stamp iff the Hub lists 2 active rows'
assert n in (1, 2), 'expected 1 or 2 active rows'
EOF
```

### P4 — Exclusive checkout in PLX_MC

- **gate:** later yes · **executor:** orchestrator (builder) · **repo:** `petralabx/PLX_MC`, base `main` · **bundle:** high-tier (`testRun`), per D7
- **depends_on:** `[P3]`. The code branch also needs D13: #255 merged, so it runs under r13 or later, after Vince's yes on r13 and round 10. Never runs at the same time as the PLX_MC half of P16.
- **branch on P3:**
  - If P3 records `outcome: same-stamp` or `outcome: 409`, write `closed: no-code` in `lease-closeout.md`. Make no product diff and open no PR.
  - If P3 records `outcome: second-stamp`, build the lease below.
- **lease contract (D2):**
  - Candidates come from a new unbounded query in `repo.ts`, `liveDispatchesForTask(taskId)`: rows where `task_id = $1 AND NOT revoked AND released_at IS NULL AND expires_at > now()` (the "live" test `listDispatches` uses since #255, `repo.ts:281`), ordered by `issued_at` ascending. Keep only rows where `dispatchRepoMatches(row.repo, input.repo)` is true.
  - A candidate holds the lease unless a `task.completed` event has `payload.checkoutId` equal to its id. Read this with a new query in `repo.ts`, `completedCheckoutIds(taskId)`, which selects `payload->>'checkoutId'` from events where `task_id = $1` and `kind = 'task.completed'` (no limit, so a busy task cannot push the event out of a window).
  - The holder of a leased dispatch is `payload.permissionActorId` on its first `checkout` event. Read it with a new query, `checkoutHolder(checkoutId)`, which selects that field from the oldest `checkout` event whose `payload->>'checkoutId'` equals the id. Null counts as its own value.
  - If several dispatches hold a lease, the oldest `issued_at` wins.
  - If `input.actor?.id ?? null` equals the holder, take that holder's leased dispatch with the latest `expires_at`. If it has at least 60 minutes left, return its `checkoutId` and insert no dispatch. Otherwise mint a new stamp as today (same holder, so no 409), so a caller never gets a stamp that is about to expire. A re-mint appends a normal `checkout` event, so `checkoutHolder` finds its holder. When, and only when, an existing id is returned, append one `checkout.reused` event (same payload as `checkout`, including `door`), not a second `checkout`, so `activity.ts`, `go-live-announcer.ts`, and routing counts do not change.
  - If the holder differs, throw `ApiError("checkout_held", "<task> is checked out on <repo> by another principal until <expires_at>.", 409)`. Insert nothing.
  - With no leased dispatch, mint as today. A released stamp (its PR merged or closed, F2) is not a candidate, so release frees the lease; a reopened PR un-releases its stamp, which then holds the lease again while it is unexpired.
  - Every door (`mc_checkout_task`, `POST /api/cursor/checkout`, `POST /api/compliance/checkout`) goes through `checkout()`, so all of them change together.
- **known limit:** two concurrent first calls can both insert. No DB constraint prevents it, and this phase does not fix that race (see Risks).
- **owns:**
  - `src/lib/compliance/service.ts`
  - `src/lib/compliance/repo.ts` (the three new queries only)
  - `tests/checkout-lease.test.ts`
  - `docs/modules/compliance/README.md` (the checkout contract section only: describe the lease)
  - `$PROOFS/lease-closeout.md` (code branch: also `pr255: merged f6d2bab7670a` and `spec_revision: r<n>`, n ≥ 13)
  - the `vi.mock("@/lib/compliance/repo", …)` factories in `tests/*.test.ts`: add the functions `checkout()` now calls (`liveDispatchesForTask`, `completedCheckoutIds`, `checkoutHolder`), and reset shared mock state in `beforeEach` where a test file lacks it. Never change or delete an existing `expect(`.
- **forbidden:** any edit to `tests/checkout-shared-core.test.ts`; `db/migrations/**`; `src/app/api/compliance/verify/**`; `scripts/generate-compliance-gate.py`; `.github/workflows/**`; `plugins/**`; Jev globs
- **tests:** commit `tests/checkout-lease.test.ts` first, using the mocked-repo pattern of `tests/compliance-server.test.ts:13-70` (its `db` and its `vi.mock("@/lib/compliance/repo", …)` factory; since #255 the dispatch rows carry `releasedAt` and `releasedReason`, and the factory mocks `releaseDispatches`, `unreleaseDispatches` and `eventTaskIdByDedupKey`). The copied `insertDispatch` (`:44-45`) sets `expiresAt` to `Date.now() + 3_600_000`, exactly 60 minutes. The "same holder gets the same id" case must set a longer expiry before the call (120 minutes is enough). If it leaves that default, less than 60 minutes remains by the time `checkout()` runs, the lease mints a new stamp, and the case fails. The under-60-minutes case sets its own shorter expiry. It covers:
  - the same holder gets the same id, with one `checkout.reused` event and no new dispatch
  - the same holder with under 60 minutes left gets a new stamp, recorded with a normal `checkout` event
  - after that re-mint, once the first stamp expires, the same holder's next call returns the new stamp with no 409
  - a different holder gets 409
  - a completed stamp frees the lease
  - a released stamp (its PR merged or closed) frees the lease: the next call mints a new one. Its `it` title contains the phrase `released stamp frees the lease`. The acceptance reads that title from the last ` > ` segment of `npx vitest list` (the `it` title). A `describe` title does not count. `vitest list` prints one line per collected test and nothing from the file body. A grep of the file text cannot serve here, because the copied mock factory already contains `releasedAt`, `releasedReason`, `releaseDispatches` and `unreleaseDispatches`.
  - an expired or revoked stamp mints a new one
  - a different repo mints a new one
  - a bare repo (`PLX_MC`) matches its full name (`petralabx/PLX_MC`)

  The first commit must fail; record `failing_first: <sha> fail`. The existing provenance test (`compliance-server.test.ts:266-284`) and the TASK-2011 block (`:139-251`) must pass unchanged.

  Every case mocks `repo`, so no test reaches the SQL of `liveDispatchesForTask`. The acceptance therefore also reads the branch diff of `src/lib/compliance/repo.ts` and requires an added line that contains `released_at IS NULL`. P4 owns only the three new queries in that file, and `liveDispatchesForTask` is the only one of the three that reads `mc_dispatch` (`completedCheckoutIds` and `checkoutHolder` read events), so that line can belong only to the lease query.
- **after merge:** CIP lands the PR. The operator confirms that `mc.plxcustomer.io` deployed the merge SHA and records `deployed_sha: <12 hex>`.
- **rollback:** revert the P4 commits on PLX_MC `main` and redeploy. There is no schema change to undo.

Acceptance (P4, cwd = P4 worktree):
```bash
. "$TOOLS/accept.sh"; L=$PROOFS/lease-closeout.md
if grep -qxF 'outcome: second-stamp' "$PROOFS/double-checkout.md"; then
  npm ci || fail "npm ci"
  [ -f tests/checkout-lease.test.ts ] || fail "no lease test"
  npx vitest run || fail "full vitest suite"
  npx vitest run tests/checkout-lease.test.ts || fail "lease test"
  npm run typecheck || fail typecheck
  git diff --quiet origin/main...HEAD -- tests/checkout-shared-core.test.ts db/migrations || fail "guard test or migrations changed"
  ! git diff --quiet origin/main...HEAD -- src/lib/compliance/service.ts || fail "checkout() unchanged"
  [ "$(git diff origin/main...HEAD -- 'tests/*.test.ts' | grep -c '^-.*expect(')" -eq 0 ] || fail "an existing expect( was removed or changed"
  rline 'failing_first: [0-9a-f]{7,40} fail' "$L"
  line 'pr255: merged f6d2bab7670a' "$L"
  rline 'spec_revision: r(1[3-9]|[2-9][0-9])' "$L"
  npx vitest list tests/checkout-lease.test.ts 2>/dev/null | awk -F ' > ' '{print $NF}' | grep -qiF 'released stamp frees the lease' || fail "no released-stamp case in the it title (D2, F2)"
  git diff origin/main...HEAD -- src/lib/compliance/repo.ts | grep -qE '^\+.*released_at IS NULL' || fail "liveDispatchesForTask ignores release (D2, F2)"
else
  line 'closed: no-code' "$L"
fi
```

### P5 — Measure always-on context

- **gate:** first yes · **executor:** orchestrator (mechanical) · **repo:** none (read-only clones)
- **depends_on:** `[]`
- **owns:** `$PROOFS/context-measure.md`
- **forbidden:** any repo edit; any PR; Jev globs
- **steps:**
  1. Refresh all four clones.
  2. Run `python3 "$TOOLS/measure_ref.py" "$PORTAL_REPO@b75477d9c85d" "$PORTAL_REPO@origin/staging" "$PLX_MC_REPO@origin/main" "$SWARM_REPO@origin/main" "$SECONDBRAIN_REPO@origin/main"`.
  3. Paste the output verbatim.
  4. Add `method_sha256:` (from `tools.md`), `code_edit: no`, and `pr: none`.
  5. List the broad-glob rules (a `globs:` value that matches most files, such as `**/*.{ts,tsx,js,jsx,py,md}`) with their bytes, one line each: `broad_glob: <repo> <file> <bytes>`. They load on almost every task but sit outside the `cursor` view. Portal has `workflow-orchestration.mdc` at 2665 bytes.
- **comparison row (27 Sep 2026):**
  - portal cursor 129113 at `b75477d9c85d`
  - portal claude 15862
  - swarm cursor 117574 at `35ed5034eddf`
  - PLX_MC cursor 52966 at `2faa2a2c9633`
  - swarm codex `bytes_dropped` 44171 at `35ed5034eddf`

Acceptance (P5):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/context-measure.md
for r in plx-customer-portal PLX_MC agentic-swarm plx_secondbrain; do line "repo: petralabx/$r" "$F"; done
[ "$(grep -Ec '^sha: [0-9a-f]{12}$' "$F")" -ge 5 ] || fail "five sha lines"
line 'code_edit: no' "$F"; line 'pr: none' "$F"; rline 'method_sha256: [0-9a-f]{64}' "$F"
OUT=$(python3 "$TOOLS/measure_ref.py" "$PORTAL_REPO@b75477d9c85d") || fail "meter run"
printf '%s\n' "$OUT" | grep -qxF 'view: cursor bytes: 129113 needles_missing: []' || fail "method no longer reproduces the baseline"
```

### P6 — Meter in PLX_MC

- **gate:** later yes · **executor:** orchestrator (builder) · **repo:** `petralabx/PLX_MC`, base `main` · **tier:** standard
- **depends_on:** `[P5]`
- **deliverables:**
  - `scripts/agent-context/measure.py`: stdlib only, a port of Appendix A with the same report lines. Command line: `measure.py [--check-needles] [--check-caps] REPO[@REF] [REPO[@REF] …]`. The two flags are booleans; repos are always positional. It adds two exit-coded modes:
    - `--check-needles REPO[@REF]…` exits 1 when a view in that repo's `needle_views` misses a needle.
    - `--check-caps REPO[@REF]…` exits 1 when a capped view is over its cap. With no caps for that repo, it exits 0 and prints `caps: none`.
    - The flags combine; the run exits 1 if either check fails. Report mode exits 0. A git error or a bad argument exits 2.
    - The repo is identified by its `origin` URL slug, so worktrees work. `caps.json` is read relative to `measure.py` itself (`Path(__file__).resolve().parents[2] / "config/agent-context/caps.json"`), never the cwd. A slug with no entry in `caps.json` exits 2 in either check mode.
  - `config/agent-context/caps.json`: per-repo `needle_views` and `caps`.
    - `needle_views`: portal `cursor claude codex`; PLX_MC `cursor claude codex hermes`; swarm `cursor claude codex hermes`; secondbrain `cursor claude codex`.
    - `caps`: the view caps from the P10 table, final values. The swarm keeps its `needle_views` entry because P6's acceptance runs `--check-needles` on the swarm baseline and expects exit 1; a slug missing from `caps.json` exits 2. The swarm has no caps (P10 no longer trims it). The portal slice cap (2457) is a file cap, not a view; P10 checks it with `wc -c`, not `caps.json`.
  - `config/agent-context/baseline.json`: the P5 numbers with their SHAs.
  - `tests/test_agent_context_measure.py`: builds temporary git repos. It proves report output, both exit codes of each check mode, the codex cap split, `hermes absent`, and the slug-from-origin rule.
  - `docs/modules/agent-context/README.md`: What, Why, How, Dependencies, Owner (repo module rule). Add one index row, `| agent-context | Vince | Medium | docs/modules/agent-context/README.md |`, to `docs/modules/README.md`, and the matching row to the `## Module Ownership` table in `AGENTS.md` (hand-written; outside the generated block).
  - No product behavior change.
- **owns:** `scripts/agent-context/**`, `config/agent-context/**`, `tests/test_agent_context_measure.py`, `docs/modules/agent-context/README.md`, one row in `docs/modules/README.md`, one row in the `AGENTS.md` Module Ownership table, `$PROOFS/meter.md` (`pr:`, `gate_tier:`)
- **forbidden:** `src/**`, `plugins/**`, `.github/workflows/**`, `scripts/generate-compliance-gate.py`, `scripts/generate-governance-surfaces.py`, Jev globs
- **rollback:** revert the P6 commit. Nothing reads these files until P8.

Acceptance (P6, cwd = P6 worktree):
```bash
. "$TOOLS/accept.sh"; M=scripts/agent-context/measure.py
.venv/bin/python -m pytest tests/test_agent_context_measure.py -q || fail pytest
OUT=$(python3 $M "$PORTAL_REPO@b75477d9c85d") || fail run1
printf '%s\n' "$OUT" | grep -qxF 'view: cursor bytes: 129113 needles_missing: []' || fail "portal baseline"
OUT=$(python3 $M "$PLX_MC_REPO@2faa2a2c9633") || fail run2
printf '%s\n' "$OUT" | grep -qxF "view: cursor bytes: 52966 needles_missing: ['repo: petralabx/PLX_MC']" || fail "PLX_MC baseline"
OUT=$(python3 $M "$SWARM_REPO@35ed5034eddf") || fail run3
printf '%s\n' "$OUT" | grep -qF 'view: codex bytes: 76939 loaded: 32768 bytes_dropped: 44171' || fail "swarm baseline"
python3 $M --check-caps "$PORTAL_REPO@95276888b6ed" >/dev/null; [ $? -eq 1 ] || fail "check-caps must exit exactly 1 on an over-cap tree"
python3 $M --check-caps --check-needles "$PORTAL_REPO@95276888b6ed" >/dev/null; [ $? -eq 1 ] || fail "combined flags must parse and exit 1"
python3 $M --check-needles "$PORTAL_REPO@95276888b6ed" >/dev/null; [ $? -eq 0 ] || fail "portal needles present today"
A=$PWD/$M
for r in "$SWARM_REPO@35ed5034eddf" "$SECONDBRAIN_REPO@af0b3ea3c9f8" "$PLX_MC_REPO@2faa2a2c9633"; do
  (cd / && python3 "$A" --check-needles "$r" >/dev/null); [ $? -eq 1 ] || fail "needles check from another cwd must exit 1 for $r"
done
./scripts/preflight.sh --mode pre-push || fail preflight
```

### P7 — Withdrawn in r12

The swarm writer lock is no longer needed. The writers write only the swarm repo,
which no phase edits now (SC-12, F25). The retirement spec's R1 plans to turn them off. No task is
created for P7, and no evidence file is written. The numbering of the other phases
does not change.

### P8 — Complete-order sentence and handshake slice

- **gate:** later yes (it edits PLX_MC and portal guides) · **executor:** orchestrator (builder) · **repos:** PLX_MC and secondbrain on base `main`, and portal on base `staging` (D12). Three MC tasks, three checkouts, three PRs.
- **depends_on:** all three halves need `[P6]` (merged). The phase is done when all three halves and the P8 close pass.
- **locked sentence** (exact words; do not paraphrase): `Last commit, then mc_complete_task, then freeze.` Markdown marks around a word (backticks, bold) are allowed; the check ignores them.
- **carrier rule:** every carrier contains the locked sentence at least once and no other complete-order wording. Any line matching `COMPETING` in Appendix B (for example "last commit … freeze", "Completing releases", "`mc_complete_task` … freeze", or "`mc_complete_task` before/during … PR"; case-insensitive) must contain the locked sentence, and nothing else on that line may match `COMPETING` once the locked sentence is removed (so "Last commit, then mc_complete_task, then freeze. Completing releases the checkout." fails). Identical copies are fine.
- **needles:** `mc_checkout_task`, `repo: petralabx/<slug>` (unquoted), `prBodyLine`, `MC-Checkout: pending`, `verificationCommands`, `rollback`, `dsp_`.
- **PLX_MC:**
  - In `config/governance-contract.yaml` `agent_workflow`, add the locked sentence and the line "In this repo, check out with `repo: petralabx/PLX_MC`." Replace any other complete-order wording there.
  - Regenerate with `python3 scripts/generate-governance-surfaces.py`.
  - In `config/cloud-agent-fleet-always-apply.md:118-120`, the Cursor Team Rules paste source, replace "Before creating or updating a PR on a governed repo: call `mc_complete_task` …" with the locked sentence, keeping the summary, rollback, and verificationCommands requirement.
  - Also replace the wording at `docs/AGENT-PR-SOP.md:325` with the locked sentence. Change only that line; `tests/test_canary.py` pins other strings in that file.
  - The locked sentence always sits on one line; `carrier` does not match a sentence that wraps.
  - After merge, the operator re-pastes the **Rule 5** fenced block of that file ("MC PR evidence closeout") into Cursor Team Rules.
  - Keep every string `tests/test_canary.py` pins (F13).
  - Carriers: `AGENTS.md`, `CLAUDE.md`, `HERMES.md`, `.cursor/rules/governance.mdc`, `config/cloud-agent-fleet-always-apply.md`.
- **plx_secondbrain (D3):** each of these files carries the 7 needles for `repo: petralabx/plx_secondbrain`, the locked sentence, and the line `compliance_mode: soft (registry; do not flip hard)`:
  - a new `AGENTS.md` (short, with a pointer to PLX_MC `docs/AGENT-PR-SOP.md`)
  - a new `CLAUDE.md` of at most 900 bytes
  - a new `.cursor/rules/mc-compliance.mdc` with `alwaysApply: true`

  Change `docs/GOVERNANCE.md:14` so it points at these files and forbids further copies. Carriers: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/mc-compliance.mdc`.
- **plx-customer-portal (D12):** replace each F14 portal line's competing sentence with the locked sentence, keeping the rest of the line. For example, "3. Last commit, then freeze. Completing releases the checkout. Never create a new TASK …" becomes "3. Last commit, then mc_complete_task, then freeze. Never create a new TASK …". For `mc-compliance.mdc:230,344`, rewrite only the clause that orders completion against PR open. Change nothing else. Carriers: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.cursor/rules/mc-compliance.mdc`.
- **no other change:** demote no other rule and delete no guide.
- **owns** (by repo):
  - PLX_MC: `config/governance-contract.yaml`, `config/cloud-agent-fleet-always-apply.md`, `docs/AGENT-PR-SOP.md` (line 325 only), and the regenerated `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `GROK.md`, `GEMINI.md`, `HERMES.md`, `.cursor/rules/governance.mdc`
  - secondbrain: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/mc-compliance.mdc`, `docs/GOVERNANCE.md`
  - portal: the 15 files listed in F14, those lines only
  - all: `$PROOFS/handshake.md`
- **forbidden:**
  - any `petralabx/agentic-swarm` file, any `scripts/` or `tests/` file in any repo, every other `.cursor/rules/*` file, and every other line of `docs/AGENT-PR-SOP.md`
  - the four nested portal AGENTS.md files, `portal/**`, and every portal line not listed in F14
  - `.github/workflows/**`, `plugins/**`, Jev globs
- **evidence template (`handshake.md`):** paste the `--check-needles` output under `## raw`.
  ```
  complete-order: last commit, then mc_complete_task, then freeze
  needles_missing: []
  pr_plx_mc: https://github.com/petralabx/PLX_MC/pull/<n>
  pr_secondbrain: https://github.com/petralabx/plx_secondbrain/pull/<n>
  pr_portal: https://github.com/petralabx/plx-customer-portal/pull/<n>
  team_rules_repasted: yes
  ```
  Also record `merged_<repo>: <12 hex>` for each of the three merged PRs. Write `needles_missing: []` only when `--check-needles` exits 0 for all three repos on their merged base.
- **rollback:** revert each repo's P8 PR on its own. The operator re-pastes the previous Team Rules text.

Acceptance (P8 PLX_MC half, cwd = the PLX_MC P8 worktree; runs on the frozen PR head):
```bash
. "$TOOLS/accept.sh"; M="$PLX_MC_REPO/scripts/agent-context/measure.py"
python3 "$M" --check-needles "$PWD" >/dev/null || fail needles
for f in AGENTS.md CLAUDE.md HERMES.md .cursor/rules/governance.mdc config/cloud-agent-fleet-always-apply.md docs/AGENT-PR-SOP.md; do carrier "$f"; done
sweep . || fail "competing wording left in PLX_MC"
! grep -qi 'Before creating or updating a PR' config/cloud-agent-fleet-always-apply.md || fail "old Team Rules wording"
.venv/bin/python scripts/generate-governance-surfaces.py --check || fail drift
.venv/bin/python -m pytest tests/test_canary.py -q || fail canary
```

Acceptance (P8 secondbrain half, cwd = the secondbrain P8 worktree; runs on the frozen PR head):
```bash
. "$TOOLS/accept.sh"; M="$PLX_MC_REPO/scripts/agent-context/measure.py"
python3 "$M" --check-needles "$PWD" >/dev/null || fail needles
[ "$(wc -c < CLAUDE.md)" -le 900 ] || fail "CLAUDE.md > 900"
grep -qx 'alwaysApply: true' .cursor/rules/mc-compliance.mdc || fail "secondbrain slice is not alwaysApply"
for f in AGENTS.md CLAUDE.md .cursor/rules/mc-compliance.mdc; do
  carrier "$f"
  grep -qF 'compliance_mode: soft (registry; do not flip hard)' "$f" || fail "soft line missing in $f"
done
! sed 's/[*`]//g' docs/GOVERNANCE.md | grep -qF 'Do not duplicate agent rules or MC-Checkout discipline in this repo.' || fail "GOVERNANCE.md:14 unchanged"
for n in AGENTS.md CLAUDE.md .cursor/rules/mc-compliance.mdc; do grep -qF "$n" docs/GOVERNANCE.md || fail "GOVERNANCE.md does not name $n"; done
sweep . || fail "competing wording left in secondbrain"
npm run typecheck || fail typecheck; npm test || fail tests
```

Acceptance (P8 portal half, cwd = the portal P8 worktree; runs on the frozen PR head):
```bash
. "$TOOLS/accept.sh"
LIST="AGENTS.md CLAUDE.md GEMINI.md .cursorrules .github/copilot-instructions.md .cursor/rules/mc-compliance.mdc .cursor/rules/mc-delegation.mdc .cursor/skills/babysit/SKILL.md .cursor/skills/mc-sync/SKILL.md prompts/uat-agent/v2/CONTRACT.md prompts/uat-agent/v2/SYSTEM.md prompts/workbench-readonly-build-prompt.md docs/runbooks/CLAUDE-CODE-WEB-MC-SETUP.md docs/runbooks/CLOUD-AGENT-ENVIRONMENT.md docs/runbooks/CONTRIBUTING.md"
for f in $(git diff --name-only origin/staging...HEAD); do case " $LIST " in *" $f "*) ;; *) fail "unexpected file $f" ;; esac; done
N=$(git diff --numstat origin/staging...HEAD | awk '{n+=$1+$2} END{print n+0}'); [ "$N" -le 60 ] || fail "diff too large for line-scoped fixes ($N lines)"
for f in AGENTS.md CLAUDE.md GEMINI.md .cursorrules .github/copilot-instructions.md .cursor/rules/mc-compliance.mdc; do carrier "$f"; done
for f in $LIST; do sed 's/[`*]//g' "$f" | grep -qiF -- "$LOCKED" || fail "locked sentence missing in $f"; done
sweep . || fail "competing wording left in portal"
node --test scripts/ci-staged-gate.test.mjs || fail "ci-staged-gate"
node scripts/uat-agent/verify-agent-contract.mjs || fail "uat agent contract"
hygiene_gate origin/staging
```

Acceptance (P8 close; runs after all three PRs merge and the operator re-pastes Team Rules):
```bash
. "$TOOLS/accept.sh"; M="$PLX_MC_REPO/scripts/agent-context/measure.py"
python3 "$M" --check-needles "$PLX_MC_REPO@origin/main" "$SECONDBRAIN_REPO@origin/main" "$PORTAL_REPO@origin/staging" >/dev/null || fail "needles on the merged base"
F=$PROOFS/handshake.md
line 'complete-order: last commit, then mc_complete_task, then freeze' "$F"; line 'needles_missing: []' "$F"
line 'team_rules_repasted: yes' "$F"
rline 'pr_plx_mc: https://github.com/petralabx/PLX_MC/pull/[0-9]+' "$F"
rline 'pr_secondbrain: https://github.com/petralabx/plx_secondbrain/pull/[0-9]+' "$F"
rline 'pr_portal: https://github.com/petralabx/plx-customer-portal/pull/[0-9]+' "$F"
for r in PLX_MC plx_secondbrain plx-customer-portal; do rline "merged_$r: [0-9a-f]{12}" "$F"; done
for d in "$PLX_MC_REPO" "$SECONDBRAIN_REPO" "$PORTAL_REPO"; do (cd "$d" && sweep .) || fail "competing wording on the merged base in $d"; done
```

### P9 — Loader canary

- **gate:** starts on evidence (after the P8 close block passes) · **executor:** operator · **recorder:** orchestrator · **repos:** portal, PLX_MC, secondbrain. Portal is included because P10 may trim it.
- **depends_on:** `[P8]` (the P8 close block passed)
- **owns:** `$PROOFS/loader-canary.md`
- **forbidden:** any PR; any push to a base branch; `plugins/**`, `.github/workflows/**`, `portal/prisma/**`, Jev globs
- **slices** (the `alwaysApply` handshake rule per repo):
  - portal `.cursor/rules/mc-compliance.mdc`
  - PLX_MC `.cursor/rules/governance.mdc`
  - secondbrain `.cursor/rules/mc-compliance.mdc`
- **steps:** do these once per repo.
  1. Make four nonces with `python3 -c 'import secrets; print("NONCE-" + secrets.token_hex(4))'`. Kinds:
     - `root`: in root `AGENTS.md`
     - `slice`: in the slice
     - `desc`: in one description-only rule (`alwaysApply: false`, a description, no globs)
     - `glob`: in one glob rule

     A nonce is never a `TASK-*` id.
  2. The operator pushes as a human (F19): `CURSOR_AGENT` and `CURSOR_AGENT_PR_BODY` unset, and a git identity that is not `cursoragent@cursor.com` or "Cursor Agent". The operator creates branch `proj/frontier-stack/canary-<slug>` from base. Add each nonce as one plain-text line, `Canary: NONCE-<hex>`. The root nonce goes on the line after the first `# ` heading of `AGENTS.md`, so file length cannot hide it. The other nonces go at the end of their rule files. Make these commits with the GitHub web editor on the canary branch, so no local hook runs; PLX_MC's pre-commit drift check would refuse a nonce in the generated `governance.mdc`. Cursor Cloud reads GitHub, not a local tree. CI or drift failures on this branch are expected and ignored; the branch never gets a PR.
  3. On each surface (Cursor IDE, Cursor Cloud on that branch, Cursor CLI), start a new chat with no files attached. Prompt: "Without calling any tool, list every string in your context that starts with NONCE-. If there are none, answer NONE."
  4. Record the nonces returned and the tool-call count.
  5. Delete the branch: `git push origin --delete proj/frontier-stack/canary-<slug>`, plus the local branch.
- **rows:** exactly one row per (surface, repo, kind):
  - root and slice: `surface: <cursor-ide|cursor-cloud|cursor-cli> repo: petralabx/<slug> kind: <root|slice> nonce: NONCE-<8 hex> result: <pass|fail> tool_calls: <n>`. A row passes only when its nonce came back with `tool_calls: 0`.
  - desc and glob: `surface: … repo: … kind: <desc|glob> nonce: … loaded: <yes|no|n/a> tool_calls: <n>`. Use `nonce: none loaded: n/a` when the repo has no rule of that kind (plx_secondbrain has neither after P8). Never create a rule on a canary branch. These rows inform the budget. They are not pass or fail.
  - Per repo, exactly one line: `canary: pass repo: petralabx/<slug>` when all six root and slice rows pass; otherwise `canary: fail repo: petralabx/<slug>`.
  - Footer: `pr: none` and `canary_branches_deleted: yes`.

Acceptance (P9):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/loader-canary.md
line 'pr: none' "$F"; line 'canary_branches_deleted: yes' "$F"
python3 - "$F" <<'EOF' || fail "canary rows"
import re, sys
t = open(sys.argv[1]).read()
repos = ["plx-customer-portal", "PLX_MC", "plx_secondbrain"]
surfaces = ["cursor-ide", "cursor-cloud", "cursor-cli"]
row = re.compile(r"^surface: (\S+) repo: petralabx/(\S+) kind: (root|slice) nonce: (NONCE-[0-9a-f]{8}) result: (pass|fail) tool_calls: (\d+)$", re.M)
rows = {}
for s, r, k, n, res, tc in row.findall(t):
    assert (s, r, k) not in rows, f"duplicate row {s} {r} {k}"
    rows[(s, r, k)] = (res == "pass" and tc == "0")
for r in repos:
    cells = [rows.get((s, r, k)) for s in surfaces for k in ("root", "slice")]
    assert None not in cells, f"{r}: missing root/slice rows"
    want = "pass" if all(cells) else "fail"
    lines = re.findall(rf"^canary: (pass|fail) repo: petralabx/{re.escape(r)}$", t, re.M)
    assert lines == [want], f"{r}: need exactly one canary line, and it must be {want}; got {lines}"
EOF
```

### P10 — Trim guides, one repo per PR

- **gate:** later yes, naming the repo · **executor:** orchestrator (builder) · **base:** `staging` for portal, `main` for the others · **tier:** standard
- **depends_on:** `[P9]`, plus `canary: pass` for that repo. A repo with `canary: fail` does not enter P10 (D8). plx_secondbrain has nothing to trim after P8, so P10 does not run for it.
- **what moves:**
  - `alwaysApply` bodies move to description-only rules, or to glob rules scoped to a path prefix (for example `portal/prisma/**`). A glob that starts with `*` or `**` loads on almost every task, so moved content never goes into one (acceptance checks every rule the PR touches).
  - Each repo keeps one `alwaysApply` slice (the P9 list), with all 7 needles and the locked sentence, following the P8 carrier rule.
  - The four nested portal AGENTS.md files stay untouched.
- **caps** (bytes, meter views; final values):

  | Repo | View | Cap | At the F7 heads |
  |---|---|---|---|
  | portal | cursor | 17408 | 130138 |
  | portal | claude | 14848 | 15862 |
  | portal | `.cursor/rules/mc-compliance.mdc` (the slice) | 2457 | 19778 |
  | PLX_MC | cursor | 32768 | 52966 |
  | PLX_MC | claude | 26624 | 16361 |

- **what the caps imply** (so the builder does not rediscover it):
  - **Portal:** root `AGENTS.md` (20864) plus `.cursorrules` (8243) alone exceed 17408, so the trim must shorten both. Keep every string `ci-staged-gate.test.mjs` pins (F13): the staging-merge sentence in AGENTS, CLAUDE, GEMINI, and `.cursorrules`, and no banned phrase. Demote `auto-merge-after-push.mdc` and `pr-watch-until-green.mdc` by frontmatter only (`alwaysApply: false` plus a `description:`); never move, rename, split, or reword their bodies. Do not touch `.cursor/skills/`. P8 already replaced the competing wording (D12); the trim must not bring any back, including in demoted rules (`sweep`). Keep `repo: petralabx/plx-customer-portal`, and write no `Never Hub`, in AGENTS.md.
  - **PLX_MC:** generated surfaces change through `config/governance-contract.yaml` plus regeneration, never by hand. Keep every string `tests/test_canary.py` pins and the two AGENTS.md cells `check-arch-parity.py` pins.
- **owns** (by repo):
  - portal: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`, `.cursor/rules/**`
  - PLX_MC: `config/governance-contract.yaml`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `GROK.md`, `GEMINI.md`, `HERMES.md`, `.cursor/rules/**`
  - all: `$PROOFS/guide-trim.md`
- **forbidden:**
  - the four nested portal AGENTS.md files, `portal/prisma/**`
  - PLX_MC `tests/test_canary.py`, any `petralabx/agentic-swarm` file
  - `.github/workflows/**`, `scripts/generate-compliance-gate.py`, `plugins/**`, Jev globs
- **evidence template (`guide-trim.md`):** append one block per repo; paste the meter output under `## raw`.
  ```
  repo: petralabx/<slug>
  sha: <12 hex of the PR head>
  cap: met repo: petralabx/<slug>
  pr: <PR URL>
  ```
  Write `cap: met` only when `--check-caps --check-needles` exits 0 on the PR head.
- **rollback:** revert that repo's P10 PR. The P8 slice stays.

Acceptance (P10, cwd = P10 worktree; plus the repo's pre-push validation):
```bash
. "$TOOLS/accept.sh"; M="$PLX_MC_REPO/scripts/agent-context/measure.py"
line "canary: pass repo: petralabx/$SLUG" "$PROOFS/loader-canary.md"
python3 "$M" --check-caps --check-needles "$PWD" || fail "caps or needles"
line "cap: met repo: petralabx/$SLUG" "$PROOFS/guide-trim.md"
BASE=$([ "$SLUG" = plx-customer-portal ] && echo origin/staging || echo origin/main)
git diff --name-only "$BASE...HEAD" -- .cursor/rules | python3 -c '
import re, sys
bad = []
for f in (l.strip() for l in sys.stdin if l.strip()):
    try: t = open(f).read()
    except FileNotFoundError: continue
    m = re.match(r"---\r?\n(.*?)\r?\n---", t, re.S)
    fm = m.group(1) if m else ""
    g = re.search(r"(?ms)^globs:(.*?)(?=^\S|\Z)", fm)
    pats = re.findall(r"[^\s,\[\]\x27\x22-][^,\[\]\x27\x22]*", g.group(1)) if g else []
    if any(p.strip().startswith("*") for p in pats): bad.append(f)
sys.exit("broad glob in: " + " ".join(bad) if bad else 0)' || fail "moved content into a broad glob"
case "$SLUG" in
  plx-customer-portal)
    [ "$(wc -c < .cursor/rules/mc-compliance.mdc)" -le 2457 ] || fail "slice > 2457"
    sweep . || fail "competing wording left in portal"
    for f in AGENTS.md CLAUDE.md GEMINI.md .cursorrules .github/copilot-instructions.md .cursor/rules/*.mdc; do
      if grep -qiE "$COMPETING|$LOCKED" "$f" || [ "$f" = .cursor/rules/mc-compliance.mdc ]; then carrier "$f"; fi
    done
    grep -qF 'repo: petralabx/plx-customer-portal' AGENTS.md || fail "AGENTS repo line"
    ! grep -q 'Never Hub' AGENTS.md || fail "Never Hub"
    git diff --quiet origin/staging...HEAD -- .cursor/skills || fail "skills changed"
    B=$(git merge-base HEAD origin/staging)
    for r in auto-merge-after-push pr-watch-until-green; do
      body() { awk 'c>=2{print} /^---$/{c++}'; }   # text after the closing frontmatter line
      diff <(git show "$B:.cursor/rules/$r.mdc" | body) <(body < .cursor/rules/$r.mdc) >/dev/null || fail "$r body changed"
    done
    node --test scripts/ci-staged-gate.test.mjs || fail "ci-staged-gate"
    hygiene_gate origin/staging ;;
  PLX_MC)
    for f in AGENTS.md CLAUDE.md HERMES.md .cursor/rules/governance.mdc; do carrier "$f"; done
    sweep . || fail "competing wording"
    .venv/bin/python scripts/generate-governance-surfaces.py --check || fail drift
    .venv/bin/python -m pytest tests/test_canary.py -q || fail canary; .venv/bin/python scripts/check-arch-parity.py || fail "arch parity" ;;
  *) fail "P10 does not run for $SLUG" ;;
esac
```

### P11 — Audit nested portal roster files

- **gate:** first yes · **executor:** orchestrator (mechanical) · **repo:** none (read-only)
- **depends_on:** `[]`
- **owns:** `$PROOFS/roster-audit.md`
- **forbidden:** any repo edit; running `scripts/sync-agents-md.py`; any PR; Jev globs
- **deliverables:**
  - Quote, with line numbers, every retired name in the four files. Known names (F12): CEO Router, CEO, R.Commander, Vibes, Dick, Senior (roster use only), Prof, Factory, CRO, CMO, PMP, QART.Commander, D.Commander, Dev Team, QA Techs, QA Reviewer.
  - Quote the "Auto-generated … Do not edit manually" header lines.
  - Record `banner_missing: <path>` for each file without the consumer-copy banner.
  - Quote the current roster from root `AGENTS.md:9-11,41,49-56`: "(Cursor Cloud, Grok Bot, CIP, Claude Code, Codex, Copilot, Gemini, Hermes) and colleagues shipping from IDEs" (Cos, Ricardo, Stephen); humans review in Mission Control.
  - Record `code_edit: no` and `pr: none`.

Acceptance (P11):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/roster-audit.md
line 'code_edit: no' "$F"; line 'pr: none' "$F"; line 'banner_missing: portal/src/components/AGENTS.md' "$F"
for p in portal/src/app/AGENTS.md portal/src/components/AGENTS.md portal/src/lib/AGENTS.md portal/prisma/AGENTS.md 'Cursor Cloud' 'Claude Code' 'Codex' 'Auto-generated' 'Vibes' 'D.Commander' 'QART.Commander' 'Factory'; do
  grep -qF "$p" "$F" || fail "missing $p"
done
```

### P12 — Correct nested portal roster files

- **gate:** later yes · **executor:** orchestrator (builder) · **repo:** `petralabx/plx-customer-portal`, base `staging` · **tier:** low (docs only)
- **depends_on:** `[P11]`
- **deliverables** (hand edit only; never run the generator):
  1. Hygiene is compared with the branch point by `hygiene_gate` (Appendix B), so the shims that expire on 30 Sep 2026 (F21) do not block this phase.
  2. Replace the "Auto-generated … Do not edit manually" header with: "Hand-maintained. Root `/AGENTS.md` is canonical. Do not regenerate with `scripts/sync-agents-md.py`."
  3. Add the consumer-copy banner to `components/AGENTS.md`, per SOP `:165-173`, with the exact lines the other three files carry.
  4. Roster text: each file gets one line that copies root `AGENTS.md:10`: "Agents: Cursor Cloud, Grok Bot, CIP, Claude Code, Codex, Copilot, Gemini, Hermes, and colleagues shipping from IDEs (Cos, Ricardo, Stephen). Humans review in Mission Control. Accountable human: vince@petrasoap.com."
  5. In tables and headings, replace retired agent names:
     - a cell in a review or approval column becomes `human review in Mission Control`
     - every other cell that names a retired agent (builder, designer, owner, or domain expert, for example `Dick`, `Vibes`, `Factory, Prof`, `PMP, CRO`) becomes `any agent`
     - headings drop the agent name (for example "Manufacturing Domain Rules (Factory Enforces)" becomes "Manufacturing Domain Rules")
     - "Factory-aware" becomes "manufacturing-aware"
  6. In body text:
     - a sentence that names a retired agent as reviewer or approver ("Prof review", "Senior review", "Senior approves") names `human review in Mission Control` instead, with the same rule (for example "Do not create migrations without human review in Mission Control")
     - a sentence that names one as implementer ("Vibes builds", "Dick designs") says `the implementing agent`
     - delete the delegation paragraphs that only describe the retired orchestration (D.Commander, QART.Commander, QA Techs, the "escalate to CEO" line)
  7. Keep these word for word: the manufacturing domain rules (FEFO, full lot traceability, 21 CFR Part 11, soft deletes, immutable audit trails, formulation sums, versioned BOMs, OEE and preventive maintenance) and the line "No temporary fixes. Senior developer standards." Add no agent name. The files stay.
  8. In the PR body, `## Review links` holds GitHub blob links for the four files on the PR branch.
  9. Record `gate_tier:` in `roster-fix.md`.
- **owns:** the four files, `$PROOFS/roster-fix.md`
- **forbidden:** `portal/prisma/schema.prisma`, `portal/prisma/migrations/**`, root `AGENTS.md`, `scripts/sync-agents-md.py`, `.github/workflows/**`, `plugins/**`, Jev globs
- **rollback:** revert the P12 PR.

Acceptance (P12, cwd = P12 worktree):
```bash
. "$TOOLS/accept.sh"
F="portal/src/app/AGENTS.md portal/src/components/AGENTS.md portal/src/lib/AGENTS.md portal/prisma/AGENTS.md"
! grep -nE '\b(CEO|R\.Commander|Vibes|Dick|Prof|Factory|CRO|CMO|PMP|QART\.Commander|D\.Commander|QA Techs|QA Reviewer|Dev Team)\b|Auto-generated|Do not edit manually' $F || fail "retired name or header left"
! { grep -nE '\bSenior\b' $F | grep -v 'Senior developer standards'; } || fail "Senior as a roster name"
for f in $F; do for s in 'Cursor Cloud' 'Grok Bot' 'CIP' 'Claude Code' 'Codex' 'Copilot' 'Gemini' 'Hermes' 'Mission Control' 'Consumer copy notice' 'Hand-maintained'; do
  grep -qF "$s" "$f" || fail "$f lacks $s"; done; done
B=$(git merge-base HEAD origin/staging)
for f in $F; do
  grep -qF 'Additive local guidance is allowed. Contradicting root rules is not allowed.' "$f" || fail "$f lacks the second banner line"
  for p in 'FEFO' '21 CFR Part 11' 'Formulation %s must sum to 100%' 'Never delete versioned BOMs' 'Full lot traceability' \
           'Soft deletes only' 'Immutable audit trails' 'OEE tracking' 'Preventive maintenance' 'No temporary fixes. Senior developer standards.'; do
    if git show "$B:$f" | grep -qF -- "$p"; then grep -qF -- "$p" "$f" || fail "$f dropped domain rule: $p"; fi
  done
done
hygiene_gate origin/staging
```

### P13 — Audit the brain MCP registration point

- **gate:** first yes · **executor:** orchestrator (mechanical) · **repo:** none (read-only)
- **depends_on:** `[]`
- **owns:** `$PROOFS/brain-audit.md`
- **forbidden:** `.cursor/mcp.json`, `.mcp.json`, `apps/**`, `plugins/**`, `.github/workflows/**`; any registration; any PR; Jev globs
- **deliverables:**
  - Quote `docs/runbooks/brain-mcp.md:26-42`:
    - name `plx-brain`
    - URL `https://missioncontrol.tayloralton.com/api/vmc/knowledge/mcp`
    - header `X-API-Key` (the knowledge-plane key: `VMC_API_KEY` or a dept key from `VMC_SCOPED_API_KEYS`)
    - optional `X-MCP-Session` and `X-Agent-Name` set to `plx-brain`
    - the register point: cursor.com/agents → MCP servers
  - Quote the declaration table `:15-22`: owner, auth, default state, kill switch, health check, fallback, and data/audit boundary.
  - Quote that the route exists at `apps/vmc-web/src/app/api/vmc/knowledge/mcp/route.ts`.
  - Record the write tools and the key-parity fact (F16).
  - Record that no committed MCP file has a `plx-brain` key.
  - Record that the swarm retirement spec's R6 routes this path to the new brain service in plx_secondbrain, R6a gives the brain its own address, and R7 moves each caller to it (F26). P14 registers that address with a brain key (D5, D14).
  - Record `registered: no`. Never paste a key.
- **r13:** only the R6a fact above changed (retirement section 10: "P13 runs as it is"); the gate, the template and the acceptance are r12's. A P13 run under r12 stays valid for P14. Round 10 reviews this change with P14 (D13, SC-13).
- **evidence template (`brain-audit.md`):** quotes go under `## raw`.
  ```
  name: plx-brain
  url: https://missioncontrol.tayloralton.com/api/vmc/knowledge/mcp
  route: apps/vmc-web/src/app/api/vmc/knowledge/mcp/route.ts
  kill_switch: BRAIN_MCP_HTTP_ENABLED=0
  health_check: brain_self_check
  writes: brain_ingest, brain_propose_relation
  moves_to: plx_secondbrain service (retirement R4, R6, R7)
  registered: no
  code_edit: no
  pr: none
  ```

Acceptance (P13):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/brain-audit.md
for l in 'name: plx-brain' 'url: https://missioncontrol.tayloralton.com/api/vmc/knowledge/mcp' 'registered: no' \
         'code_edit: no' 'pr: none' 'kill_switch: BRAIN_MCP_HTTP_ENABLED=0' 'health_check: brain_self_check' \
         'writes: brain_ingest, brain_propose_relation' 'route: apps/vmc-web/src/app/api/vmc/knowledge/mcp/route.ts' \
         'moves_to: plx_secondbrain service (retirement R4, R6, R7)'; do
  line "$l" "$F"
done
```

### P14 — Register plx-brain on the Team MCP list

- **gate:** later yes that names `BRAIN_URL` (D14), given against r13 or later, after Vince's yes on r13 and round 10 (D13, SC-13), plus Vince's yes to D5 as changed in r13. The D5 yes has one form, the phrase `D5 as r13`, and Vince gives it once: in a yes on r13 (`yes r13, D5 as r13`) or in this later yes (`yes P14, BRAIN_URL=https://brain.plxcustomer.io, D5 as r13`; drop `, D5 as r13` when the yes on r13 already carried it). `r13` names the revision that changed D5, whatever revision the yes is given against, so the phrase stays the same under r14 or later and the acceptance checks it as a fixed line. The later yes is the explicit enablement this write-capable integration needs, and the D5 phrase is Vince's yes to the changed default (the rule under "Decisions a yes confirms"); r12's yes covered r12's D5 only. · **executor:** operator (cursor.com dashboard) · **recorder:** orchestrator · **repo edit:** none
- **depends_on:** `[P13]`, plus Vince's yes on r13 and round 10 applied to the r13 changes to D5, D14, F26, P13 and P14 (D13, SC-13), plus Vince's `D5 as r13` (the gate), plus `brain_self_check` answering at `$BRAIN_URL/api/vmc/knowledge/mcp` with a brain key (retirement R6a is done; the rest of R7 need not be done), plus a `BRAIN_API_KEY` issued for the Cursor Team MCP registration (R4 creates `BRAIN_API_KEYS`; the operator adds this key to it, which does not wait for R7: retirement section 10 says P14 needs only the host answering `brain_self_check`)
- **owns:** `$PROOFS/brain-register.md`
- **forbidden:** `.cursor/mcp.json`, `.mcp.json`, and any stdio `plx-brain` block in a committed file; `plugins/**`, `.github/workflows/**`; `PLX_MC_MCP_API_KEY`, the `VMC_API_KEY` value or any `VMC_SCOPED_API_KEYS` department key as the header value (D5); Jev globs
- **stop rule:** if the runbook table is missing, or `brain_self_check` does not answer at `$BRAIN_URL/api/vmc/knowledge/mcp`, stop and register nothing.
- **steps:**
  1. The orchestrator records the yeses in `brain-register.md` before anything is registered: `spec_revision: r<n>` (the revision the later yes was given against; n ≥ 13); `later_yes: yes P14, BRAIN_URL=<BRAIN_URL>` or `later_yes: yes P14, BRAIN_URL=<BRAIN_URL>, D5 as r13` (Vince's words, in the gate's form) and `later_yes_at: <UTC>`; `d5_confirmed: D5 as r13`, `d5_confirmed_at: <UTC, when Vince gave the yes that carried the phrase>` and `d5_confirmed_in: yes on r<n>` (the yes on r13, or on the revision current when he gave it) or `d5_confirmed_in: P14 later yes`. Without a yes from Vince that carries `D5 as r13`, P14 does not start.
  2. At cursor.com/agents → MCP servers → Add server, enter name `plx-brain`, the URL `$BRAIN_URL/api/vmc/knowledge/mcp` (the R6a address), and the header `X-API-Key` set to the brain key chosen by D5 (a `brn_` key from `BRAIN_API_KEYS`). Optionally add `X-MCP-Session: plx-brain` and `X-Agent-Name: plx-brain`.
  3. Reload MCP in a Cursor Cloud agent and run `brain_self_check`.
- **evidence template:**
  ```
  registered_name: plx-brain
  spec_revision: r<n>
  later_yes: yes P14, BRAIN_URL=<BRAIN_URL>[, D5 as r13]
  later_yes_at: <UTC, when Vince gave that yes>
  d5_confirmed: D5 as r13
  d5_confirmed_at: <UTC, when Vince gave the yes that carried the phrase>
  d5_confirmed_in: <yes on r<n> | P14 later yes>
  brain_url: <BRAIN_URL>
  url: <BRAIN_URL>/api/vmc/knowledge/mcp
  brain_host_live_at: <UTC, when brain_self_check first answered at BRAIN_URL (retirement R6a)>
  service_commit: <12 hex of the plx_secondbrain main commit serving the route>
  key_kind: brain
  key_name: BRAIN_API_KEY:<label the operator gave the key when it was issued>
  registered_by: <email>
  registered_at: <UTC>
  brain_self_check: ok
  writes: brain_ingest, brain_propose_relation
  stdio_in_committed_mcp_json: no
  kill_switch: BRAIN_MCP_HTTP_ENABLED=0
  ```
- **rollback:** remove the server from the Team MCP list. In an emergency, set `BRAIN_MCP_HTTP_ENABLED=0` on the brain service's host. That disables brain HTTP MCP for every client.

Acceptance (P14):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/brain-register.md
for l in 'registered_name: plx-brain' 'brain_self_check: ok' 'stdio_in_committed_mcp_json: no' \
         'writes: brain_ingest, brain_propose_relation' 'kill_switch: BRAIN_MCP_HTTP_ENABLED=0'; do line "$l" "$F"; done
case "$BRAIN_URL" in https://missioncontrol.tayloralton.com*) fail "BRAIN_URL is the old host (D14)" ;; https://?*) ;; *) fail "BRAIN_URL must be https" ;; esac
rline 'spec_revision: r(1[3-9]|[2-9][0-9])' "$F"
grep -qxF -e "later_yes: yes P14, BRAIN_URL=$BRAIN_URL" -e "later_yes: yes P14, BRAIN_URL=$BRAIN_URL, D5 as r13" "$F" || fail "later_yes must be Vince's P14 yes that names BRAIN_URL, with or without 'D5 as r13' (D14, D5)"
rline "later_yes_at: $TS" "$F"
line 'd5_confirmed: D5 as r13' "$F"; rline "d5_confirmed_at: $TS" "$F"; rline 'd5_confirmed_in: (yes on r(1[3-9]|[2-9][0-9])|P14 later yes)' "$F"
if grep -qxF 'd5_confirmed_in: P14 later yes' "$F"; then line "later_yes: yes P14, BRAIN_URL=$BRAIN_URL, D5 as r13" "$F"; fi
line "brain_url: $BRAIN_URL" "$F"; line "url: $BRAIN_URL/api/vmc/knowledge/mcp" "$F"
rline "brain_host_live_at: $TS" "$F"; rline 'service_commit: [0-9a-f]{12}' "$F"
line 'key_kind: brain' "$F"; rline 'key_name: BRAIN_API_KEY:[A-Za-z0-9_.-]+' "$F"
! grep -qE 'VMC_API_KEY|VMC_SCOPED_API_KEYS|brn_[A-Za-z0-9]{5,}' "$F" || fail "a VMC key name or key material in the P14 evidence (D5)"
rline 'registered_by: [^ ]+@[^ ]+' "$F"; rline "registered_at: $TS" "$F"
! git -C "$SWARM_REPO" grep -q plx-brain -- .cursor/mcp.json .mcp.json || fail "plx-brain in swarm MCP config"
! git -C "$PORTAL_REPO" grep -q plx-brain -- .mcp.json .cursor/mcp.json.example || fail "plx-brain in portal MCP config"
```

### P15 — Audit the compliance merge-queue path

- **gate:** first yes · **executor:** orchestrator (mechanical) for the code lines; a repo admin (operator) for the settings lines · **repo:** none (read-only)
- **depends_on:** `[]`
- **owns:** `$PROOFS/merge-queue-audit.md`
- **forbidden:** `.github/workflows/**`, `scripts/generate-compliance-gate.py`, `src/app/api/compliance/**`; ruleset changes; any PR; Jev globs
- **deliverables:**
  - **Code lines (orchestrator):** record these, then release the slot.
    - The `on:` block and job id of portal `plx-mc-compliance.yml` and of the stopgap.
    - `NAME_AND_PR_TRIGGER` from PLX_MC `scripts/generate-compliance-gate.py:58-63`, with its `pull_request` types (four since #255).
    - The `merge_group` triggers of `lint-typecheck-build` and `Validate ledgers`.
    - The TASK-2008 test in `ci-staged-gate.test.mjs:871-956`, and the import of `scripts/merge-group-prs.mjs` at `:20` with its test at `:958-980`.
    - The drift check's `GEN_SHA`.
    - The verify facts in F11.
  - **Settings lines (admin):**
    - The required checks and "Require merge queue" state of ruleset `18632985`.
    - Org ruleset `18679471`: its rule type (for example `workflows`), the workflow path and ref it runs, and the branches it targets.
    - The `prd` field of buckets `BKT-INFRA` and `BKT-PROD`. Read it with `mc_get_context { depth: "full" }`, which returns full bucket rows (`mc_list_buckets` omits `prd`). Paste the two raw rows under `## raw`.
- **evidence template (`merge-queue-audit.md`):** quotes go under `## raw`.
  ```
  job_id: compliance
  plx_mc_compliance_merge_group: absent
  stopgap: .github/workflows/compliance-merge-group.yml
  lint-typecheck-build_merge_group: present
  validate-ledgers_merge_group: present
  NAME_AND_PR_TRIGGER: pull_request only
  verify_oidc_merge_group: rejected
  ci_test_pins_stopgap: scripts/ci-staged-gate.test.mjs
  gen_sha: <40 hex>
  queue_enabled: <yes|no>
  org_ruleset_type: <type>
  org_ruleset_workflow: <path@ref|none>
  bucket_prd: BKT-INFRA <present|absent>
  bucket_prd: BKT-PROD <present|absent>
  compliance_ci_token: <present|absent>
  last_run_auth: <oidc|bearer|bearer-fallback|skipped>
  gate_pr_types: opened, synchronize, reopened, edited
  pr255: merged f6d2bab7670a
  code_edit: no
  pr: none
  ```
    - Whether the portal secret `COMPLIANCE_CI_TOKEN` exists (name only).
    - Which auth path the latest `plx-mc-compliance` run used, from its `auth=` log line: `oidc`, `bearer`, or `bearer-fallback`; `skipped` when the run logged "compliance gate skipped".
- **#255 (D13):** record `pr255: merged f6d2bab7670a` (F24) and the generator's `pull_request` types (`gate_pr_types`). An r12 run of P15 does not satisfy r13. P15 runs again under r13 before P16 starts. The r12 run has no `gate_pr_types` line, so it fails the acceptance below whatever it recorded for `pr255`, and the P16 PLX_MC acceptance reads both r13 lines from `merge-queue-audit.md`.

Acceptance (P15):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/merge-queue-audit.md
for l in 'job_id: compliance' 'plx_mc_compliance_merge_group: absent' 'stopgap: .github/workflows/compliance-merge-group.yml' \
         'lint-typecheck-build_merge_group: present' 'validate-ledgers_merge_group: present' 'NAME_AND_PR_TRIGGER: pull_request only' \
         'verify_oidc_merge_group: rejected' 'ci_test_pins_stopgap: scripts/ci-staged-gate.test.mjs' 'code_edit: no' 'pr: none'; do
  line "$l" "$F"
done
rline 'queue_enabled: (yes|no)' "$F"; rline 'org_ruleset_type: [a-z_]+' "$F"; rline 'org_ruleset_workflow: ([^ ]+@[^ ]+|none)' "$F"
rline 'bucket_prd: BKT-INFRA (present|absent)' "$F"; rline 'bucket_prd: BKT-PROD (present|absent)' "$F"
rline 'compliance_ci_token: (present|absent)' "$F"; rline 'last_run_auth: (oidc|bearer|bearer-fallback|skipped)' "$F"
rline 'gen_sha: [0-9a-f]{40}' "$F"
line 'pr255: merged f6d2bab7670a' "$F"
line 'gate_pr_types: opened, synchronize, reopened, edited' "$F"
```

### P16 — merge_group in the compliance generator and verify service

- **gate:** later yes · **executor:** orchestrator (builder) · **repos:** `petralabx/PLX_MC` base `main` first, then `petralabx/plx-customer-portal` base `staging`. Two MC tasks, two PRs. **Tier:** high; both PRs touch `.github/workflows/`.
- **depends_on:** `[P15]` run under r13 (an r12 run does not satisfy r13; the PLX_MC acceptance reads P15's r13 lines), plus a bucket PRD `present` for each half's bucket (D11: `BKT-INFRA` for PLX_MC, `BKT-PROD` for portal), plus D13 (#255 merged; this half runs under r13 or later, after Vince's yes on r13 and round 10). The PLX_MC half never runs at the same time as P4. The portal half starts, and checks out, only after the PLX_MC PR is merged and deployed (8-hour rule), and only after the P8 and P10 portal PRs have merged (`cap: met repo: petralabx/plx-customer-portal` in `guide-trim.md`; D13).
- **PLX_MC PR (D4):**
  - **Generator:**
    - `NAME_AND_PR_TRIGGER` adds `merge_group:` with `types: [checks_requested]` and no `paths` filter, beside the existing `pull_request` types, which stay `[opened, synchronize, reopened, edited]` (#255; `tests/test_generate_compliance_gate.py:49-55` pins that exact list).
    - The downstream job keeps id `compliance` and branches inside its shell on `$GITHUB_EVENT_NAME`. The `pull_request` branch stays the same.
    - The `merge_group` branch gets `GH_TOKEN: ${{ github.token }}`. It parses `N` from `github.event.merge_group.head_ref` (`gh-readonly-queue/<base>/pr-<N>-<sha>`). With `gh api`, inline, and no repo-local script, it reads PR `N`'s body, head SHA, labels, and changed files. It extracts the `MC-Checkout` lines and posts the existing verify payload plus `event: "merge_group"`, with `prNumber: N` and PR `N`'s head SHA.
    - When it cannot parse `N` or read the PR, it prints `merge_group: could not resolve the pull request` and joins the existing block-verdict path, which exits 1 in hard mode and prints the soft-mode notice and exits through the existing soft-mode exit otherwise. It adds no new exit.
  - **Regenerate:** regenerate PLX_MC's own `.github/workflows/compliance-gate.yml`, so `generate-compliance-gate.py --check` passes. The trigger stays inert in PLX_MC, which has no queue.
  - **Verify route:**
    - `src/app/api/compliance/verify/route.ts` accepts an optional body field `event: z.enum(["pull_request", "merge_group"]).optional()`, with no zod default, so a body without `event` is forwarded unchanged. `verifyPr` treats a missing `event` as `pull_request`.
    - For OIDC it requires `event` to equal `claims.eventName`; a missing `event` counts as `pull_request`, and a null `eventName` claim keeps today's behavior (`route.ts:88-90`).
    - For `merge_group` it requires `ref` to match `^refs/heads/gh-readonly-queue/[^/]+/pr-(\d+)-[0-9a-f]+$`, with that number equal to `body.prNumber`, plus the existing repo and workflow binding.
    - `pull_request` binding does not change.
    - Bearer (`COMPLIANCE_CI_TOKEN`) requests keep today's rule: the body is trusted, including `event`. This is safe because merge-group mode only re-confirms a stamp that already passed on the same head.
  - **Service:** `verifyPr` takes `event`. For `merge_group`, it resolves each stamp with a queue resolver, not `prDispatchResolver`: `resolveDispatch` first (`service.ts:113-125`: unknown, revoked, released, repo mismatch, expired); on `expired` only, it accepts the stamp when `eventTaskIdByDedupKey(gateDedupKey(repo, prNumber, headSha, taskId, "pass"))` returns that task (the `resolveDispatchForMerge` rule, `:169-180`), else it blocks. It never calls `loadPrState` in `merge_group` mode. `pull_request` resolution does not change: it keeps #255's `prDispatchResolver` (F11).
  - **Tests:** add cases, failing first. Route cases go in `tests/compliance-verify-route.test.ts`. Service cases go in a new `tests/compliance-merge-group.test.ts`, using the mocks of `tests/compliance-server.test.ts:10-104` (they already include `eventTaskIdByDedupKey` and a `loadPrState` mock, so the string `loadPrState` is in the new file before any case asserts on it). Every new test name contains `merge_group`. Put it, and the two fixed titles below, in the `it` title itself, not only in a `describe` title: the acceptance reads the last ` > ` segment of each `npx vitest list` line, so a `describe` titled `merge_group` does not count. A grep of the file text proves nothing here:
    - an OIDC `merge_group` with a matching `pr-N` passes the binding; a mismatched `N` fails
    - `event` must match the claim
    - `merge_group: an expired stamp with a prior pass on the same head passes without loadPrState`, this exact title. The prior pass is an entry in the mock's `db.dedupKeys` equal to the gate's dedup key for that repo, PR, head, task and `pass` (`gateDedupKey`, `service.ts:162-164`; the mock `eventTaskIdByDedupKey` at `tests/compliance-server.test.ts:41-43` answers `TASK-900` for any key present, so the stamp's task is `TASK-900`). The case asserts verdict `pass` and `expect(github.loadPrState).not.toHaveBeenCalled()`, the idiom of `tests/compliance-server.test.ts:186,192`.
    - `merge_group: an expired stamp with no prior pass blocks without loadPrState`, this exact title. The `loadPrState` mock resolves `{ open: true, checkoutIds: [<the stamp>] }`, as the copied `beforeEach` (`:128-137`) does for `dsp_old`, so a resolver that fell through to `prDispatchResolver` (`service.ts:148-158`) would pass the stamp and fail this case. The case asserts verdict `block` and `expect(github.loadPrState).not.toHaveBeenCalled()`.
    - a released stamp blocks in `merge_group` with reason `released`
    - `pull_request` with an expired stamp keeps #255's rule: it passes when `loadPrState` says the PR is open and carries the stamp, and blocks when the PR is closed or the stamp is not in the body (`tests/compliance-server.test.ts:139-251` pins this; the new case shows that `merge_group` support did not change it)

    Extend `tests/test_generate_compliance_gate.py` for the new trigger; keep `test_pull_request_trigger_includes_edited_so_stamp_edits_rerun_gate` (`:49-55`).
  - After CIP lands the PR, the operator confirms that `mc.plxcustomer.io` deployed it.
- **portal PR:**
  - Regenerate `.github/workflows/plx-mc-compliance.yml` with `--emit downstream` from the merged PLX_MC SHA. The regenerated file gains `edited` (#255) and `merge_group` (this phase) at once.
  - Set `GEN_SHA` in `.github/workflows/compliance-gate-drift.yml` to that SHA.
  - Delete `.github/workflows/compliance-merge-group.yml`, as its header asks.
  - Edit the TASK-2008 test in `scripts/ci-staged-gate.test.mjs` (`:871-956` at `2b656d8adf33`) exactly as follows:
    - In `required` (`:872-877`), re-point `["compliance-merge-group.yml", "compliance"]` to `["plx-mc-compliance.yml", "compliance"]`. Keep the `workbench-api.yml` row.
    - Invert `assert.doesNotMatch(activeLines(generated), /merge_group/, …)` (`:892-896`) into `assert.match(activeLines(triggerSection(generated)), /merge_group:/)`.
    - Replace the `queueTrigger` block (`:898-905`) with an assertion that `compliance-merge-group.yml` does not exist (`existsSync` is imported at `:16`).
    - Replace the five `compliance` stopgap assertions (`:927-932`) with three on `generated`: `/github\.event\.merge_group\.head_ref/`, `/MC-Checkout: dsp_/`, and `/gh api/`.
    - In `protection`, re-point `/1339f1196d4e56377953fb90d41f2238402e8750/` (`:943`) to the new `GEN_SHA` and `/compliance-merge-group\.yml/` (`:945`) to `/plx-mc-compliance\.yml/`.
    - Leave every other assertion (the `ci.yml` preflight and build checks, ledger, the other runbook lines, and `autoMerge`, `:949-955`) unchanged. Leave the import at `:20` and the test at `:958-980` unchanged: `scripts/merge-group-prs.mjs` stays, as dead code, until a later cleanup removes both together (F10).
  - Update `docs/runbooks/BRANCH-PROTECTION-STAGING.md` (the merge-queue section `:305-385` at `2b656d8adf33`: the table row `:312`, the paragraph `:316-327`, the `max_entries_to_merge` row `:346`, the PLX_MC dependency list `:360-385`, and `GEN_SHA` at `:378`) and the "Merge queue (TASK-2008)" section of `.cursor/rules/auto-merge-after-push.mdc` (`:125-144`), so neither names `compliance-merge-group` any more. Keep the `/merge_group/` mention that the CI test pins, and keep it outside the "Current set" table (`:83-92`), which that test requires to stay free of `merge_group`. The generated job verifies only PR `N` from the queue ref, so the runbook must say that `max_entries_to_merge` stays 1 and `grouping_strategy` stays `ALLGREEN`, and must drop the line "The compliance job still resolves every PR if this is raised later".
  - **`edited` lines (D13):** in `.cursor/rules/mc-compliance.mdc`, or in the rule P10 moved them to, rewrite the restamp item that says a body-only edit does not re-run the gate, that the generated workflow "still triggers only on opened/synchronize/reopened", and "Do not add `edited` in this repo" (`:128-131` at `2b656d8adf33`), and the paragraph that says the workflow "triggers on `pull_request: [opened, synchronize, reopened]`" and tells the agent to push an empty commit (`:301-309`). After this PR the generated file triggers on `opened, synchronize, reopened, edited` and on `merge_group`, so say that a body edit re-runs the gate and that nobody hand-edits `.github/workflows/*compliance*`. Change no other line of that rule; P8 (D12) and P10 own the rest. The rewrite stays within P10's caps and keeps every needle and P8's carrier rule: the slice `.cursor/rules/mc-compliance.mdc` stays at or under 2457 bytes, `measure.py --check-caps --check-needles` still passes, and every rule this PR edits still passes `carrier` where P10 required it. The acceptance re-runs those checks.
  - If P15 recorded that org ruleset `18679471` runs PLX_MC `compliance-gate.yml` on the portal's `staging`, that org workflow also gains `merge_group` from the regenerated canonical file. Both call the same verify service with the same payload. Record this in `merge-group.md` as `org_workflow_on_staging: yes`; otherwise record `no`.
  - `COMPLIANCE_MODE` does not change. The unset-`PLX_MC_BASE_URL` branch does not change. Add no `continue-on-error`, no job-level `if:`, and no new `exit 0`.
  - Other consumers keep their pinned `GEN_SHA` and do not change.
- **owns:**
  - PLX_MC: `scripts/generate-compliance-gate.py`, `.github/workflows/compliance-gate.yml`, `docs/modules/compliance/README.md` (the verify and merge-queue sections only), `src/app/api/compliance/verify/route.ts`, `src/lib/compliance/service.ts` (`verifyPr` and stamp resolution only), `tests/compliance-verify-route.test.ts`, `tests/compliance-merge-group.test.ts` (new), `tests/test_generate_compliance_gate.py`
  - evidence: `$PROOFS/merge-group.md` with `pr255: merged f6d2bab7670a`, `spec_revision: r<n>` (n ≥ 13), `failing_first: <sha> fail`, `pr_plx_mc: <URL>`, `deployed_sha: <12 hex>`, `pr_portal: <URL>`, and the D11 confirmation read by Vince: `bucket_prd_confirmed: BKT-INFRA present` and `bucket_prd_confirmed: BKT-PROD present`
  - portal: `.github/workflows/plx-mc-compliance.yml`, `.github/workflows/compliance-gate-drift.yml`, `.github/workflows/compliance-merge-group.yml` (delete), `scripts/ci-staged-gate.test.mjs` (the TASK-2008 test only), `docs/runbooks/BRANCH-PROTECTION-STAGING.md`, `.cursor/rules/auto-merge-after-push.mdc`, `.cursor/rules/mc-compliance.mdc` (the `edited` and trigger-type lines only, D13; or the rule P10 moved them to). Not owned: `scripts/merge-group-prs.mjs` stays, because `scripts/ci-staged-gate.test.mjs:20` imports it (F10).
- **forbidden:** `checkout()` in `service.ts`, `src/lib/compliance/verify.ts`, `src/lib/compliance/risk.ts`, any ruleset, other consumers' workflows, `plugins/**`, Jev globs
- **live proof:** none in this plan. `merge_group` events fire only after a repo admin turns on the queue, which is outside this plan (SC-10). The admin's first queued PR is the live proof.
- **rollback:** revert the portal PR first. That restores the stopgap, its test, and the old `GEN_SHA`. Then revert the PLX_MC PR and redeploy. Never mark `compliance` optional.

Acceptance (P16 PLX_MC, cwd = P16 PLX_MC worktree):
```bash
. "$TOOLS/accept.sh"
line 'bucket_prd_confirmed: BKT-INFRA present' "$PROOFS/merge-group.md"
line 'gate_pr_types: opened, synchronize, reopened, edited' "$PROOFS/merge-queue-audit.md"
line 'pr255: merged f6d2bab7670a' "$PROOFS/merge-queue-audit.md"
line 'pr255: merged f6d2bab7670a' "$PROOFS/merge-group.md"
rline 'spec_revision: r(1[3-9]|[2-9][0-9])' "$PROOFS/merge-group.md"
grep -qF 'reopened, edited]' scripts/generate-compliance-gate.py || fail "the edited trigger from #255 was dropped"
python3 scripts/generate-compliance-gate.py --check || fail "generator drift"
grep -q 'merge_group:' scripts/generate-compliance-gate.py || fail "no merge_group"
.venv/bin/python -m pytest tests/test_generate_compliance_gate.py -q || fail "generator tests"
npm ci || fail "npm ci"; npx vitest run || fail "vitest"; npm run typecheck || fail typecheck
! git diff --quiet origin/main...HEAD -- src/app/api/compliance/verify/route.ts || fail "route unchanged"
! git diff --quiet origin/main...HEAD -- src/lib/compliance/service.ts || fail "verifyPr unchanged"
L=$(npx vitest list tests/compliance-verify-route.test.ts tests/compliance-merge-group.test.ts 2>/dev/null)
T=$(printf '%s\n' "$L" | awk -F ' > ' '{print $NF}')
N=$(printf '%s\n' "$T" | grep -c merge_group)
[ "$N" -ge 6 ] || fail "expected at least 6 merge_group it titles, found $N"
for t in 'merge_group: an expired stamp with a prior pass on the same head passes without loadPrState' \
         'merge_group: an expired stamp with no prior pass blocks without loadPrState'; do
  printf '%s\n' "$T" | grep -qF -- "$t" || fail "the merge_group it title lacks the case '$t' (D4)"
done
grep -qE 'loadPrState\)?\.not\.toHaveBeenCalled' tests/compliance-merge-group.test.ts || fail "the merge_group test never asserts that loadPrState was not called (D4)"
rline 'failing_first: [0-9a-f]{7,40} fail' "$PROOFS/merge-group.md"
[ "$(git diff origin/main...HEAD -- tests/compliance-verify-route.test.ts tests/test_generate_compliance_gate.py | grep -cE '^-.*(expect\(|assert )')" -eq 0 ] || fail "an existing test assertion was removed or changed"
./scripts/preflight.sh --mode pre-push || fail preflight
```

Acceptance (P16 portal, cwd = P16 portal worktree):
```bash
. "$TOOLS/accept.sh"; W=.github/workflows
line 'bucket_prd_confirmed: BKT-PROD present' "$PROOFS/merge-group.md"
line 'cap: met repo: petralabx/plx-customer-portal' "$PROOFS/guide-trim.md"
grep -q 'merge_group:' $W/plx-mc-compliance.yml || fail "no merge_group"
grep -qF 'reopened, edited]' $W/plx-mc-compliance.yml || fail "regenerated gate lacks the edited trigger (#255)"
[ ! -e $W/compliance-merge-group.yml ] || fail "stopgap still present"
[ "$(grep -lE '^  compliance:' $W/*.yml | wc -l)" -eq 1 ] || fail "more than one compliance job"
grep -q '/api/compliance/verify' $W/plx-mc-compliance.yml || fail "verify call missing"
! grep -q 'continue-on-error' $W/plx-mc-compliance.yml || fail "continue-on-error"
SHA=$(sed -nE 's/^ *GEN_SHA: *([0-9a-f]{40}).*/\1/p' $W/compliance-gate-drift.yml); [ -n "$SHA" ] || fail "no GEN_SHA"
git -C "$PLX_MC_REPO" merge-base --is-ancestor "$SHA" origin/main || fail "GEN_SHA not on PLX_MC main"
G=$(mktemp); git -C "$PLX_MC_REPO" show "$SHA:scripts/generate-compliance-gate.py" > "$G" || fail "generator at GEN_SHA"
python3 "$G" --emit downstream | diff -u $W/plx-mc-compliance.yml - || fail "generated file drifts"
grep -qF "$SHA" docs/runbooks/BRANCH-PROTECTION-STAGING.md || fail "runbook GEN_SHA"
rline 'deployed_sha: [0-9a-f]{12}' "$PROOFS/merge-group.md"
D=$(sed -nE 's/^deployed_sha: ([0-9a-f]{12})$/\1/p' "$PROOFS/merge-group.md")
git -C "$PLX_MC_REPO" merge-base --is-ancestor "$SHA" "$D" || fail "the deployed Hub predates GEN_SHA"
! grep -q 'compliance-merge-group' .cursor/rules/auto-merge-after-push.mdc docs/runbooks/BRANCH-PROTECTION-STAGING.md || fail "stopgap still named"
! grep -rqE 'Do not add `edited`|still triggers only on|opened, synchronize, reopened\]|A body-only edit does not re-run the gate|Until TASK-2011 is live' .cursor/rules/ || fail "a rule still forbids the edited trigger, names three trigger types, or keeps the pre-#255 body-edit sentences (D13)"
python3 "$PLX_MC_REPO/scripts/agent-context/measure.py" --check-caps --check-needles "$PWD" || fail "caps or needles (P10, D13)"
[ "$(wc -c < .cursor/rules/mc-compliance.mdc)" -le 2457 ] || fail "slice > 2457 (P10, D13)"
for f in .cursor/rules/mc-compliance.mdc $(git diff --name-only origin/staging...HEAD -- .cursor/rules); do
  if grep -qiE "$COMPETING|$LOCKED" "$f" || [ "$f" = .cursor/rules/mc-compliance.mdc ]; then carrier "$f"; fi
done
! grep -q 'still resolves every PR' docs/runbooks/BRANCH-PROTECTION-STAGING.md || fail "runbook still promises multi-PR groups"
grep -qF '`max_entries_to_merge` | `1`' docs/runbooks/BRANCH-PROTECTION-STAGING.md || fail "runbook must keep max_entries_to_merge at 1"
rline 'org_workflow_on_staging: (yes|no)' "$PROOFS/merge-group.md"
node --test scripts/ci-staged-gate.test.mjs || fail "ci-staged-gate"
hygiene_gate origin/staging
```

## Risks and rollback

- **The P2 and P3 stamps stay live** for 8 hours, and nothing revokes a stamp (F2). Mitigation: one task; no PR; nobody pastes those ids. Rollback: wait for expiry.
- **P3 arrives after the P2 stamp expires.** Mitigation: the P3 acceptance checks the time. Rollback: none needed. P3 is void and needs a new yes.
- **P4 breaks an agent that expects a new id on every call.** Mitigation: the same principal gets the same live id, which is a valid stamp. A different principal gets a clear 409. A completed stamp frees the lease. A reuse appends `checkout.reused`, so checkout counts do not inflate. The full vitest suite runs, with no `expect(` removed. Rollback: revert and redeploy.
- **P4 locks out a hand-off.** A second principal cannot take a task another principal holds until the holder completes, the stamp expires (up to 8 hours), or its PR merges or closes and releases it (F2). This is the intended exclusivity. Vince can wait out the TTL.
- **P4 race:** two concurrent first calls can mint two stamps. This plan accepts that limit. A follow-up needs a transaction or advisory lock, not an index, because an index predicate cannot test `now()`.
- **Two phases edit `service.ts`.** Mitigation: P4 and the PLX_MC half of P16 never run together, and the second branches from `main` after the first merges.
- **Cloud proofs are read as permission to trim before the canary.** Mitigation: P10 depends on `canary: pass` for that repo. Rollback: revert that repo's P10 PR.
- **A Lobster writer re-grows a guide.** The writers write only the swarm repo (F9), which no phase edits now (SC-12). The swarm retirement spec's R1 plans to turn both off (F25).
- **A generated surface is edited by hand and CI fails.** Mitigation: PLX_MC edits go through `config/governance-contract.yaml` and regeneration (F8). `--check` and the pinned tests are in acceptance.
- **Two complete-order wordings land in one file.** Mitigation: `carrier` rejects competing wording on the same line as the locked sentence, and `sweep` rejects it anywhere in `INSTR_FILES` (Appendix B).
- **Team Rules in the Cursor dashboard keep the old wording.** Mitigation: the operator re-pastes after P8, and acceptance checks it.
- **A stamp expires between checkout and PR open.** Mitigation: the 8-hour rule; the same task is checked out again if needed, never a new task.
- **A team-wide brain registration lets every Cursor agent write to `memory.items`.** Mitigation: the writes are idempotent and rate-limited, with no delete (F16); the key follows D5, which Vince confirms as `D5 as r13` in a yes on r13 or in the P14 later yes; the registration uses the brain's own address (D14). Rollback: remove the server, or use the kill switch.
- **The P16 rewrite of the `edited` lines grows the portal slice past P10's cap, or drops a needle or the locked sentence (D13).** Mitigation: the portal-half acceptance re-runs `measure.py --check-caps --check-needles`, the 2457-byte slice check and `carrier` on the rules it edits, and it requires P10 portal's `cap: met` line first. Rollback: revert the portal PR.
- **PLX_MC PR #255 landed before P4 and P16 (F24).** r13 applies it: D2's lease reads release and never writes it; D4's queue rule stays stricter than #255's open-PR exception and makes no GitHub read. The "opened/synchronize/reopened only" wording is still true in the portal's `mc-compliance.mdc` (`:128-131`, `:301-309`). Portal `plx-mc-compliance.yml:10` is still `types: [opened, synchronize, reopened]`, and the drift check pins that file (F10). The wording becomes false only when the P16 portal half regenerates the workflow and edits those lines (D13). In other guides, correcting it is follow-up work outside this plan. Two of those lines are named under residual risk.
- **A reopened PR un-releases its stamp (F2).** If another principal checked out the task while the PR was closed, two live stamps with different holders exist. D2's oldest-`issued_at` rule decides; the newer holder gets 409 until the older stamp completes, expires or is released again. The 409 message names the task, the repo and the expiry (`until <expires_at>`). It does not name the holder (P4 lease contract).
- **A high-tier PR is blocked for a missing bucket PRD.** Mitigation: P15 reads the bucket rows at the first yes, and D11 puts the decision with Vince before P16 opens a PR.
- **The P16 portal half lands before the Hub deploy.** Mitigation: the portal half starts only after the deploy. The trigger stays inert until an admin turns on the queue.
- **A `merge_group` run is "fixed" by making the job pass.** Mitigation: no `continue-on-error`, no job `if:`, no new `exit 0`, and the job id stays `compliance`. An expired stamp passes only where the same head already passed. Rollback: revert both PRs, portal first.
- **Someone installs a Jev product during a phase.** Rollback: remove the plugin directory and any `~/.claude` enablement. Do not merge a PR that adds `jev-rules`, `jevgrep`, `jev-code`, or a Typesafe/Jev plugin entry.
- **The portal hygiene audit goes critical on 30 Sep 2026 (F21).** Mitigation: every portal acceptance uses `hygiene_gate`, which accepts only the expired-shim failures that the branch point already has. Retiring or re-dating those shims is separate work outside this plan.
- **Residual risk outside this plan:**
  - Running the portal `scripts/sync-agents-md.py` would regenerate the retired roster.
  - The Lobster pipelines commit to `main` from the EC2 checkout, which `.cursor/rules/ec2-deploy-safety.mdc:10` forbids. The swarm retirement spec's R1 plans to turn both writers off.
  - Portal `CLAUDE.md:151` still names `taylorvalton/plx-customer-portal`.
  - After P16, two portal lines outside `.cursor/rules/` still say a body-only edit does not re-run the gate. No phase owns them: `.cursor/skills/mc-sync/SKILL.md:49-50` and `docs/runbooks/CONTRIBUTING.md:262-263` at portal `2b656d8adf33`. `CLAUDE.md:106` at that pin does not state the three-trigger rule.

## Worktree plan

- **Spec:** `$STORE/docs/frontier-implementation-spec.md`. This file is the single spec. The review record is `$STORE/docs/frontier-review-log.md`.
- **Evidence:** `$PROOFS/`. **Tools:** `$TOOLS/`. Neither has a product branch.
- **Phase branches:** `proj/frontier-stack/phase-<k>-<name>` on each repo a phase edits, from that repo's base.
- **PLX_MC:** P4, P6, the PLX_MC half of P8, P10 (if named), and the PLX_MC half of P16 each get their own worktree.
- **plx_secondbrain:** the secondbrain half of P8.
- **plx-customer-portal:** the portal half of P8, P10 (if named), P12, and the portal half of P16 each get their own worktree.
- **Canary branches:** `proj/frontier-stack/canary-<slug>`. Pushed by the operator, never opened as a PR, deleted after P9.
- **Integration branch:** none. Each code phase opens one PR per repo into that repo's base. This deviates from a single `proj/frontier-stack/integration` PR, because the proofs and audits must not edit a product repo and the code phases must not share one tree.

## Model plan

Resolved from the session model list. No override file was present. The slugs are
frozen here; confirm or edit them in the approval answer.

| Role | Slug | Use |
|---|---|---|
| planner | `claude-fable-5-1-thinking-max` | Planning and phase judgment. |
| builder | `composer-2.5` | P4, P6, P8, P10, P12, P16. |
| mechanical | `composer-2.5-fast` | Setup, P5, P11, P13, the P15 code lines, and recording evidence for P1, P2, P3, P9, and P14. |
| critic | `gpt-5.6-sol-high` | Reviews any product diff before a PR. |
| operator | Vince or a named human | P1, P2, P3, P9, P14, the P15 settings lines, and the post-merge deploy confirmations. |

Code phases run at `threshold: high`, `max_iter: 3`, `strict_approve: true`.

## What approval unlocks

A yes on the question below approves this full plan, r12, with the defaults in
"Decisions a yes confirms". It runs Setup, sets `approved_by` and `approved_at`, and
starts P1, P2, P5, P11, P13, and P15.

r13 adds no first-yes phase, so the r12 yes stands for every phase r13 does not change.
Vince answered `yes r13, D5 as r13` on 2026-09-29T18:09:35Z. The header records it.
P14 still records the phrase in `brain-register.md` and does not start without that
record. Until round 10, the r13 changes wait: P4's code branch, the P15 re-run, P16
and P14. P4, P14 and P16 are later-yes phases. The later yes that names one of them
is given against r13, or a later revision, after round 10 (D13, SC-13).

It does not start the later-yes phases:

| Phase | Why it waits | Repo |
|---|---|---|
| P3 | May mint a second stamp; must run before P2's `expires_at` | none |
| P4 | Edits PLX_MC `checkout()`; #255 merged, so its code branch runs under r13 after Vince's yes on r13 and round 10 (D13) | `petralabx/PLX_MC` base `main` |
| P6 | Edits PLX_MC (meter) | `petralabx/PLX_MC` base `main` |
| P8 | Edits PLX_MC, second brain, and portal guides (complete order only) | two repos on base `main`, portal on base `staging` |
| P10 | Edits governed guides; name the repo | one repo per PR |
| P12 | Edits portal guides | `petralabx/plx-customer-portal` base `staging` |
| P14 | Registers a team-wide, write-capable connector; name `BRAIN_URL` (D14); needs Vince's `D5 as r13` (D5), given in the yes on r13 or in this later yes; after Vince's yes on r13 and round 10 (D13) | none (cursor.com dashboard) |
| P16 | Edits the generator, the verify service, and the portal workflows; #255 merged, so it runs under r13 after Vince's yes on r13, round 10 and the P15 re-run (D13) | PLX_MC base `main`, then portal base `staging` |

P9 (operator canary, after the P8 close) starts when its `depends_on` evidence is on
disk. It does not need a separate question. P7 is withdrawn.

Every code phase also waits on the evidence named in its `depends_on`: P4 on P3 (and
D13 for its code branch), P6 on P5, P8 on P6 (merged), P10 on P9, P12 on P11, and P16 on P15 (run under r13) and D13.
P14 waits on P13, on Vince's yes on r13, on round 10 (D13), on the later yes that names `BRAIN_URL` and on Vince's `D5 as r13`.

Jev products stay out. The fleet draft (`docs/jev-fleet-implementation-spec.md`) stays the owner of skill packs and enforcement.

## Approval question (answered yes for r12 on 28 Sep 2026)

Approve the full frontier plan, r12, with the defaults in "Decisions a yes confirms"
(D1–D5, D7–D9, D11–D14; D6 and D10 are withdrawn)? The plan covers the Claude web
proof, the Codex stamp, the double-checkout record and a lease only if a second
stamp is minted, the non-Jev context diet on the portal, PLX_MC and plx_secondbrain,
the nested AGENTS.md correction, the brain MCP registration at the brain's own
address, and `merge_group` support in the compliance generator and verify service.
A yes starts P1, P2, P5, P11, P13, and P15. P3, P4, P6, P8, P10, P12, P14, and P16
still need a later yes, because they mint a second stamp, edit PLX_MC, a compliance
workflow, or governed guides, or register the team-wide, write-capable `plx-brain`
connector (P14 names `BRAIN_URL`, the brain's own address; since r13 it also needs Vince's `D5 as r13`).
P4's code branch and P16 waited for PLX_MC PR #255, which merged on 28 Sep 2026; they
run under r13 after the recorded r13 yes and its round-10 review (D13). P9 starts without a later yes
once its evidence is on disk. P7 is withdrawn, because no phase edits the swarm repo.
Every code phase waits on the evidence named in `depends_on`.

r13 changes later-yes phases (P4, P14, P16), two audits that keep their first-yes gate
(P13, P15; P15 runs again under r13 before P16), and one default (D5). It needs no new
first yes. Vince's yes on r13 is recorded (`yes r13, D5 as r13`, 2026-09-29T18:09:35Z).
The later yes that names P4, P14 or P16 is given against r13, after round 10
(D13, SC-13). D5's confirmation is the phrase `D5 as r13`, which that answer includes.
P14 still records it.

## Approval question for r13 (answered 2026-09-29T18:09:35Z)

Vince answered: `yes r13, D5 as r13`. The header records `r13_yes: yes` and
`d5_r13_yes: yes`. The r13 changes still wait for round 10. P4's code branch, the
P15 re-run, P16 and P14 do not start on this yes alone.

The question that was open:

r13 needs Vince's yes. It changes one approved default, D5, on the swarm retirement
spec's instruction (its section 10, D3, R11): P14 registers the brain with a brain key
from `BRAIN_API_KEYS`, never the `VMC_API_KEY` value or a `VMC_SCOPED_API_KEYS`
department key. r12's yes covered r12's D5 (a VMC department key, else `VMC_API_KEY`),
so the rule under "Decisions a yes confirms" puts this change to Vince. The rest of r13
re-derives P4, P15 and P16 and the facts and decisions they rest on (D2, D4, D13) with
the same defaults, and takes D14 and F26 from retirement section 10 with D14's rule
unchanged.

Do you approve r13, with D5 as r13 states it? The answer has one form:

- `yes r13, D5 as r13`.

Two variants exist. `yes r13` without the phrase approves the rest of r13 and leaves D5
pending; you then give the phrase in the P14 later yes (`yes P14,
BRAIN_URL=https://brain.plxcustomer.io, D5 as r13`), and P14 does not start without it.
`yes r13, except D5: as r12` keeps r12's D5; give it before retirement R11, and r14 must
then reconcile the two specs, because the brain stops accepting VMC keys at R11.

When the answer arrives, the orchestrator records it in the header (`r13_yes`, and
`d5_r13_yes` when the phrase is present) and in the review log, as an editorial update
like the r12 approval. That record is done: `yes r13, D5 as r13` at
2026-09-29T18:09:35Z. P14 records the phrase in `brain-register.md` (`d5_confirmed`,
`d5_confirmed_at`, `d5_confirmed_in`).

The r12 approval stands for every phase r13 does not change (the header's
`approval_covers`), and those phases keep running. The r13 yes is recorded. The r13
changes still wait for round 10: the independent critic's review of every r13 change
(P4, P15 and P16 under D13; D5, D14, F26, P13 and P14 under retirement section 10),
logged in `frontier-review-log.md` with its findings applied. Then P15 runs again
under r13, and the later yes for P4, P14 or P16 is given against r13 or later
(D13, SC-13).

## Open questions left after the r13 yes

Vince's yes answers questions 1 and 8. Questions 2–7 stay open for round 10.
`CHANGES.md`, `gate0.md` and `r13.diff` live in the orchestrator store. They are
not in this repo. Round 10 reads this section.

1. **Answered.** `yes r13, D5 as r13` at 2026-09-29T18:09:35Z.
2. **Portal `mc-compliance.mdc:128-139`.** The P16 portal acceptance now fails while
   "A body-only edit does not re-run the gate" or "Until TASK-2011 is live" remains
   under `.cursor/rules/`. #255 merged (F24), so the second sentence is stale. The
   `edited` trigger makes the first sentence false. Round 10 reviews that scope.
3. **D8 and the P16 portal half.** If the portal canary fails and P10 portal never
   runs, does the P16 portal half go ahead after P8 alone? Pending. If the answer
   is yes, r14 replaces P10's cap and needle checks in that acceptance with "the
   slice is no larger than at the branch point" and keeps the `carrier` check.
4. **D4 readings.** In `merge_group` mode the spec never calls `loadPrState`, and
   it blocks a released stamp. Both are the re-derived D4, already written in P16.
   They are not a second default. Round 10 reviews them. They do not need a
   separate yes.
5. **Deploy of `f6d2bab7670a`.** F24 does not verify that `mc.plxcustomer.io`
   deployed that SHA, and no phase gate depends on it. Whether P15 records
   `pr255_deployed: yes` stays open. Pending.
6. **P14 key label.** Which label the brain key carries
   (`key_name: BRAIN_API_KEY:<label>`), and who issues it before P14 starts.
   Pending.
7. **`scripts/merge-group-prs.mjs`.** After P16 the script is dead code that only
   its test keeps alive. Removing both is outside this plan. Whether to file that
   follow-up stays open. Pending.
8. **Answered with question 1.** The phrase `D5 as r13` is in that yes. P14 still
   records it and does not start without the record.

---

## Appendix A — reference meter (`$TOOLS/measure_ref.py`)

Setup writes this file verbatim. P6 ports it. It reproduces F7.

```python
#!/usr/bin/env python3
"""Reference always-on context meter for P5 (stdlib only, read-only).

Usage: measure_ref.py REPO[@REF] [REPO[@REF] ...]
Reads git blobs at REF (default HEAD). Never reads the working tree.
Prints key: value lines, one block per repo.

Views (raw bytes, trailing newline included):
  cursor  root AGENTS.md + root .cursorrules + every .cursor/rules/**/*.md(c)
          whose front matter has `alwaysApply: true`
  claude  root CLAUDE.md + every .claude/rules/**/*.md without a `paths:` key
  codex   root AGENTS.md; loaded = min(bytes, 32768); bytes_dropped = rest
  hermes  root HERMES.md (prints `view: hermes absent` when the file is missing)
Needles are scored on the text each view loads (codex: loaded prefix only).
"""
import re
import subprocess
import sys

CODEX_CAP = 32768
NEEDLES = [
    "mc_checkout_task",
    "repo: petralabx/{slug}",
    "prBodyLine",
    "MC-Checkout: pending",
    "verificationCommands",
    "rollback",
    "dsp_",
]
FRONT = re.compile(rb"\A---\r?\n(.*?)\r?\n---", re.S)


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True).stdout


def blob(repo, ref, path):
    r = subprocess.run(["git", "-C", repo, "show", f"{ref}:{path}"], capture_output=True)
    return r.stdout if r.returncode == 0 else b""


def front(b):
    m = FRONT.match(b)
    return m.group(1) if m else b""


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    for arg in argv:
        repo, _, ref = arg.partition("@")
        ref = ref or "HEAD"
        sha = git(repo, "rev-parse", "--short=12", ref).decode().strip()
        url = git(repo, "remote", "get-url", "origin").decode().strip()
        slug = re.sub(r"\.git$", "", url).rstrip("/").split("/")[-1]
        needles = [n.format(slug=slug) for n in NEEDLES]
        files = git(repo, "ls-tree", "-r", "--name-only", ref).decode().splitlines()

        agents = blob(repo, ref, "AGENTS.md")
        cursor = [agents, blob(repo, ref, ".cursorrules")]
        for f in files:
            if f.startswith(".cursor/rules/") and f.endswith((".mdc", ".md")):
                b = blob(repo, ref, f)
                if re.search(rb"(?m)^alwaysApply:\s*true\s*$", front(b)):
                    cursor.append(b)
        claude = [blob(repo, ref, "CLAUDE.md")]
        for f in files:
            if f.startswith(".claude/rules/") and f.endswith(".md"):
                b = blob(repo, ref, f)
                if not re.search(rb"(?m)^paths:", front(b)):
                    claude.append(b)
        views = {
            "cursor": b"".join(cursor),
            "claude": b"".join(claude),
            "codex": agents[:CODEX_CAP],
            "hermes": blob(repo, ref, "HERMES.md"),
        }
        print(f"repo: petralabx/{slug}")
        print(f"sha: {sha}")
        for name, text in views.items():
            if name == "hermes" and not text:
                print("view: hermes absent")
                continue
            size = len(agents) if name == "codex" else len(text)
            missing = [n for n in needles if n.encode() not in text]
            extra = ""
            if name == "codex":
                extra = f" loaded: {len(text)} bytes_dropped: {max(0, len(agents) - CODEX_CAP)}"
            print(f"view: {name} bytes: {size}{extra} needles_missing: {missing}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

## Appendix B — acceptance prelude (`$TOOLS/accept.sh`)

Setup writes this file verbatim. Every acceptance block sources it first.

```bash
# Acceptance prelude. Source it; run blocks with `bash -u` (no -e, no pipefail).
: "${PROOFS:?set PROOFS}" "${TOOLS:?set TOOLS}"
TS='20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z'
LOCKED='last commit, then mc_complete_task, then freeze'
# After LOCKED is removed from each line, no text may match COMPETING (case-insensitive, markdown marks stripped).
COMPETING='last commit[^.]*freeze|completing releases|mc_complete_task[^.]*freeze|mc_complete_task[^.]*(before|as part of|during)[^.]*pr'
fail()  { echo "ACCEPTANCE FAIL: $*" >&2; exit 1; }
# line TEXT FILE: FILE has a line exactly equal to TEXT (fixed string)
line()  { [ -f "$2" ] || fail "no file $2"; grep -qxF -- "$1" "$2" || fail "missing line '$1' in $2"; }
# rline ERE FILE: FILE has a whole line matching the extended regex
rline() { [ -f "$2" ] || fail "no file $2"; grep -qxE -- "$1" "$2" || fail "no line matching /$1/ in $2"; }
# carrier FILE: contains the locked sentence; every complete-order line is the locked sentence.
# Markdown marks (backticks, asterisks) are ignored, case-insensitive.
carrier() {
  [ -f "$1" ] || fail "no carrier $1"
  local plain; plain=$(sed 's/[`*]//g' "$1")
  printf '%s\n' "$plain" | grep -qiF -- "$LOCKED" || fail "locked sentence missing in $1"
  if printf '%s\n' "$plain" | sed "s/$LOCKED//Ig" | grep -iqE "$COMPETING"; then
    fail "other complete-order wording in $1"
  fi
}
# INSTR_FILES: tracked files an agent loads or is pointed at: root guides, rules, skills, prompts, runbooks. sweep DIR: none may hold competing
# complete-order wording once the locked sentence is removed (markdown marks stripped).
INSTR_FILES='^([^/]+\.md|\.cursorrules|\.github/[^/]+\.md|\.cursor/rules/.+\.mdc?|\.claude/[^/]+\.md|\.cursor/skills/.+\.md|prompts/.+\.md|docs/runbooks/.+\.md|config/cloud-agent-fleet-always-apply\.md|docs/AGENT-PR-SOP\.md)$'
sweep() {
  local f hits=0
  while IFS= read -r f; do
    if sed 's/[`*]//g' "$1/$f" | sed "s/$LOCKED//Ig" | grep -iqE "$COMPETING"; then echo "competing wording: $f" >&2; hits=1; fi
  done < <(git -C "$1" ls-files | grep -E "$INSTR_FILES")
  return $hits
}
# hygiene_gate BASE: run from the portal repo root on the committed PR head. The portal hygiene audit
# on HEAD may not be worse than on the branch point: score not lower, and exit 2 only for the same
# expired-shim lines (F21). Both run in detached worktrees, because audit check 9 reads the branch.
hygiene_gate() {
  local b h wb wh bo be ho he bs hs
  b=$(git merge-base HEAD "$1") || fail "merge-base with $1"; h=$(git rev-parse HEAD)
  wb=$(mktemp -d); wh=$(mktemp -d)
  git worktree add -q --detach "$wb" "$b" && git worktree add -q --detach "$wh" "$h" || fail "audit worktrees"
  bo=$(cd "$wb/portal" && npm run -s audit:hygiene 2>&1); be=$?
  ho=$(cd "$wh/portal" && npm run -s audit:hygiene 2>&1); he=$?
  git worktree remove --force "$wb"; git worktree remove --force "$wh"
  bs=$(printf '%s\n' "$bo" | sed -nE 's/^Score: ([0-9]+).*/\1/p'); hs=$(printf '%s\n' "$ho" | sed -nE 's/^Score: ([0-9]+).*/\1/p')
  [ -n "$bs" ] && [ -n "$hs" ] || fail "no hygiene score (base exit $be, head exit $he)"
  [ "$hs" -ge "$bs" ] || fail "hygiene score dropped ($bs -> $hs)"
  shims() { grep -E '^ *Shim ' | sed -E 's|^.*(src/lib/)|\1|' | sort; }
  case "$he" in
    0) ;;
    2) [ "$be" -eq 2 ] || fail "new critical hygiene failure"
       [ "$(printf '%s\n' "$ho" | shims)" = "$(printf '%s\n' "$bo" | shims)" ] || fail "shim failures differ from the branch point" ;;
    *) fail "hygiene audit exit $he" ;;
  esac
}
```
