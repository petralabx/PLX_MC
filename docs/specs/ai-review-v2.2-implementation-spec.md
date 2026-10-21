# AI Reviewer v2.2 — implementation spec

```yaml
revision: r1 (20 Oct 2026, draft for Vince's review; nothing in any repo, setting or workflow changes under this revision)
accountable: vince@petrasoap.com
authors: CIP (v2.2 design, 2026-10-20, design only); Claude Code web session (design review and this spec)
sources:
  - v2.2 design text (CIP, 2026-10-20; grounded in research/pr-review-frontier.md, which lives outside PLX_MC and the portal)
  - design review: artifacts/review/2026-10-20-ai-review-v2-2-design-review/REPORT.md (also https://claude.ai/code/artifact/e756d3ac-c183-44dd-b276-46f2204bdb20)
  - session: https://claude.ai/code/session_01Jr6kkh37KDwYQSLg7Fy1Et
mission_control:
  project: PRJ-FLEET-COMPLIANCE
  bucket_review: BKT-REVIEW-PROCESS (TASK-3426 to TASK-3437, this spec's phases)
  bucket_gates: BKT-GITHUB-GATES (TASK-3414 to TASK-3420, the ruleset and App side; unchanged by this spec)
  bucket_launcher: BKT-LAUNCHER (TASK-3411 plx-launch; TASK-3438 the Steward design hand-off to Infra; section 12)
```

## 1. What this spec is

The v2.2 design (CIP, 2026-10-20) is the reviewer process: role checks instead of model
names, a per-tier quorum, cross-family verification, deterministic checks before any model
spend, specialists on T2 to T4, quality metrics, and author exclusion by family. The design
review checked it against `petralabx/plx-customer-portal` (staging `731dfb3`), `petralabx/PLX_MC`
(`5bf29d2`) and live GitHub. Every claim in the design's section 0 that could be checked holds.
Four things would make the design fail as written in this org, and one large component of it
already exists. This spec keeps every v2.2 rule except where section 2 says otherwise, and turns
the design into phases with owners, acceptance checks and Mission Control tasks.

The eight changes to v2.2, each with its evidence in the review:

| # | v2.2 section | Change | Why |
|---|---|---|---|
| 1 | §1 T4 | FileMaker hard-fail applies to **net-new** references on added lines outside an allowlist, not to any reference in the diff | 680 portal files reference FileMaker (399 under `portal/src`, including the live `fm-migration` library and the 30-minute sync). The rule as written stops most PRs and the decommission itself, and it is the only rule with no escape hatch |
| 2 | §1a | The pool is an **ordered** list, OpenAI (Sol, Astra) then Anthropic (Claude) then **Grok** (Grokbot, Cursor on a Grok model). Sol and Astra are one family (CIP confirmed Astra is OpenAI, 2026-10-20) | About 183 of the last 300 portal commits carry Claude trailers. Without a third family, K=2 and the cross-family verifier are unreachable on Anthropic-authored PRs, which are most |
| 3 | §1a, §8 | Author family = union of every family in the head's commit trailers plus the PR opener, resolved through a trailer-to-family map keyed on the trailer email; an unmapped identity fails `review/tier` | 53 of 300 commits carry no trailer, 23 carry two identities, and the PR opener (`plx-cip[bot]`, Grok) differs from the commit author (Claude) on most PRs |
| 4 | §2, §3, §9, §10 | **Mission Control is plx-gate.** No new App service, SQS queue, object-locked S3 or two-AZ runner pool in phase 1 | MC already has the GitHub App auth, the signed PR webhook, `risk.ts` tiering, the verify reason codes, trailer checks, `mc_verify_pr` and `merge_group` verification |
| 5 | §2, §7 | `checks/deterministic` splits into a **fast gate** (secret scan, FileMaker scan, migration and workflow detectors, lint) that releases LLM reviews, and the full CI that the verdict waits for. SAST is its own work item | Portal lint, typecheck, tests and build carry 20 to 45 minute timeouts; a 10-minute first-review SLA cannot wait for them. No SAST exists in either repo |
| 6 | §9 | Strict up-to-date checks stay **off** and auto-merge stays **on** until TASK-3420 enables the merge queue. Merge method is decided once (D4) and the ruleset, `auto-merge-after-push.mdc`, `pr-watch-until-green.mdc` and `BRANCH-PROTECTION-STAGING.md` change in one PR | Ruleset 18632985 runs `strict: false` on purpose (TASK-710); the agent rule mandates `gh pr merge --auto --squash`; 16 to 46 merges a day would re-run CI and review on every open PR after every merge |
| 7 | §3, §8 | The `MC-Task:` commit trailer is replaced by the existing `MC-Checkout: dsp_*` trailer and MC's `On-Behalf-Of` and `Agent` checks | 0 of 300 commits carry `MC-Task:`; 79 carry `MC-Checkout:` |
| 8 | §10 | Break-glass (TASK-3415) ships before any bypass list is emptied. A one-week spend baseline from coding-1 logs is a phase 1 deliverable before the USD 150/day budget throttles anything | #2673 was landed through admin bypass on 2026-10-20; neither repo holds per-review spend |

