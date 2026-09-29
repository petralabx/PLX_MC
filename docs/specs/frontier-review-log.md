# Frontier stack spec — adversarial review log

Target: `frontier-implementation-spec.md` (r1 as pasted on 27 Sep 2026 → r2).
Method: each factual claim was checked against the repos at these heads: portal
`95276888b6ed`, PLX_MC `2faa2a2c9633`, agentic-swarm `35ed5034eddf`,
plx_secondbrain `af0b3ea3c9f8`. Every acceptance command was then dry-run. After
that, independent critics reviewed the result blind, with no access to the author's
reasoning.
No repo was edited. No Mission Control checkout, self-check, or stamp was called. No
PR was opened.

Round 10 (29 Sep 2026) reviewed the r13 changes the same way. Its section, near the end
of this file, replaces the one that held the draft critic's five rounds and left round 10
pending, and the r13 approval follows it, recorded like the r12 approval. r13 merged to
PLX_MC `main` on 29 Sep 2026 (#260, `697373e00719`) with a landing edit that recorded the
yes; the round-10 text lands on that merged text and keeps the landing corrections.

Severity key: **B** is a blocker (the phase cannot succeed or does harm as written).
**M** is major (wrong result likely, or the builder must guess). **m** is minor.

## Round 1 — fact check and dry runs (author)

| ID | Sev | Where | r1 defect | Evidence | r2 fix |
|---|---|---|---|---|---|
| R1-01 | B | P1 | The environment `PLX Portal + MC` does not exist. The account lists `PLX` and `Default` only. | `list_environments`; runbook `:110` uses the name as "e.g." | D1: the operator creates or renames it before P1. |
| R1-02 | B | P1 | A multi-repo Claude web session starts in `/home/user` and never loads `.mcp.json`, so there are no MC tools. | Review session: key set, no `mc_*` tools | P1 runs a single-repo session. |
| R1-03 | B | P1 | `mc_self_check` returns no principal, so `sp_mcp_claude_code` cannot come from it. `parse_error` is not a field. | PLX_MC `actions.ts:61-72`; `self-check/route.ts`; `envelope.ts:49` | The principal comes from REST `meta.actor.servicePrincipalId`. `parse_error` is an operator observation. |
| R1-04 | B | P1, P2, P3, P9, P14 | The executor is a Cursor model, but these steps run in Claude web, Codex, Cursor surfaces, or the cursor.com dashboard. The runtime also cannot reach `/cursor/stores`. | — | These phases get an `executor: operator` plus an orchestrator recorder that pastes verbatim. |
| R1-05 | B | P2, P3 rollback | "The operator revokes in Mission Control." No code path sets `revoked`. `complete()` does not release a stamp. | `grep revoked` (only fixtures); `complete()` | Rollback is expiry at issue + 480 min. P2's wording is corrected. |
| R1-06 | M | P2 | Search-then-create is undefined for Codex. The helper source is not in any repo. | `CODEX-CLOUD.md:33-51`; `git grep` | HTTP search and create steps; record the helper's sha256 and `--help`. |
| R1-07 | B | P3 | P3 needs a later yes, but it must run inside P2's 8-hour TTL. Nothing enforced that. | `CHECKOUT_TTL_MIN = 480` | A timing rule, plus an acceptance that compares `second_call_at` to `expires_at`. |
| R1-08 | M | P3 | The outcome is already decidable from code (second-stamp). | F1 | Record `code_prediction`. The live call tests the deployed Hub. |
| R1-09 | M | P4 | "Return the live stamp OR 409" leaves the contract to the builder. Rows hold `runtime`, not the principal. | `insertDispatch` fields | D2 contract: same runtime returns the same stamp; a different runtime gets 409. No migration. |
| R1-10 | M | P4 | `owns` let the builder edit `checkout-shared-core.test.ts`, the guard test. That test also mocks `checkout()` entirely. | `tests/checkout-shared-core.test.ts:8-22` | Forbidden. The real-core tests (`compliance-server`) are added to acceptance. `git diff --quiet` guard. |
| R1-11 | M | P4 | `npx vitest` fails without `npm ci` (no node_modules). The failing-first rule was unverifiable. | checkout state | `npm ci` added; `failing_first:` evidence line. |
| R1-12 | B | P5 | There was no measurement method, so the numbers could not be reproduced. | none of the terms appear in any repo | Appendix A reproduces 129113, 52966, and 44171 exactly. |
| R1-13 | M | P5 | The baseline mixes methods (portal Claude 15861 strips the newline) and gives swarm 117875 with no SHA. | Appendix A run | The row is restated with SHAs and raw bytes. |
| R1-14 | M | P6 | `cursor-min` is undefined and unused. The acceptance could not fail (it only ran the script). | — | D9 drops it; exit-coded `--check-*` modes; proof that the gate fails. |
| R1-15 | B | P7 | The "lobster path" does not exist. Lobster is the cron that runs the live-pushing sync. `sync_to_sharepoint.py` writes SharePoint lists, not guides, so dry-run would break a live feature. | swarm `governance_repo_sync.py:143-203`; `pipelines.yaml:421-431`; `sync_to_sharepoint.py:312-317` | D6: lock the instruction paths in `governance_repo_sync.py` only. |
| R1-16 | M | P7 | `writer-lock.md` was not in `owns`. The "deploy and porcelain" criteria were not in acceptance. Swarm deploy is gated by `SWARM_DEPLOY_ENABLED`. | `deploy-swarm.yml:40` | Operator done gate and template. |
| R1-17 | B | P8 | Swarm and PLX_MC `governance.mdc` and the marker blocks are generated. Hand edits fail `--check`. Swarm AGENTS.md embeds the rules and a test compares it byte for byte. | F8 | Edit `config/governance-contract.yaml`, regenerate, and add `--check` to acceptance. |
| R1-18 | B | P8 | The second brain's `docs/GOVERNANCE.md:14` forbids duplicating agent rules. | F15 | D3: change that line in the same PR. |
| R1-19 | M | P8 | The PLX_MC Team Rules paste source says "Before creating or updating a PR … call mc_complete_task". Every Cursor Cloud agent sees that wording. | `config/cloud-agent-fleet-always-apply.md:118` | Added to the carriers; the operator re-pastes. |
| R1-20 | M | P8 | "One sentence per file" conflicted with the arrow form already in swarm AGENTS/CLAUDE and with the generated embed copy. | swarm `AGENTS.md:20`, `CLAUDE.md:32` | The rule becomes: at least one locked sentence and no other wording. |
| R1-21 | B | P9 | Cursor Cloud reads GitHub. An uncommitted nonce is invisible to it. | — | Operator pushes a canary branch (human push), no PR, deleted after. |
| R1-22 | B | P9→P10 | The portal was never canaried, so P10 portal could never start. | P9 "repos P8 touched" | P9 covers all four repos. |
| R1-23 | M | P9 | "pass" was undefined for demoted-candidate rows. | — | root and slice rows are pass or fail; desc and glob rows record `loaded`. |
| R1-24 | B | P10 | "Portal mc-compliance.mdc *stays* ≤ 2457" is false; it is 19778 bytes. "Provisional caps until the canary passes" contradicts "runs only after pass". | `wc -c` | The caps are final, with a "now" column. D8 drops the failed-canary path. |
| R1-25 | M | P10 | The caps require generator changes that were not in `owns`. Portal CI requires strings in root AGENTS.md, CLAUDE.md, GEMINI.md, and `.cursorrules`. | F8, F13 | `owns` extended; implications stated; CI tests added to acceptance. |
| R1-26 | M | P10 | `canary: pass` was grepped globally, not per repo. | — | Per-repo line. |
| R1-27 | M | P11, P12 | The name list missed Dev Team, QA Techs, QA Reviewer, PMP, and CEO. `Senior` false-positives on "Senior developer standards". The "Do not edit manually" header would stay. `components` lacks the banner. | F12 | Word-bounded grep with an allow-line; header and banner checks; hygiene score comparison. |
| R1-28 | M | P14 | The registration gives every Cursor agent `memory.items` write access with a shared key. Integration declaration fields were missing. | F16 | D5 key choice; key name and write tools recorded; the operator executes. |
| R1-29 | B | P15, P16 | The portal already has `compliance-merge-group.yml`, which emits `compliance` on `merge_group`. Adding `merge_group` to `plx-mc-compliance.yml` makes two jobs named `compliance`. The verify route rejects OIDC tokens that are not from `pull_request`. There is no PR body on `merge_group`, and the verify API takes no body. The drift check pins `GEN_SHA`. | F10, F11 | D4: port the stopgap into the generator, accept `merge_group` OIDC, regenerate, bump `GEN_SHA`, delete the stopgap. Acceptance checks "exactly one `compliance` job" and reproduces the drift diff. |
| R1-30 | M | all code phases | The MC handshake, validation commands, PR sections, tier bundle (`testRun` and bucket PRD for high), and complete order were missing. | repo CLAUDE.md files; `risk.ts`; `verify.ts` | Code-phase contract section. |
| R1-31 | M | all | Evidence format, variables, cwd, and shallow clones were undefined. Six starts ran against a cap of 2 with no order. | clones are shallow | Execution contract section. |
| R1-32 | m | all | Markdown ate the `**` in the Jev globs (`/jev-rules/`). | pasted text | Globs in code spans, gitignore-style. |
| R1-33 | m | CLAUDE.md (portal) | `CLAUDE.md:151` still names `taylorvalton/plx-customer-portal`. | portal `CLAUDE.md:151` | Out of scope; noted for a separate fix. |

Self-review of r2 before round 2: two `grep -qx` patterns containing `[` would parse
as bracket expressions (now `-F`). `! cmd` also passed on exit 2 (now `[ $? -eq 1 ]`).
The `handshake.md` and `guide-trim.md` templates were missing. The timestamp format
now avoids fractional seconds for `fromisoformat`. Dry runs all behaved as intended:
baselines reproduce, P12 and P16 fail on today's tree, the drift diff reproduces at
the pinned SHA, and the P3 time check rejects a late call.

## Round 2 — independent critic on r2 (blind), then author verification

Verdict: **NOT READY**, with 5 blockers, 9 majors, and 15 minors. Every blocker was re-checked in
code before r3 changed anything.

| ID | Sev | Where | Critic finding (verified) | Evidence re-checked | r3 fix |
|---|---|---|---|---|---|
| C1-B1 | B | P4 | The lease needs repo lookups that every `vi.mock("@/lib/compliance/repo")` factory lacks. The door-provenance test calls `checkout` twice with the same task, runtime, and repo, and expects an event on each call. | `tests/compliance-server.test.ts:21-47,122-140`; 19 mock sites | P4 may add mock functions (never assertions). A reused lease appends a `checkout` event with `reused: true`, so the provenance test passes unchanged. The full vitest suite runs. |
| C1-B2 | B | P16 | The portal TASK-2008 CI test pins the stopgap: the file must exist, and `plx-mc-compliance.yml` must not mention `merge_group`. | `scripts/ci-staged-gate.test.mjs:870-948` | The test is added to `owns` with an exact rewrite spec; acceptance runs it. |
| C1-B3 | B | P8 | `grep -qx 'needles_missing: []'` always exits 2 (BRE bracket). | reproduced | Every fixed-string check goes through `line()` (`grep -qxF`). |
| C1-B4 | B | P8 | The swarm contract's `agent_behavior` feeds runtime prompts, and a test pins 12 rules, so a contract edit would change every swarm agent's prompt. | `generate-governance-surfaces.py:202-220`; `governance_preamble.py`; `test_governance_gates.py:89` | D10: swarm carriers are hand-written text plus a new hand-written slice. The contract stays untouched, and acceptance checks that. |
| C1-B5 | B | F8, F13 | Wrong facts. The swarm generator does not write AGENTS.md. The wiring test reads fixtures only. | `AGENT_GUIDES` list; no `readFile` in the test | F8 and F13 rewritten. P10 portal adds explicit greps. |
| C1-M1 | M | P16 | Stamps expire before queue runs, so the queue stalls. Unbound `prNumber` lets any queue run write verdicts for any PR. The stopgap uses a portal-only script. | `service.ts:106-139`; runbook `max_entries_to_merge: 1` | Merge-group mode reuses the `resolveDispatchForMerge` rule. `prNumber` is bound to `pr-<N>` in the ref. Inline `gh api` with `GH_TOKEN`. `service.ts` is in P16 `owns`, and P16 is serialized with P4. |
| C1-M2 | M | P4 | The lease key used the self-asserted runtime header. A hand-off was locked for 8 hours. Bare repo names were not matched. | `auth.ts:128`; `permissionActorId` on the event | D2: the holder is `permissionActorId`; `task.completed` frees the lease; `dispatchRepoMatches` handles bare names. |
| C1-M3 | M | P7 | A second Lobster writer (`lessons_rule_promote.py`) re-grows an `alwaysApply` rule and guide blocks. `config/` let a DB row overwrite the governance contract. | `lessons_rule_promote.py:1-35,171-176`; crontab `:82` | D6: both writers are locked, and the contract is added to the instruction paths. |
| C1-M4 | M | P8 | The swarm codex view (the first 32 KiB) lacks `repo: petralabx/agentic-swarm`. | meter | The hand-written AGENTS.md section before the embed carries all needles. |
| C1-M5 | M | P14 | Unchained checks meant a pasted secret passed. | reproduced | Appendix B helpers exit on the first failed check. Dry run: a pasted key now fails. |
| C1-M6 | M | all | Clones went stale after merges (fetch only). | — | `checkout --detach origin/<base>` after each fetch. |
| C1-M7 | M | P8, P16 | A stamp could expire between checkout and PR open for split phases. | TTL 480 | 8-hour rule: check out when the PR can open; check out the same task again on expiry. |
| C1-M8 | M | P2 | The checkout response has no expiry time. Self-check needs extra headers. | `actions.ts:376-384`; `auth.ts:131-137` | Read the checkouts API; headers stated. |
| C1-M9 | M | P9 | Acceptance did not check the six rows per repo or their consistency with the `canary:` line. | — | Python check. Dry run: a mismatched `canary:` line fails. |
| C1-m1…m15 | m | various | Heredoc indentation; undefined variables; F7 "now" value; wrong `sync-agents-md.py` path; D7 wording; ET vs UTC; porcelain untracked files; portal `npm ci`; P12 table cells, "Factory-aware", and score baseline; PLX_MC `test_canary` strings; generated-slice nonce and HTML comment; P15 admin slot; P8 PR and Team Rules checks; P1 `actor.repo` echo; portal slice locked sentence; failure path after the freeze. | — | All fixed. Acceptance blocks sit at column 0, with the variables table, P12 cell rules, plain-text nonces, `--untracked-files=no`, and a "stop and report" rule after the freeze. |

Author checks on r3 before round 3:
- **Extraction:** all 18 acceptance blocks were extracted from the spec and pass `bash -n`. Appendix A matches the tested meter byte for byte.
- **Dry runs:** with good and bad sample evidence, P1, P2, P3, P5, P7 (done gate), P9, P11, P13, P14, and P15 all pass on good evidence and fail on bad.
- **Today's tree:** P12 and P16 (portal) fail on it, as they should.
- **One more trap fixed:** the `carrier` check rejected ``then `mc_complete_task`, then freeze``, which is Markdown a builder would write naturally. It now ignores backticks and asterisks.

## Round 3 — independent critic on r3 (blind), then author verification

Verdict: **NOT READY**, with 2 blockers, 10 majors, and 9 minors. This is down from 5, 9, and 15. Each blocker and major was re-checked in code.

| ID | Sev | Where | Finding (verified) | r4 fix |
|---|---|---|---|---|
| C2-B1 | B | P2 step 5 | Checkouts API rows carry `checkoutRef` (`dsp_…` plus the last 4 chars), not `id`. The script raised `StopIteration`. `$TASK`, `$STAMP`, and the headers were undefined. (`read-actions.ts:54-85`) | Match on `checkoutRef`, assert exactly one row, and define `H=(…)`, `TASK`, and `STAMP`. Dry run on the real row shape passes, and an empty list fails. |
| C2-B2 | B | F13, P10 | F13 was wrong. The required CI test pins strings in `auto-merge-after-push.mdc`, `pr-watch-until-green.mdc`, two skills, and bans phrases in the guides and the slice. | F13 corrected. P10 portal demotes those two rules by frontmatter only; acceptance compares the bodies against `origin/staging` and checks that skills are unchanged. |
| C2-M1 | M | Appendix B | `carrier` missed "Last commit, then freeze. Completing releases the checkout." and "`mc_complete_task` before or as part of PR open". | `COMPETING` regex added. Dry run: both are rejected, and the locked sentence and unrelated lines pass. F14 lists every portal line. |
| C2-M2 | M | P3 | The id rule was wrong both ways. | Checked per outcome. Dry run covers 6 cases, 3 good and 3 bad. |
| C2-M3 | M | P15 | The workflow logs `auth=bearer-fallback`, or skips. | The regex widened. |
| C2-M4 | M | P12 | About 20 body lines had no edit rule. | Explicit reviewer, implementer, and delete rules; the keep-verbatim list names the domain rules. |
| C2-M5 | M | P6, P10 | The swarm hermes cap of 5632 could never reach `caps.json`. | `caps.json` holds final caps from P6; P8 keeps its own 9216 check. |
| C2-M6 | M | P10 | CI-only swarm parity checks and the PLX_MC arch-parity pins. | Listed in implications and added to acceptance. |
| C2-M7 | M | P4, P7, P16 | Acceptance passed on a no-op. | Require a diff in the changed source, the named new tests (a count floor), and no removed `expect(`. |
| C2-M8 | M | P9 | desc and glob rows are impossible in secondbrain. | `nonce: none loaded: n/a`; never create rules on a canary branch. |
| C2-M9 | M | P16 | Service tests were aimed at a pure-function test file. | New `tests/compliance-merge-group.test.ts` using the mocked-repo pattern. |
| C2-M10 | M | P16 | The TASK-2008 test edit was underspecified. | An exact delete, invert, and re-point list for each assertion. |
| C2-m1…m9 | m | various | Labels are added after `opened`; P4 query windows and the tie-break; a reused event inflated counts; P10 and P16 portal both own `auto-merge-after-push.mdc`; a repo-specific line in the fleet contract; soft-mode path in P16; duplicate `canary:` lines; no evidence file for P6/P16; unrelated EC2 dirt; P8 per-half dependencies. | D7 now uses the high-tier bundle, not a label, and records `gate_tier`. Explicit `completedCheckoutIds` and `checkoutHolder` queries; the oldest dispatch wins; a `checkout.reused` event. Portal halves serialized. "In this repo" phrasing. The existing block path in soft mode. Exactly one `canary:` line. `merge-group.md` evidence. Porcelain limited to instruction paths. Per-half `depends_on`. |

Author checks on r4:
- **Extraction and syntax:** all 18 blocks re-extracted; `bash -n` is clean.
- **Dry runs:** P1, P2, P5, P7 (done gate), P11, P13, P14, and P15 pass on good evidence. The P3 variants (6) and P9 variants (2), the `carrier` competing-wording cases (4), the P2 parser (2), the P10 body comparison, and P16 on today's tree all behave as intended.

## Round 4 — independent critic on r4 (blind), then author verification

Verdict: **NOT READY**, with 2 blockers, 5 majors, and 9 minors. Each finding was re-checked in code.

| ID | Sev | Where | Finding (verified) | r5 fix |
|---|---|---|---|---|
| C3-B1 | B | P7 | Swarm `pyproject.toml:214` sets `addopts = "-v --cov…"`. With `-q`, `--collect-only` prints a tree, so the `::` count is always 0. | `-o addopts=` on the count command; the venv python. |
| C3-B2 | B | P4, P8, P10, P16 | "Changed" and "unchanged" guards compared against a moving `origin/<base>`. After a fetch or merge they flip, and the two P16 blocks could never both pass. | Three-dot diffs (`origin/<base>...HEAD`) and `merge-base` for the body comparison. The contract says acceptance runs on the frozen PR head before merge. |
| C3-M1 | M | approval | "What approval unlocks" and the question still said r3. | Both say r5, and D1–D11. |
| C3-M2 | M | Appendix B | Competing wording on the same line as the locked sentence passed. | `carrier` strips LOCKED from each line, then tests COMPETING. The dry run rejects both same-line cases and accepts `**…freeze.** CIP lands the PR.` |
| C3-M3 | M | F14, P10 | Competing wording is also in `GEMINI.md:14`, `.cursorrules:101`, `mc-compliance.mdc:344`, and `mc-delegation.mdc:24,54-55`. | F14 is complete. P10 portal runs `carrier` on every root guide and rule that mentions the order. |
| C3-M4 | M | F17, P16 | The bucket PRD is not advisory. The seed `BKT-PROD` and `BKT-INFRA` have `prd: null`, which gives `absent` and blocks every high-tier PR. P4 still carried a `risk:high` label. | F17 corrected. New D11: P15 reads both buckets, P16 needs a PRD present, and Vince decides; no agent edits a bucket. The P4 label is gone (high-tier bundle only). |
| C3-M5 | M | P10 | Content could move into broad-glob rules that the meter ignores. | Moved content goes only to description-only rules or path-scoped globs; acceptance rejects globs starting with `*`. |
| C3-m1…m9 | m | various | P12 designer and owner cells; the P16 stopgap is named in auto-merge prose, not a table; no P6 evidence file; task titles undefined; toolchain (PyYAML, venv, pytest-cov); P2 needed a persistent shell and had indentation issues; unchecked P8 and P11 deliverables; org ruleset `18679471` runs PLX_MC `compliance-gate.yml@main` as a required workflow; byte-offset wording. | One cell rule. Prose paragraph named, and acceptance checks the stopgap is no longer named. `meter.md`. A task title and branch table. Venv install rows and `.venv/bin/python` in blocks. One column-0 read-back script. The soft line and GOVERNANCE check. Quoted-name checks. P15 records the org rule type and workflow; P16 records `org_workflow_on_staging`. F8 and P8 offsets fixed (the handshake section is at byte ~466; the marker is at 33026). |

Author checks on r5:
- **Extraction and syntax:** all 18 blocks, Appendix B, and the P2 read-back script pass `bash -n`.
- **Evidence dry runs:** P1, P2, P3, P5, P7, P9, P11, P13, P14, and P15 pass on good evidence.
- **Round-4 cases:** the `carrier` same-line cases give 2 rejected and 2 accepted. The broad-glob guard rejects `**/*` and `*.md` and accepts `portal/prisma/**`.
- **One more bug found and fixed:** the dry run caught `TASK=TASK-<n>` (shell redirection syntax) in the P2 script. The placeholders are now safe, and the script, run with a mocked `curl`, prints `issued_at`, `expires_at`, and `principal` correctly.

## Round 5 — independent critic on r5 (blind), then author verification

Verdict: **NOT READY**, with 1 blocker, 6 majors, and 9 minors. Each was re-checked in code.

| ID | Sev | Where | Finding (verified) | r6 fix |
|---|---|---|---|---|
| C4-B1 | B | portal pre-push, P10, P12, P16 | 23 portal shims say "remove after 2026-09-30". From 30 Sep the hygiene audit exits 2 on unchanged `staging`, so every portal phase fails validation. | F21 added. New `hygiene_gate` in Appendix B compares HEAD with the branch point, both in detached worktrees. Pre-existing expired-shim failures pass; anything worse fails. |
| C4-M1 | M | P8 | The GOVERNANCE.md guard could never fail, because line 14 has `**` marks. | Marks stripped before the match; the file must also name the three new files. F15 quote corrected. |
| C4-M2 | M | P6 | The CLI shape was ambiguous, and `nargs='+'` would break P10's combined flags. | Boolean flags with positional repos; acceptance runs the combined form. |
| C4-M3 | M | P7, P16 | Existing security tests could be weakened; a zod `.default` would change the forwarded body. | Guards against removed `expect(`/`assert` lines (P7 allows only recorded `assert_edit:` lines). `event` is `.optional()` with no default. |
| C4-M4 | M | P8 | One acceptance block needed three PRs plus a post-merge re-paste, so it had no valid time to run. | Three pre-merge half blocks plus a post-merge "P8 close" block; P9 depends on the close. |
| C4-M5 | M | P11, P12 | The roster dropped Claude Code, Codex, Copilot, Gemini, and Hermes (root `AGENTS.md:10`). | The roster line copies root `:10` plus colleague IDEs; acceptance checks Claude Code and Codex. |
| C4-M6 | M | P16 | `merge_group` over the bearer token was unspecified. | Bearer keeps today's trusted-body rule. It is safe because merge-group mode only re-confirms a prior pass on the same head. |
| C4-m1…m9 | m | various | No P13 or P15 templates; a leftover D7 label clause in P16; the P4 query needed a limit and was newest-first; Setup never set `approved`; the glob check missed YAML lists; deploy confirmation had no method; F19 identities; the P2 guard did not stop; `caps.json` scope. | Templates added. Clause removed. Unbounded ascending `liveDispatchesForTask`. `status: approved`. A Python frontmatter parser. F22 plus the Vercel `plx-mission-control` method. F19 plus a human-identity rule. `if … fi` guard. View caps only. |

Author checks on r6:
- **Extraction and syntax:** all 21 blocks (P8 is now four), Appendix B, and the P2 script pass `bash -n`.
- **`hygiene_gate` on the real portal:**
  - It passes today, and it passes with a faked 2026-10-01 clock, where the pre-existing expiry is tolerated.
  - It fails on a commit that drops a consumer-copy banner, both today (100 → 88) and on 1 Oct (88 → 77).
  - An early version compared a detached base against the named branch. Audit check 9 reads the branch, which made the scores differ (100 vs 88) on the same commit. Both sides now run detached.
- **P10 glob parser:** it rejects the `**` inline and YAML-list forms and allows path-scoped and description-only rules.
- **P2 script:** it stops on placeholders and prints all three fields when they are filled in.

## Round 6 — independent critic on r6 (blind), then author verification

Verdict: **NOT READY**, with 1 blocker, 3 majors, and 8 minors. Each was re-checked in code.

| ID | Sev | Where | Finding (verified) | r7 fix |
|---|---|---|---|---|
| C5-B1 | B | F14, P8, P10 | Two more competing-wording files had no owner: portal `.github/copilot-instructions.md:14` and PLX_MC `docs/AGENT-PR-SOP.md:325`. | This class is now closed by construction. A new `sweep` in Appendix B scans every tracked instruction file (`INSTR_FILES`) in a repo. F14 was rebuilt from a sweep of all four repos. P8 (three halves plus close) and P10 portal run `sweep .`. P8 PLX_MC owns SOP line 325; P10 portal owns `copilot-instructions.md`. |
| C5-M1 | M | P15, D11 | `mc_list_buckets` omits `prd`. | Read with `mc_get_context { depth: "full" }`, which returns full bucket rows. |
| C5-M2 | M | P6 | The `caps.json` location and unknown-slug behavior were unspecified, and later phases run the meter from other directories. | `caps.json` is resolved relative to `measure.py`; an unknown slug exits 2; acceptance runs the needle check from `/`. |
| C5-M3 | M | P3 | The outcome trusted the helper's output. | The Hub's active rows decide (`active_rows`, `active_ref`); acceptance ties `second-stamp` to 2 rows. |
| C5-m1…m8 | m | various | P7 test floor 6 vs 5 listed cases; the P7 run could predate the deploy; the P9 root nonce was at the end of a 77 KB file; no 409 rule; P12 roster check incomplete; P16 deploy vs `GEN_SHA`; PLX_MC shims dated 2026-10-15 could trip the critic; Team Rules re-paste was ambiguous. | Floor 5. Time-order assert. Root nonce after the H1. A 409 `checkout_held` stop rule. Copilot, Gemini, and Hermes checked. Deploy-contains-`GEN_SHA` check. F23 plus a critic scope note. The Rule 5 block named, with the one-line sentence rule. |

Author checks on r7:
- **Extraction and syntax:** all 21 blocks, Appendix B, and the P2 script pass `bash -n`.
- **`sweep` today:** it fails on portal (7 files), PLX_MC (1), and swarm (2), and passes on secondbrain. On a scratch PLX_MC clone with line 325 fixed, it passes.
- **P3:** of 4 Hub-row cases, 2 pass and 2 fail, as intended.
- **P7 done gate:** it rejects a governance run that predates the deploy.

## Round 7 — independent critic on r7 (blind), then author verification

Verdict: **NOT READY**, with **0 blockers**, 2 majors, and 7 minors. Each was re-checked in code.

| ID | Sev | Where | Finding (verified) | r8 fix |
|---|---|---|---|---|
| C6-M1 | M | F14, sweep, P10 | Skills, prompts, and runbooks still carry "Completing releases the checkout", including `mc-sync` and `babysit` on the PR-open path, and `sweep` did not scan them. A sweep of all tracked markdown also showed the "then freeze" pattern over-matched (for example "then freeze it into model_plan"). | `INSTR_FILES` now covers `.cursor/skills`, `prompts`, and `docs/runbooks`. `COMPETING` is tightened (`last commit…freeze`, `completing releases`, `mc_complete_task…freeze`, `mc_complete_task…before/as part of/during…PR`), so the false positives drop. F14 is rebuilt: 19 portal lines in 15 files, 1 PLX_MC, 2 swarm; no test pins any. New **D12**: a P8 portal half makes line-scoped fixes to all 15 files, so the fix does not wait on the portal canary; P10 only trims. |
| C6-M2 | M | P3 | The operator had to rewrite Python to count the Hub's rows. | A literal P3 read-back script prints `active_rows` and `active_ref`. |
| C6-m1…m7 | m | various | The P7 host was ambiguous (vmc-prod resets on push); no hook bypass for canary commits; D11 confirmation had no evidence; the runbook promised multi-PR groups; a reused stamp could be about to expire; no `sweep` in the P10 swarm and PLX_MC arms; the P9 start line was inconsistent. | P7 names swarm-prod via the bastion, confirms the `swarm-lobster-cron` restart, reads the skip line from `journalctl`, uses `git log origin/main`, and restores `--untracked-files=no`. Canary commits use the GitHub web editor. `bucket_prd_confirmed` lines are checked in both P16 blocks. The runbook keeps group size 1 and ALLGREEN. Reuse requires at least 60 minutes left, otherwise a fresh stamp. `sweep` in all P10 arms. P9 starts after the P8 close. |

Author checks on r8:
- **Extraction and syntax:** all 22 blocks, Appendix B, and both read-back scripts pass `bash -n`.
- **Tightened `sweep` today:**
  - Portal fails on exactly the 15 F14 files.
  - PLX_MC fails on 1 file and swarm on 2; secondbrain passes.
  - False positives (`project-orchestrator` "then freeze it into model_plan", `pd-artwork`) are gone.
- **P3 script:** stops on its placeholder, and with a mocked `curl` it lists both active rows.
- **P8 portal half, end to end:** on a scratch portal clone, the line-scoped replacements a builder would make across all 15 files were committed. The full acceptance block then passed (rc=0) with every check:
  - the file-list guard and diff-size guard
  - `carrier` on the 6 carriers
  - `sweep`
  - `node --test scripts/ci-staged-gate.test.mjs`
  - `verify-agent-contract.mjs`
  - `hygiene_gate`

  The phase is achievable within its `owns`.

## Round 8 — independent critic on r8 (blind), then author verification

Verdict: **0 blockers**, 2 majors, and 6 minors. The critic confirmed that F1–F23 hold and that F14 matches the sweep exactly. It also dry-ran the P8 PLX_MC and swarm halves to a pass.

| ID | Sev | Where | Finding | r9 fix |
|---|---|---|---|---|
| C7-M1 | M | P4 | A same-holder re-mint could have been written as `checkout.reused`. That would leave the new stamp with no holder, and the original principal would later get 409 on its own task. | A re-mint appends a normal `checkout` event; `checkout.reused` only when an existing id is returned. A new test: re-mint, first stamp expires, same holder gets the new stamp with no 409. |
| C7-M2 | M | Scheduling | "Portal halves run one at a time, P8 first" wrongly held P12 and P16 behind P8. | The real overlaps only: P8 portal before P10 portal; P10 and P16 portal serialized; P12 independent. |
| C7-m1…m6 | m | various | Stale "three halves" text; new slices not checked for `alwaysApply`; portal non-carrier files not checked for the locked sentence; `tasks/lessons.md` exclusion not stated; module-index rows unowned; the approval question omitted auto-start phases (P7, P14); P12 did not check the second banner line or the domain rules. | All fixed: `alwaysApply` greps; a locked-sentence check on all 15 portal files; the F14 exclusion stated; P6 owns the index rows; P4 and P16 own their compliance contract sections; the approval question names P7, P9, and P14; P12 checks the banner line and preserves each domain phrase present at the branch point. |

Author checks on r9:
- **Extraction and syntax:** all 22 blocks, Appendix B, and both read-back scripts pass `bash -n`.
- **Evidence dry runs:** P1, P2, P3, P5, P7, P9, P11, P13, P14, and P15 pass on good evidence.
- **P8 portal half, end to end:** re-run on a scratch clone, rc=0.
- **P12, end to end:** on a scratch clone, a mechanical P12 rewrite passes the full block (rc=0), including `hygiene_gate`. Dropping a unique domain rule fails it ("dropped domain rule: Never delete versioned BOMs").

## Round 9 — independent critic on the r12 changes (blind), then author verification

r12 applies the swarm retirement (swarm retirement spec r2, section 10) and holds the
lease and merge-queue work for PLX_MC PR #255. Under the spec's own rule, the changed
phases were reviewed again. The critic saw r11, r12, the retirement spec, the agent
fleet spec and PR #255's description; it did not see the author's reasoning. The
author checked each finding against the files and PR #255's file diff, and all ten
held.

| ID | Sev | Area | Finding | Fix in r12 |
|---|---|---|---|---|
| R9-1 | M | P14, D14 | P14 "started on evidence" with no evidence file for R7, no `BRAIN_URL` variable, and an acceptance that took any host but the old one. The first yes would approve a write-capable registration at an unnamed host. | P14 is a later yes that names `BRAIN_URL`. It waits only for `brain_self_check` at that host. Evidence gains `brain_url`, `r7_host_live_at` and `service_commit`; acceptance checks the exact URL. |
| R9-2 | M | F24, D13 | F24 named two overlapping files; #255 changes 17, including `repo.ts`, the compliance README, `compliance-gate.yml`, and a test that now expects an expired stamp to pass. | F24 lists every file P4 or P16 edits or cites. D13's r13 re-derives F1, F2, F6, F11, D2, D4 and every cited test line. |
| R9-3 | M | Risks, P16 | If #255 merges, the P16 portal regeneration adds `edited`, but portal `mc-compliance.mdc` says "Do not add `edited` in this repo", and P16 did not own that file. | D13: r13 gives those lines to the P16 portal half, sequenced after P8 and P10 on the portal. |
| R9-4 | M | SC-13, D13 | No evidence recorded #255's state, and D13 blocked P4's no-code branch for no reason. | `pr255:` and `spec_revision:` in the P4 code-branch, P15 and P16 evidence, with checks. The no-code branch does not wait. |
| R9-5 | M | Scheduling | Retirement R7 and S7 edit files that P8 and P10 own, with no ordering rule. | New Scheduling rule: same-file PRs from the two specs never run together on one repo. |
| R9-6 | m | F24 | P2 and P3 were not addressed. | F24 records that both are unaffected, and why. |
| R9-7 | m | F25 | "R1 turns off both writers" overstated R1, which runs after R0 and only when nothing depends on the writers; one writer is a VMC cron. | Reworded everywhere to "plans to turn off"; P7's withdrawal rests on no phase editing the swarm. |
| R9-8 | m | P13, P14 | The new P13 line had no evidence key; P14's stop rule checked the old swarm route. | P13 gains `moves_to:` with a check; P14's stop rule checks `brain_self_check` at `BRAIN_URL`. |
| R9-9 | m | Scope | The scope line took the URL from a runbook that names the old host. | Name and headers from the runbook, URL from R7. |
| R9-10 | m | P6 | The reason given for keeping the swarm's `needle_views` was wrong. | Corrected: P6's acceptance needs the entry so `--check-needles` exits 1, not 2. |

Author verification: all 22 bash blocks pass `bash -n`. The changed P4 and P14 checks
were dry-run with sample evidence and the Appendix B helpers. Good evidence exits 0.
The old host, an open #255, and a merged #255 without r13 each exit 1.

## Convergence and stopping rule

| Round | Reviewer | Blocker | Major | Minor |
|---|---|---|---|---|
| 1 | author fact check (r1) | 14 | 17 | 2 |
| 2 | critic on r2 | 5 | 9 | 15 |
| 3 | critic on r3 | 2 | 10 | 9 |
| 4 | critic on r4 | 2 | 5 | 9 |
| 5 | critic on r5 | 1 | 6 | 9 |
| 6 | critic on r6 | 1 | 3 | 8 |
| 7 | critic on r7 | 0 | 2 | 7 |
| 8 | critic on r8 | 0 | 2 | 6 |
| 9 | critic on the r12 changes | 0 | 5 | 5 |
| 10 | three critics on the r13 changes | 0 | 8 | 19 |

The loop stopped after two consecutive blind rounds with no blocker. Every finding from those rounds is fixed in r9 and verified by extraction plus dry runs, with end-to-end scratch-clone runs for the two phases that changed most (P8 portal half, P12). r9 itself has not had a ninth blind critic pass.

## What this review could not prove

- **F4, F5, P1:** need a live Claude web session on `PLX Portal + MC`. The rename is done; its variables and network policy are not visible from the review session.
- **P2, P3:** need the Codex environment and its unpublished `~/bin/plx-mc-stamp` (F6).
- **P9:** needs three Cursor surfaces.
- **P14:** needs the cursor.com dashboard.
- **PLX_MC PR #255:** its outcome is unknown. D13 holds P4's code branch and P16 until it merges or closes.
- **P14 host:** the retirement spec's R7 has not named or built the brain's own address yet.
- **P15 admin lines and D11:** need GitHub ruleset and Mission Control bucket reads.
- **P4, P6, P16 (code phases):** have scratch-verified acceptance shapes, but not a real build. pytest and vitest were not installed in the review container.

## Post-review update — 28 Sep 2026 (r10)

The operator renamed `env_01SVX8gUwth13dQuc5G2wRDQ` (formerly `PLX`) to `PLX Portal + MC`; `list_environments` confirms it. r10 updates F4 and D1 to match, and P1 now requires that exact `environment_id`. Nothing else changed, so no review round was run.

r11, same day: Vince confirmed D1 (the renamed environment carries the runbook variables) and D12 (the P8 portal half). Only confirmation markers changed.

## Post-review update — 28 Sep 2026 (r12)

The operator decided to retire the swarm and to build the agent fleet on the portal
registry. r12 applies section 10 of the swarm retirement spec (r2):
- P7 and D6 are withdrawn.
- P8, P9 and P10 lose their swarm halves, and D10 is withdrawn.
- P14 registers the brain's own address, as a later yes naming `BRAIN_URL` (D14).
- PLX_MC PR #255 holds P4's code branch and P16 until it merges or closes (D13).

Round 9 reviewed these changes: 0 blockers, 5 majors, 5 minors, all fixed in r12.
If #255 merges, r13 re-derives the lease and merge-queue rules, and the review runs
again on P4, P15 and P16.

## Approval — 2026-09-28T14:23:22Z

Vince approved r12 with the defaults in "Decisions a yes confirms" (D1–D5, D7–D9,
D11–D14) and the frozen model plan. Setup (writing `$TOOLS`, recording the tool
hashes, and updating the store copy of this spec) runs in the Cursor project store,
which the review session cannot reach.

## Editorial update after approval — 28 Sep 2026

The spec keeps revision r12. These edits change no phase, gate, acceptance check or
default:

- The approval is recorded at the top and in "Does an approved plan exist?".
- The spec, the agent fleet spec and the swarm retirement spec are committed to
  PLX_MC `docs/specs/`. The private-page links are removed.
- The operator then confirmed swarm retirement r4: the trading lab is not touched,
  it keeps the repo, and `missioncontrol.tayloralton.com` stays for it. F25, F26,
  D10, D14's reason and SC-12 no longer say that the repo is archived or that the
  old host goes away. D14's rule is unchanged: P14 registers `BRAIN_URL`, never the
  old host.

## Round 10 — independent critic on the r13 changes (blind), then author verification

Round 10 has two parts. The first is the independent critic's review of the r13 draft
before it was adopted (five rounds, 28 and 29 Sep 2026; background below). The second
is the blind round the README defines: three independent critics reviewed every r13
change in PR #260 at head `8ed919f5e59f`, blind, from a packet that held r12, r13, the
r13 diff, retirement section 10, the merged PR #255 and the cited code at PLX_MC
`fc7ceef3d123` and portal `b192d624aeaa`. The author then verified each finding against
the code and the specs on the build host. While the round ran, a landing review of the
same PR recorded the yes and corrected citations (head `f96a92c468d1`, 21:28:12Z), and
#260 merged to PLX_MC `main` at 2026-09-29T21:42:13Z as `697373e00719`; the round-10
text is built on that merged text and keeps the landing corrections (background below).
After the round's packet was cut, `main` also gained #262 (TASK-2111, 22:09:53Z) and #263
(TASK-2112, `7f79712657e3`, 22:22:59Z), which changed files P4 and P16 cite and edit, the
fact F17 states, and one line of the spec; a ninth check of the round-10 text pinned every
P4 and P16 code citation at `7f79712657e3`, corrected F17 and the P16 released-stamp case
to that code, and kept #263's line ("Main after the round", below).
Vince answered `yes r13, D5 as r13` at
2026-09-29T18:09:35Z, before this round ran (the approval section below). The spec
header records the yes, what it covers, and `round_10: done`. The time the gates read,
`round_10_done_at`, is the time the round-10 text merged to PLX_MC `main`: it is an
approval field, the orchestrator sets it in its execution copy when the round-10 PR
merges, with no second PR, and each gated acceptance derives it from `main`, so no
later yes given before that merge counts. Vince answered every question this round
put to him on 29 Sep 2026 ("Questions put to Vince and his answers" below, each with
its time); two points the round did not put to him (open questions 7 and 8) stay open
for r14 or follow-up work, and no phase waits on them.
This section replaces the one that recorded the draft critic's rounds and left round
10 pending.

### Background — the draft critic, rounds 1–5

The critic reviewed the draft in five rounds, against PLX_MC `fc7ceef3d123` and portal
`2b656d8adf33`. Rounds 1–4 returned six blockers. The author applied all six, each as
the critic proposed or one step further, and re-checked the evidence for each. Round 5
approved the draft with no blockers. The draft's `CHANGES.md` (section 18) holds the
full text of each blocker and each fix. TASK-2088 committed the approved draft to
PLX_MC `docs/specs/` as PR #260.

Author verification of the draft rounds: after each round, the author re-checked the
cited evidence at the heads above, and every fenced `bash` block passed `bash -n`.
Before each set of edits, the documented diff command reproduced the previous
`r13.diff` byte for byte; each edit replaced one exact, unique anchor. The new P14
acceptance was dry-run with a synthetic `brain-register.md`: it passed on the three
good forms and failed, on the intended check, on six bad ones.

The landing review. Before #260 merged, a landing review of head `8ed919f5e59f` made one
more commit on the PR (`f96a92c468d1`, "record the r13 yes and correct the landing
defects", 2026-09-29T21:28:12Z, by a Cursor agent for TASK-2088), and #260 merged as
`697373e00719` at 2026-09-29T21:42:13Z. That edit set `r13_yes` and `d5_r13_yes` from
Vince's answer, kept `round_10` pending, copied the draft's section-16 questions into the
spec ("Questions left after the r13 yes"), and announced an `RR10-` prefix for round
10's findings. Its corrections, each re-checked by the author at the pins, stand in the
round-10 text: `fc7ceef3d123` and `2b656d8adf33` are pins, not claims about `origin/main`
or `origin/staging`; the generator test pin is `:49-55`; F23 names
`compliance-gate.yml:77`; F14 cites `prompts/workbench-readonly-build-prompt.md:359` and
`tasks/lessons.md:15` at `2b656d8adf33`; F10 cites `mc-quality-ledger.yml:20-33`; the
auto-merge merge-queue section is `:125-144`; the 409 message names no holder; D4's two
readings are the re-derived default (Vince confirmed them all the same); the portal's
three-trigger wording is true until P16 regenerates the workflow; the P16 portal
acceptance rejects "A body-only edit does not re-run the gate" and "Until TASK-2011 is
live" and requires the `max_entries_to_merge` row to keep `1`; the P4 same-holder case
sets an expiry longer than the copied 60-minute mock; the `vitest list` checks read the
`it` title (the last ` > ` segment); and three portal lines outside `.cursor/rules/`
(`.cursor/skills/mc-sync/SKILL.md:49-50`, `docs/runbooks/CONTRIBUTING.md:262-263`,
`CLAUDE.md:106`, at `2b656d8adf33`) join the residual risks. The round-10 text names the
blind round's findings by critic (`R10-d13-code-<n>`, `R10-retirement-s10-<n>`,
`R10-gates-acceptance-<n>`), which also does not collide with the draft critic's R10-1
to R10-6, so the `RR10-` prefix is not used.

Main after the round. PLX_MC `main` gained #262 (TASK-2111, `5658c055bccc`, "name a
deleted task and an expired checkout", merged 2026-09-29T22:09:53Z) after the round's
packet was cut and before the eighth revision's files were written (22:16-22:18Z). #263
(TASK-2112, `7f79712657e3`, "require a real PRD link on high-risk work") followed at
22:22:59Z, after the eighth revision.
#262 changed `src/lib/compliance/service.ts` (28 lines after `:107`: a
`CheckoutBlockReason` type, `CHECKOUT_BLOCK_TEXT` and `checkoutBlockReason`; one more
line in `resolveDispatchForOpenPr`, where a missing task blocks as `task_deleted`; two
more in `verifyPr`, whose loop maps every block reason to a text, so a released stamp
blocks as `checkout released — re-checkout the task`) and `tests/compliance-server.test.ts`
(18 lines in the TASK-2011 block: the `it.each` table now holds the texts, and a case
`names a deleted task on a live checkout`). #263 changed the test file again (33 lines: a
`bucketsThrow` flag, a throwing `getBuckets` mock, three `beforeEach` lines and three
cases in the verifyPr `describe`), `src/lib/compliance/bucket-prd.ts`, `verify.ts` and
`types.ts` (a bucket PRD counts as present only when it is an http(s) URL; a task with
no bucket blocks as `no_bucket`; a failed bucket read is advisory), and one line of
`docs/specs/frontier-implementation-spec.md` (step 8 of the code-phase contract: the
gate's messages are "high-risk change requires a linked bucket PRD" and "high-risk change
requires the task on an initiative with a linked bucket PRD"). P4 and P16 cite and edit
both compliance files, and F17 states the PRD rule, so the ninth check of the round-10
text (below) pinned every P4 and P16 code citation at `7f79712657e3` by line and by
symbol, gave the facts r13 re-derived their `fc7ceef3d123` pin and the `7f79712657e3`
position of each function that moved, corrected F17, D11 and the P16 released-stamp case
to that code, and folded #263's spec line into the round-10 text, so the round-10 PR
reverts none of #263.

| Round | Date | Blockers | Nits | Verdict |
|---|---|---|---|---|
| 1 | 28 Sep 2026 | 2 (R10-1, R10-2) | 13 | changes needed |
| 2 | 28 Sep 2026 | 2 (R10-3, R10-4) | 11 | changes needed |
| 3 | 29 Sep 2026 | 1 (R10-5) | 13 | changes needed |
| 4 | 29 Sep 2026 | 1 (R10-6) | none recorded | changes needed |
| 5 | 29 Sep 2026 | 0 | none recorded | approved |

| ID | Sev | Round | Area | Finding | Fix in r13 |
|---|---|---|---|---|---|
| R10-1 | B | 1 | D5, P14 | r13 changed an approved default (D5) and P14's gate, template and acceptance. Nothing put the change to Vince, and round 10 covered only P4, P15 and P16. | Round 10's scope adds D5, D14, F26, P13 and P14. D5 needs Vince's yes. P14 records that yes in `brain-register.md`, and its acceptance checks it. |
| R10-2 | B | 1 | P16 portal | The rewrite of the `edited` lines in `mc-compliance.mdc` runs after P10 trims that file to its cap. The portal acceptance re-ran no cap or needle check. | The portal acceptance requires `cap: met repo: petralabx/plx-customer-portal` in `guide-trim.md`, runs `measure.py --check-caps --check-needles`, checks that the slice is at most 2457 bytes, and runs P10's `carrier` loop over the rules the PR edits. |
| R10-3 | B | 2 | P4 | `grep -qi 'released'` on the lease test matched the mocked-repo pattern alone. No check proved that the lease query filters released stamps. | A case titled `released stamp frees the lease`, read from `npx vitest list`. A diff check requires `repo.ts` to add a line with `released_at IS NULL`. |
| R10-4 | B | 2 | P16 PLX_MC | `grep -q 'loadPrState'` matched the hoisted mock. A resolver that made the GitHub read in `merge_group` mode passed. | Two `merge_group` cases with fixed titles assert that `loadPrState` is not called. The acceptance reads both titles and at least 6 `merge_group` titles from `npx vitest list`, and requires the assertion in the file. |
| R10-5 | B | 3 | P14, D5 | The acceptance tied the D5 phrase to `spec_revision` (`D5 as $REV`), but the gate gave Vince the literal `D5 as r13`. A yes given against r14 would fail. | One fixed phrase, `D5 as r13`, given once: in a yes on r13 or in the P14 later yes. P14 records `d5_confirmed`, `d5_confirmed_at` and `d5_confirmed_in` and checks them as fixed lines. |
| R10-6 | B | 4 | P15, P16 | The draft did not say plainly whether P15 runs again under r13. P16's check `! grep -qx 'pr255: open'` passed on the r12 P15 run, which has no `gate_pr_types` line. | An r12 run of P15 does not satisfy r13, so P15 runs again under r13 before P16. The P16 PLX_MC acceptance reads `gate_pr_types: opened, synchronize, reopened, edited` and `pr255: merged f6d2bab7670a` from `merge-queue-audit.md`. |

The author also changed the header in rounds 3 and 4, so that r13 did not read as
approved before Vince answered.

Nits. The draft critic's rounds 1-3 returned 37 nits (13, 11 and 13; rounds 4 and 5
recorded none). Their texts are in the orchestrator store (`wave0-result.json`,
`r13.rounds[0..2].nits`), and each has a disposition here: 3 came back as blockers and
closed there (R10-3, R10-5, R10-6), 31 are applied (in the draft's rounds, in the
round-10 text, or by the ninth check of that text, marked "ninth check"), and 3 are
closed without a change, with the reason. None is left for r14. An earlier form of this
section said that the 22 round-1 and round-2 nits that did not come back as blockers had
no recorded text and stayed for r14; the texts were in the store, and the ninth check
dispositioned them.

