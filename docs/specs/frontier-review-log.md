# Frontier stack spec — adversarial review log

Target: `frontier-implementation-spec.md` (r1 as pasted on 27 Sep 2026 → r2).
Method: each factual claim was checked against the repos at these heads: portal
`95276888b6ed`, PLX_MC `2faa2a2c9633`, agentic-swarm `35ed5034eddf`,
plx_secondbrain `af0b3ea3c9f8`. Every acceptance command was then dry-run. After
that, independent critics reviewed the result blind, with no access to the author's
reasoning.
No repo was edited. No Mission Control checkout, self-check, or stamp was called. No
PR was opened.

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