## 2. Decisions for Vince (TASK-3428)

Each has a default. A default stands until Vince changes it; the task records the answer.

| Id | Decision | Default | Evidence |
|---|---|---|---|
| D1 | Cursor agents review with a Grok model, so Cursor adds the `xai` family rather than only a reviewer | yes | Cursor's trailer (`cursoragent@cursor.com`) does not name a model; on Claude or GPT it adds no family |
| D2 | Astra's effort and token cap in the pool, now that Astra and Sol share the OpenAI family | Astra `high`, Sol `xhigh`, cap per §2 of the design (T0 50k, T1 300k, T2+ 800k) | `docs/ci/ai-review-verdict.md`: Sol runs `gpt-6.1-sol`; Astra's effort is `high` on coding-1 |
| D3 | Family of PLX Agent (`cos@petrasoap.com`) and AWS_GH (`aws-gh@petralabx.com`) | PLX Agent = anthropic (its commits carry `Agent: claude/claude-cos*`); AWS_GH = Infra names the runtime before phase 1 | 25 and 1 commits respectively in the last 300 |
| D4 | Merge method on the three repos once the queue is on | merge commit only, as v2.2 §9 | 45 merge commits and 23 squash-style subjects in the last 60 commits on staging; both paths are live today |
| D5 | Grok starts in shadow mode and is promoted to counted roles by the precision metric after four weeks of data | yes | Grok has no review record in this org yet |

## 3. `review-tiers.yml` (TASK-3427, TASK-3435)

One file per repo at `.github/review-tiers.yml`, read from the base branch, itself a T3 file
(Vince merges). Illustrative content; the task fixes the schema.

```yaml
schema: plx-review-tiers/v1
reviewer_pool:            # preference order; roles filled by walking this list and skipping the author's family
  - {id: sol-6.1, model: gpt-6.1-sol, family: openai,    roles: [primary, independent, security, verifier], effort: xhigh}
  - {id: astra,   model: <from evidence>, family: openai, roles: [primary, independent, verifier],           effort: high}
  - {id: claude,  model: <from evidence>, family: anthropic, roles: [independent, security, verifier]}
  - {id: grokbot, model: <from evidence>, family: xai,   roles: [independent, verifier], mode: shadow}       # D5
  - {id: cursor,  model: <pinned Grok model>, family: xai, roles: [independent, verifier], mode: shadow}     # D1
quorum:                   # N counted passes, K distinct families; same-family passes count toward N, not K
  T0: {n: 1, k: 1, roles: [primary]}
  T1: {n: 2, k: 2, roles: [primary, independent], fallback_k: 1}   # fallback only while every xai entry is in shadow
  T2: {n: 3, k: 2, roles: [primary, independent, security], specialists: [security-auth], if_migration: [migration-db]}
  T3: {n: 3, k: 2, roles: [primary, independent, security], specialists: [ci-supply-chain]}
  T4: {n: 3, k: 2, roles: [primary, independent, security], specialists: [security-auth, bc-erp], if_migration: [migration-db]}
specialists:
  security-auth:   {pool: [sol-6.1, claude]}
  migration-db:    {pool: [sol-6.1, astra]}
  ci-supply-chain: {pool: [claude, sol-6.1]}
  bc-erp:          {pool: [sol-6.1, astra]}
author_families:          # keyed on trailer email; case-insensitive trailer keys; no entry => review/tier fails author_family_unknown
  "noreply@anthropic.com": anthropic
  "cos@petrasoap.com": anthropic                      # D3
  "342250558+plx-cip[bot]@users.noreply.github.com": xai
  "plx-cip[bot]@users.noreply.github.com": xai
  "plx-cip@users.noreply.github.com": xai
  "plx-uat@users.noreply.github.com": xai
  "plx-agents[bot]@users.noreply.github.com": openai
  "cursoragent@cursor.com": xai                       # D1; overridden by an Agent: cursor/<model> trailer
  "aws-gh@petralabx.com": <Infra decides>             # D3
agent_runtimes:           # Agent: <runtime>/<model-or-lane>; the model part resolves the family when present
  claude-code: anthropic
  claude: anthropic
  codex: openai
  grok: xai
  cursor: <model part of the trailer>
tiers:
  T0: {paths: ["**/*.md", "docs/**", "*.txt", "**/*.png", "**/*.svg"]}
  T2: {paths: ["**/auth/**", "**/grants/**", "**/permissions/**", "**/*permission*.{ts,tsx,js}", "**/migrations/**", "portal/prisma/migrations/**", "**/*.sql", "prisma/**", "**/secrets*", "**/iam/**", "CODEOWNERS"], labels: ["risk:security"]}
  T3: {paths: [".github/**", "scripts/ci-*", "**/review-tiers.yml", "**/Dockerfile", "**/rulesets/*.json"], labels: ["risk:ci"]}
  T4: {paths: ["**/erp/**", "**/businesscentral/**", "**/bc/**"], labels: ["risk:erp"]}
  # T1 = everything else. Labels only raise. Highest match wins. Re-checked on every evaluation of the current head.
filemaker:
  patterns: ["filemaker", "fmrest", "fmp://"]
  scope: added-lines                                  # change 1
  allow: ["portal/src/lib/fm-migration/**", "scripts/sql/**", "docs/**"]
  allow_expires: <decommission task date>
unverified_approvers: [vince@petrasoap.com]
```