| Round | Nit | Topic | Disposition |
|---|---|---|---|
| 1 | 1 | F14 says 19778 bytes; the slice is 19795 at `2b656d8adf33` (TASK-2037) | Applied: F14 names both counts and the commit, and the P10 cap table's "At the F7 heads" column was right (same as round-3 nit 7). |
| 1 | 2 | `.cursor/skills/mc-sync/SKILL.md:49` becomes false after P16 | Applied: it is in the residual risks with two more lines the landing review found, and open question 7's follow-up covers them. |
| 1 | 3 | The P16 portal wording check reads only `.cursor/rules/`; P10 could move the lines elsewhere | Closed without change: P10 moves rule text only into description-only or path-scoped rules, all under `.cursor/rules/` (its "what moves" rule, from C3-M5), and its acceptance fails if `.cursor/skills` changed, so the check over `git ls-files -- .cursor/rules` covers every place P10 can move the lines; lines outside are residual risk (nit 2). |
| 1 | 4 | `grep -qi 'released'` on the lease test | Came back as blocker R10-3 (round 2); closed above. |
| 1 | 5 | Nothing proves that round 10 ran | Applied: R10-gates-acceptance-1 (`round_10_done_at`, read from the execution copy and checked against `main`; `later_yes_at` later than it). |
| 1 | 6 | `status: approved` beside a draft revision line | Applied in draft rounds 3 and 4 (the header read as pending); moot since the yes. |
| 1 | 7 | `r7_host_live_at` names R7 | Applied: the key is `brain_host_live_at`, set from the pre-check (R10-retirement-s10-1). |
| 1 | 8 | No stop when no brain key is issued; a `brn_` label trips the key-material grep | Applied (ninth check): the P14 stop rule names a missing key; step 4 and the template say the label never starts with `brn_`; the grep is `brn_[A-Za-z0-9_-]{6,}` (R10-retirement-s10-7). |
| 1 | 9 | P14 needs a key "R7 issues" | Applied: R4 accepts and R5 holds the key; the operator adds it by R5's procedure without waiting for R7 (R10-retirement-s10-4; same as round-3 nit 3). |
| 1 | 10 | The P13 bullet names R6, R6a and R7, not R4 | Applied (ninth check): the bullet names R4's key check; the template's `moves_to` line already named R4. |
| 1 | 11 | R7's portal PR also edits `.cursor/skills/session-brain/SKILL.md:47` and `portal/.env.example:222` | Closed without change: P10 portal owns `.cursor/rules/**` and the root guides, not `.cursor/skills/**` ("Do not touch `.cursor/skills/`"; its acceptance fails if they change), and no frontier phase owns `portal/.env.example`, so neither file is an overlap. |
| 1 | 12 | D4 and F11 call the queue rule "stricter" | Applied (ninth check): F11 and the Risks bullet say "narrower, not a subset", and say what the rule does not test. |
| 1 | 13 | The reopen risk holds only for an uncompleted stamp | Applied: D2 and the P4 contract say so (R10-d13-code-3); the Risks bullet says so since the ninth check. |
| 2 | 1 | The r12 bullet says the address comes from R7 | Applied: "R6a (r13; R7 in r12)" (R10-retirement-s10-5). |
| 2 | 2 | Rename `r7_host_live_at` | Applied: `brain_host_live_at` in the template and the acceptance. |
| 2 | 3 | `D5 as r13` in the gate, `D5 as $REV` in the acceptance | Came back as blocker R10-5 (round 3); closed above. |
| 2 | 4 | D2 versus `SYSTEM_OF_RECORD.md:45-51` (an open PR's stamp does not expire) | Applied: D2 and the P4 contract say that an expired stamp on an open PR still passes verify but holds no lease (R10-d13-code-3; same as round-3 nit 1). |
| 2 | 5 | The slash form `opened/synchronize/reopened` escapes the regex | Applied: the check rejects the slash list in any spelling (R10-gates-acceptance-6). |
| 2 | 6 | `cap: met` shows that P10's acceptance passed, not that its PR merged | Applied (ninth check): the P16 `depends_on` says so, and that this half's cap and slice re-run on a branch from `staging` fails on an unmerged P10. |
| 2 | 7 | No evidence records that round 10 finished | Applied: as round-1 nit 5. |
| 2 | 8 | The replaced `pull_request` case has no `merge_group` in its name | Applied (ninth check): its `it` title also contains `merge_group`, so it counts toward the title floor. |
| 2 | 9 | Runbook `:344` becomes false after P16 | Came back as R10-d13-code-8; applied. |
| 2 | 10 | `sort -u` in the P16 portal carrier loop | Closed without change: when the PR edits `mc-compliance.mdc`, the loop runs a read-only check twice on that file, which changes nothing; a style change to a bash block is not made for it. |
| 2 | 11 | The draft-folder README understates round 10's scope | Applied: `docs/specs/README.md` states the full scope; the draft folder in the store is a record, not in the repo (same as round-3 nit 13). |
| 3 | 1 | D2's lease versus #255's open-PR rule | Applied: as round-2 nit 4 (R10-d13-code-3). |
| 3 | 2 | Two approval forms for D5 | Closed with R10-5: one fixed phrase, `D5 as r13`. |
| 3 | 3 | The key can come from `BRAIN_API_KEYS` before R7 | Applied in r13 (draft round 4), then R10-retirement-s10-4. |
| 3 | 4 | Retirement R7's Team MCP step overlaps P14 | Applied in r13 (the Scheduling bullet), then R10-gates-acceptance-4 and retirement r13. |
| 3 | 5 | F25 and Stage 0 cite retirement r2 and r4 §8 | Applied: F25's evidence cites r12 §8 at PLX_MC `fc7ceef3d123` (R0 `:169`, R1 `:198`, T3 `:818`, S7 `:936`); the r2 mentions date the decision of 28 Sep 2026 and stay. |
| 3 | 6 | F23 could also cite `.github/workflows/compliance-gate.yml:77` | Applied: F23 names the generated copy of the shim comment. |
| 3 | 7 | F14's byte count and prompt line | Applied: as round-1 nit 1; the slice is 19778 bytes at the F7 head `b75477d9c85d` and 19795 at `2b656d8adf33` (TASK-2037, `d164a52f4`), unchanged through `b12dc09e396c`. |
| 3 | 8 | May a null `eventName` claim enter `merge_group` mode | Applied: no. The P16 route text and a test say so: the binding requires `event` to equal `claims.eventName`, so with no claim `merge_group` matches nothing, and a missing or `pull_request` event keeps today's `route.ts:88-90` behavior (unchanged at `7f79712657e3`). R10-d13-code-9 (`VerifyPrInput` and the check row) did not answer this nit. |
| 3 | 9 | Must an r12 P15 run be repeated | Came back as blocker R10-6 (round 4); closed above. |
| 3 | 10 | What closes Q4 (the two D4 refinements) | Applied: only Vince could confirm a reading of D4, so Q4 went to him as item 4 of open question 5 below; he accepted it at 2026-09-29T19:55:37Z and confirmed the reading at 20:03:53Z (no `loadPrState` in `merge_group` mode; a released stamp blocks there), and D4 records it. |
| 3 | 11 | `r7_host_live_at` is a historical name | Applied: renamed `brain_host_live_at` in the template and the acceptance. |
| 3 | 12 | `auto-merge-after-push.mdc:127` says three required checks; four since TASK-2037 | Applied: the P16 portal half, which owns that section (`:125-144` at `2b656d8adf33`), writes four, and the acceptance rejects "three required checks". |
| 3 | 13 | The draft-folder README says round 10 covers only P4, P15 and P16 | Applied: as round-2 nit 11. |

### The blind round — three critics on the r13 changes, then author verification

Verdict: **0 blockers, 8 majors, 19 minors** across three critics (`d13-code`: the D13
work, P4, P15 and P16; `retirement-s10`: the retirement section-10 work, D5, D14, F26,
P13 and P14; `gates-acceptance`: the gates and every acceptance block). A fourth blind
pass (Codex, on the same packet) returned no finding. The author verified all 27
findings on the build host against PLX_MC `fc7ceef3d123` (`main` has since moved:
#259, merged 2026-09-29T18:48:26Z as `20fc262c95eb`, added `sp_mcp_agent_runner` to
`MCP_AGENT_SERVICE_PRINCIPAL_IDS` in `src/lib/permissions/types.ts`, the array the P4
tests pointer cites at `:131-138` at `fc7ceef3d123`; #261, merged 2026-09-29T21:24:23Z
as `25ff88b7234b`, added `sp_mcp_portal` to that array (`:138-147` at `25ff88b7234b`,
unchanged on `main` through `7f79712657e3`) and gave it
a least-privilege grant in `SERVICE_GRANTS` in `src/lib/permissions/grants.ts`, which P4
also cites; so the P4 pointer cites both files by symbol at `fc7ceef3d123`; neither PR
touches another file P4, P15 or P16 cite, nor `docs/specs`; #260, this spec's r13, merged
2026-09-29T21:42:13Z as `697373e00719` and changed only `docs/specs`; #262, TASK-2111,
merged 2026-09-29T22:09:53Z as `5658c055bccc` after the round's packet was cut, changed
`src/lib/compliance/service.ts` and `tests/compliance-server.test.ts`, which P4 and P16
cite and edit, so the ninth check of this text pinned every P4 and P16 code citation at
`7f79712657e3` by line and by symbol; #263, TASK-2112, merged 22:22:59Z as
`7f79712657e3`, changed the test file again, the bucket-PRD check that F17 states, and
one line of the spec on `main`, all folded in by the same check), portal
`2b656d8adf33`, `bc1272941c35` and `b12dc09e396c` (the cited lines are unchanged, except
`docs/runbooks/CONTRIBUTING.md`, pinned at `2b656d8adf33`), agentic-swarm `b1117811cbd7`,
plx_secondbrain `af0b3ea3c9f8` (then `a5febed32ac7`; the cited files unchanged), the
retirement spec at PLX_MC `fc7ceef3d123`, and the r12 P15 evidence in the store.
**All 27 hold: 27 accepted, 0 rejected.** 22 fixes are in the r13 text in full: as the
critic proposed, one step further, or one of the critic's two options (R10-d13-code-4
took the second option, and Vince confirmed it at 2026-09-29T19:50:13Z: the 409 message
names the expiry only). Five were applied in part. For three, the rest went to Vince as an
open question, and he answered the same day, which closes them:
R10-gates-acceptance-2 (open question 6, "stand under r13", 2026-09-29T19:54:30Z: the
round-10 gate, `depends_on`, stop-rule and `owns` changes stand under the yes on r13),
R10-gates-acceptance-3 (open question 2, "wait for P10", 2026-09-29T19:55:37Z) and
R10-gates-acceptance-4 (open question 3, "yes", 2026-09-29T19:54:30Z: retirement r13
amends R7). The merged pair R10-retirement-s10-2 with R10-gates-acceptance-5 stays
applied in part: the brain's log carries only what retirement R4 promises, a key tier
per request, so P14's acceptance pins no more than that, and open question 8 (a fixed
log wording in R4) was not put to Vince and stays open for r14 or follow-up work; P14
does not wait on it.
Vince also answered open questions 1, 4 and 5 (below). No default changed. Duplicates
were merged: R10-retirement-s10-2 with R10-gates-acceptance-5 (the brain's own proof of the
key tier); R10-retirement-s10-8 with the P14 part of R10-gates-acceptance-1 (the
header cross-check); R10-d13-code-1 with R10-gates-acceptance-9 and the P15 part of
R10-gates-acceptance-1 (the P15 re-run); R10-retirement-s10-3 with the header part of
R10-gates-acceptance-10 (the void variants and `d5_r13_yes`).

