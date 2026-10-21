<!-- Research record for docs/specs/ai-review-v2.2-implementation-spec.md. Written in the Claude Code web session
https://claude.ai/code/session_01Jr6kkh37KDwYQSLg7Fy1Et on 2026-10-20 and kept live at
https://claude.ai/code/artifact/e756d3ac-c183-44dd-b276-46f2204bdb20 (same content at export time, 2026-10-20).
MC: PRJ-FLEET-COMPLIANCE / BKT-REVIEW-PROCESS, TASK-3426. -->

# AI Reviewer v2.2 Design Review

2026-10-20 · Claude Code web session (operator cos@petrasoap.com), reviewed with CIP

Research review of the AI reviewer process v2.2 design (CIP, 2026-10-20, design only), checked against `petralabx/plx-customer-portal` (branch `claude/admiring-wozniak-tjr3r9` at `731dfb3`, staging head) and `petralabx/PLX_MC` (at `5bf29d2`), plus the live state of PR #2684 and #2673 on GitHub. No repo, setting or workflow was changed by the review.

## Verdict

The direction of v2.2 is right and every §0 claim I could check is accurate. Role checks instead of model names, deterministic checks before any model spend, App-posted check runs built from runner evidence, and author exclusion by family are all sound and match what the repos show is missing today. Four things would make the design fail in this org as written, and one large piece of it already exists.

1. **The FileMaker hard-fail blocks most of the portal.** 680 files in `plx-customer-portal` reference FileMaker, 399 of them under `portal/src`, including the live `fm-migration` library and the 30-minute FM sync. "Any FileMaker reference in the diff" with no override would stop nearly every PR, including the work that retires FileMaker.
2. **Author-family exclusion plus K=2 is unmeetable with today's pool.** About 183 of the last 300 portal commits carry a Claude co-author trailer, so Anthropic is the author family on most PRs. That leaves Sol (`gpt-6.1-sol`, OpenAI) and Astra, which CIP confirmed on 2026-10-20 is OpenAI too. On those PRs T1 never reaches two families and the design's own fallback (pending, escalate after 2 h) becomes the normal state. Grok (xAI), run by Grokbot and by Cursor agents on a Grok model, is the third family that makes K=2 reachable on every author family; the ordered pool (OpenAI, then Claude, then Grok) is in finding 2 and recommendation 2.
3. **The merge-settings changes contradict the live ruleset and the in-repo rule.** Ruleset `staging-protection` (id 18632985) deliberately runs `strict: false`, the repo allows auto-merge, and `.cursor/rules/auto-merge-after-push.mdc` tells every agent to `gh pr merge --auto --squash`. v2.2 flips all three. Strict mode at 46 merges a day (2026-10-19) without the merge queue means a CI and review re-run after every merge.
4. **Deterministic-first and the 10-minute first-review SLA cannot both hold.** The portal's deterministic stage (lint, typecheck, test, build) carries 20 to 45 minute timeouts, and no SAST exists in either repo today.

**The plx-gate App is mostly Mission Control already.** MC has the GitHub App auth, the signed PR webhook, path-and-label risk tiering, the verify reason codes, commit-trailer checks, `mc_verify_pr`, and `merge_group` verification. Building plx-gate inside MC and extending `risk.ts` removes the new App, SQS queue, object-locked S3 store and two-AZ runner pool from phase 1. The eight concrete edits are in the recommendations section.

## Section 0 claims, checked

Every claim about the portal repo and GitHub holds. The claims about `land-when-green.sh`, `hold-guard.sh`, `revdrain3.sh` and `ai-review-comment.sh` could not be checked, because those scripts live outside the two repos in this session (see the last section).