Author-family rules (change 3): the family of a head is the union over `base...head` of every
mapped co-author email, every `Agent:` runtime, and the PR opener. `human` is the family of a
commit with no trailer; it excludes no reviewer. `review/tier`'s summary lists every identity
found and the family it resolved to. The weekly report counts `author_family_unknown` hits.
Every runtime adds a model-bearing `Agent:` trailer (TASK-3435) so new models resolve without
a map edit.

## 4. Mission Control as plx-gate (TASK-3429)

MC already holds the pieces. The deltas:

| Piece | Today (PLX_MC) | Delta |
|---|---|---|
| App identity that posts checks | `src/lib/github-app/token.ts`, read-only Contents, Metadata, Pull requests | Add `checks: write` (or a second App whose key MC holds). TASK-3416 owns the App; this task consumes it |
| PR webhook | `src/app/api/compliance/webhook`, HMAC | Subscribe to `ready_for_review`, `labeled`, `unlabeled`, `check_run`, `merge_group` |
| Tiering | `src/lib/compliance/risk.ts` (low/standard/high, `risk:high`/`risk:low`) | Extend to T0 to T4 reading `review-tiers.yml`; drop `risk:low`; keep the anchored `permissions?` regex; add `portal/prisma/migrations/` |
| `mc/checkout` reasons | `expired`, `unknown_checkout`, `stamp_not_in_pr`, `repo_mismatch`, `released`, `revoked`, `pr_not_open`, `task_deleted`, `task_closed`, trailer mismatches | Reuse as is. v2.2's `checkout_expired` = `expired`; `no_task_link` = `unknown_checkout` or `stamp_not_in_pr`; `trailer_mismatch` exists |
| Checkout pinned for the PR's lifetime | PR #255 (TASK-2011) | Nothing |
| Merge-queue re-evaluation | `compliance-gate.yml` `merge_group`; spec D4/P16 | Nothing for compliance; review and UAT contexts subscribe in TASK-3434 |
| Job queue | none | Postgres table, unique on (repo, pr, head_sha, reviewer) (TASK-3431) |
| Evidence store | `mc_upload_evidence` (SharePoint, TASK-3166) | Reuse for `evidence.json` and transcripts; `external_id` = sha256 of the evidence |

Evidence schema v1 (`evidence.json`, one per review run):