| ID | Sev | Area | Finding (verified) | Evidence re-checked | Fix in r13 (round 10) |
|---|---|---|---|---|---|
| R10-d13-code-1 | M | P15, P16, D13, SC-13 | Nothing proved that P15 ran again under r13: the template pre-fills the two fixed lines the acceptance checks, so an r12 file with them appended passes P15 and the P16 PLX_MC acceptance, and P15's gate line still said "first yes". | r13 `:1088-1089`, `:1109-1110`, `:1169-1170`, `:1054-1055`; the r12 run in the store already carries `pr255: merged f6d2bab7670a` (`:51`) and `spec_revision: r12` (`:3`). | The P15 template gains `spec_revision`, `plx_mc_sha` and `audited_at`, and quotes `NAME_AND_PR_TRIGGER` under `## raw`. The acceptance checks `spec_revision` r13+, `plx_mc_sha` descends from `fc7ceef3d123`, the generator at that SHA carries the four types, the raw quote, and `audited_at` later than the header's `r13_yes_at` and `round_10_done_at` (read from the spec on PLX_MC `main`). The P16 PLX_MC acceptance reads `spec_revision` and `audited_at` from `merge-queue-audit.md`. The P15 gate and `depends_on` lines say the re-run waits for the yes and for `round_10_done_at`. Dry run: the real r12 file with `gate_pr_types` appended now fails. |
| R10-d13-code-2 | m | P4 (D2 repo match) | The lease called the two-argument `dispatchRepoMatches`, which compares bare names only, so `evil/PLX_MC` would hold the lease for `petralabx/PLX_MC`. | `service.ts:89-106` (full binding only when the third argument has `/`); `checkout/route.ts:13` (free `repo` string); `compliance-server.test.ts:360-380`; all at `fc7ceef3d123` (the first two unchanged at `7f79712657e3`; the test is `:383-403` there). | P4 calls `dispatchRepoMatches(row.repo, input.repo, input.repo)`, D2 says how repos compare, and a new lease case `another owner mints a new stamp` is read from `npx vitest list`. |
| R10-d13-code-3 | m | D2, P4 | D2 did not say that the lease ends at complete or the TTL, that release and reopen matter only for an uncompleted stamp, or that an expired stamp on an open PR holds no lease. | Contract steps 6–7; `SYSTEM_OF_RECORD.md:45-46`; the P4 SQL `expires_at > now()`. | D2 and the P4 contract say all three; the released-stamp test stays. |
| R10-d13-code-4 | m | P4 409 message | The 409 message does not name the holder, but the reopen risk bullet and contract step 2.8 said it does. | r13 `:523`, `:1243`, `:284`; r12 had the same message and step, so the risk bullet introduced the claim. | Applied, the second option: the risk bullet and step 2.8 say the message names the task, repo and expiry, and that the holder is on the stamp's oldest `checkout` event in Mission Control; the message is unchanged. Vince confirmed it at 2026-09-29T19:50:13Z ("expiry only"; store `approvals.md`, `round10_oq1_answer`), which closes open question 1; step 2.8 and the risk bullet record the answer. |
| R10-d13-code-5 | m | P4 tests pointer | `:13-70` copies too little: `checkout()` needs the sync mocks and the github-pr mock, and two holders need `actor` objects that pass `authorizeStaged`. | `service.ts:44,199-213,222,225`; `compliance-server.test.ts:10-11,72-94`; `enforcement.ts:213`; `grants.ts:51-72` and `types.ts:131-138`, all at `fc7ceef3d123`; no checkout test passes an actor. | P4 cites `:10-137` at `fc7ceef3d123`, names the four factories, `taskish` and the root `beforeEach`, and gives the holders as service actors (`sp_mcp_codex`, `sp_mcp_cursor`) or null, citing `MCP_AGENT_CAPABILITIES` and `SERVICE_GRANTS` in `grants.ts` and `MCP_AGENT_SERVICE_PRINCIPAL_IDS` in `types.ts` by symbol at `fc7ceef3d123`, because #259 moved the `types.ts` lines (it added `sp_mcp_agent_runner`) and #261 (merged 2026-09-29T21:24:23Z as `25ff88b7234b`) edited both files again: it added `sp_mcp_portal` to the array (`:138-147` at `25ff88b7234b`, unchanged on `main` at `697373e00719`) and gave that principal a least-privilege grant in `SERVICE_GRANTS` (`PORTAL_MCP_CAPABILITIES`, `task.read` and `task.create` only, CG-07b), so `sp_mcp_codex` and `sp_mcp_cursor` still carry `MCP_AGENT_CAPABILITIES` and are valid holders, and `sp_mcp_portal` is not; P4 says so (the fifth check of the round-10 text caught the bare range; the seventh caught the text that still called #261 open). The same P4 bullet carries the landing review's note on the copied `insertDispatch` mock (`:44-45` at `fc7ceef3d123`: a 60-minute expiry, so the same-holder case sets a longer one). The ninth check re-pinned every P4 code citation at `7f79712657e3`, after #262 and #263 (the pattern is `:10-142` there; `getEntity` `service.ts:251`, `patchTask` `:254`, `authorizeStaged` `:228-242`). |
| R10-d13-code-6 | m | P16 tests citations | The line citations into `compliance-server.test.ts` move if P4 (which edits that file's factory) runs first, and `:10-104` leaves out `taskish` and the `beforeEach`. | `:106-126`, `:128-137`; P4 owns the `vi.mock` factories. | P16 cites `:10-137` at `fc7ceef3d123` and names each cited item by symbol (the `eventTaskIdByDedupKey` mock, the root `beforeEach`, the TASK-2011 `describe`); since the ninth check the pin is `7f79712657e3` (`:10-142`, `:42-44`, `:130-142`, `:144-274`), after #262 and #263 moved those lines. |
| R10-d13-code-7 | m | P16 portal acceptance | Nothing checked that the TASK-2008 test edit stayed in scope: a builder could delete the preflight, build or ledger assertions and still pass. | `ci-staged-gate.test.mjs:907-955`; the block ran only `node --test`. Four of the first 22 pins repeated elsewhere in the file (`EVENT_NAME" = "merge_group"` at `:916` and inside `:920`; `/18632985/` at `:937` and `:951`; `/petralabx\/PLX_MC/` at `:694` and `:942`; `"Current set"` at `:522`, `:608`, `:671` and `:953`), so deleting those assertions passed. | The acceptance greps 33 fixed fragments of the assertions that must survive (the three unchanged `required` rows `:873` and `:875-876`, the loop `:878-887`, `:891`, `:897`, `:907-925`, `:933-934`, `:936-942`, `:944`, `:946-955`), each unique in the file at `2b656d8adf33`: the four repeated ones are anchored to their subject (`preflight, /EVENT_NAME" = "merge_group"/`, `protection, /18632985/`, `protection, /petralabx\/PLX_MC/`, the `autoMerge.slice(…"Current set"…"Reporting-only")` line). A first round-10 text pinned only `:907-955`, so the `required` rows (the `workbench-api.yml` row the edit list says to keep) and the loop assertions `:881-887` were unguarded; the third check of the text caught it. The block also requires the seven fragments the edit writes (the re-pointed row, the inverted trigger assertion, the three `assert.match(generated, …)` lines, the runbook pin on the new `GEN_SHA` and `/plx-mc-compliance\.yml/`) and rejects the stopgap row, `queueTrigger`, `/gh pr view/` and the old `GEN_SHA`. Dry run on the build host: the unedited file fails; a builder's edit made exactly as the list says passes; deleting the `:873`, `:876`, `:881`, `:887`, `:891`, `:897`, `:914`, `:916`, `:937`, `:942` or `:952-955` assertion from the edited file fails. |
| R10-d13-code-8 | m | P16 portal runbook | Runbook `:344` ("compliance uses [squash subjects] to find every PR in the group") becomes false after P16 and was not in the list of lines to change. | `BRANCH-PROTECTION-STAGING.md:344`; `ci-staged-gate.test.mjs:938` pins `/Squash/`. | `:344` is in the list, with the `Squash` word kept; the acceptance rejects "to find every PR in the group". |
| R10-d13-code-9 | m | P16 ownership | `event` has to be added to `VerifyPrInput`, and a `merge_group` verify overwrites the check row for the same head; P16 owned neither. | `service.ts:328-338,68-70,1010-1023`; `repo.ts:340-348`; at `fc7ceef3d123` (`VerifyPrInput` `:357-367` and `verifyPrOrQueue` `:1041-1054` at `7f79712657e3`; `:68-70` and `repo.ts` unchanged). | P16's `owns` names `VerifyPrInput` beside `verifyPr` in `service.ts`. That is an `owns` change: the type is outside the region r13 named (`verifyPr` and stamp resolution), although r13 already required `verifyPr` to take `event`, which changes the type. It is written in the text so that the builder owns what the approved text changes, and it went to Vince as open question 9 (the table below lists it); he confirmed it under the yes on r13 at 2026-09-29T19:54:30Z, with open question 6. The service bullet says the queued input carries `event`, that the check row is replaced, and that the gate event dedups on the pass key. |
| R10-retirement-s10-1 | M | P14 steps, stop rule | No step ran `brain_self_check` at `BRAIN_URL` before registration; `brain_host_live_at` had no source; R6a tests only `agent/status` and `/api/health`; the MCP route has its own auth path against `VMC_API_KEY`, which the brain never holds. | swarm `mcp-http-auth.ts:56-71` at `b1117811cbd7`; `api/api-handler.ts:201,261`; `mcp/route.ts:46-49` (stateless, JSON); retirement R4 `env.names` (`:283`), R6a acceptance (`:491-494`). | New step 2: a pre-check from an operator machine (never the brain host, never a trading host) with the brain key; `precheck_at`, `precheck: ok`; `brain_host_live_at` from it; a 401 stops P14 with the cause named. The acceptance checks both lines. |
| R10-retirement-s10-2 (merged with R10-gates-acceptance-5) | M | P14 acceptance, D5 proof | `key_kind: brain` is a line anyone can write, and until R11 a VMC key works at `BRAIN_URL`; the retirement spec's key-tier log can prove the choice and P14 did not use it. | Retirement R4 `:303-304` (every request logs its key tier), `:274-275` and R11 `:743-746` (VMC hash accepted until R11); `mcp-http-tools.ts:242-262` (`apiKey: "ok"`, no source). | **Applied in part.** New step 6: the operator copies the brain service log off the brain host (as R6a does), identifies the step-5 self-check's line in the window after `registered_at`, records `self_check_log_at` and `self_check_key_tier: brain`, and pastes the line beneath `### brain log line (step 6)` under `## raw`; `X-Agent-Name: plx-brain` is required. The acceptance checks the typed lines and the time order, requires at least one pasted line beneath that heading, rejects the template placeholder, and rejects the VMC and scoped tier names in it (`vmc_api_key`, `legacy`, `scoped`, `dept`; swarm `docs/knowledge-os/KEY_TIERS.md` names the tiers "Legacy (unscoped)" and "Department-scoped"). It pins no other wording: R4 (`:303-304`) promises only that each request logs its key tier, not the agent name or the tool name; the swarm route the service copies writes no request line (`mcp/route.ts:35` logs unhandled errors only), and `mcp-http-auth.ts:37-43` reads `X-Agent-Name` into an identity whose default actor is also `plx-brain` (`:43`), so a `plx-brain` token would not tell the registration's request from any other. A first round-10 text pinned `brain_self_check` and `plx-brain` in the line, which the third check of the text caught. Not applied (open question 8, open for r14 or follow-up work; no phase waits on it): the critics' pinned proofs (a `key_tier_seen` line for the `plx-brain` `brain_self_check` request; a label tied to `key_name`; a key source in the `brain_self_check` result) each need a fixed log wording or a result field, which is retirement R4 code. The proposed `vmc_key_tier_requests_since_registration: 0` is not applied either: callers still on the old host reach the brain through the R6 block with VMC-tier keys until R7 moves them, so a zero count is not P14's to prove, and the window's other lines are not checked. |
| R10-retirement-s10-3 | m | header, r13 question | The variant `yes r13, except D5: as r12` would register a VMC key at the brain's own name, which retirement D3, R7 and section 10 forbid; moot after Vince's answer, but still offered. | r13 `:9`, `:1363-1364`; retirement D3 `:115`, R7 `:506-507`, section 10 `:987-988`. | The header and the r13 question mark both variants void by the answer of 2026-09-29T18:09:35Z and say why the second was never safe. |
| R10-retirement-s10-4 | m | F26, P14 depends_on, D5 Why | F26 and P14 said R4 creates `BRAIN_API_KEYS`; R4 only accepts it and R5 holds it in `prod/plx-brain`. P14 gave no procedure for adding the key and no rule for where it is made. D5's Why cited F26 for the hashes, which D3 and R5 state. | Retirement R4 `:274-275`, R5 `:401-408` and its change procedure `:428-429`, R6a `:494`. | F26 and P14 say "R4 accepts and R5 holds"; P14 points at R5's change procedure and says the operator makes the key off the brain host and off every trading host; D5's Why cites retirement D3 and R5. |
| R10-retirement-s10-5 | m | P13 r13 line; `:51-52` | The P13 template and acceptance do not check the R6a fact, an r12 run records the R7 wording, and `:51-52` still said the address comes from R7. | r13 `:969-971`, `:980`, `:51-52`. | The P13 r13 line says P14 takes the address from D14, never from `brain-audit.md`, so an r12 run is harmless; `:51-52` reads "R6a (r13; R7 in r12)". |
| R10-retirement-s10-6 | m | SC-8, P14 step | SC-8 pointed at the runbook's name and headers, but the runbook's auth and URL rows name VMC keys and the old host, and no phase edits it. | swarm `docs/runbooks/brain-mcp.md:17,32-36` at `b1117811cbd7`; SC-12; the R7 PR list. | SC-8, the scope line, P14 step 4 and the P14 stop rule say that P14 takes four rows from the runbook, the server name (`:32`) and the three header names (`:34`, `:35`, `:36`), and nothing else; the URL comes from D14 and the key value from D5. The stop rule turns on those four rows. Row `:34` holds both the header name `X-API-Key`, which P14 takes, and a VMC key value, which D5 supersedes: the name counts for the stop rule, and the value does not. The URL row `:33` and the auth row `:17` are superseded for P14 and do not count; every row stays unedited (SC-12). A first round-10 text put the statement in SC-8 and the scope line only, and left P14's own steps and its stop rule ("if the runbook table is missing") without it; the fifth check of the text caught that. The fifth revision then listed `:34` both among the rows that count and among the superseded rows that do not, and this row said "the two rows P14 takes"; the eighth check caught both, and the stop rule, step 4, SC-8 and this row now read as above. |
| R10-retirement-s10-7 | m | P14 evidence | `key_name` labels have no anchor in `BRAIN_API_KEYS`; the key-material grep misses a `brn_` key with `_` or `-` early; `service_commit` had no source and no check. | Retirement R5 `:407-408`, R4 `:303-304`; r13 `:1044-1046`; plx_secondbrain `af0b3ea` has no `service/`. | `key_sha256_prefix` (first 12 hex of sha256, computed off the brain and trading hosts); the grep is `brn_[A-Za-z0-9_-]{6,}`; `service_commit` comes from the brain's own `/api/health` when it reports a commit (R4 does not say that it does; a first draft cited B13, which is VMC's route on the old host, and the second check removed that) or from the host's checkout, and must be an ancestor of plx_secondbrain `origin/main`. |
| R10-retirement-s10-8 (merged with the P14 part of R10-gates-acceptance-1) | m | P14 acceptance | With `d5_confirmed_in: yes on r13`, nothing tied the evidence to the header's answer. | r13 `:1041-1042`. | When the evidence says `yes on r<n>`, the acceptance reads `d5_r13_yes` from the spec on PLX_MC `main`, requires the phrase and requires `d5_confirmed_at` to equal its time. |
| R10-gates-acceptance-1 | M | header; P4, P15, P16, P14 acceptance; SC-13 | No acceptance checked the r13 gates: a run made from the draft before the yes or before round 10 passed, and P4 and P16 recorded no later yes. | r13 `:566`, `:1172`, `:1110`, `:1038-1042`, `:7-12`, `:1292-1295`. | The header records `r13_yes_at`; `round_10_done_at` is the time the round-10 text merged to PLX_MC `main` (an author's edit time would let a later yes count against text a failed check could still change), and the orchestrator sets it in its execution copy after the merge, the copy that holds the approval fields (README), so no second PR is needed. The P4 code branch, P15, both P16 halves and P14 read `r13_yes`, `round_10` and `r13_yes_at` from the spec on PLX_MC `main`, derive the merge time from `main`'s first-parent history (the first commit that carries the `round_10` line; its committer time in UTC, which can differ from GitHub's `mergedAt` by a second), fail while `r13_yes` or `round_10` is pending or the execution copy's `round_10_done_at` is not set or differs from that time, and require `later_yes_at` (P4, P16, P14) or `audited_at` (P15) later than both times. `lease-closeout.md` and `merge-group.md` gain `later_yes` and `later_yes_at`. Dry run: the pending line fails with its own message; a later yes at 2026-09-29T18:14:39Z fails against a set time; the derivation picks the merge commit's time on a merge-commit and on a squash history and rejects the branch commit's time (second revision). |
| R10-gates-acceptance-2 | M | header; r13 question | Vince's yes named no revision SHA and came before round 10; the spec did not say whether it covers round-10 fixes. | `approvals.md` in the store (yes at 18:09:35Z against #260 head `8ed919f5e59f`); r13 `:10`, `:147-150`, `:1368-1371`. | **Applied in part; the rest closed on Vince's answer (open question 6).** `r13_yes` records the head and the time, as proposed. The coverage rule was not the critic's. The critic sends every fix that changes a gate, `depends_on`, `owns` or `forbidden` to r14, and round 10 had made changes to such lines (the table below), so the author wrote a narrower reading: a fix stands under the yes when it tightens an acceptance check, corrects a citation or a fact, adds an evidence line or a stop condition, or restates SC-13 or the header in a phase's own gate or `depends_on` lines; a fix that would change a default, let a phase start earlier or on fewer conditions, change `owns` (a file, a region or a symbol), or narrow `forbidden` goes to Vince. Vince had stated neither rule, so the header named the reading as the author's, and open question 6 asked him to confirm it, to choose the critic's, or to send any listed line to r14. He confirmed the author's reading at 2026-09-29T19:54:30Z ("stand under r13"): every listed line, the `VerifyPrInput` `owns` change among them (open question 9), stands under the yes on r13, and no r14 is needed for them. The header now records that answer, and its rule says that such a fix goes to Vince and lands in the next revision unless he confirms it under the yes on r13, which removes the contradiction a fifth check of the text found (the rule sent an `owns` change to r14 while a plain P16 later yes counted as consent to one). A first form of the reading let a fix stand when it "names a symbol inside an owned file" while sending "a file or a region added to `owns`" to r14, and contradicted itself on `VerifyPrInput`, a type outside the region P16 owned; the fourth check of the round-10 text caught it, and that change became `owns`-level open question 9. Round 10 changed no default. Of its four such points, three went to Vince, two gate-level (open questions 2 and 3) and one `owns`-level (9), and he answered all three. The fourth, `owns`-level open question 7 (the empty-commit line in a portal rule P16 does not own), was not put to him: it stays open for r14 or follow-up work, and no phase waits on it. |
| R10-gates-acceptance-3 | M | P16 depends_on, D8 | The whole P16 portal half depends on P10 portal, which may never run (a failed canary keeps a repo out of P10, D8), and the spec gave no fallback. | r13 `:1116`, `:1197`, `:1215`, `:805`, `:816`; the r12 P16 `depends_on` (r12 `:1056`) did not name P10. | **Applied in part; the rest closed on Vince's answer (open question 2).** The text records that the half waits while P10 portal does not run, and that only Vince can change that. The finding holds: the spec had no fallback, and the proposed branch (start after P8 alone; drop the cap checks) changes a gate, so it went to Vince (open question 2; `CHANGES.md` Q3 asked the same). He answered "wait for P10" at 2026-09-29T19:55:37Z: the portal half starts only after the P8 and P10 portal PRs, as D13 states, with no after-P8-alone path; if the portal canary fails and P10 portal never runs (D8), the half stays blocked until he decides again. The P16 `depends_on`, D13, `pending_r13_changes` and the Scheduling bullet record the answer. |
| R10-gates-acceptance-4 | M | Scheduling, P14 | r13 said R7 adds no `plx-brain` entry, but the retirement spec's R7 tells its operator to update the Cursor team MCP registration; an entry made under R7 would bypass P14's gates and P14 could not detect it; Scheduling was outside the round-10 scope. | Retirement `:546-547`, B16 `:50`; r13 `:266`, `:1034-1047`, `:12`. | **Applied in part in this text; the rest closed on Vince's answer (open question 3) and is in retirement r13.** The amendment to the retirement spec went to Vince (open question 3), because that spec was outside this round's files. He answered "yes" at 2026-09-29T19:54:30Z, so retirement r13 (29 Sep 2026, in the same docs PR) amends R7: it leaves the Cursor Team MCP entry to frontier P14 and records `team_mcp: left to frontier P14` in R7's evidence, and its B16 and section 10 say the same. The Scheduling bullet cites retirement r13. New P14 step 3 records `team_mcp_plx_brain_before: none`, an existing entry stops P14, and the acceptance requires the line. The header's round-10 scope names the Scheduling bullet. |
| R10-gates-acceptance-5 | M | P14 acceptance, D5 | The key lines are typed by hand and `brain_self_check: ok` passes with a VMC key until R11, so D5 had no evidence beyond self-attestation. | As R10-retirement-s10-2. | **Applied in part**, merged into R10-retirement-s10-2: the brain's log line, checked as far as retirement R4 fixes that log. The other option (a key source in the moved service's `brain_self_check` result) and a fixed log wording are retirement R4 code, outside the frontier spec: open question 8, open for r14 or follow-up work; P14 does not wait on it. |
| R10-gates-acceptance-6 | m | P16 portal acceptance | The negative grep matched only today's exact phrasing, and never checked the empty-commit instruction. | portal `mc-compliance.mdc:128` ("Push a commit (empty is fine)"), `:130-131` (the sentence wraps after "on", and the slash list is whole on `:131`), `:304` (the bracket list; `:303-304` with "triggers on") and `:308-309` ("an empty" / "commit is enough", split across lines, so a one-line `empty commit` grep never matches it). The trigger-list wording is in no other tracked rule at `2b656d8adf33`, `bc1272941c35` or `6828ae8ff93d` (origin/staging on 29 Sep); `pr-watch-until-green.mdc:49-50` says "push a commit (empty is fine)" at each of those refs, and P16 does not own it. A first draft of this fix said that no other rule carried the wording, which was false, and rejected the empty-commit wording in every rule, so the check could not pass without an edit outside P16's `owns`; the second check of the round-10 text found it. | The acceptance reads each tracked rule with its whitespace squeezed to one space, so a phrase wrapped across lines counts. It rejects the trigger-list wording (`Do not add `edited``, `still triggers only on`, `opened/synchronize/reopened` with a space allowed at each slash, so a list wrapped at a slash or spaced around them counts (the fourth check of the round-10 text), any bracket list with `reopened` and without `edited`) in every tracked rule, as r13 did, and the empty-commit wording (`empty commit`, `commit (empty`, `empty is fine|enough`) only in `mc-compliance.mdc` and any rule that carries the fixed line "A body edit re-runs the gate (`edited`).", which it requires in a rule, wrapped or not. Dry run on all 31 rules at `6828ae8ff93d`: the real `mc-compliance.mdc` fails on its wrapped text; a builder's rewrite of it passes while `pr-watch-until-green.mdc` keeps "empty is fine" (the first form of the check failed there); the rewrite with "push an empty / commit" left in `mc-compliance.mdc` fails; the fixed line moved to another rule that still says "commit (empty" fails on that rule, and passes once it is clean. Fourth revision, on the 31 rules at `c7e796d61c00`: the real file fails; a builder's rewrite passes; the rewrite with a slash list appended fails in each of four spellings (whole, wrapped at a slash, spaced around the slashes, and followed by `/edited`, the form the bullet tells the builder to avoid); a bracket list wrapped after a comma fails; a four-type bracket list passes; the fixed line wrapped passes. |
| R10-gates-acceptance-7 | m | P16 portal acceptance | P16 edits a runbook in `INSTR_FILES` but its acceptance never ran `sweep`. | r13 `:1160`, `:1194-1224`, `:268`; Appendix B `INSTR_FILES`. | `sweep . || fail` is in the portal block; the risk bullet says so. |
| R10-gates-acceptance-8 | m | P4 acceptance | The `released_at IS NULL` grep passed on any added line, and `vitest list` was piped straight into `grep -q`. | r13 `:567-568`, `:250`. | `LL=$(npx vitest list …) || fail`, then greps on `$LL`; the body of `liveDispatchesForTask` is extracted with awk and must contain `released_at IS NULL` and `expires_at > now()`. Dry run: a comment elsewhere no longer counts. |
| R10-gates-acceptance-9 | m | P15 acceptance | `gate_pr_types` is a fixed line the orchestrator types; the acceptance never read the generator. | `generate-compliance-gate.py:62`. | The acceptance reads the generator at `plx_mc_sha` (captured first) and requires `types: [opened, synchronize, reopened, edited]`. |
| R10-gates-acceptance-10 | m | P16 generator citation; header | The pin citation stopped at `:54` (the assert is at `:55`); the header made P14 wait for `d5_r13_yes` without a rule that sets it from the P14 later yes. | `test_generate_compliance_gate.py:55`; r13 `:9`, `:1366-1369`. | All three citations read `:49-55` (a first draft left F24 at `:49-54`, which the second check caught); `d5_r13_yes` is set from Vince's answer, and the header no longer offers the variants. |

### Gate, depends_on, stop-rule and owns lines that round 10 changed

Vince's yes came before round 10 and named no rule for what it covers, so the round-10
text stated the author's reading in the header's `r13_yes` line, and this table is the
list that line refers to. Each change is of a kind that reading covers, except two `owns`
changes: the `VerifyPrInput` row, which went to Vince (open question 9), and the P16
portal `owns` row that adds the "Until TASK-2011 is live" sentence, which is Vince's own
decision (open question 5, item 2). None lets a phase start earlier, on fewer conditions
or on more files, and the later yes for P4, P16 and P14 is given against the round-10
text. Open question 6 asked Vince to
confirm the reading, to choose the critic's stricter one (every row goes to r14), or to
send any single row to r14. He confirmed the reading at 2026-09-29T19:54:30Z ("stand
under r13"): every row below, the `VerifyPrInput` row included, stands under the yes on
r13, and no r14 is needed for them. The last six rows were made after his answers: four
on those answers or on the fifth check of the text (the two that come from open question
5 are his own decisions), and two on the ninth check, each of a kind the rule in
`r13_yes` covers.

| Line | Change in round 10 | Kind |
|---|---|---|
| P4 `depends_on` | names the later yes, given after `round_10_done_at`, and its evidence lines `later_yes` and `later_yes_at` in `lease-closeout.md` | restates SC-13; evidence lines |
| P4 `owns` (evidence file) | `lease-closeout.md` gains `later_yes` and `later_yes_at` | evidence lines |
| P4 tests | a case for a same-bare-name repo under another owner | tightens acceptance |
| P15 `gate`, `depends_on` | the r13 re-run waits for the yes on r13 and for `round_10_done_at`; the r12 run's first-yes gate is unchanged | restates SC-13 and the header (the phase's own lines said "first yes" and `[]`, which R10-d13-code-1 flagged) |
| P16 `depends_on` | names the later yes, given after `round_10_done_at`, and its evidence lines; says that the portal half waits while P10 portal does not run, and that only Vince can change that | restates SC-13; records Vince's answer to open question 2 ("wait for P10", 2026-09-29T19:55:37Z) |
| P16 `owns` (PLX_MC) | `src/lib/compliance/service.ts`: `VerifyPrInput`, the input type of `verifyPr`, named beside `verifyPr` and stamp resolution; r13 already required `verifyPr` to take `event`, which changes that type | `owns` change, outside the region r13 named; put to Vince (open question 9), written in the text so the builder owns what r13 already changes; confirmed under the yes on r13 (2026-09-29T19:54:30Z) |
| P16 `owns` (evidence file) | `merge-group.md` gains `later_yes` and `later_yes_at` | evidence lines |
| P16 tests, portal edits | a case for a token with no `event_name` claim; the runbook `:344` and the auto-merge `:127` lines join the lines P16 rewrites in files it already owns | tightens acceptance; corrects facts in owned files |
| P14 `gate` | records that Vince gave `D5 as r13` in the yes on r13, so the later yes need not repeat it; the executor line names the operator machine for the pre-check and the log copy | restates the header |
| P14 `depends_on` | the existing `brain_self_check` condition is the step-2 pre-check; the key is held by R5, not created by R4; the operator makes the key off the brain and trading hosts; the Team MCP list holds no `plx-brain` entry before registration | restates a condition; corrects a citation; adds stop conditions |
| P14 stop rule | a pre-check that does not answer `ok` (a 401) or an existing `plx-brain` entry stops P14 | adds stop conditions |
| P16 `depends_on` (portal half) | records Vince's answer to open question 2: the half starts only after the P8 and P10 portal PRs, with no after-P8-alone path, and stays blocked if P10 portal never runs (D8) until he decides again | restates D13, on Vince's answer (2026-09-29T19:55:37Z) |
| P15 template and acceptance | `pr255_deployed: yes` and `pr255_deployed_source: gate0.md (GitHub deployment 6721728347, 2026-09-28T22:11:43Z)`, checked as fixed lines | evidence lines, on Vince's answer (open question 5, item 5; 2026-09-29T19:55:37Z) |
| P16 `owns` (portal) and edit list | `mc-compliance.mdc` gains the "Until TASK-2011 is live" sentence (`:137-139` at `2b656d8adf33`, or the rule P10 moved it to), which the same PR deletes; the acceptance rejects the sentence in every tracked rule, whitespace squeezed | `owns` change, on Vince's answer (open question 5, item 2; 2026-09-29T19:55:37Z, reading confirmed 20:03:53Z) |
| P14 stop rule (wording) | names the four runbook rows that count (the server name at `:32` and the header names at `:34`, `:35` and `:36` of swarm `docs/runbooks/brain-mcp.md`); the URL row `:33`, the auth row `:17` and the key value in `:34` are superseded and do not count, and the header name in `:34` does | corrects a citation (R10-retirement-s10-6; the fifth check of the text; the eighth check corrected the reading of `:34`) |
| P14 stop rule (ninth check) | a brain key not yet issued for the registration stops P14 before it starts (`depends_on` already required the key; round-1 nit 8) | adds a stop condition |
| P16 `depends_on` (portal half, wording) | says what `cap: met` in `guide-trim.md` shows (P10 portal's acceptance passed on its PR head) and that this half's cap and slice re-run on a branch from `staging` fails on an unmerged P10 (round-2 nit 6) | corrects a fact; no condition changed |

### Questions put to Vince and his answers (all on 29 Sep 2026)

Vince answered in the orchestrator chat; the orchestrator's `decisions.md` and the
store's `approvals.md` hold the record. The numbers are the ones the round-10 text
gave the questions.

1. **P4 409 message.** Asked: should `checkout_held` also name the holder? Answered
   "expiry only" at 2026-09-29T19:50:13Z (`approvals.md`, `round10_oq1_answer`). The
   message names the task, repo and expiry, as written; step 2.8 and the Risks bullet
   record the answer; R10-d13-code-4 is closed; nothing goes to r14.
2. **P16 portal half when P10 portal does not run** (`canary: fail`, D8, or P10
   declined for the portal). Asked: does the half start after the P8 portal PR alone,
   with the cap checks replaced by a no-growth check, or does the `edited` rewrite move
   to a small follow-up PR? Answered "wait for P10" at 2026-09-29T19:55:37Z: the half
   starts only after the P8 and P10 portal PRs, as D13 states, and there is no
   after-P8-alone path. If the portal canary fails and P10 portal never runs (D8), the
   half stays blocked until Vince decides again. No r14 change. The P16 `depends_on`,
   D13, the Scheduling bullet and the header record it; R10-gates-acceptance-3 is
   closed.
3. **Retirement R7 and the Team MCP entry.** Asked: amend R7 (or section 10) so that R7
   leaves the Team MCP entry to P14 and records `team_mcp: left to frontier P14`?
   Answered "yes" at 2026-09-29T19:54:30Z. Retirement r13 (29 Sep 2026) makes that
   edit to `docs/specs/swarm-retirement-spec.md` (the R7 operator step at r12
   `:546-547`, B16 at `:50` and section 10) in the same docs PR as this text, because
   both edit `docs/specs/README.md`. P14 still guards the entry itself
   (`team_mcp_plx_brain_before: none`); R10-gates-acceptance-4 is closed.
4. **The later yes for P4 and P16.** Vince gave `yes P4` and `yes P16` at
   2026-09-29T18:14:39Z, before round 10 closed and before `round_10_done_at` (the
   merge of the round-10 text). SC-13 says the later yes is given after round 10, and
   the acceptance enforces it, so those two answers do not count. Answered "repeat
   later" at 2026-09-29T19:50:13Z (`approvals.md`, `later_yes_P4_status`,
   `later_yes_P16_status`): he gives `yes P4` and `yes P16` again once #260 and the
   round-10 text are on `main` and `round_10_done_at` is set. The header's
   `pending_r13_changes` records it; the rule does not change.
5. **Carried from the draft's `CHANGES.md` section 16.** The orchestrator put three of
   its items to Vince: item 2 (include the "Until TASK-2011 is live" sentence of
   `mc-compliance.mdc:134-139` in the P16 portal half's line-scoped edit, or leave
   it; `:134-139` is the paragraph, and the sentence is its last three lines,
   `:137-139` at `2b656d8adf33`), item 4 (confirm the two D4 refinements: no `loadPrState` in `merge_group`
   mode, and a released stamp blocks there; round-3 nit 10 asked what closes it) and
   item 5 (whether the P15 re-run records `pr255_deployed: yes` from `gate0.md`, or
   F24 cites it in r14, or neither). Answered "accept all three" at
   2026-09-29T19:55:37Z, and Vince confirmed the orchestrator's reading at
   2026-09-29T20:03:53Z: (2) the P16 portal half deletes the sentence "Until TASK-2011
   is live, the Hub may still block an expired stamp; do not restamp ahead of that
   verdict." (`:137-139` at `2b656d8adf33`), the sentence joins P16's `owns` and its
   acceptance rejects it in every tracked rule; (4) both D4 refinements are confirmed,
   D4 records it, and round-3 nit 10 is closed; (5) the P15 re-run records
   `pr255_deployed: yes` and `pr255_deployed_source: gate0.md (GitHub deployment
   6721728347, 2026-09-28T22:11:43Z)`, the acceptance checks both lines, and F24 cites
   `gate0.md`. Two other section-16 items were not put to Vince, because neither is a
   decision a phase waits on: item 6 (the label and issuer of the P14 brain key) is
   settled by P14's steps and `depends_on` (the operator makes the key off the brain
   host and off every trading host by retirement R5's procedure, labels it, and P14
   records the label and the key's sha256 prefix), and item 7 (a follow-up task to
   remove `scripts/merge-group-prs.mjs` and its test together) is follow-up work
   outside this plan (F10: a later cleanup removes both together). The landing edit of
   29 Sep 2026 copied the section-16 list into the spec ("Questions left after the r13
   yes"), because `CHANGES.md` is in the orchestrator store, not in the repo; the spec's
   copy now records each item's disposition.
6. **What the yes on r13 covers.** The yes came before round 10 and named no rule. The
   round-10 text stated the author's reading in the header's `r13_yes` line (a
   round-10 fix stands under the yes when it tightens an acceptance check, corrects a
   citation or a fact, adds an evidence line or a stop condition, or restates SC-13 or
   the header in a phase's own gate or `depends_on` lines; a changed default, an
   earlier or easier start, an `owns` change or a narrower `forbidden` goes to Vince)
   beside the critic's stricter one (R10-gates-acceptance-2: every round-10 change to
   a gate, `depends_on`, `owns` or `forbidden` line goes to r14 before its phase
   starts), with the table above as the list of every such line, and asked Vince to
   confirm the reading, choose the critic's, or send any single line to r14. Answered
   "stand under r13" at 2026-09-29T19:54:30Z: every listed line stands under the yes on
   r13, `VerifyPrInput` in P16's `owns` included (question 9), and no r14 is needed for
   them. The header records the answer and keeps the rule for later fixes;
   R10-gates-acceptance-2 is closed.