| v2.2 claim | Result | Evidence |
| --- | --- | --- |
| `ai-review-verdict.yml` posts the commit status `ai-review/verdict` as github-actions | Confirmed | `permissions: statuses: write`; `createCommitStatus` with context `ai-review/verdict` ([workflow](https://github.com/petralabx/plx-customer-portal/blob/staging/.github/workflows/ai-review-verdict.yml)) |
| It parses `<!-- ai-review {...} -->` markers from `plx-agents[bot]` comments, reviews or the PR description | Confirmed | `trustedBot = 'plx-agents[bot]'`, type `Bot`; body, comments and non-dismissed reviews are scanned |
| One reviewer is enough | Confirmed on staging | `reviewers = {astra, sol-6.1, claude}`; success when any one is clean |
| 30-minute cron sweep and a 2026-10-19 CUTOVER exemption | Confirmed | `schedule: */30 * * * *`; `CUTOVER = 2026-10-19T12:00:00Z` |
| Any workflow with `statuses: write` can forge it | Confirmed | The ruleset pins the context to integration 15368 (GitHub Actions), per `docs/runbooks/BRANCH-PROTECTION-STAGING.md`; nothing distinguishes workflows |
| PR #2684 is open at head `7b9b1726`, requires both Sol 6.1 and Astra on the head, open P0/P1 = 0, `files_read > 0`, retires CUTOVER | Confirmed | [PR #2684](https://github.com/petralabx/plx-customer-portal/pull/2684): open, `mergeable_state: clean`, 3 files, author `plx-cip[bot]`; `REQUIRED_REVIEWERS: sol-6.1,astra`; Claude markers read but not sufficient; 61 tests pass per the body |
| It is still comment-based and posted by Actions | Confirmed | Same `pull_request_target` + `statuses: write` design; only the pass rule changed |
| `uat-agent-pr-gate` is advisory and skipped unless the body carries the governed marker and `UAT-Feedback:` | Confirmed | Job `if:` requires `<!-- uat-agent-governed: true -->` and `UAT-Feedback:` in the body |
| Real UAT is a manual `plx-uat` `## UAT stamp` comment read by `land-when-green.sh` | Not verifiable here | No `## UAT stamp` string in either repo; `plx-uat` appears as a commit co-author only |
| `coding-1` is the only host that runs reviews; the Sol sidecar glob is the failure point | Partly | `scripts/ops/astra-watch/README.md` confirms `plx-astra-review` runs only on plx-coding-1, at most 2 concurrent, 90-minute timeout, and that markers queue as `~/logs/ai-review-<TASK>-<reviewer>-<sha>.*` sidecars. The glob itself is in `ai-review-comment.sh`, outside these repos |
| Humans and admins can still squash, auto-merge or bypass (#2673) | Confirmed | [PR #2673](https://github.com/petralabx/plx-customer-portal/pull/2673): label `do-not-merge`, body section "Do not land until" with three unticked conditions, merged by `taylorvalton` at 2026-10-20T00:25Z |
| Org on Team plan until 2026-10-20; no merge queue on private repos | Consistent | `BRANCH-PROTECTION-STAGING.md` records the Team upgrade on 2026-07-25; MC spec D4 says turning on the queue "stays a repo-admin action outside this plan" |
| Required portal checks: `lint-typecheck-build`, `compliance`, `Validate ledgers`, `workbench-api` | Confirmed | Runbook table plus `workbench-api` added 2026-09-28 (TASK-2037); `strict_required_status_checks_policy: false`; `allow_auto_merge: true` |

## Findings that break v2.2 as written

### 1. The FileMaker rule is scoped to the wrong thing

§1 T4 says any FileMaker reference in the diff (`**/filemaker/**`, `fmrest`, `fmp://`, the word FileMaker) fails `review/tier` and `uat/stamp` hard, with no dismissal, no break-glass and no UNVERIFIED acceptance. The portal is mid-migration off FileMaker, so the codebase is full of such references.

| Where FileMaker is referenced today | Files |
| --- | --- |
| `portal/src` (includes `portal/src/lib/fm-migration/` with `fm-api-client.ts`, `fm-db.ts`, `fm-source.ts`) | 399 |
| `docs/projects` | 42 |
| `portal/scripts` | 19 |
| `docs/modules`, `docs/runbooks`, `portal/prisma`, `.cursor/skills`, `.claude/skills`, `scripts/sql`, `portal/e2e`, others | 220 |
| Total | 680 |

Edits to any of these files put the word in the diff. Two workflows (`db-seed-staging.yml`, `uat-feedback-post-deploy.yml`) name it too. The rule as written stops the FileMaker decommission itself, and it is the only rule in the design with no escape hatch. Fix: fail on **net-new** references outside an allowlisted set of paths (the `fm-migration` library, `scripts/sql`, docs), scanned on added lines only, with the allowlist in `review-tiers.yml` and an expiry date tied to the decommission task.

### 2. The quorum cannot be met on most PRs with the pool as described

The author family is the family of the agent that wrote the commits. On the portal that is overwhelmingly Anthropic.

| Co-author trailer, last 300 portal commits | Count |
| --- | --- |
| Claude (Opus 5.5, Fable 5.1, plain "Claude") | 183 |
| PLX Agent | 25 |
| plx-cip / plx-cip[bot] (CIP, Grok) | 10 |
| Cursor / Cursor Agent | 9 |
| plx-uat, plx-agents[bot], AWS_GH | 7 |

`Agent:` trailers (56 commits) say the same: `claude-code/claude-uat`, `claude/claude-cos`, `cursor/coding-1`, `cursor/cip`. Under the §1a rule, Claude never counts on those PRs. The remaining pool is Sol, which `docs/ci/ai-review-verdict.md` says runs `gpt-6.1-sol`, and Astra. CIP confirmed on 2026-10-20 that Astra is the same OpenAI family (ChatGPT/Codex); neither repo documents it. So on an Anthropic-authored T1 PR the counted passes are Sol and Astra: N=2 but K=1, and `review/independent` cannot be filled from a second family. Once Sol raises a P0 there is no eligible verifier either, because Astra shares Sol's family and Claude shares the author's. The design's own answer is "pending, escalate to CoS after 2 h", which at 46 merges a day is a stoppage, not an exception.

What each author family leaves in the pool, with Cursor's family taken from the model its evidence names:

| PR author family | Share of recent portal commits | Reviewers that count | Distinct families | Verifier for an OpenAI-raised P0 |
| --- | --- | --- | --- | --- |
| Anthropic (Claude Code, Claude UAT, CoS sessions) | about 60% of commits, 80% of trailed ones | Sol, Astra, Grokbot, Cursor on Grok | 2 (OpenAI, xAI) | Grok |
| OpenAI (Codex-authored) | small today | Claude, Grokbot, Cursor on Grok | 2 (Anthropic, xAI) | Claude or Grok |
| xAI (CIP, UAT, Cursor on Grok) | about 5% | Sol, Astra, Claude | 2 (OpenAI, Anthropic) | Claude |
| Human, no trailer | about 18% | everyone | 3 | any cross-family reviewer |

The reviewer preference CIP states, OpenAI first, then Claude, then Grok, fits the role model as an ordered pool: `primary` is the first eligible entry in that order, `independent` the first eligible entry from a different family, specialists and the verifier likewise. Grok is reachable two ways, Grokbot (the CIP and UAT runtimes) and Cursor agents with a Grok model pinned as their review model; both carry family `xai` in the evidence `model` field. Three things to decide before phase 1: the order, model and family of each pool entry in `review-tiers.yml`, including the Grok model Cursor reviews with; Grok's effort level, token cap and roles, since it has no review record here yet (start it in shadow mode and let §7's precision metric promote it); and a precedence rule for the author family when signals disagree, since the PR opener is `plx-cip[bot]` (Grok) while the commits carry Claude trailers. Recommend the strictest reading: the union of every family in the head's commit trailers plus the opener.

### Trailer-to-family map: every identity resolves or the tier check fails

The author family is only as good as the map from commit identities to families. The trailers in the last 300 portal commits are the full inventory today. Key the map on the trailer email, not the display name, because the names vary (`Co-Authored-By: Claude Opus 5.5` and `Co-authored-by: Claude` share one email) while the emails do not.

| Trailer identity (email) | Who it is | Family | Note |
| --- | --- | --- | --- |
| `noreply@anthropic.com` (Claude, Claude Opus 5.5, Claude Fable 5.1) | Claude Code, Claude web, Claude UAT | anthropic | 183 commits |
| `cos@petrasoap.com` (PLX Agent) | CoS sessions | anthropic, to confirm | The same commits carry `Agent: claude/claude-cos*`; the email alone does not name a model |
| `plx-cip[bot]`, `plx-cip` (two email forms) | CIP, Grok Bot | xai | Also the PR opener on most PRs |
| `cursoragent@cursor.com` (Cursor, Cursor Agent) | Cursor IDE and cloud agents | the model Cursor ran | Not derivable from the trailer. Pin a Grok model as its review model in `review-tiers.yml` and require `Agent: cursor/<model>` on new commits |
| `plx-uat@users.noreply.github.com` | UAT Grok Bot | xai | |
| `plx-agents[bot]@users.noreply.github.com` | Astra's posting identity | openai | Should never author; if it does, Sol and Astra are excluded |
| `aws-gh@petralabx.com` (AWS_GH) | Infra agent | unknown | Infra names the runtime before phase 1 |
| No trailer at all | A person, or an agent that dropped its trailer | human | 53 of 300 commits. MC's existing unstamped-agent-commit check in `service.ts` is the backstop |

Rules for the map:

1. The map lives in `review-tiers.yml` (a T3 file, so every addition is a Vince merge). Matching is case-insensitive on the trailer key, since both `Co-Authored-By` and `Co-authored-by` are in use.
2. The author family of a head is the union over every commit in `base...head` of: every mapped co-author email, every `Agent:` runtime, and the PR opener. 23 of 300 commits carry two identities (for example Claude plus Cursor), so a list is required, not a single value.
3. An identity with no map entry fails `review/tier` with `author_family_unknown: <email>` and names the fix. No guessing and no "treat as human": a wrong guess either lets a same-family reviewer count or excludes nobody.
4. `human` is a family that excludes no reviewer. A human-only head still needs the full quorum.
5. `review/tier`'s summary lists every identity found on the head and the family it resolved to, so the mapping applied is visible on every PR, and the weekly report counts `author_family_unknown` hits.
6. Every agent runtime adds a model-bearing `Agent:` trailer (`claude-code/<model>`, `cursor/<model>`, `codex/<model>`, `grok/<model>`) so new models resolve without a map edit; the email map stays for commits that only carry a co-author line.

### 3. Merge settings: v2.2 reverses decisions the repo made on purpose

| Setting | Today | v2.2 §9 | Why it matters |
| --- | --- | --- | --- |
| Strict up-to-date checks | `false` on ruleset 18632985, chosen in TASK-710 to avoid forced rebases | on | With no merge queue, every merge makes every open PR BEHIND. At 24/9/46/16 merges on 10-17 to 10-20 that is a CI and review re-run per PR per merge. Patch-id carry-over saves review spend but not CI |
| Merge method | Mixed: 45 merge commits and 23 squash-style subjects in the last 60 commits on staging; the agent rule says `gh pr merge --auto --squash` | Merge commit only | Changing it also changes `auto-merge-after-push.mdc`, `pr-watch-until-green.mdc` and `BRANCH-PROTECTION-STAGING.md`, which says the required set lives in exactly two places that must change together |
| Auto-merge | `allow_auto_merge: true`, and the rule depends on it | Off | Agents lose the only landing path the rule allows them; CIP's `land-when-green` becomes the single path |

None of these is wrong as a target. They are wrong as a phase 2 toggle without the queue. Keep strict off and auto-merge on until TASK-3420 enables the queue, rely on `merge_group` re-evaluation (which MC already supports, spec D4 and `compliance-gate.yml`), and ship the rule-file and runbook edits in the same PR as the ruleset change.

### 4. Deterministic-first collides with the 10-minute first-review SLA

§2 enqueues LLM reviews only after lint, typecheck, tests, secret scan, SAST, the FileMaker scan and the detectors are green. §7 wants a review job started within 10 minutes of a push. On the portal, `ci.yml` gives lint 20 minutes, typecheck 20 minutes (self-hosted `plx-large`), tests 25 minutes and build 45 minutes. The secret scan exists (`scripts/audit-secrets.mjs`). No SAST step exists in either repo, so that is new work, not a result to "read, pinned". Split the stage: a fast gate (secret scan, FileMaker scan, migration and workflow detectors, lint) releases LLM reviews; tests and build run in parallel and the verdict waits for them. Define time-to-first-review from the fast gate.

## Reuse before create: plx-gate is mostly Mission Control

Most of what §2, §3 and §9 describe as a new App with its own queue, store and runner pool exists in `PLX_MC` today. The design should name MC as the gate's home and list the deltas.

| v2.2 component | Exists today | Gap to close |
| --- | --- | --- |
| GitHub App identity that posts checks | `PLX_MC/src/lib/github-app/token.ts`: App JWT and installation tokens, scoped read-only to Contents, Metadata and Pull requests | Add `checks: write` to that App, or mint a second App whose key MC holds. Either way the key stays in MC's secrets accessor, not on runners |
| Webhook receiver for `pull_request` events | `src/app/api/compliance/webhook` with HMAC verification | Subscribe to `ready_for_review`, `labeled`, `check_run` and `merge_group`; today the gate workflow runs on `opened, synchronize, reopened, edited` |
| Tier classification from the diff plus labels | `src/lib/compliance/risk.ts`: `classifyRiskTier(changedPaths, labels)` returns low/standard/high; labels `risk:high` and `risk:low`; precedence label > high path > low | Extend to T0 to T4 as a superset. Drop `risk:low` so labels only raise. Add the portal's real migration path (`portal/prisma/migrations/`, 223 files) since `HIGH_PATH` only matches `db/migrations/`. Keep the anchored `permissions?` regex; v2.2's `**/*permission*` re-introduces the `permissions-guide.md` false positive that review N4 fixed |
| `mc/checkout` reasons | `service.ts` already returns `unknown_checkout`, `revoked`, `released`, `repo_mismatch`, `expired`, `pr_not_open`, `stamp_not_in_pr`, `task_deleted`, `task_closed`, plus trailer mismatches for `On-Behalf-Of` and `Agent` | Reuse these names. `checkout_expired` is `expired`; `no_task_link` is `unknown_checkout` or `stamp_not_in_pr`; `trailer_mismatch` already exists as a text reason |
| Checkout pinned for the PR's lifetime | MC PR #255 (TASK-2011): an expired stamp passes while the PR is open and the live body carries it; closing or merging releases it | Nothing. Say so in §3 instead of designing it again |
| `mc_verify_pr` as a stamp input | `src/app/api/cursor/verify/route.ts` and `read-actions.ts` compute the verdict without recording | Nothing |
| Merge-time re-evaluation on the queue | `compliance-gate.yml` handles `merge_group` and resolves the PR from the queue ref; spec D4 and P16 define the expired-stamp rule in queue mode | TASK-3420 is the switch, not new code for compliance. New code is only for the review and UAT contexts |
| Job queue (SQS, idempotency key `repo#pr#sha#reviewer`) | None | At ~50 heads a day a Postgres table in MC with a unique key on (repo, pr, sha, reviewer) is enough. SQS adds an Infra dependency for no throughput reason |
| Evidence store (S3 with object lock, 90 days) | `mc_upload_evidence` stores evidence on the PLX SharePoint Mission Control library (TASK-3166) | Reuse it for transcripts and `evidence.json`; keep the sha256 in `external_id` as designed. Object lock can come later if audit needs it |
| Review runner pool (self-hosted ephemeral, 2 AZ, label `plx-review`) | One self-hosted CI runner `plx-ci-webpack` (labels `self-hosted, plx-large`, m6i.xlarge) and `plx-coding-1` for reviews, 2 concurrent | Start with GitHub-hosted `ubuntu-latest` for the API-only reviewers (Astra, Claude, Sol) and keep coding-1 as the fallback. Decide on a pool from measured queue times, not up front |
| Watcher that re-requests reviews | `scripts/ops/astra-watch/astra-watch.mjs` (TASK-2966): one review per head, drafts skipped, backoff on rate limits, 90-minute timeout | Its decisions (`skip-draft`, `skip-reviewed`, `locked-retry`, `rate-limited`) are the dispatcher's state machine. Port it into MC rather than writing a new one |
| Verdict tests | `scripts/ai-review-verdict.test.mjs` (61 cases after #2684) | Carry the trust and staleness cases over as the first tests of the quorum evaluator |

## Smaller corrections

- **`MC-Task:` commit trailer does not exist.** §3 validates `mc/checkout` "from the MC-Task commit trailer" and §8 asks every actor for `MC-Task: TASK-n`. In the last 300 portal commits there are 0 `MC-Task:` trailers, 79 `MC-Checkout:`, 96 `Claude-Session:`, 56 `On-Behalf-Of:` and 56 `Agent:`. Use `MC-Checkout: dsp_*` and MC's existing `On-Behalf-Of` and `Agent` checks.
- **Labels arrive after `opened`.** MC spec D7 records that `gh pr create` adds labels after the open event and the compliance gate never sees them. v2.2 handles this for tiering (a label change re-runs it). `mc/checkout` and `merge/hold` need the same `labeled` and `unlabeled` subscription, which §9 lists only for `merge/hold`.
- **Break-glass must exist before the bypass list is emptied.** §10 removes admin bypass in phase 0 and builds the App break-glass action in phase 2. Between them Vince has no emergency path; #2673 shows one was used two days ago. Move the break-glass action into phase 1, or keep one named bypass until it ships.
- **The spend budget has no baseline.** USD 150 a day across 24 to 46 merged PRs plus unmerged heads, each needing two reviews at Sol `xhigh` and Astra `high` under a 300k token cap, implies under USD 2 per review. Neither repo holds per-review spend. Measure for a week from coding-1 logs before the budget becomes a throttle, because the throttle pauses T0 and T1, which is all routine work.
- **SLA numbers assume the runner pool.** Today a review has a 3,600 s model timeout and a 90-minute watcher timeout, with 2 concurrent on one host. §7's 45 and 75 minute targets are fine as targets once the pool exists; until then the watcher's escalation after 2 h is the only real SLA.
- **`scripts/ci/**` matches nothing.** The portal has no `scripts/ci` directory. The CI gate tests are `scripts/ci-staged-gate.test.mjs` and `scripts/ci-webpack-gate.test.mjs` at the `scripts/` root; the T3 glob should name `scripts/ci-*` or the whole `scripts/` directory.
- **Rebase carry-over by patch-id needs the base pinned.** `git diff base...head` patch-id changes whenever the base moves and the merge base shifts a context line. Carry over on identical head tree plus identical merge base, or on patch-id of `git diff <merge-base> <head>` with the merge base recorded in the evidence.
- **UNVERIFIED acceptance already has an owner list mechanism.** `review-tiers.yml` is a T3 file, so adding a second approver is a Vince merge. That is the right constraint; say it in §6.
- **§0 overstates one thing.** "Claude can fail the gate but cannot satisfy it" is true after #2684 merges, not today. Today Claude alone satisfies it (`docs/ci/ai-review-verdict.md`, Vince 2026-10-17).

## Recommended edits to v2.2 before phase 1

1. **§1 T4:** replace "any FileMaker reference" with "net-new FileMaker reference on added lines outside the allowlist in `review-tiers.yml`". Allowlist `portal/src/lib/fm-migration/**`, `scripts/sql/**`, `docs/**` at the start, with an expiry date on the decommission task.
2. **§1a:** Sol and Astra are one family (OpenAI: ChatGPT/Codex). Add Grok (xAI) as the third family, run by Grokbot (the CIP and UAT runtimes) and by Cursor agents with a Grok model pinned as their review model. Encode the reviewer preference as an ordered pool in `review-tiers.yml`: OpenAI (Sol, Astra), then Anthropic (Claude), then Grok (Grokbot, Cursor on Grok). Roles are filled by walking that order and skipping the author's family; two OpenAI passes count as N=2, K=1. With Grok in the pool every author family leaves at least two others, so K=2 and the cross-family verifier are reachable on every tier. Grokbot never counts on PRs that CIP or UAT authored (author exclusion); Sol, Astra and Claude cover those. Keep the T1 K=1 fallback only while Grok reviews run in shadow mode (§10 phase 1) and have no precision record yet.
3. **§1a and §8:** define the author family as the union of every family in the head's commit trailers (`Co-authored-by`, `Agent`) and the PR opener. Record it in the evidence `author_family` field as a list. Resolve every identity through the trailer-to-family map in finding 2, keyed on the trailer email; an unmapped identity fails review/tier until the map is updated.
4. **§2, §3, §9, §10:** name Mission Control as plx-gate's home. Extend `risk.ts` to the five tiers, reuse the verify reason codes, port `astra-watch.mjs` as the dispatcher, use a Postgres job table, and store evidence through `mc_upload_evidence`. Drop SQS, the object-locked bucket and the two-AZ pool from phase 1; revisit the pool after a week of measured queue times.
5. **§2 and §7:** split `checks/deterministic` into a fast gate (secret scan, FileMaker scan, migration and workflow detectors, lint) that releases LLM reviews, and the full CI that the verdict waits for. Add SAST as its own work item with an owner. Measure time-to-first-review from the fast gate.
6. **§9:** keep `strict: false` and auto-merge on until TASK-3420 turns the queue on. Decide the merge method once, and change the ruleset, `auto-merge-after-push.mdc`, `pr-watch-until-green.mdc` and `BRANCH-PROTECTION-STAGING.md` in the same PR.
7. **§3 and §8:** replace the `MC-Task:` trailer with the existing `MC-Checkout: dsp_*` trailer and MC's trailer checks.
8. **§10:** move the break-glass App action from phase 2 to phase 1, before any bypass list is emptied. Add a spend baseline (one week of coding-1 review logs) as a phase 1 deliverable before §7's budget throttles anything.

## Phase 0 and the rollout

Phase 0 can proceed as written except for two lines.

| Phase 0 item | Status | Note |
| --- | --- | --- |
| Merge #2684 (Sol and Astra required, CUTOVER retired) | Ready | Open, `mergeable_state: clean`, head `7b9b1726`, workflow file so Vince merges. After merge the 30-minute sweep drops Sol-only PRs to pending `Missing astra on <sha7>` |
| Turn off auto-merge and squash on portal and agentic-swarm | Hold | Contradicts `auto-merge-after-push.mdc` and the runbook; see finding 3. Change the rule files in the same change, or defer to phase 2 with the queue |
| Remove admin bypass from `staging-protection` | Hold until break-glass exists | #2673 was landed through it on 2026-10-20. Build the App action first (recommendation 8) |
| Fix the Sol sidecar glob | Not verifiable here | `ai-review-comment.sh` is on plx-coding-1, outside these repos |
| Stop accepting PR-description markers | Ready | A one-line change in `ai-review-verdict.yml` (drop `pr.body` from `texts`), with a test in `scripts/ai-review-verdict.test.mjs` |
| CIP merges only via `land-when-green`; watcher re-requests Sol and Astra | Ready | `astra-watch.mjs` already reviews every new head; it needs a `--reviewer sol-6.1` pass or a second timer |

Phase 1 shadow mode is the right shape. Run the quorum evaluator inside MC against the same heads the Actions verdict scores, and diff for three days as planned. Phase 2's repin to the App id is the first moment the forged-status gap closes; until then #2684 narrows it but does not close it.

## Not verifiable from these two repos

- `research/pr-review-frontier.md`, cited throughout as [F §n], is in neither `plx-customer-portal` nor `PLX_MC`. The frontier citations stand unchecked. `PLX_MC/docs/specs/frontier-implementation-spec.md` (r13) is a different document about checkout leases and the merge queue, and it is the one that already governs `merge_group` work.
- `land-when-green.sh`, `hold-guard.sh`, `revdrain3.sh`, `ai-review-comment.sh` and `plx-astra-review` are not in either repo; they are presumably in `petralabx/agentic-swarm` or on plx-coding-1. The §0 descriptions of them are consistent with `astra-watch/README.md` but were not read.
- Astra's model and family in the repos; CIP confirmed on 2026-10-20 that Astra is OpenAI (ChatGPT/Codex). Sol's is documented (`gpt-6.1-sol`); Astra's is not.
- The live ruleset contents, bypass list and merge-method settings on GitHub. The GitHub tools in this session cannot read rulesets, so the state above comes from `docs/runbooks/BRANCH-PROTECTION-STAGING.md` (re-verified 2026-07-26) and `auto-merge-after-push.mdc`.
- The `## UAT stamp` comment convention and the `plx-uat` login. Only the co-author trailer appears in the repos.
- Per-review token spend and durations on coding-1.

## Sources

Portal (`petralabx/plx-customer-portal`, staging head `731dfb3`):

- [`.github/workflows/ai-review-verdict.yml`](https://github.com/petralabx/plx-customer-portal/blob/staging/.github/workflows/ai-review-verdict.yml) and [`docs/ci/ai-review-verdict.md`](https://github.com/petralabx/plx-customer-portal/blob/staging/docs/ci/ai-review-verdict.md)
- [`scripts/ops/astra-watch/README.md`](https://github.com/petralabx/plx-customer-portal/blob/staging/scripts/ops/astra-watch/README.md) and `astra-watch.mjs`
- [`docs/runbooks/BRANCH-PROTECTION-STAGING.md`](https://github.com/petralabx/plx-customer-portal/blob/staging/docs/runbooks/BRANCH-PROTECTION-STAGING.md)
- [`.cursor/rules/auto-merge-after-push.mdc`](https://github.com/petralabx/plx-customer-portal/blob/staging/.cursor/rules/auto-merge-after-push.mdc)
- [`.github/workflows/plx-mc-compliance.yml`](https://github.com/petralabx/plx-customer-portal/blob/staging/.github/workflows/plx-mc-compliance.yml), `uat-agent-pr-gate.yml`, `uat-e2e.yml`, `ci.yml` (job timeouts, `audit-secrets.mjs`, self-hosted runner)
- `scripts/merge-group-prs.mjs`, `portal/src/lib/fm-migration/`, `portal/prisma/migrations/` (223 entries)
- Git history: co-author and `Agent:` trailers over the last 300 commits; merges per day since 2026-10-07
- [PR #2684](https://github.com/petralabx/plx-customer-portal/pull/2684) and [PR #2673](https://github.com/petralabx/plx-customer-portal/pull/2673), read live

Mission Control (`petralabx/PLX_MC`, main `5bf29d2`):

- [`src/lib/compliance/risk.ts`](https://github.com/petralabx/PLX_MC/blob/main/src/lib/compliance/risk.ts), `service.ts` (reason codes, trailer checks, `merge_group` mode), `github-pr.ts` (`mc_verify_pr`), `webhook.ts`
- [`src/lib/github-app/token.ts`](https://github.com/petralabx/PLX_MC/blob/main/src/lib/github-app/token.ts)
- [`.github/workflows/compliance-gate.yml`](https://github.com/petralabx/PLX_MC/blob/main/.github/workflows/compliance-gate.yml)
- [`config/tracked-repos-registry.json`](https://github.com/petralabx/PLX_MC/blob/main/config/tracked-repos-registry.json)
- [`docs/specs/frontier-implementation-spec.md`](https://github.com/petralabx/PLX_MC/blob/main/docs/specs/frontier-implementation-spec.md) (D4, D7, D11, F17, F24, P16), `docs/runbooks/CI-PIPELINE.md`