```json
{"repo":"petralabx/plx-customer-portal","pr":2684,"head_sha":"<40>","base_sha":"<40>",
 "diff_files":["..."],"files_read":["..."],"tests_run":[{"cmd":"...","exit":0}],
 "model":"gpt-6.1-sol","model_version":"...","family":"openai","reviewer":"sol-6.1",
 "role":"primary","author_family":["anthropic","xai"],"effort":"xhigh",
 "findings":[{"id":"<hash(file,title)>","severity":"P1","file":"...","line":12,"title":"...","body":"..."}],
 "transcript_url":"...","started_at":"...","finished_at":"...","runner_id":"...","tokens":{"in":0,"out":0},
 "carried_from":null}
```

Invalid evidence (fails the check with `invalid-evidence`, never counts): wrong or stale sha;
`files_read` below threshold (T1+: 100% of `diff_files` minus generated files; T0: 80%) or empty;
missing transcript; a P0/P1 without body, file and line; missing `model` or `family`; runner error
or timeout; hash mismatch; posted by anything but MC. PR body text and MC evidence claims are never
inputs.

Check contexts, all posted by MC: `review/tier`, `checks/deterministic`, `review/primary`,
`review/independent`, `review/security`, `review/human`, `ai-review/verdict`, `uat/stamp`,
`mc/checkout`, `merge/hold`. The name `ai-review/verdict` is kept and repinned from integration
15368 to the App id in TASK-3418.