9. **The `VerifyPrInput` type in P16's `owns`.** r13 named `src/lib/compliance/service.ts`
   (`verifyPr` and stamp resolution only) and required `verifyPr` to take `event`,
   which changes its input type `VerifyPrInput` (`service.ts:328-338` at
   `fc7ceef3d123`; `:357-367` at `7f79712657e3`, after #262). R10-d13-code-9 asked for the type in `owns`, and round 10 wrote it
   there, so that the P16 builder owns a type the approved text already changes. That
   is an `owns` change, so it went to Vince. Answered with question 6 at
   2026-09-29T19:54:30Z: it stands under the yes on r13. The P16 `owns` line records
   it, and the P16 later yes carries no other consent.

### Open questions, not yet put to Vince, for r14 or follow-up work (no phase waits on them)

7. **The empty-commit line in `pr-watch-until-green.mdc`.** Portal
   `.cursor/rules/pr-watch-until-green.mdc:49-50` says "push a commit (empty is fine)",
   the instruction P16 removes from `mc-compliance.mdc`. P16 does not own that rule, so
   its acceptance leaves it alone and the Risks bullet calls it follow-up work. The
   landing review found three more portal lines outside `.cursor/rules/` that say a
   body-only edit does not re-run the gate (`.cursor/skills/mc-sync/SKILL.md:49-50`,
   `docs/runbooks/CONTRIBUTING.md:262-263` and `CLAUDE.md:106`, at `2b656d8adf33`); the
   spec lists them under residual risk, and the same follow-up covers them. Open:
   add `:49-50` to P16's `owns` in r14, or leave it to the follow-up. The orchestrator
   has not put it to Vince yet. P16 does not wait on the answer.
8. **The brain's own proof of the key tier (P14, D5).** Retirement R4 promises only
   that the brain logs each request's key tier (`:303-304`). It fixes no wording, and
   the swarm code the service copies writes no request line and treats `plx-brain` as
   the default actor (`mcp-http-auth.ts:43`). So P14's acceptance checks the pasted
   line only for a VMC or scoped tier name, and it cannot tell the self-check's line
   from another brain-tier line in the window: the proof is the brain's line as the
   operator identifies it. Open: amend retirement R4 so that the brain's request log
   has a fixed wording that names the key tier (`brain`, the VMC hash, a scoped hash),
   the actor from `X-Agent-Name` and, for MCP calls, the tool name; or add the key
   source to the moved service's `brain_self_check` result. Either is an edit to
   `docs/specs/swarm-retirement-spec.md` and R4 code, for r14 or follow-up work. With
   it, r14 pins the self-check's line (or `self_check_key_source: brain`) in P14's
   acceptance, and P14 can send a distinct `X-Agent-Name` (today's value, `plx-brain`,
   equals the default actor, so it identifies nothing). The orchestrator has not put it
   to Vince yet. P14 runs on what R4 promises today and does not wait on the answer.

### Author verification

- **Sources.** Every finding was checked against the packet's blob-checked copies at
  PLX_MC `fc7ceef3d123` and portal `b192d624aeaa`, and on the build host against
  PLX_MC `origin/main` (`7f79712657e3` at the ninth revision, the merge of #263;
  `697373e00719` at the seventh and eighth, the merge of #260; `20fc262c95eb` and
  `25ff88b7234b` before). Since `fc7ceef3d123`, four cited files changed:
  `src/lib/permissions/types.ts` (#259 added `sp_mcp_agent_runner` to the array the P4
  tests pointer cites; #261 added `sp_mcp_portal`) and `src/lib/permissions/grants.ts`
  (#261 gave `sp_mcp_portal` a least-privilege grant in `SERVICE_GRANTS`), which the
  pointer cites by symbol at `fc7ceef3d123`; and, after the round's packet was cut,
  `src/lib/compliance/service.ts` (#262, 22:09:53Z: block reasons became texts, and the
  functions P4 and P16 cite moved 28 to 31 lines down) and
  `tests/compliance-server.test.ts` (#262 and #263, 51 lines: on `main` the TASK-2011
  block is `:144-274`, the checkout `describe` `:276-347` and the verifyPr `describe`
  `:349-537`), which P4 and P16 cite and edit and now cite at `7f79712657e3`. #263 also
  changed `src/lib/compliance/bucket-prd.ts`, `verify.ts` and `types.ts`, which F17
  cites (F17 is corrected at `7f79712657e3`), and one line of the spec on `main` (step
  8), which the round-10 text keeps. Of the files the spec's facts cite, #261 also
  changed `src/lib/mcp/actions.ts` and `src/lib/mcp/create-http-server.ts`, and #259
  `config/tracked-repos-registry.json`, where the cited lines moved or gained a
  neighbour and did not change (F3, F6, F15, F17 and F18 hold at their heads; since the
  tenth check F3 and F6 name both positions, and F15 says that its lines did not move),
  and #263 one line of `docs/AGENT-PR-SOP.md` (`:464`), below the line F14 cites (`:325`,
  unchanged); #260 changed only `docs/specs`. Portal `origin/staging` (`bc1272941c35`,
  then `ced66ea9cced` at the seventh and eighth revisions, `b12dc09e396c` at the ninth,
  `6d3ae82e4eca` at the tenth, `893de7196888` at the eleventh): the
  cited `mc-compliance.mdc` (still blob `fa1f84c17c2f`), `auto-merge-after-push.mdc`,
  `pr-watch-until-green.mdc`, `BRANCH-PROTECTION-STAGING.md`, `ci-staged-gate.test.mjs`,
  `mc-sync/SKILL.md`, root `CLAUDE.md` and the three compliance workflows are unchanged
  since `2b656d8adf33`; `docs/runbooks/CONTRIBUTING.md` gained 25 lines at `:74`
  (TASK-2104), so its cited lines are pinned at `2b656d8adf33`. Agentic-swarm
  `origin/main` (`b1117811cbd7`; `brain-mcp.md`, `mcp-http-auth.ts`, `mcp-http-tools.ts`
  and the MCP route unchanged), plx_secondbrain `origin/main` (`af0b3ea3c9f8`, then
  `a5febed32ac7` at the ninth revision: retirement R3.code, TASK-2087, merged
  2026-09-29T21:46:43Z; no `service/` yet, and `src/tools.ts` and `src/config.ts`
  unchanged), the retirement spec at PLX_MC `fc7ceef3d123` and `main` (blob
  `f7cdd48b84ad` at both, through `7f79712657e3`; B16 at `:50`), the store's
  `approvals.md`, `decisions.md`, `wave0-result.json` (the draft critic's nits) and the
  r12 P15 evidence. No trading host was contacted; no key was read.
- **Edits.** The round-10 text was made from the r13 text at PR #260 head
  `8ed919f5e59f` by replacing exact, unique anchors (67 in the first pass, 39 in the
  first revision, 22 in the second, 18 in the third, 28 in the fourth, 29 in the
  sixth, 21 in the eighth, 38 in the spec, 15 in this log and 4 in the README in the
  ninth, 10 in the spec, 4 in this log and 2 in the README in the tenth, and 5 in the
  spec, 3 in this log and 1 in the README in the eleventh; the fifth,
  which applied Vince's answers and the fifth check, used the same
  method, and so did the seventh, which applied the seventh check and reconciled the
  text with the landing edit); nothing was written until every anchor matched the
  expected number of times. The output is LF. From the seventh revision on, the diff is
  taken twice: against the #260 head the round reviewed (`8ed919f5e59f`, the packet) and
  against the text on `main` (`697373e00719` at the seventh and eighth revisions;
  `7f79712657e3`, which carries #263's step-8 line, at the ninth), which is the text the
  round-10 PR changes.
- **A check of the round-10 text itself.** An adversarial check of the first round-10
  text returned eight problems: the coverage rule did not match the changes made under
  it; the fix counts overstated the result and "wait only for their later yes" was
  false; `round_10_done_at` was the author's edit time; the `empty commit` rejection
  missed the portal's wrapped text; four TASK-2008 pins were not unique; the nit
  disposition misstated nits 8, 10 and 12 and dropped the rounds-1-and-2 statement;
  the r13 approval was not logged like the r12 one and the diff covered a section-only
  file; and B16 was cited at `:51`. All eight are applied in this text.
- **A second check.** An adversarial check of the revised text returned five problems,
  all applied. The P16 portal wording check rejected `empty is fine` in every tracked
  rule, and portal `pr-watch-until-green.mdc:49-50` carries it, so the check could not
  pass without an edit outside P16's `owns`: the empty-commit rejection is now limited
  to the rule P16 edits, and the trigger-list rejection stays repo-wide as in r13. F24
  still cited `test_generate_compliance_gate.py:49-54`. P14 step 6 cited retirement B13
  for the brain's `/api/health`, but B13 is VMC's route on the old host (R4 gives the
  brain its own route and does not say what it reports). The P14 acceptance never read
  `## raw` for the pasted log line; it now requires a line there that names
  `brain_self_check` and `plx-brain` and no VMC or scoped tier, and the text says that
  the proof is the pasted line. The header listed the brain's log line as a P14 start
  condition; it is acceptance evidence. With the check, the orchestrator noted that
  `round_10_done_at` is an approval field, which the README puts in the execution copy:
  the line is now set there after the merge, with no second PR to `main`, each gated
  acceptance derives the merge time from `main`'s first-parent history and requires the
  two to agree, and a new `SPEC_EXEC` path names the execution copy. Checked on real
  history: the first-parent walk finds PR #256's merge `f355533ab0f5` for the r12
  approval, with commit time 2026-09-28T17:00:36Z, one second before GitHub's
  `merged_at`, so the header says that the commit time is the one.
- **Syntax.** All 22 fenced `bash` blocks of the spec pass `bash -n` (re-run after the
  third revision).
- **Dry runs** (Appendix B as `accept.sh`, synthetic evidence, a scratch git repo
  holding the packet's copies of the three portal files, a `git` shell function in
  place of the PLX_MC clone; nothing touching a real repository). First pass, 34 cases
  as intended: P14 passes on the two good forms and fails on nine bad ones (a later yes
  before round 10, a `d5_confirmed_at` that differs from the header, a VMC key tier in
  the brain's log line, key material with a dash, an entry present before registration,
  a log line older than the registration, no pre-check, the later-yes form without the
  phrase, and the r12 header on `main`); P15 passes on a good re-run and fails on the
  real r12 file with `gate_pr_types` appended, on `audited_at` before round 10, on a
  missing raw quote, on a generator without the four types, and on the r12 header; the
  P4 header and query checks pass on good input and fail on a later yes of
  2026-09-29T18:14:39Z, on a query without `released_at IS NULL`, and on that string
  in a comment elsewhere; the P16 PLX_MC checks reject an r12 or pre-round-10 P15 run
  and a later yes before round 10. Revision, 20 cases as intended: the wording check
  fails on the real `mc-compliance.mdc` (its wrapped "an empty / commit"), passes on a
  builder's rewrite of both passages and of `auto-merge-after-push.mdc:127`, passes
  when the fixed line itself wraps, fails on each of five old forms appended one at a
  time (`empty is fine`, a wrapped `an empty / commit`, a bracket list without
  `edited`, the slash list, `Do not add `edited``), passes on a four-type bracket list
  and fails when the auto-merge rule still says "three required checks"; the 22 pins
  pass on the real test file and fail when `:914`, `:916`, `:937`, `:942` or
  `:952-955` is deleted; the header check of that revision failed on
  `round_10_done_at: pending` with its own message, passed on a set time with a later
  yes after it, failed on a later yes of 2026-09-29T18:14:39Z, and failed on the r12
  header. Second revision, 16 cases as intended, and the wording, raw-line and derivation
  checks were then cut from the spec text itself and run again with the same results: the
  scoped wording check on all 31
  portal rules at `6828ae8ff93d` (the six cases in the R10-gates-acceptance-6 row); the
  P14 `## raw` check passes on a pasted line for `plx-brain` and fails on no raw
  section, a line for another agent, a scoped tier and a VMC tier (the second
  revision's form of that check; the third revision replaced it, below); the
  `round_10_done_at` derivation in scratch repos passes when the execution copy carries
  the merge commit's UTC time on a merge-commit history (a `+05:00` commit time
  normalised) and on a squash history with fractional seconds, and fails on the branch
  commit's time, on a pending line and on a `main` without the round-10 text.
- **A third check.** An adversarial check of the second revision returned four
  problems, all applied. (1) The P14 acceptance pinned `brain_self_check` and
  `plx-brain` in the brain's log line, which retirement R4 does not promise (it
  promises a key tier per request, `:303-304`; the swarm route writes no request line,
  and `plx-brain` is its default actor), and its negative check named only
  `vmc_api_key|scoped`, so a line written as `legacy` passed. The check now takes the
  lines beneath a fixed heading under `## raw`, pins no wording, rejects the placeholder
  and rejects `vmc_api_key`, `legacy`, `scoped` and `dept` (the swarm's tier names);
  step 6, step 4, D5 and the Risks bullet say what the line proves, and open question 8
  records the R4 amendment as open for r14 or follow-up work; it was not put to Vince
  (the seventh check corrected this sentence, which had said "puts ... to Vince"). (2) The store's `approvals.md` (2026-09-29T19:50:13Z)
  already held Vince's answers to open questions 1 ("expiry only") and 4 ("repeat
  later"); both are recorded as answered, R10-d13-code-4 is closed, step 2.8 and the
  Risks bullet record the 409 answer, and the header's `pending_r13_changes` records
  that the 18:14:39Z yeses are not counted. (3) The counts then added up (23 in full, 4 in
  part, 27 in all; the fourth check moved one more to "in part", below), and the header,
  the intro and the r13 question all said three points went to Vince under the coverage
  rule (four, after the fourth check). (4) The TASK-2008 pins cover the `required`
  rows and the loop assertions (33 survive pins, seven edit pins, four negatives).
- **Dry runs of the third revision** (the pin block and the raw-line check cut from
  the spec text, on the build host): 25 cases as intended. Pins: the unedited file at `2b656d8adf33` fails (the
  re-pointed row is missing); a builder's edit made exactly as the list says passes
  (`node --check` clean); deleting the `ci.yml` row, the `workbench-api.yml` row, the
  `checks_requested`, `new RegExp(check.replace(`, `/pull_request:/`,
  `has("compliance")`, `merge_group\.base_sha`, `preflight … merge_group`,
  `protection, /18632985/`, `protection, /petralabx\/PLX_MC/` or `autoMerge.slice`
  assertion from the edited file fails on that pin; skipping the `generated, /gh api/`
  line fails; leaving `protection` pointed at the stopgap fails. The raw-line check: a
  brain-tier line beneath the step-6 heading passes, also with other callers' VMC and
  `legacy` lines above the heading and under another `###` heading; no heading, a
  heading with no line beneath it, the template placeholder, a `legacy`,
  `Department-scoped`, `dept/trading` or `VMC_API_KEY` tier, and no `## raw` section
  each fail. Every fenced `bash` block passes `bash -n`.
- **A fourth check.** An adversarial check of the third revision returned three
  problems. (1) It said the P16 portal wording check misses the slash list, because the
  real `mc-compliance.mdc` wraps after a slash and the squeezed text reads
  `opened/synchronize/ reopened`. That evidence is wrong: at `2b656d8adf33`,
  `b192d624aeaa`, `bc1272941c35` and `c7e796d61c00` (origin/staging on 29 Sep) the rule
  is the same blob (`fa1f84c17c2f`), `:130` ends with "still triggers only on", `:131`
  holds `opened/synchronize/reopened.` whole, the squeezed text reads "triggers only on
  opened/synchronize/reopened. Do not add", and the pattern matched it on the build
  host. The gap it points at is real for a rewrite: a three-type slash list wrapped at
  a slash, or spaced around the slashes, escaped the pattern. The pattern now allows a
  space at each slash, the comment and the `edited` bullet say so (the slash form is
  rejected in any spelling, also with `/edited` after it, so the builder names the four
  types as the generated file does), and the dry run below covers the wrapped and the
  spaced forms. (2) R10-gates-acceptance-2 was counted as applied in full, but the
  coverage rule in the header was the author's, broader than the critic's, and Vince
  never stated it; the rule also contradicted itself on `VerifyPrInput`. The finding is
  now applied in part (open question 6 puts the reading to Vince beside the critic's),
  `VerifyPrInput` is `owns`-level open question 9, the "names a symbol" kind is gone
  from the rule, and the counts read 22 in full and 5 in part in the header, the intro,
  the approval question, this log and the README. (3) The heading of this section now
  follows the log's form, and the rounds-1-and-2 nit count reads 22: 24 less the two
  that came back as blockers.
- **Dry runs of the fourth revision** (the wording check cut from the spec text, on a
  scratch copy of the 31 tracked rules at portal `c7e796d61c00`, on the build host):
  nine cases as intended. The real `mc-compliance.mdc` fails; a builder's rewrite of
  `:128-131` and `:301-309` passes; the rewrite with a three-type slash list appended
  fails in each of three spellings (whole, wrapped at a slash, spaced around the
  slashes); a four-type slash list fails (the form the bullet tells the builder to
  avoid); a bracket list wrapped after a comma fails; a four-type bracket list passes;
  the fixed line wrapped across two lines passes. Every fenced `bash` block passes
  `bash -n`.
- **A fifth check.** An adversarial check of the fourth revision returned six
  problems, all applied. (1) The header's rule sent an `owns` change to r14 while
  round 10 wrote `VerifyPrInput` into P16's `owns` and both P16 acceptance blocks
  accepted any `later_yes: yes P16`, so a bare `yes P16` counted as consent to an
  `owns` change; Vince's answer to open question 6 (2026-09-29T19:54:30Z) covers the
  change, the header records it, and the rule now says that such a fix goes to Vince
  and lands in the next revision unless he confirms it under the yes on r13. (2) The
  log said #259 touches none of the cited files; it changes
  `src/lib/permissions/types.ts` (one line in `MCP_AGENT_SERVICE_PRINCIPAL_IDS`),
  which the P4 tests pointer cited as a bare `:131-138`; the pointer, the
  R10-d13-code-5 row and the sources bullet now cite `grants.ts` and `types.ts` by
  symbol at `fc7ceef3d123`, and noted #259 and #261, then open (it merged at
  21:24:23Z, before the sixth revision's files were written; the seventh check caught
  the stale wording). (3)
  R10-retirement-s10-6 was counted as applied in full while P14's own steps never said
  that P14 takes only the server name and header names from the runbook, and its
  stop rule turned on "if the runbook table is missing" without saying which rows
  count; step 4 and the stop rule now name the rows (`:32`, `:34-36`) and say that the
  URL and key rows (`:17`, `:33`, `:34`) are superseded and do not count (the eighth
  check corrected that reading of `:34`: the row's header name counts, and only its
  value is superseded). (4) Two
  citations were wrong: the bracket trigger list in portal `mc-compliance.mdc` is at
  `:304` (`:303-304`), not `:305-306`, and retirement R4's key-tier line is at
  `:303-304`, not `:304-305`; both rows are corrected, checked at blob `fa1f84c17c2f`
  and at PLX_MC `fc7ceef3d123` (the retirement spec's blob, `f7cdd48b84ad`, is the
  same on `main`). (5) The spec's intro still called r13 a draft; it now says that
  Vince approved it on 29 Sep 2026 and round 10 closed the same day. (6) The rewrite
  of the round-10 section had dropped the draft rounds' author-verification record
  (`bash -n` after each round, the byte-for-byte diff reproduction, the P14 dry run
  with three good and six bad forms); the background now carries it.
- **Vince's answers applied** (the same revision). The header (`revision`,
  `approval_covers`, `r13_yes`, `pending_r13_changes`, `round_10`,
  `round_10_done_at`), the intro, F24, D4, D13, the Scheduling bullets, P14 (its
  `depends_on`, stop rule, step 4 and step 6), P15 (the `pr255_deployed` lines in its
  template, its #255 bullet and its acceptance), P16 (its `depends_on`, its `edited`
  bullet and portal `owns`, its PLX_MC `owns`, and the `Until TASK-2011 is live`
  rejection in its portal acceptance), the Risks bullets and the r13 approval section
  record the answers of 29 Sep 2026 with their times; the two open points (7 and 8),
  not yet put to Vince, are marked open for r14 or follow-up work. Retirement r13 (the R7 step, B16 and
  section 10) applies the answer to open question 3, and the README's frontier and
  retirement rows say so. Every fenced `bash` block of the spec passes `bash -n`
  after these edits (22 blocks, 0 failures, on the build host). The P16 portal
  wording loop, cut from the spec text and run on the 31 tracked rules at portal
  `origin/staging` (`426df6af1235`; `mc-compliance.mdc` is still blob
  `fa1f84c17c2f`), behaves as intended in six cases: the real rules fail on the
  `edited` wording; the real file with the `edited` lines rewritten and the sentence
  kept fails on the new check, because the squeezed text joins "Until" (`:137`) to
  "TASK-2011 is live" (`:138`); the rewrite that also deletes the sentence passes;
  the sentence appended wrapped after "TASK-2011" fails; the sentence in another rule,
  in another case, fails on that rule; the good rewrite passes again.
- **A sixth check.** An adversarial check of the fifth revision returned four
  problems, all applied. (1) The nit-disposition list and the README still said that
  round-3 nit 10 stays open, although Vince's acceptance of section-16 item 4
  (2026-09-29T19:55:37Z, reading confirmed 20:03:53Z) closes it, as open question 5
  and D4 already said; both now say that it closed on his answer. (2) The header's
  `r13_yes` line, the intro, the r13 approval section and the R10-gates-acceptance-2
  row said that round 10 put four such points to Vince and that open question 7
  stayed open, while the `round_10` line and this section said that he answered every
  question the round put to him; the record (the orchestrator's `decisions.md`) shows
  that open questions 7 and 8 were not put to him. Every line now says that three
  points went to Vince and were answered, and that 7 and 8 were not put to him and
  stay open for r14 or follow-up work, with no phase waiting on them. (3) The
  R10-gates-acceptance-4 row was labelled "applied in full" while the count put it
  among the five applied in part with the rest closed on Vince's answer; that row, and
  the R10-gates-acceptance-2 and -3 rows, now carry the label "applied in part; the
  rest closed on Vince's answer", which is what the 22 / 3 / 2 split counts. (4) The
  spec's "Does an approved plan exist?" table still listed the retirement spec as r12;
  it now lists r13 with the R7 amendment. The retirement r13 text was re-checked
  against PLX_MC `origin/main` (`20fc262c95eb` when the check ran; the file's blob
  there is `f7cdd48b84ad`, the same as at `fc7ceef3d123`, at #260's head
  `8ed919f5e59f`, at `25ff88b7234b` and at `697373e00719`):
  it differs from it only in the revision line, B16, the R7 operator step with its
  acceptance, and the section-10 P14 bullet. No bash block changed in this revision,
  and all 22 still pass `bash -n`.
- **A seventh check.** An adversarial check of the sixth revision returned five
  problems, all applied, and the author found one more fact while applying them. (1)
  The text still called #261 open, said `main` was `20fc262c95eb`, and gave a bare
  `:131-139` range on `main`; #261 had merged at 2026-09-29T21:24:23Z as
  `25ff88b7234b`, three minutes before the sixth revision's files were written, and it
  changed `grants.ts`, which P4 cites, as well as `types.ts`. The P4 bullet, the
  R10-d13-code-5 row, the blind-round intro, the sources bullet and the fifth-check
  bullet now state the merge, what #261 changed (`sp_mcp_portal` in the array, at
  `:138-147`, which the eighth check pinned at `25ff88b7234b`, and its least-privilege
  grant), and that `sp_mcp_codex` and
  `sp_mcp_cursor` remain valid holders; no bare `main` range remained in the spec, and
  every citation into the two files is by symbol at `fc7ceef3d123` (this log kept three
  `:138-147` "on `main`" notes, which the eighth check pinned). (2) The third-check
  bullet said open question 8 "puts the R4 amendment to Vince"; it now says the question
  is open and was not put to him, as every other line does. (3) The intro to the table
  of gate, `depends_on`, stop-rule and `owns` changes said every row but `VerifyPrInput`
  was of a covered kind, while the table also holds the P16 portal `owns` row (the
  "Until TASK-2011 is live" sentence, Vince's own decision); the intro names both
  `owns` rows. (4) The r13 approval section said the r13 changes start "each on its
  later yes"; the P15 re-run has no later yes and starts once `round_10_done_at` is set,
  so the section now says so, as the header and the P15 gate do. (5) Two retirement
  citations in the R10-retirement-s10-4 row were off by one (`:495` is R6a's rollback
  line; the no-key-material statement is `:494`; R5's change procedure is `:428-429`,
  not `:429-430`). The author then re-read every retirement citation in the table
  against the file (blob `f7cdd48b84ad`, the same at `fc7ceef3d123` and on `main`) and
  corrected six more of the same kind: R4's accept line is `:274-275` (not `:275-276`,
  in two rows), R4's `env.names` `never` list is `:283` (not `:284`), the R6a acceptance
  is `:491-494` (not `:492-495`), D3 is `:115` (not `:116`), the section-10 sentence is
  `:987-988` (not `:988-989`), `BRAIN_API_KEYS` in R5 is `:401-408` and `:407-408` (not
  `:402-409` and `:408-409`), and R4's key-tier line is `:303-304` (not `:304`). (6) The
  new fact: while round 10 ran, a landing review made one more commit on PR #260
  (`f96a92c468d1`, 21:28:12Z), and #260 merged to `main` at 2026-09-29T21:42:13Z as
  `697373e00719`, so the text the round-10 PR changes is that merged text, not the
  `8ed919f5e59f` copies the packet held. The author re-checked each landing correction
  at the pins (the background above lists them) and folded every one into the round-10
  text, so the round-10 PR reverts none of them: the P4 and P16 `vitest list` checks
  read the `it` title (the last ` > ` segment, captured first as the contract asks), the
  P16 portal acceptance also rejects "A body-only edit does not re-run the gate" in
  every tracked rule and requires the runbook's `max_entries_to_merge` row to keep `1`,
  the spec keeps the landing edit's list of the draft's section-16 questions with each
  item's disposition, and the spec's facts intro says which cited files moved since
  `fc7ceef3d123` and that the two heads are pins. The retirement r13 text needed no
  change (#260 did not touch that file). Every fenced `bash` block of the spec passes
  `bash -n` after these edits (22 blocks, 0 failures). `round10.diff` is regenerated
  against the `8ed919f5e59f` copies, as before, and a second diff against the merged
  text on `main` is written beside it.
- **An eighth check.** An adversarial check of the seventh revision returned two
  problems, both applied. (1) The P14 stop rule listed runbook row `:34` among the
  header-name rows that must be present and again among the superseded rows that "do
  not count", and the R10-retirement-s10-6 row said that the rule turns on "the two
  rows P14 takes". At agentic-swarm `b1117811cbd7` (still `origin/main`), swarm
  `docs/runbooks/brain-mcp.md:34` is one row that holds both the header name
  `X-API-Key`, which P14 takes, and the VMC key value, which D5 supersedes; P14 takes
  four rows (`:32`, `:34`, `:35`, `:36`). The stop rule, step 4, SC-8, the scope line,
  the R10-retirement-s10-6 row and the table of changed lines now say that the four
  rows count, that `:34` counts by its header name only, so a changed value there does
  not stop P14, and that the URL row `:33`, the auth row `:17` and the `:34` value are
  superseded and do not count. (2) The spec's "Does an approved plan exist?" paragraph
  said that r13's changes "to P4, P15 and P16 (D13) and to D5, D14, F26, P13 and P14
  (retirement section 10) wait for `round_10_done_at` ..., then for their named later
  yes", which gave P13 and the P15 re-run a gate they do not have: P13 keeps its
  first-yes gate and a run under either revision is valid (the intro, the P13 r13 note,
  SC-4 and `approval_covers`), and the P15 re-run has no later yes and starts once
  `round_10_done_at` is set (`pending_r13_changes`, the P15 gate). Round 10 introduced
  that wording; the merged text on `main` (`697373e00719`) says only that the changes
  "are pending Vince's yes on r13 ... and round 10". The paragraph now names the four
  gated phases, says that the P15 re-run starts with no later yes, and says that P13
  and the r12 run of P15 keep their first-yes gate; the r13 approval section, this
  log's approval section and the README's frontier row, which opened the same sentence
  with "The r13 changes wait for" or "start after", now say the same. With the check,
  the three citations that gave `:138-147` "on `main`" for
  `MCP_AGENT_SERVICE_PRINCIPAL_IDS` in `src/lib/permissions/types.ts` are pinned at
  `25ff88b7234b` (the file is unchanged on `main` at `697373e00719`), because that file
  moved in #259 and #261 and can move again. No fenced `bash` block changed in this
  revision: the 22 blocks were extracted from the seventh and eighth revisions and
  compared byte for byte, so the seventh revision's `bash -n` results stand. Both
  diffs are regenerated. The retirement r13 text needed no change; its base is still
  the `origin/main` blob (`f7cdd48b84ad`).
- **A ninth check.** An adversarial check of the eighth revision returned three
  problems, all applied, and the author found two more facts while applying them. (1)
  The text said that since `fc7ceef3d123` PLX_MC `main` had gained only #259, #261 and
  #260, and that no other cited file changed. PLX_MC #262 (TASK-2111, `5658c055bccc`) had
  merged at 2026-09-29T22:09:53Z, before the eighth revision's files were written
  (22:16-22:18Z), and #263 (TASK-2112, `7f79712657e3`) followed at 22:22:59Z. #262
  changed `src/lib/compliance/service.ts` (28 lines after `:107`: a `CheckoutBlockReason`
  type, `CHECKOUT_BLOCK_TEXT` and `checkoutBlockReason`; one more line in
  `resolveDispatchForOpenPr` and two more in `verifyPr`) and
  `tests/compliance-server.test.ts` (18 lines in the TASK-2011 block); #263 changed the
  test file again (33 lines), `bucket-prd.ts`, `verify.ts`, `compliance/types.ts`, and
  one line of the spec on `main`. The spec cited both compliance files with bare ranges
  that named no ref (P4 `:564`, `:581`, `:593`; the P16 Service and Tests bullets), and
  P4 and P16 branch from `main`, so on `main` those ranges pointed at the wrong lines:
  `VerifyPrInput` is `:357-367` there, not `:328-338`; `verifyPrOrQueue` `:1041-1054`,
  not `:1010-1023`; `resolveDispatch` `:141-153`, not `:113-125`; `getEntity` in
  `checkout()` `:251`, not `:222`; the TASK-2011 block `:144-274`, not `:139-251`; the
  provenance test `:289-307`, not `:266-284`; the foreign-checkout verify case
  `:383-403`, not `:360-380`. Every P4 and P16 code citation now names `7f79712657e3`
  and its symbol, with the `fc7ceef3d123` position kept where the text had one; the facts
  r13 re-derived (F1, F2, F11, F23 and F24; F6, which the preamble also lists, kept its
  bare range until the tenth check, below) say that their ranges are at `fc7ceef3d123` and
  give the `7f79712657e3` position of each function that moved; the facts preamble
  lists the five merges since `fc7ceef3d123` with what each changed, says which ref the
  citations use, and says that each builder re-checks its citations at the code of the
  day before it starts (P4 and P16 both edit `service.ts`, and compliance code was
  still changing); the blind-round verdict, the sources bullet and this log's evidence
  cells (R10-d13-code-2, -5, -6 and -9, question 9) are pinned or annotated the same
  way. (2) P16 required the case "a released stamp blocks in `merge_group` with reason
  `released`". Since #262 `verifyPr` maps every resolution reason to a text through
  `checkoutBlockReason`, so a released stamp blocks as `checkout released — re-checkout
  the task` (`CHECKOUT_BLOCK_TEXT`, `:120-130`; the TASK-2011 case at `:199-203` asserts
  that text), and a builder who followed the spec wrote an assertion that fails. The
  case now asserts that text on `tasks[0].reasons` and that `loadPrState` was not
  called, and F2, F11, D4 and the P16 Service bullet say that block reasons are texts
  and that the queue resolver's reasons go through the same mapping. (3) The header's
  `round_10` line did not match this log and the README on what round 10 left open: it
  named only open questions 7 and 8, while the log and the README said that 22 nits of
  the draft critic's rounds 1 and 2 had no recorded text and stayed for r14. The texts
  were in the store (`wave0-result.json`, `r13.rounds[0..2].nits`: 13, 11 and 13); the
  "Nits" table above now gives every one of the 37 a disposition (3 blockers closed, 31
  applied, 3 closed without a change, none left for r14), six of them applied by this
  check (round-1 nits 8, 10, 12 and 13; round-2 nits 6 and 8), and the header's
  `round_10` and `pending_r13_changes` lines, this log and the README say the same. (4)
  The first new fact: #263 edited step 8 of the code-phase contract on `main` (the
  gate's PRD messages, "requires a linked bucket PRD" and "requires the task on an
  initiative with a linked bucket PRD"); the round-10 text carries that line, so the
  round-10 PR does not revert it. (5) The second: #263 changed the fact F17 states. The
  gate now counts `prd` as present only when it is an http(s) URL (`docLinkFromPrd`),
  any other value is `absent` and blocks, a task with no bucket blocks as `no_bucket`,
  and only a failed bucket read is advisory. F17 is a fact P16 rests on through D11, so
  F17, D11, the P15 settings line and the Risks bullet now say so, with the code at
  `7f79712657e3`; the two bucket rows the r12 P15 run read on 29 Sep 2026 hold GitHub
  URLs (`merge-queue-audit.md`, `## raw`), so both stay `present`, and no default or
  gate changed. Also in this revision: the P14 stop rule names a missing brain key, and
  the P16 portal `depends_on` says what `cap: met` shows (two rows in the table of
  changed lines, each of a kind the rule in `r13_yes` covers); F11 and the Risks bullet
  call D4's queue rule narrower, not stricter; the reopen risk bullet says that the
  case needs an uncompleted stamp; the P13 bullet names R4. No fenced `bash` block
  changed: the 22 blocks were extracted from the eighth and ninth revisions and compared
  byte for byte, so the seventh revision's `bash -n` results stand. Heads at this
  revision: PLX_MC `origin/main` `7f79712657e3`; portal `origin/staging` `b12dc09e396c`
  (every portal file P16 cites has the same blob as at `2b656d8adf33`, except
  `docs/runbooks/CONTRIBUTING.md`, pinned there); agentic-swarm `origin/main`
  `b1117811cbd7` (the four cited files unchanged); plx_secondbrain `origin/main`
  `a5febed32ac7` (retirement R3.code, TASK-2087, merged 21:46:43Z; no `service/` yet;
  `src/tools.ts` and `src/config.ts` unchanged since `af0b3ea3c9f8`). The retirement r13
  text needed no change; its base is still the `origin/main` blob (`f7cdd48b84ad`, the
  same at `7f79712657e3`). `round10.diff` is regenerated against the `8ed919f5e59f`
  copies, and the second diff is now taken against `main` at `7f79712657e3`, the text
  the round-10 PR changes, in place of the one against `697373e00719`.
- **A tenth check.** An adversarial check of the ninth revision returned two problems,
  both applied, and the author pinned four more citations while applying them. (1) F6,
  one of the facts r13 re-derived, still cited PLX_MC `actions.ts:357-384` with no ref
  and no `7f79712657e3` position, although `actionCheckout` moved: #261 added 14 lines
  to `src/lib/mcp/actions.ts` (`git diff --stat fc7ceef3d123 7f79712657e3 --
  src/lib/mcp/actions.ts`; the file is in #261's file list and in no other merge
  between the two refs), so the function is `:357-384` at `fc7ceef3d123` and
  `:371-398` at `7f79712657e3` (`requireMcpActor` at `:377`, `checkout(` at `:381`,
  the stamp at `:389`), with the same body; and the ninth-check bullet above listed
  the re-derived facts as "F1, F2, F11, F23, F24", which left F6 out and did not match
  the preamble's list. F6 now names `fc7ceef3d123` for its three PLX_MC ranges, gives
  `actionCheckout`'s `7f79712657e3` position and the symbols its `read-actions.ts`
  ranges hold, and says that `checkouts/route.ts` and `read-actions.ts` did not change
  between the two refs (the same diff over the six files F3 and F6 cite lists only
  `actions.ts`); its portal citation is pinned at `2b656d8adf33`, where
  `docs/runbooks/CODEX-CLOUD.md` is unchanged through `6d3ae82e4eca`; and the
  ninth-check bullet says which fact it missed. The same kind of bare range stood in F3
  (`actions.ts:61-72`, `actionSelfCheck`, which moved one line, to `:62-73` at
  `7f79712657e3`; the same lines at `2faa2a2c9633` and `fc7ceef3d123`, because the
  file did not change between those two, and `self-check/route.ts`, `envelope.ts` and
  `auth.ts` did not change from `2faa2a2c9633` through `7f79712657e3`) and in F15
  (`config/tracked-repos-registry.json:185-205`, the `plx_secondbrain` entry, whose
  lines did not move: #259 appended the `agent-runner` entry after it); both now say
  so, and the facts preamble says which ref F3 and F15 use. The P15 code line for
  `NAME_AND_PR_TRIGGER` (`generate-compliance-gate.py:58-63`) and the P16 generator
  bullet's `test_generate_compliance_gate.py:49-55` now say that their lines are the
  same from `fc7ceef3d123` through `7f79712657e3` (neither file is in `git diff
  --name-status fc7ceef3d123 7f79712657e3`). That listing also shows that #263 changed
  one line of `docs/AGENT-PR-SOP.md` (`:464`, the PRD row of its fix table), below the
  line F14 and P8 cite (`:325`, the same text from `2faa2a2c9633` through
  `7f79712657e3`); the preamble and the sources bullet say so, and the sources bullet
  now attributes the registry change to #259, not #261 (`git diff --name-only
  fc7ceef3d123 20fc262c95eb` lists the file; the #261 range does not). (2) The README's
  retirement row and the spec's Documents table said that retirement r13 amends R7 and
  that "nothing else changed", while retirement r13 also edits B16 (`:50`) and the P14
  bullet of section 10 (`:990-991` in the r13 text) so that they agree with R7, as its
  revision line, the R10-gates-acceptance-4 row and question 3 above record. Both rows
  now say that B16 and the section-10 bullet say the same and that no decision, default
  or other step changed. The header's `round_10` line and the README's round-10 section
  name this check. No fenced `bash` block changed: the 22 blocks were extracted from
  the ninth and tenth revisions and compared byte for byte, so the seventh revision's
  `bash -n` results stand. Heads at this revision: PLX_MC `origin/main` still
  `7f79712657e3` (no merge after #263 when this check ran); portal `origin/staging`
  `6d3ae82e4eca` (22:46:56Z; of the files P16 cites, only `docs/runbooks/CONTRIBUTING.md`
  differs from `2b656d8adf33`, and its lines are pinned there; `mc-compliance.mdc` is
  still blob `fa1f84c17c2f`, and the tracked rules are still 31; `tasks/lessons.md`,
  which F14 pins at `2b656d8adf33`, gained three lines). The retirement r13 text needed
  no change; its base is still the `origin/main` blob (`f7cdd48b84ad`). Both diffs are
  regenerated.
- **An eleventh check.** An adversarial check of the tenth revision returned one
  problem, applied. The P16 portal PR's TASK-2008 bullet and the comment above the pin
  block in the P16 portal acceptance gave the assertions that survive the edit as
  `:936-955` (both) and `:873-876` (the comment), which count three lines the same edit
  list re-points: `:874` is the stopgap `required` row
  `["compliance-merge-group.yml", "compliance"]`, `:943` the old `GEN_SHA` pin and `:945`
  `/compliance-merge-group\.yml/`, and the same acceptance rejects the first two. The
  R10-d13-code-7 row above had the right ranges (`:873` and `:875-876`; `:936-942`,
  `:944`, `:946-955`), so the spec and this log disagreed; both spec places now give
  those ranges and say that `:874`, `:943` and `:945` are not survivors. The 33 pins are
  unchanged and were re-checked on the build host at portal `2b656d8adf33`: each occurs
  once in `scripts/ci-staged-gate.test.mjs`, at `:873`, `:875-876`, `:878`, `:880-881`,
  `:883`, `:885`, `:887`, `:891`, `:897`, `:911`, `:914-917`, `:920`, `:922-923`, `:925`,
  `:934`, `:937-942`, `:944`, `:946-947`, `:950-951` and `:953`, none at `:874`, `:943`
  or `:945`; the four rejected fragments are at `:874`, `:898` and `:902` (`queueTrigger`),
  `:932` and `:943`. The comment is the one line that changed inside a fenced `bash`
  block: the other 21 blocks are byte for byte the tenth revision's, and all 22 pass
  `bash -n` (run on the build host from this revision's text). With the check, SC-8's
  runbook rows (`brain-mcp.md:32,34-36`) and P14 step 6's swarm citations
  (`mcp/route.ts:35`, `mcp-http-auth.ts:37-43`) name `b1117811cbd7`, as the P14 steps
  already did. Heads at this revision: PLX_MC `origin/main` still `7f79712657e3` (no
  merge after #263 when this check ran; the P4 and P16 code citations were re-read
  there: `dispatchRepoMatches` `:94-105`, `checkout()` from `:227` with `authorizeStaged`
  `:228-242`, `getEntity` `:251` and `patchTask` `:254`, `CheckoutBlockReason`,
  `CHECKOUT_BLOCK_TEXT` and `checkoutBlockReason` `:108-134`, `resolveDispatch`
  `:141-153`, `prDispatchResolver` `:177-187`, `gateDedupKey` `:191-193`,
  `resolveDispatchForMerge` `:198-209`, `VerifyPrInput` `:357-367`, the `verifyPr`
  verdict `:471-477`, `verifyPrOrQueue` `:1041-1054`; in `tests/compliance-server.test.ts`
  the hoists to the end of the root `beforeEach` `:10-142`, the TASK-2011 block
  `:144-274` with its released case `:199-203`, the provenance case `:289-307` and the
  foreign-checkout case `:383-403`; `repo.ts:281` and `:340-348`; `route.ts:88-90`);
  portal `origin/staging` `893de7196888` (23:22:14Z, one MRP fix after `6d3ae82e4eca`;
  of the files P16 cites, still only `docs/runbooks/CONTRIBUTING.md` differs from
  `2b656d8adf33`, `mc-compliance.mdc` is still blob `fa1f84c17c2f`, and the tracked
  rules are still 31); agentic-swarm `origin/main` `b1117811cbd7` and plx_secondbrain
  `origin/main` `a5febed32ac7`, both unchanged since the tenth. The retirement r13 text
  needed no change; its base is still the `origin/main` blob (`f7cdd48b84ad`). Both
  diffs are regenerated.

## Approval — 2026-09-29T18:09:35Z (r13)

Vince approved r13 with `yes r13, D5 as r13`, in the orchestrator chat session,
against PR #260 head `8ed919f5e59f`, before round 10 ran. The phrase `D5 as r13`
confirms D5 as r13 changed it (a brain key from `BRAIN_API_KEYS`, never a VMC key);
P14 records it as `d5_confirmed_in: yes on r13`, and its acceptance compares
`d5_confirmed_at` with the header's `d5_r13_yes` time. The header records the yes
(`status`, `approved_by`, `approved_at`, `r13_yes`, `r13_yes_at`, `d5_r13_yes`) and
keeps r12's approval for the phases r13 does not change (`approval_covers`). Setup is
once, on the first yes (r12), so this approval changes only the header's approval
fields. Because the yes came before round 10 and named no rule for what it covers, the
round-10 text stated the author's reading in the header's `r13_yes` line, listed the
round-10 changes to gate, `depends_on`, stop-rule and `owns` lines in the table above,
and asked Vince (open question 6) to confirm that reading, choose the critic's, or
send any of them to r14. He confirmed it at 2026-09-29T19:54:30Z ("stand under r13"):
every listed change, `VerifyPrInput` in P16's `owns` included, stands under this yes,
and no r14 is needed for them. The two variants the r13 question offered (`yes r13`
alone; `yes r13, except D5: as r12`) are void by this answer. The four phases the r13
changes gate start after `round_10_done_at` is set, an approval field that the
orchestrator sets in its execution copy when the round-10 PR merges to PLX_MC `main`:
the P15 re-run then starts, with no later yes, and records `audited_at` later than that
time; P4's code branch, P16 and P14 each start on their later yes, given after that
time, and their `depends_on` evidence. P13 keeps its first-yes gate, and a run under
either revision is valid.