Quorum evaluator: from valid evidence on the current head only, count passes (N), distinct families
(K), role coverage, and author exclusion. A same-family result is shown as advisory. If the pool
cannot meet the quorum after exclusion, the check stays pending and the watcher escalates after 2 h.
First tests: the trust and staleness cases of `scripts/ai-review-verdict.test.mjs` (61 after #2684).

## 5. Deterministic fast gate (TASK-3430)

Fast gate, posted as `checks/deterministic`, runs on every new head before any LLM job is enqueued:
`scripts/audit-secrets.mjs`; the FileMaker net-new scan (section 3); the migration detector
(`portal/prisma/migrations/**`, `**/*.sql`, `**/migrations/**`); the workflow detector (`.github/**`,
Dockerfiles, `review-tiers.yml`); lint. Detector hits feed tiering (migration to T2 with
`migration-db`, workflow to T3). A FileMaker hit fails `review/tier` with no override. If the fast
gate fails, every LLM review for that sha is skipped (neutral `skipped-deterministic-failure`, no
spend) and re-runs on the fixing push. The full CI (`lint-typecheck-build`, tests, `workbench-api`)
runs in parallel; `ai-review/verdict` waits for it. SAST (CodeQL or semgrep) is a separate item with
an owner; it joins the fast gate only after a burn-in record (the runbook's four preconditions).
Time-to-first-review is measured from fast-gate green.

## 6. Dispatcher and runners (TASK-3431)

Port `scripts/ops/astra-watch/astra-watch.mjs` (TASK-2966) into MC: one review per head, drafts
skipped, `locked-retry`, rate-limit backoff 15 min doubling to 2 h, 90-minute timeout. Idempotency:
one job per (repo, pr, head_sha, reviewer). Cancel on push: a new head cancels in-flight jobs for the
old sha (the runner checks before each model call) and marks the old sha's checks `neutral:
superseded`. Carry-over: a head whose merge base and tree diff equal an already-reviewed sha carries
the verdict with `carried_from`.

Runners: GitHub-hosted `ubuntu-latest` for the API-only reviewers first; `plx-coding-1` as fallback
(through `plx-launch`, section 12); no repo write credentials on any runner; runners return evidence
to MC and only MC posts. A self-hosted pool is decided from a week of measured queue times, not up
front. SLA targets as v2.2 §7; the watcher's 2-hour escalation is the only enforced SLA until the
pool exists.

Cost controls as v2.2 §2 (per-review caps; draft skip; T0 one cheap pass), with the daily budget set
from the baseline in section 10 and the T0/T1 throttle off until then.

## 7. Grok reviewer runtime (TASK-3432)

Grokbot (the CIP and UAT runtimes) and Cursor agents pinned to a Grok model run the review prompt
and upload `evidence.json` with `family: xai`. Grokbot never counts on PRs that CIP or UAT authored.
Shadow mode (D5) until the precision metric has four weeks of data; promotion is a `review-tiers.yml`
PR. With Grok counted, every author family leaves two others:

| Author family | Counted reviewers | Families | Verifier for an OpenAI-raised P0 |
|---|---|---|---|
| anthropic (about 80% of trailed commits) | Sol, Astra, Grokbot, Cursor on Grok | 2 | Grok |
| openai (Codex-authored) | Claude, Grokbot, Cursor on Grok | 2 | Claude or Grok |
| xai (CIP, UAT, Cursor on Grok) | Sol, Astra, Claude | 2 | Claude |
| human (no trailer) | everyone | 3 | any cross-family reviewer |

## 8. Finding lifecycle (TASK-3433)

As v2.2 §5. Verifier: a different family from the raiser and not the author's; two reviewers from
different families raising the same finding id count as confirmed; refuted downgrades to P2 and is
logged with the verifier's evidence; timeout keeps the block (`unconfirmed-blocking`), one retry on
another eligible verifier, then escalation (CoS; Vince on T2 to T4). Dismissal through the App action
or slash comment by authorized actors only (Vince any; CIP or Steward P1 on T0/T1; never the author),
recorded against finding id and head sha. P2 auto-files an MC task labelled `ai-review-followup`.
Fix matching by `id = hash(file, title)`; a push invalidates every result for the old sha; no cron
re-scoring.

## 9. `uat/stamp` (TASK-3434)

Posted by MC, recomputed on every child-check change from valid head evidence: quorum met (section
4), every tier role check success, `checks/deterministic` success, `mc/checkout` success with its
reason copied in, `review/tier` success, no unmet PR-body gate ("Before the operator merges", "Do not
land until"; #2652, #2673), no `do-not-merge` label, harness result for the head (Playwright
`uat-e2e` against a preview deploy plus the MC task's acceptance criteria). A body gate counts as met
only through the App action "Mark gate met" by an authorized actor, recorded with actor, sha and
evidence link. Manual approval only through "Approve UAT for <sha>" with a mandatory evidence link.
`UNVERIFIED, accepted by <approver>` is Vince only while `persona-qa-staff2` is pending, auto-opens
the post-merge UAT task, and retires when the staff login exists. `land-when-green` §3c reads the
check instead of the comment. T0 and runtime-free T1 get `neutral: not-applicable` only after the
run-time glob re-check.

## 10. Metrics and the weekly report (TASK-3436)

Fix rate per reviewer and role (target 50% rolling 4 weeks; below 40% for 4 weeks demotes to
advisory), false-positive rate (refuted or dismissed over raised; target 25%, retune above 35% for 2
weeks), precision per reviewer and family (confirmed-and-fixed P0/P1 over raised; drives pool
assignment). Weekly report: TTFR p50/p95, invalid-review rate, spend per tier, verifier refutation
and timeout counts, spend saved by deterministic skips, quorum-unmet and author-family-exclusion
counts, `author_family_unknown` hits, UNVERIFIED acceptances, and a pool tuning recommendation
applied only through a `review-tiers.yml` PR. First deliverable: one week of per-review tokens and
duration from plx-coding-1 logs, so the daily budget is set from data.

## 11. Enforcement and rollout

The ruleset and App side is already tracked in BKT-GITHUB-GATES and is not re-specified here:
TASK-3414 (merge #2684), TASK-3415 (break-glass), TASK-3416 (the App, four checks in advisory mode),
TASK-3417 (`merge_group` triggers), TASK-3418 (rulesets to Evaluate then Active, app-pinned, merge
commits only), TASK-3419 (retire classic branch protection), TASK-3420 (merge queue). Ordering
constraints this spec adds:

1. TASK-3415 (break-glass) lands before any bypass list is emptied (change 8).
2. Strict up-to-date checks stay off and auto-merge stays on until TASK-3420 (change 6). The
   `merge_group` re-evaluation of `review/tier`, `mc/checkout`, `merge/hold` and `uat/stamp`
   ships in TASK-3434 and TASK-3417 before the queue is required.
3. The repin in TASK-3418 waits for the three-day shadow diff (TASK-3437) and Vince's go.

| Phase | Work | Tasks | Owner |
|---|---|---|---|
| 0 (now) | Merge #2684. Stop accepting PR-description markers (drop `pr.body` from `texts` in `ai-review-verdict.yml`, with a test). Watcher re-requests Sol and Astra on every head (`astra-watch` gains `--reviewer sol-6.1`). Keep auto-merge and squash as they are. | TASK-3414; portal follow-ups under TASK-3431 | Vince (merge), CIP |
| 1 (this week) | `review-tiers.yml`; decisions D1 to D5; evidence schema and quorum evaluator in MC, shadow mode; fast gate; dispatcher; Grok runtime in shadow; trailers; spend baseline | TASK-3427, 3428, 3429, 3430, 3431, 3432, 3435, 3436 | CIP, Infra, AWS_GH, Vince |
| 1 gate | Three-day shadow diff against the Actions verdict, go or no-go | TASK-3437 | UAT Testing, Vince |
| 2 (next week) | Repin contexts to the App, bypass lists empty, break-glass live, `uat/stamp` live, verifier and dismissal flow, P2 filing, retire comment markers and the Actions verdict workflow (T3 PR, Vince merges) | TASK-3416, 3418, 3419, 3415, 3433, 3434 | CIP, UAT Testing, Infra, Vince |
| 3 | Merge queue on; strict on; merge method per D4 | TASK-3420, TASK-3417 | Vince, Infra |

## 12. Interaction with the launcher (TASK-3411)

The Steward's design makes the lease loop the only thing that launches lane jobs on coding-1
through a root-owned `plx-launch`. Three touch points with this spec:

1. Review runs that fall back to coding-1 (section 6) go through `plx-launch` with a **review
   lease** issued by the MC dispatcher, keyed to (repo, pr, head_sha, reviewer) rather than to a
   task checkout. Without it the fallback stops working the day `systemd-run` is closed to lane
   users. The primary path (GitHub-hosted runners) is unaffected.
2. Trailers frozen from the lease (`Agent:`, `On-Behalf-Of:`, `MC-Checkout:`) are the
   trustworthy source for author-family resolution (section 3). The lease should record the
   model, so the frozen `Agent:` trailer is model-bearing (TASK-3435).
3. "`verify_pr` rejects commits with no matching launch record" must be scoped to commits whose
   `Agent:` trailer names a coding-1 lane. Commits from Claude web, Cursor cloud, Codex cloud and
   people never have a launch record; an unscoped rule blocks every PR from those runtimes.

The approval-record API the launcher needs is the same record `uat/stamp` uses for "Mark gate
met" and "Approve UAT for <sha>" (section 9): one API, one actor-sha-evidence record shape.

## 13. Acceptance checks

| Task | Done when |
|---|---|
| TASK-3427 | `review-tiers.yml` parses in all three repos; every trailer email in the last 300 commits of each repo resolves; a unit test fails on an unmapped email |
| TASK-3429 | Shadow check runs appear on every open portal PR; the quorum evaluator passes the 61 ported tests plus family and author-exclusion cases; `risk.ts` returns T2 for `portal/prisma/migrations/x.sql` and T0 for `docs/permissions-guide.md` |
| TASK-3430 | `checks/deterministic` posts within 5 minutes of a push on a docs PR; a PR adding `fmrest` outside the allowlist fails `review/tier`; a PR editing `fm-migration/fm-db.ts` does not |
| TASK-3431 | A push cancels the in-flight job for the old sha; two events for one head create one job; a rebase-only head carries `carried_from` |
| TASK-3432 | Grok evidence validates against the schema with `family: xai`; a CIP-authored PR shows Grok as advisory |
| TASK-3433 | A Sol P0 on an Anthropic-authored PR is sent to Grok; a refuted finding shows as P2 with the verifier named; an author's `/dismiss` is refused |
| TASK-3434 | `uat/stamp` flips to failure within one event of a `do-not-merge` label; an approval without an evidence link is refused; #2673's body text blocks the stamp in a replay |
| TASK-3435 | Every runtime's new commits carry `Agent: <runtime>/<model>`; `review/tier` lists each identity and family |
| TASK-3436 | The first weekly report carries the spend baseline, with per-review tokens and duration for one week |
| TASK-3437 | A comparison table of every head, both verdicts and the reason for each disagreement, uploaded as evidence; Vince's go or no-go recorded on the task |

## 14. Not verified in this revision

`research/pr-review-frontier.md` (the [F §n] citations), `land-when-green.sh`, `hold-guard.sh`,
`revdrain3.sh`, `ai-review-comment.sh`, `plx-astra-review`, the live ruleset contents and bypass
list, the `## UAT stamp` comment convention, and per-review spend on coding-1 are outside the two
repos read for this spec. Each is named where it matters above.

## 15. Rollback

This revision changes documents only. Reverting the commit that carries it removes the spec, the
review artifact and the README row. The MC tasks it names stay and can be cancelled from Mission
Control.
