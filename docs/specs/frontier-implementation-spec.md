# Frontier stack — implementation spec

```
status: approved (r13: "yes r13, D5 as r13", 2026-09-29T18:09:35Z, round 10 applied 29 Sep 2026; r12 approved 28 Sep 2026, and that approval stands for every phase r13 does not change: approval_covers)
revision: r13 (28 Sep 2026, written under D13; Vince's yes on 29 Sep 2026 and round 10 applied the same day, see the header lines below; r13 merged to PLX_MC main on 29 Sep 2026 as #260, 697373e00719, 21:42:13Z, with a landing edit that recorded the yes and corrected citations, which the round-10 text keeps, see the review log; after round 10's packet was cut, main gained #262 (TASK-2111, 5658c055bccc, 22:09:53Z: every block reason verifyPr records is a text) and #263 (TASK-2112, 7f79712657e3, 22:22:59Z: a bucket PRD counts only as an http(s) link; it also edited this file's step 8 on main, which the round-10 text keeps), so the round-10 text pins the P4 and P16 code citations at 7f79712657e3, corrects F17 and the P16 released-stamp case to that code, and says each builder re-checks its citations at the code of the day; after PLX_MC PR #255 merged at 22:11 UTC as f6d2bab7670a: F1, F2, F6, F10, F11, F23 and F24 re-derived at PLX_MC fc7ceef3d123 and portal 2b656d8adf33, and F13's portal test lines re-cited; D2 and D4 re-derived with the same defaults; P4 and P16 re-derived against the merged code, and every test line they cite re-cited; the P16 portal half gains the portal mc-compliance.mdc lines that forbid the edited trigger and name three trigger types, after P8 and P10 on the portal and within P10's caps; P15 records the merged #255 and the generator's trigger types, and runs again under r13 before P16 starts, because an r12 run of P15 does not satisfy r13; the P16 PLX_MC acceptance reads P15's two r13 lines; D5, D14, F26, P13 and P14 follow swarm retirement r12 section 10: a brain key from BRAIN_API_KEYS, the address from R6a, and the R6 routes stay. r13 needed Vince's yes, because D5 is a changed default; he gave it on 29 Sep 2026 as "yes r13, D5 as r13", and P14 records the phrase. Round 10 reviewed every r13 change, P4, P15 and P16 and D5, D14, F26, P13 and P14, plus the Scheduling bullet on retirement R7 and the draft critic's 37 nits, each with a disposition in the review log; it verified 27 findings: 22 fixes are in this text in full, 3 closed on Vince's answers the same day (review log, open questions 2, 3 and 6: the P16 portal half waits for P10 portal; retirement r13 leaves the Team MCP entry to P14; the round-10 gate, depends_on, stop-rule and owns changes stand under the yes on r13), and 2 (one merged pair) are applied in part, with the rest open for r14 or follow-up work (open question 8, the brain's log wording, not yet put to Vince; no phase waits on it). Vince also answered the round's other questions the same day: the 409 message names the expiry only; the later yes for P4 and P16 is given again after round_10_done_at; and the draft's section-16 items 2, 4 and 5 are accepted (the P16 portal half also deletes the "Until TASK-2011 is live" sentence, D4's two refinements are confirmed, and the P15 re-run records pr255_deployed: yes). The r13 changes start only after that yes and that review, both recorded below (round 10's time for the gates, round_10_done_at, is the merge of its text): P4's code branch, the P15 re-run, P16 and P14. The r12 approval stands for the phases r13 does not change, and they keep running under it. r12: swarm retirement applied, so P7 and the swarm halves of P8, P9 and P10 are withdrawn; P14 waits for the brain's own address; PLX_MC PR #255 gates P4 and P16; round 9 reviewed the r12 changes. Editorial, after approval on 28 Sep 2026: approval recorded, the spec committed to PLX_MC `docs/specs/`, and F25, F26, D10, D14 and SC-12 aligned with swarm retirement r4, where the trading lab keeps the repo and the old host; no phase, gate, acceptance or default changed. r11: adversarial review, 27 Sep 2026; D1 and D12 confirmed 28 Sep 2026. Record: frontier-review-log.md)
approved_by: vince@petrasoap.com (r13; r12: vince@petrasoap.com)
approved_at: 2026-09-29T18:09:35Z (r13); 2026-09-28T14:23:22Z (r12)
approval_covers: r12: every phase r13 does not change (P1, P2, P3, P5, P6, P8, P9, P10, P11, P12), and the first-yes gate of P13 and P15. r13: P4's code branch, the P15 re-run, P16 and P14, as reviewed in round 10, including every change round 10 made to their gate, depends_on, stop-rule and owns lines (Vince, 2026-09-29T19:54:30Z; r13_yes)
r13_yes: yes r13, D5 as r13 (vince@petrasoap.com, 2026-09-29T18:09:35Z; given against PR #260 head 8ed919f5e59f, before round 10. The yes named no rule for what it covers, so the round-10 text stated the author's reading and put it to Vince (review log, open question 6). Vince confirmed it at 2026-09-29T19:54:30Z, "stand under r13": the yes covers the round-10 text of P4, P15, P16 and P14, including every change round 10 made to their gate, depends_on, stop-rule and owns lines (the review log lists each one) and the VerifyPrInput type named in P16's owns (open question 9, answered by the same answer). No r14 is needed for them. Round 10 changed no default, and none of its changes lets a phase start earlier, on fewer conditions or on more files; the later yes for P4, P16 and P14 is given against this text. The rule for a later fix: it stands under the yes when it tightens an acceptance check, corrects a citation or a fact, adds an evidence line or a stop condition, or restates SC-13 or this header in a phase's own gate or depends_on lines; a fix that would change a default, let a phase start earlier or on fewer conditions, change owns (a file, a region or a symbol), or narrow forbidden goes to Vince before the affected phase starts, and lands in the next revision unless he confirms it under the yes on r13, as he did for the round-10 owns change on 2026-09-29T19:54:30Z. Round 10 found four such points. Three went to Vince, and he answered them (open questions 2, 3 and 9, the last with 6). The fourth, open question 7 (the empty-commit line in portal pr-watch-until-green.mdc:49-50, which P16 does not own), was not put to him: it stays open for r14 or follow-up work, and no phase waits on it. The two variants the r13 question offered are void)
r13_yes_at: 2026-09-29T18:09:35Z
d5_r13_yes: D5 as r13 (in the yes on r13, 2026-09-29T18:09:35Z)
pending_r13_changes: none waits for r13_yes now, the round-10 review is done, and every question it put to Vince is answered, and the two points it did not put to him (review log, open questions 7 and 8) stay open for r14 or follow-up work, with no phase waiting on them, and no nit of the draft's critic is left for r14 (review log, "Nits"); each gated acceptance reads round_10_done_at from the orchestrator's execution copy, where the orchestrator sets it when the round-10 PR merges to PLX_MC main, and checks it against main's history. P4's code branch, P16 and P14 still wait for their named later yes, given against r13 or later and after round_10_done_at (SC-13; the phase evidence records later_yes and later_yes_at; the yes P4 and yes P16 of 2026-09-29T18:14:39Z came before round 10 and do not count, and Vince chose to give them again, 2026-09-29T19:50:13Z), and for their depends_on evidence: P4 for P3; P16 for the P15 re-run and the bucket PRDs (D11), and its portal half for the P8 and P10 portal PRs (no after-P8-alone path: Vince, 2026-09-29T19:55:37Z); P14 for BRAIN_URL, its pre-check and the Team MCP list's state (the brain's log line for the self-check is P14's acceptance evidence, written after the registration, not a start condition). The P15 re-run starts once round_10_done_at is set; it records audited_at later than that time
round_10: done (29 Sep 2026: three blind critics returned 27 findings, 8 major and 19 minor; the author verified each against the code and the specs: 27 accepted, 0 rejected; 22 fixes are in this text in full, 3 closed on Vince's answers the same day (review log, open questions 2, 3 and 6), and 2 (one merged pair) are applied in part, with the rest open for r14 or follow-up work (open question 8: the brain's proof of the key tier, which needs retirement R4 to fix its log wording; no phase waits on it). Vince answered every question the round put to him on 29 Sep 2026: open questions 1 and 4 at 19:50:13Z (the 409 message names the expiry only; the later yes for P4 and P16 is given again after round_10_done_at), 3, 6 and 9 at 19:54:30Z (retirement r13 leaves the Team MCP entry to P14; the round-10 gate, depends_on, stop-rule and owns changes, VerifyPrInput among them, stand under the yes on r13), 2 and 5 at 19:55:37Z (the P16 portal half waits for P10 portal; the draft's section-16 items 2, 4 and 5 are accepted, reading confirmed at 20:03:53Z); open questions 7 and 8 were not put to him and stay open for r14 or follow-up work, and no phase waits on them; no default changed; a fourth blind pass returned no finding. Scope: P4, P15 and P16 under D13; D5, D14, F26, P13 and P14 under retirement section 10; the Scheduling bullet on retirement R7; the draft critic's 37 nits (13, 11 and 13 in rounds 1-3), each with a disposition in the review log: 3 came back as blockers (R10-3, R10-5, R10-6) and closed there, 31 are applied in the r13 or round-10 text (6 of them by the ninth check of that text), 3 are closed without a change, with the reason, and none is left for r14. After the round's packet was cut, PLX_MC main gained #262 (TASK-2111, 2026-09-29T22:09:53Z) and #263 (TASK-2112, 7f79712657e3, 22:22:59Z); a ninth check of the round-10 text (29 Sep 2026) pinned the P4 and P16 code citations at 7f79712657e3, corrected F17 (a bucket PRD counts only as an http(s) link) and the P16 released-stamp case (its reason is a text since #262), and kept #263's edit to step 8 of this file; a tenth check pinned the last bare ranges (F3, F6, F15) the same way; an eleventh check corrected the two ranges of the TASK-2008 assertions that survive the P16 portal edit, which had counted the three re-pointed lines among the survivors (the 33 pins were right). Logged in frontier-review-log.md under "Round 10". The gates take their time from round_10_done_at (below), derived from the merge that carried this line to main, not from the date in this line)
round_10_done_at: pending in this repo copy. It is an approval field: the orchestrator sets it in its execution copy in the store, the copy that holds the approval fields (docs/specs/README.md, "Rules for these files"), when the round-10 PR merges to PLX_MC main; no second PR to main is needed. The value is the UTC committer time of the first commit in PLX_MC main's first-parent history whose header carries this file's round_10 line, which is the merge of the round-10 text: TZ=UTC git show -s --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ <commit>. GitHub's mergedAt can differ from that time by a second, so the commit time is the one. The line reads round_10_done_at: <UTC> (PR #<n>, merge <commit>). Each r13-gated acceptance derives the same time from main and requires the execution copy's line to equal it, so a typed time counts only when it is the merge. Until it is set, every r13-gated acceptance fails, and no later yes and no P15 audited_at counts. If a later PR amends the round-10 text, it amends the round_10 line too, and the orchestrator sets this line again from that PR's merge
accountable_human: vince@petrasoap.com
```

Vince approved r12 on 28 Sep 2026 (the approval question is at the end). Setup runs on that yes.

r13 (28 Sep 2026) was written under D13, after PLX_MC PR #255 merged. Vince approved
it on 29 Sep 2026, and round 10 closed the same day. It changes P4, P15 and P16, and
the facts and decisions they rest on (F1, F2, F6, F10, F11, F23, F24, D2, D4, D13). It
also applies swarm retirement r12 section 10 to D5, D14, F26, P13 and P14. D5 is a
changed default, not a re-derived one: r12's yes covered r12's D5, and the rule under
"Decisions a yes confirms" puts a changed default to Vince. So r13 needed Vince's yes,
in the form `yes r13, D5 as r13`. Vince gave it on 29 Sep 2026 at 18:09:35 UTC, against
PR #260 head `8ed919f5e59f` (header: `r13_yes`, `d5_r13_yes`). The phrase `D5 as r13`
confirms D5; P14 records it in `brain-register.md` (`d5_confirmed_in: yes on r13`) and
does not start without it (D5, D14, SC-8).
Round 10, the blind review of every r13 change (P4, P15 and P16 under D13; D5, D14,
F26, P13 and P14 under retirement section 10; the Scheduling bullet on retirement R7;
and the draft critic's 37 nits, each with a disposition in the review log), closed the
same day with 27 findings, all verified: 22 fixes are in this text in full, 3 closed on Vince's answers the same day,
2 (one merged pair) are applied in part with the rest open for r14 or follow-up work,
and none changes a default (header: `round_10`; record: `frontier-review-log.md`).
After the round, PLX_MC `main` gained #262 and #263 (TASK-2111 and TASK-2112, 29 Sep
2026), which changed files P4 and P16 cite and edit and the fact F17 states, so the
round-10 text pins their code citations at `7f79712657e3`, corrects F17, and says that
each builder re-checks its citations at the code of the day before it starts (facts
preamble).
Its time for the gates, `round_10_done_at`, is the merge of its text; the orchestrator
sets it in its execution copy when the round-10 PR merges. The yes came before round
10 and named no rule for what it covers, so the round-10 text stated the author's
reading and put it to Vince (review log, open question 6). Vince confirmed it at
19:54:30 UTC ("stand under r13"): a round-10 fix stands under the yes when it tightens
an acceptance check, corrects a citation or a fact, adds an evidence line or a stop
condition, or restates SC-13 or the header in a phase's own gate or `depends_on`
lines, and the changes round 10 made to the P4, P15, P16 and P14 gate, `depends_on`,
stop-rule and `owns` lines, listed in the review log, stand under it. A fix that would
change a default, let a phase start earlier or on fewer conditions, change `owns` (a
file, a region or a symbol), or narrow `forbidden` goes to Vince before the affected
phase starts. Round 10 found four such points. Three went to him, and he answered
them: the P16 portal half without P10 (it waits for P10 portal, 19:55:37 UTC),
retirement R7's Team MCP step (retirement r13 leaves the entry to P14, 19:54:30 UTC)
and the `VerifyPrInput` type in P16's `owns` (it stands under the yes on r13, 19:54:30
UTC). The fourth, the empty-commit line in portal `pr-watch-until-green.mdc:49-50`,
which P16 does not own, was not put to him: it is open for r14 or follow-up work
(review log, open question 7), and no phase waits on it. Vince also accepted three items the
draft's `CHANGES.md` section 16 left open (19:55:37 UTC, reading confirmed 20:03:53
UTC): the P16 portal half deletes the "Until TASK-2011 is live" sentence of
`mc-compliance.mdc`, D4's two refinements are confirmed, and the P15 re-run records
`pr255_deployed: yes`.
The r13 changes start only after that yes and that review: P4's code branch, P16 and
P14 wait for their later yes, given after `round_10_done_at` (D13, SC-13), and for
their `depends_on` evidence (P4 for P3; P16 for the P15 re-run and the bucket PRDs,
and its portal half for the P8 and P10 portal PRs; P14 for `BRAIN_URL` and its
pre-checks), and the P15 re-run starts once `round_10_done_at` is set. The r12 approval stands for the phases r13 does not change,
and they run under it. P13 and P15 keep their first-yes gate. An r12 run of P15 does
not satisfy r13: P15 runs again under r13 before P16 starts (its D13 note), and the
P16 PLX_MC acceptance reads its r13 lines. A P13 run under either revision is valid,
because r13 changes only one fact P13 records, and P14 takes the address from D14, not
from `brain-audit.md`. r13 adds no first-yes phase.

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
  spec's R6a (r13; R7 in r12) (D14).
- PLX_MC PR #255 changed how stamps expire and release (F24). P4's code branch and
  P16 waited until it merged or closed (D13). It merged on 28 Sep 2026 at 22:11 UTC as
  `f6d2bab7670a`; r13 applies it.

## Does an approved plan exist?

Yes. This file: r12, approved by Vince on 28 Sep 2026, and r13, approved by Vince on
29 Sep 2026 (`yes r13, D5 as r13`; D5 is a changed default) and reviewed in round 10 the
same day. r13 changes P4, P15 and P16 (D13) and D5, D14, F26, P13 and P14 (retirement
section 10). The four phases those changes gate wait for `round_10_done_at` (the merge
of the round-10 text; an approval field that the orchestrator sets in its execution
copy): the P15 re-run then starts, with no later yes; P4's code branch, P16 and P14 then
wait for their named later yes and their `depends_on` evidence (header). P13 and the r12
run of P15 keep their first-yes gate (SC-4, `approval_covers`), and a P13 run under
either revision is valid (its r13 note). Before the r12 answer, nothing in the project
was an approved implementation plan. The documents below are not approved plans.

| Document | Status | What it is |
|---|---|---|
| `docs/jev-fleet-implementation-spec.md` | Draft. Independent review NOT_APPROVED / NO-GO on full execution. AGREE on rejecting Jev. | Context diet. This spec takes its meter, complete-order sentence, loader canary, and guide trim (r12 dropped the swarm writer lock). Skill packs and enforcement stay on that draft. |
| `internal/frontier-package-fit.md` | Strategy note. Loop verdict NOT_APPROVED because there is no code change. | Exclusive checkout, the brain connector, and the merge-queue stall are named there. This spec is the plan that contains them. |
| `docs/parity-plan.md`, `docs/project-context.md` | Inventory, 25 Sep 2026. | Capability matrix. They do not authorize edits. |
| Swarm retirement spec, r13 (`docs/specs/swarm-retirement-spec.md` in PLX_MC) | D1–D13 confirmed; reviewed in seven rounds, then closed by the operator on 28 Sep 2026. r13 (29 Sep 2026) amends R7 on Vince's answer to round-10 open question 3: R7 leaves the Cursor Team MCP entry to P14 and records `team_mcp: left to frontier P14`; its B16 and the P14 bullet of its section 10 say the same, and no decision, default or other step changed. | Retires the swarm; moves the brain to plx_secondbrain at `brain.plxcustomer.io`; leaves the trading lab untouched. Its section 10 lists the r12 changes and what r13 picks up. |
| Agent fleet spec, r13 (`docs/specs/agent-fleet-spec.md` in PLX_MC) | D1–D26 confirmed; reviewed in seven rounds plus one pass on r13 (28 Sep 2026). | Agents in the portal registry, a runner, and COS as the chief of staff. It adds no guide roster. |

The first four documents live in the Cursor project store. The last two, and this spec,
are in PLX_MC `docs/specs/`.

## Facts this spec relies on

Checked on 27 Sep 2026 against these heads: portal `95276888b6ed` (= `origin/staging`),
PLX_MC `2faa2a2c9633`, agentic-swarm `35ed5034eddf`, plx_secondbrain `af0b3ea3c9f8`.
A phase that finds a fact changed stops and reports. It does not work around it.
r12 adds F24–F26, checked on 28 Sep 2026. r13 re-checks F1, F2, F6, F11, F23 and F24
against PLX_MC `fc7ceef3d123` (the pin for this revision; it includes #255's merge
commit `f6d2bab7670a`; later commits on `main` do not move the pin), and F10 and F13's
portal test lines against portal `2b656d8adf33` (the pin for this revision, portal
`staging` on 28 Sep 2026; later commits do not move it). Between `2faa2a2c9633` and
`fc7ceef3d123` no other PLX_MC file cited in F3, F8, F13, F17, F18 or F22 changed
(`git diff --stat`), so those citations hold. Since `fc7ceef3d123`, PLX_MC `main` has
gained #259 (`20fc262c95eb`, 18:48:26Z), #261 (`25ff88b7234b`, 21:24:23Z), this spec's
r13 (#260, `697373e00719`, 21:42:13Z), #262 (TASK-2111, `5658c055bccc`, 22:09:53Z) and
#263 (TASK-2112, `7f79712657e3`, 22:22:59Z), all on 29 Sep 2026. #259 and #261 changed
two files P4 cites, `src/lib/permissions/types.ts` and `grants.ts`, which P4 therefore
cites by symbol at `fc7ceef3d123`, and, of the other cited files, only
`src/lib/mcp/actions.ts` and `src/lib/mcp/create-http-server.ts` (#261) and
`config/tracked-repos-registry.json` (#259), where the lines F3, F6, F15, F17 and F18 cite
moved or gained a neighbour and did not change, so those citations hold at their heads;
F3, F6 and F17 also name the `7f79712657e3` position of each cited function that moved,
and F15's lines did not move. #263 also changed one line of `docs/AGENT-PR-SOP.md`
(`:464`, the PRD row of its fix table), below the line F14 and P8 cite (`:325`, the same
text from `2faa2a2c9633` through `7f79712657e3`).
#260 changed only `docs/specs/`. #262 changed `src/lib/compliance/service.ts` (28 lines
after `:107`: a `CheckoutBlockReason` type, `CHECKOUT_BLOCK_TEXT` and
`checkoutBlockReason`, so every block reason `verifyPr` records is a text, for example
`checkout released — re-checkout the task`; one more line in `resolveDispatchForOpenPr`,
where a missing task now blocks as `task_deleted`; two more in `verifyPr`) and
`tests/compliance-server.test.ts` (18 lines in the TASK-2011 block); P4 and P16 cite
and edit both files. #263 changed `src/lib/compliance/bucket-prd.ts`, `verify.ts` and
`types.ts` (a bucket PRD counts as present only when it is an http(s) link; F17, D11),
`tests/compliance-server.test.ts` again (33 lines: a `bucketsThrow` flag, a throwing
`getBuckets` mock, three `beforeEach` lines and three cases), and one line of this file
(step 8 of the code-phase contract, the gate's PRD messages), which the round-10 text
keeps. Which ref each code citation uses: the facts r13 re-derived (F1, F2, F6, F11,
F23, F24) cite `fc7ceef3d123`, the commit they were checked at, and name the position at
`7f79712657e3` of each cited function that moved; F3 and F15 cite `2faa2a2c9633`, where
they were checked, and F3 names the `7f79712657e3` position of `actionSelfCheck`, the
one cited function that moved; the P4 and P16 sections cite
`7f79712657e3`, PLX_MC `origin/main` when the round-10 text was written (the merge of
#263), by line and by symbol, so a later commit cannot make a range point at the wrong
lines unnoticed; F17 is re-checked at `7f79712657e3`; portal citations use
`2b656d8adf33`. Each builder re-checks every citation of its phase at the code of the
day before it starts (P4 and P16 both edit `service.ts`, and compliance code was still
changing on 29 Sep 2026): a citation that no longer matches is re-derived by symbol and
recorded in the phase evidence, and a changed fact stops the phase, as the rule above
says. At portal
`2b656d8adf33` the F14 sweep finds the same 19 lines in the same 15 files, and F14
cites them at that head; only `prompts/workbench-readonly-build-prompt.md` moved, from
`:354` at the F7 head to `:359`. Several F14 files gained `workbench-api` in their
required-checks line (TASK-2037), which moved no F14 line. At portal `origin/staging`
on 29 Sep 2026 (`b12dc09e396c`, then `6d3ae82e4eca`) every portal file P16 cites has the
same blob as at `2b656d8adf33`, except `docs/runbooks/CONTRIBUTING.md`, whose cited
lines are pinned there.

| # | Fact | Evidence |
|---|---|---|
| F1 | `checkout()` mints a new id on every call. It does not look up a live dispatch first. `mc_dispatch` has only a non-unique `task_id` index; migration `026` adds `released_at` and `released_reason` and no constraint. Code prediction for a second call on the same task and repo: a second stamp. Re-checked at `fc7ceef3d123`, after #255. | PLX_MC `src/lib/compliance/service.ts:198-266` at `fc7ceef3d123` (`checkout()`; `:227-295` at `7f79712657e3`, same body); `src/lib/compliance/repo.ts:198-213`; `db/migrations/008_compliance.sql:25-37`, `026_dispatch_release.sql:3-4` (`repo.ts` and the migrations are unchanged through `7f79712657e3`) |
| F2 | Nothing sets `revoked`. `complete()` validates the stamp and appends `task.completed` with `payload.checkoutId`; it rejects an unknown, revoked, released or expired stamp, and it does not release the stamp. Since #255 (TASK-2011), the PR lifecycle releases a stamp: on `closed`, `ingestPullRequest` sets `released_at` and `released_reason` (`merged` or `closed`) after attribution and projection and appends `checkout.released`; on `reopened`, it clears the release of an unrevoked, repo-matching stamp. In the ledger and the checkout listing, "live" means `NOT revoked AND released_at IS NULL AND expires_at > now()`; the TTL is still `issued_at + 480 min`. For verify, an expired, unrevoked, unreleased, repo-bound stamp still passes when GitHub shows its PR open, the live body carries the stamp, and its task exists and is not `verified`. That GitHub read happens once per PR and only on expiry; a GitHub failure fails closed. A stamp with no PR (P2, P3) has no such exception. `resolveDispatchForMerge` accepts an expired, unrevoked, repo-bound stamp when the gate passed that exact PR head for its task; it does not test release, so attribution survives release. Since #262 (TASK-2111, 29 Sep 2026) a block names its reason as a text (`CHECKOUT_BLOCK_TEXT`, `checkoutBlockReason`), for example `checkout released — re-checkout the task`, and a missing task blocks as `task deleted — re-register` (`task_deleted`) instead of `task_closed`; the pass conditions did not change. | PLX_MC `service.ts:57-59,113-158,169-180`, `complete()` `:278-324`, `ingestPullRequest()` `:812-819,919-925`, all at `fc7ceef3d123` (at `7f79712657e3`, after #262: `:57-59` unchanged; `CHECKOUT_BLOCK_TEXT` and `checkoutBlockReason` `:108-134`; `resolveDispatch` `:141-153`; `resolveDispatchForOpenPr` `:157-174`; `prDispatchResolver` `:177-187`; `resolveDispatchForMerge` `:198-209`; `complete()` `:307-353`; `ingestPullRequest()` `:843-850,950-956`); `repo.ts:253-299,301-326` (unchanged through `7f79712657e3`); `db/migrations/026_dispatch_release.sql`; `docs/product/SYSTEM_OF_RECORD.md:45-51` |
| F3 | The MCP tool `mc_self_check` returns `ok`, operator, counts, and honesty fields. It returns no principal. `GET /api/cursor/self-check` returns the same `data` plus `meta.actor`, which includes `servicePrincipalId` (derived from the API key) and `repo` (echoed from the `x-mc-repo` header). `parse_error` is not a server field. Every `/api/cursor/*` call needs the headers `x-mc-operator-email` and `x-mc-repo`. `x-mc-runtime` is self-asserted and defaults to `cursor`. | PLX_MC `src/lib/mcp/actions.ts:61-72` at `2faa2a2c9633` (`actionSelfCheck`; the same lines at `fc7ceef3d123`; `:62-73` at `7f79712657e3`, same body, after #261 added 14 lines to the file); `src/app/api/cursor/self-check/route.ts`; `src/lib/mcp/envelope.ts:49`; `src/lib/mcp/auth.ts:120-140` (these three unchanged from `2faa2a2c9633` through `7f79712657e3`) |
| F4 | This Claude account lists two environments. On 28 Sep 2026 the operator renamed `env_01SVX8gUwth13dQuc5G2wRDQ` (formerly `PLX`) to `PLX Portal + MC`. The other is `Default` (`env_011f8FzdosCcNnecSTiXrX2U`), which carries the runbook variables. The review session cannot read the renamed environment's variables or network policy. | `list_environments` on 27 and 28 Sep 2026; portal `docs/runbooks/CLAUDE-CODE-WEB-MC-SETUP.md:110,117-125` |
| F5 | A multi-repo Claude web session starts in `/home/user`. That folder has no `.mcp.json`, so no PLX-MC tools load even with the key set. | Review session: six repos, `Default` environment, no `mc_*` tools |
| F6 | The source of `~/bin/plx-mc-stamp` is not committed in any of the six repos. The runbook documents env vars and output fields only. The Codex key maps to `sp_mcp_codex`. The checkout response carries no issue or expiry time. `GET /api/cursor/checkouts?taskId=&repo=&active=` returns rows with no raw id: each has `checkoutRef` (`dsp_…` plus the id's last 4 chars), `issuedAt`, `expiresAt`, `releasedAt`, `releasedReason`, and `active`. Since #255, `active` is false for a released stamp; it is a ledger-only flag and ignores the open-PR exception (F2). | portal `docs/runbooks/CODEX-CLOUD.md:33-51` at `2b656d8adf33` (unchanged through `6d3ae82e4eca`, `origin/staging` on 29 Sep 2026); PLX_MC `src/lib/mcp/actions.ts:357-384` at `fc7ceef3d123` (`actionCheckout`; `:371-398` at `7f79712657e3`, same body, after #261 added 14 lines above it), `src/app/api/cursor/checkouts/route.ts:1-25` and `src/lib/mcp/read-actions.ts:47-87,203-206` (`checkoutRef`, `redactCheckoutIds`, `toCheckoutView` and the `mc_list_checkouts` registration) at `fc7ceef3d123`, both unchanged through `7f79712657e3` |
| F7 | Appendix A reproduces the baseline numbers exactly: portal cursor 129113 at `b75477d9c85d`, PLX_MC cursor 52966 at `2faa2a2c9633`, and swarm codex `bytes_dropped` 44171 at `35ed5034eddf`. Portal Claude is 15862 raw bytes; the old 15861 dropped the trailing newline. At the heads above: portal cursor 130138, swarm cursor 117574 (the old 117875 had no SHA). | Appendix A run in the review session |
| F8 | PLX_MC: `scripts/generate-governance-surfaces.py` writes one block (including "Agent Task & PR Workflow", from `agent_workflow`) into AGENTS, CLAUDE, CODEX, GROK, GEMINI, and HERMES, and rewrites `.cursor/rules/governance.mdc`. Drift is checked by `--check` in `preflight.sh:103`. **Swarm:** the same-named generator writes only CLAUDE, CODEX, GROK, GEMINI, and HERMES marker blocks (`agent_behavior` + `writing_style`) plus `governance.mdc`; it does not touch AGENTS.md. `agent_behavior` is also injected into every swarm agent's runtime prompt, and `tests/test_governance_gates.py:89` pins 12 rules. Swarm AGENTS.md's only generated part is the `sync_cursor_rules_to_agents.py` embed of every `alwaysApply` rule, whose marker line starts at byte 33026, past the 32768-byte Codex cap. The hand-written Mission Control handshake section starts near byte 466. | PLX_MC `config/governance-contract.yaml:23-31,108`; swarm `scripts/generate-governance-surfaces.py:32,202-220`, `src/governance_preamble.py:25-40`, `.github/workflows/test.yml:129-134`, `tests/test_sync_cursor_rules_to_agents.py:76-79` |
| F9 | Swarm has two Lobster writers that push to `main` from `/home/ubuntu/agentic-swarm-8`. **(a)** `governance_repo_sync.py`: nightly at 01:30 ET, `dry_run: false`. Its allowlist permits AGENTS, CLAUDE, CODEX, GROK, GEMINI, HERMES, SOUL, TOOLS, `.cursor/rules/`, and `config/` (which includes `config/governance-contract.yaml`). **(b)** `lessons_rule_promote.py`: weekly. It writes `lessons/auto/promoted.md`, `.cursor/rules/operational-lessons.mdc` (`alwaysApply`), the `lessons:auto` blocks in CLAUDE, CODEX, GROK, and GEMINI, and `config/lessons.yaml`. `sync_to_sharepoint.py` writes SharePoint lists only. The phrase "lobster path" does not exist. Swarm CI runs on push to `main`, PRs to `main`, and `merge_group` only. | swarm `src/pipelines/governance_repo_sync.py:143-203`; `config/pipelines.yaml:421-431`; `src/pipelines/lessons_rule_promote.py:1-35,171-176`; `config/vmc-web-crontab:82`; `src/tools/sync_to_sharepoint.py:312-317`; `.github/workflows/test.yml:3-8` |
| F10 | Portal `plx-mc-compliance.yml` triggers on `pull_request` only, types `opened, synchronize, reopened` (job `compliance`). It is the copy pinned at `GEN_SHA` `1339f1196d4e…`, which predates #255, so it has no `edited`. `compliance-merge-group.yml` (TASK-2008) emits job `compliance` on `merge_group` and calls portal-only `scripts/merge-group-prs.mjs`. Its header says: once the generator grows `merge_group`, regenerate, bump `GEN_SHA`, and delete this file. `ci-staged-gate.test.mjs:871-956` pins that stopgap layout and runs in required CI; `:20` imports `scripts/merge-group-prs.mjs` and `:958-980` tests it. `lint-typecheck-build`, `Validate ledgers` and, since 28 Sep 2026, `workbench-api` (TASK-2037) already trigger on `merge_group`. The queue is not on for ruleset `18632985`; the planned `max_entries_to_merge` is 1. The drift check runs in each consumer against a pinned `GEN_SHA`. Re-checked at portal `2b656d8adf33`. | portal `.github/workflows/plx-mc-compliance.yml:8-10`; `compliance-merge-group.yml:1-19,168`; `scripts/ci-staged-gate.test.mjs:20,871-956,958-980`; `ci.yml:98,114,216-217,248`; `mc-quality-ledger.yml:20-33`; `compliance-gate-drift.yml:22-28`; `docs/runbooks/BRANCH-PROTECTION-STAGING.md:44-46,305-385` |
| F11 | `/api/compliance/verify` takes `repo`, `repoFullName`, `prNumber`, `headSha`, `changedPaths`, `labels`, `checkoutId` and `checkoutIds`. It takes no PR body and no `event`. OIDC tokens from events other than `pull_request` are rejected. Only `plx-mc-compliance.yml` and `compliance-gate.yml` are allowed. Bearer `COMPLIANCE_CI_TOKEN` has no binding. Since #255, `verifyPr` resolves each stamp with `prDispatchResolver`: `resolveDispatch` first (unknown, revoked, released, repo mismatch, expired, in that order); on `expired` only, one `loadPrState` GitHub read per PR, then `resolveDispatchForOpenPr` (PR open, stamp in the live body, task present and not `verified`). A GitHub failure throws, so `verifyPrOrQueue` answers `pending` and queues the verify (fail closed). Since #262 every block reason is a text from `CHECKOUT_BLOCK_TEXT` (F2). The merge-queue rule in D4 is narrower, not a subset: it accepts an expired stamp only on a prior pass of the same head, tests neither that the PR is open nor that the live body carries the stamp, and makes no GitHub read. | PLX_MC `src/app/api/compliance/verify/route.ts:24-33,51-64,88-102,137-147` (unchanged from `fc7ceef3d123` through `7f79712657e3`); `service.ts:108-158,407-460,1010-1023` at `fc7ceef3d123` (`:136-187`, `:436-491` and `:1041-1054` at `7f79712657e3`); `github-pr.ts:19-39` (unchanged) |
| F12 | Each of the four nested portal guides opens with "Auto-generated … by `scripts/sync-agents-md.py`. Do not edit manually." All four name retired agents, "Factory" among them (always the agent, never the plant). `components/AGENTS.md` lacks the consumer-copy banner the SOP requires. `scripts/sync-agents-md.py` still exists at the repo root; nothing in CI runs it. | portal `portal/src/*/AGENTS.md:3-10`, `portal/prisma/AGENTS.md`; `docs/runbooks/PLX-PORTAL-GOVERNANCE-SOP.md:165-173`; `scripts/audit-module-coverage.sh:211-229,333` |
| F13 | Portal required CI (`ci.yml:139` runs all of `scripts/ci-staged-gate.test.mjs`) reads real guide text in several places. The TASK-2004 test (`:766-828` at portal `2b656d8adf33`; its loop at `:820-827` requires root AGENTS.md, CLAUDE.md, GEMINI.md, and `.cursorrules` to carry the staging-merge sentence) bans phrases in AGENTS.md, CLAUDE.md, and `mc-compliance.mdc`, and pins exact strings in `.cursor/rules/auto-merge-after-push.mdc`, `.cursor/rules/pr-watch-until-green.mdc`, and two `.cursor/skills/*/SKILL.md`. The TASK-2008 test (`:871-956`) pins `auto-merge-after-push.mdc` and the branch-protection runbook. Swarm CI (`test.yml:167,170`) runs `check-flag-doc-parity.py` (the `### Feature Flags` table in AGENTS.md) and `check-config-drift.py` (the `| Module | Owner | Criticality |` table); local preflight does not run them. PLX_MC `check-arch-parity.py` pins two AGENTS.md architecture cells. `verify-claude-web-mc-wiring.test.mjs` tests fixtures only. The real-file checker `verify-claude-web-mc-wiring.mjs` (which wants `repo: petralabx/plx-customer-portal` and no `Never Hub` in AGENTS.md) is not in CI and fails today on an unrelated check. PLX_MC `tests/test_canary.py` pins strings in AGENTS.md, CLAUDE.md, and `governance.mdc` (for example "Mission First", `MC-Checkout: pending`, `verificationCommands`). | portal `ci.yml:139,173`; `scripts/ci-staged-gate.test.mjs:766-956`; `scripts/verify-claude-web-mc-wiring.mjs:103,114`; swarm `.github/workflows/test.yml:167,170`; PLX_MC `tests/test_canary.py:60-115`, `scripts/check-arch-parity.py:28-31` |
| F14 | Portal `.cursor/rules/mc-compliance.mdc` is 19778 bytes at the F7 head `b75477d9c85d` and 19795 bytes at `2b656d8adf33` (TASK-2037, `d164a52f4`, added 17 bytes; unchanged since, through `bc1272941c35`), and holds all 7 needles. The `sweep` check (Appendix B) over every `INSTR_FILES` file (root guides, rules, skills, prompts, runbooks) in the four repos finds exactly these competing complete-order lines. No test pins any of them. **Portal (19 lines, 15 files, line numbers at `2b656d8adf33`):** `AGENTS.md:29`, `CLAUDE.md:169`, `GEMINI.md:14`, `.cursorrules:101`, `.github/copilot-instructions.md:14`, `.cursor/rules/mc-compliance.mdc:21,230,344`, `.cursor/rules/mc-delegation.mdc:24,54-55`, `.cursor/skills/babysit/SKILL.md:24`, `.cursor/skills/mc-sync/SKILL.md:30-32`, `prompts/uat-agent/v2/CONTRACT.md:15`, `prompts/uat-agent/v2/SYSTEM.md:25`, `prompts/workbench-readonly-build-prompt.md:359` (`:354` at the F7 head), `docs/runbooks/CLAUDE-CODE-WEB-MC-SETUP.md:212`, `docs/runbooks/CLOUD-AGENT-ENVIRONMENT.md:155`, `docs/runbooks/CONTRIBUTING.md:293`. Most say "Last commit, then freeze. Completing releases the checkout."; the second sentence contradicts F2. **PLX_MC:** `docs/AGENT-PR-SOP.md:325`; `config/cloud-agent-fleet-always-apply.md:118-120` wraps across lines, so the sweep misses it and P8 checks it by name. **Swarm:** `AGENTS.md:20`, `CLAUDE.md:32`. **Secondbrain:** none. `INSTR_FILES` excludes `tasks/`: portal `tasks/lessons.md:15` at `2b656d8adf33` ("`mc_complete_task` must land BEFORE the PR is opened") matches `COMPETING`, agrees with the locked order, and stays out of scope. | `sweep` in the review session; portal `node scripts/uat-agent/verify-agent-contract.mjs` passes today |
| F15 | plx_secondbrain is tracked with `compliance_mode: soft` ("Stays soft; do not flip hard"), default bucket `BKT-KNOWLEDGE-HUB`, and base `main`. It has no AGENTS.md, no CLAUDE.md, and no `.cursor/rules/`. `docs/GOVERNANCE.md:14` says "**Do not duplicate** agent rules or MC-Checkout discipline in this repo." (with bold marks) | PLX_MC `config/tracked-repos-registry.json:185-205` (the `petralabx/plx_secondbrain` entry; the same lines at `2faa2a2c9633`, `fc7ceef3d123` and `7f79712657e3`, because #259 appended the `agent-runner` entry after it); secondbrain tree |
| F16 | The brain HTTP route exists. It exposes 11 tools, including `brain_self_check`. Two tools write: `brain_ingest` (up to 100000 chars into `memory.items`, namespace `swarm/brain-ingest`) and `brain_propose_relation` (confidence at most 0.7). Writes are limited to 30 per minute per tenant. Every valid key has the same write access. `X-Agent-Name` is self-asserted. The committed swarm `.cursor/mcp.json` and `.mcp.json`, and portal `.mcp.json` and `.cursor/mcp.json.example`, have no `plx-brain` key. | swarm `docs/runbooks/brain-mcp.md:15-42`; `apps/vmc-web/src/app/api/vmc/knowledge/mcp/route.ts`; `apps/vmc-web/src/lib/vmc/knowledge/mcp-http-{auth,server,tools}.ts` |
| F17 | `.github/workflows/` paths are high tier by path. The label `risk:high` forces high tier. High tier needs `testRun` or `shots`, a rollback, and a bucket PRD. The gate reads the task's bucket row (`bucketPrdForTask`). Since #263 (TASK-2112, merged 2026-09-29T22:22:59Z as `7f79712657e3`): `prd` counts as `present` only when it is an http(s) URL (`docLinkFromPrd`); `null` or any other value gives `absent`, which **blocks** ("high-risk change requires a linked bucket PRD"); a task with no bucket, or a bucket id the store does not hold, gives `no_bucket`, which also **blocks** ("high-risk change requires the task on an initiative with a linked bucket PRD"); only a failed bucket read gives `store_unavailable`, advisory. Before #263 any non-empty `prd` gave `present` and a missing bucket gave `unknown`, advisory. The seed rows for `BKT-PROD` and `BKT-INFRA` have `prd: null`; the live rows the r12 P15 run read on 29 Sep 2026 carry GitHub URLs (`merge-queue-audit.md`, `## raw`), which are links under #263. `mc_update_bucket { id, prd }` sets it; since #263 the initiative page also saves an https link. Re-checked at `7f79712657e3` (a fact P16 rests on through D11). | PLX_MC `src/lib/compliance/risk.ts:8-20,35-50` (unchanged through `7f79712657e3`); `src/lib/compliance/verify.ts` (`verifyCompliance`; the PRD branch is `:76-86` at `7f79712657e3`); `src/lib/compliance/bucket-prd.ts` (`bucketPrdForTask`, the whole 22-line file at `7f79712657e3`); `src/lib/mc-data/doc-links.ts` (`docLinkFromPrd`, `:46-57`); `src/lib/mc-data/data.ts:160,164`; `src/lib/mcp/create-http-server.ts` (`mc_update_bucket`: `:212` at `2faa2a2c9633`; its description line is `:249` at `7f79712657e3`) |
| F18 | Base branches: portal `staging`; PLX_MC, swarm, and secondbrain `main`. Default buckets: portal `BKT-PROD`; PLX_MC and swarm `BKT-INFRA`; secondbrain `BKT-KNOWLEDGE-HUB`. | registry; `origin/*` refs |
| F19 | Portal `.githooks/pre-push` blocks a push without a local stamp only for agent pushes: a `cursor/` or `cloud-agent/` branch, `CURSOR_AGENT` or `CURSOR_AGENT_PR_BODY` set, git email `cursoragent@cursor.com`, or git name "Cursor Agent". Other pushes count as human and pass. PLX_MC, swarm, and secondbrain have no `.githooks/`. | portal `scripts/lib/mc-pre-push-handshake.mjs:44-75,334-361` |
| F20 | Swarm deploy runs after `Test` on `main` only when `vars.SWARM_DEPLOY_ENABLED == 'true'`. `deploy-swarm.sh` runs `git reset --hard origin/main` in `/home/ubuntu/agentic-swarm-8`, which leaves untracked files in place. | swarm `.github/workflows/deploy-swarm.yml:11-16,40`; `scripts/deploy-swarm.sh:65-74` |
| F21 | 23 portal shims under `portal/src/lib` carry `module-shim — remove after 2026-09-30`. From 30 Sep 2026, `npm run audit:hygiene` prints its `Score:` line and then exits 2 ("CRITICAL: expired/invalid shim metadata detected") on unchanged `staging`. No phase in this plan owns those shims. | portal `scripts/audit-module-coverage.sh:158-202,333,370-373`; `grep -rl 'remove after 2026-09-30' portal/src/lib` |
| F23 | PLX_MC `src/lib/compliance/service.ts:98` (`:96` before #255) and `scripts/generate-compliance-gate.py:132` carry `module-shim — remove after 2026-10-15` comments, and the generated `.github/workflows/compliance-gate.yml:77` carries the generator's copy. No PLX_MC script or CI job enforces that date. | `grep -rn 'remove after'` over PLX_MC `scripts/`, `.github/workflows/`, `src/lib/compliance/` at `fc7ceef3d123` (the three lines are unchanged at `7f79712657e3`) |
| F22 | PLX_MC deploys to the Vercel project `plx-mission-control` at `https://mc.plxcustomer.io`. PLX_MC has no version route. | PLX_MC `AGENTS.md:59`; `vercel.json` |
| F24 | PLX_MC PR #255 (TASK-2011) merged on 2026-09-28T22:11:09Z as `f6d2bab7670a` (PR head `5f0419367467`); `main` at `fc7ceef3d123` includes it. It changed 17 files. What it does: an expired stamp passes verify while GitHub shows its PR open and the live body carries it (one GitHub read per PR, on expiry only; a GitHub failure fails closed); closing or merging the PR releases the stamp (`released_at`, `released_reason`, migration `026`, event `checkout.released`) after attribution and projection; reopening clears the release; `complete()` and the active-checkout listing treat a released stamp as invalid; the gate workflow and its generator also trigger on `pull_request` type `edited`, in both variants, and `tests/test_generate_compliance_gate.py:49-55` pins the four types. The PR body records that migrations 022–026 were applied to the production `plx_mc` database. Files P4 or P16 edit or cite: `src/lib/compliance/service.ts`, `src/lib/compliance/repo.ts` (`DispatchRow` gains `releasedAt` and `releasedReason`; the active filter adds `released_at IS NULL`; new `releaseDispatches` and `unreleaseDispatches`), `src/lib/compliance/github-pr.ts` (new `loadPrState`), `scripts/generate-compliance-gate.py`, `.github/workflows/compliance-gate.yml`, `docs/modules/compliance/README.md:47-54`, `tests/compliance-server.test.ts` (at `fc7ceef3d123`: a `loadPrState` mock at `:10-11`, a TASK-2011 block at `:139-251`, and `:462-473` now expects an expired stamp on an open PR to pass; at `7f79712657e3`, after #262 and #263, the block is `:144-274` and that case is `:513-524`), `tests/test_generate_compliance_gate.py`, and `src/lib/mcp/read-actions.ts`. P2 and P3 are unaffected: they open no PR, so the open-PR exception and release never apply, and the 8-hour rule stands because `complete()` still rejects expired stamps. The orchestrator's `gate0.md` (29 Sep 2026) records the #255 production deploy as succeeded (GitHub deployment 6721728347, 2026-09-28T22:11:43Z) and Vince's confirmation that migration 026 is applied in production; the P15 re-run records `pr255_deployed: yes` from that record (Vince, 2026-09-29T19:55:37Z). No phase gate depends on the deploy, because P4 and the P16 PLX_MC half deploy on top of it. | `gh pr view 255 --repo petralabx/PLX_MC` (`state: MERGED`, `mergeCommit: f6d2bab7670a`); `git -C PLX_MC log --oneline -3 fc7ceef3d123`; the files above at `fc7ceef3d123` |
| F25 | The swarm is being retired (swarm retirement spec r2 at the decision on 28 Sep 2026; r12 now). After its R0 usage audit, its R1 plans to turn off both writers: `governance-repo-sync` (Lobster) and `lessons-rule-promote` (a VMC cron). The repo is not archived: at the end (S7, then T3) it is pruned of non-trading code and renamed for the trading lab. The writers write only the swarm repo, so once no phase edits the swarm they cannot undo any frontier change. P7's withdrawal rests on that, not on R1. | swarm retirement spec r12 §8 at PLX_MC `fc7ceef3d123` (R0 `:169`, R1 `:198`, T3 `:818`, S7 `:936`); F9 |
| F26 | The brain moves to plx_secondbrain under the same spec, onto its own EC2 host at `brain.plxcustomer.io` (retirement D5; Q1 answered 28 Sep 2026). R6 routes the 11 key paths, `/api/vmc/knowledge/mcp` among them, on `missioncontrol.tayloralton.com` to the new service; R6a gives the brain its own name and TLS; R7 moves each caller to it. The R6 Caddy block stays for good (retirement D4): a caller left on the old host still reaches the brain, and from R11 the block forwards only requests that carry a brain key. The old host stays for the trading lab (retirement D8, S6). The brain accepts the `VMC_API_KEY` value only during the lift (retirement D3, as a hash: `VMC_API_KEY_SHA256`): R4 accepts, and R5 holds in the secret `prod/plx-brain`, `BRAIN_API_KEYS` (every brain key starts with `brn_`; a value changes by R5's procedure: update the secret, re-render `brain.env`, restart `plx-brain`, check `agent/status`), R7 issues each caller its `BRAIN_API_KEY`, and R11 stops accepting `VMC_API_KEY` and department keys. The frontier `BRAIN_URL` is the same value as the retirement `BRAIN_BASE_URL`. No key limits what the connector can read or write until R11 wires key scopes, which agrees with F16. | swarm retirement spec r12 (D3, D4, D5, D8, execution contract, R4, R5, R6, R6a, R7, R11, S6, Q1, section 10) |

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

**Confirmed:** D1 and D12 (Vince, 28 Sep 2026), then all the defaults below with the approval on 28 Sep 2026. **Withdrawn in r12:** D6 and D10, with the swarm work. **Re-derived in r13** after #255 merged, with the same defaults: D2, D4 and D13. D4's re-derivation includes two readings written in P16 (in `merge_group` mode the gate never calls `loadPrState`, and a released stamp blocks there); they are the re-derived default, not a new one, and Vince confirmed them on 29 Sep 2026 (2026-09-29T19:55:37Z, the draft's section-16 item 4). **Changed in r13** on the swarm retirement spec's instruction (its section 10, D3, R7, R11): D5's key source and D14's step name. D5 is a changed default, so the rule below applied and r13 needed Vince's yes: he gave `yes r13, D5 as r13` on 29 Sep 2026 (header `r13_yes`, `d5_r13_yes`). The phrase `D5 as r13` confirms D5; P14 records it; and round 10 reviewed D5, D14, F26, P13 and P14 on 29 Sep 2026, before P14 starts (D13, SC-13). D14's rule is unchanged; only its step name and its quiet window changed.

A yes accepts every default below. To change one, answer "yes, except D<n>: …".
That answer is still one yes. Before any phase that the exception touches runs, the
orchestrator writes the next revision of this spec with the exception applied, and
re-runs the review on the changed phases.

| # | Decision | Default in this spec | Why |
|---|---|---|---|
| D1 | P1 environment | **Confirmed 28 Sep 2026.** P1 runs on `PLX Portal + MC` (`env_01SVX8gUwth13dQuc5G2wRDQ`), renamed on 28 Sep 2026. The operator confirmed it carries the runbook variables; P1 proves them live. | F4: the name is in place; its variables cannot be read from the review session. |
| D2 | Lease contract (P4) | The lease key is task + repo. The holder is the authenticated principal recorded on the `checkout` event (`permissionActorId`; null counts as its own value), never a header. A stamp holds the lease while it is live (F2 after #255: unrevoked, unreleased, unexpired) and its task has no `task.completed` event for that stamp. So the lease ends at complete or at the TTL, whichever comes first. A merged or closed PR releases its stamp and frees the lease, and a reopened PR takes the lease back while its stamp is unexpired; both matter only for a stamp not yet completed, because the contract completes the task before its PR opens (steps 6 and 7). An expired stamp on an open PR still passes verify (F2) but holds no lease. The lease compares repos as verify does (`dispatchRepoMatches` with the caller's repo as the full name): a full slug against a full slug, a bare name against either, so `evil/PLX_MC` and `petralabx/PLX_MC` are different repos. Same holder: return the held stamp and append a `checkout.reused` event, not a second `checkout`, so checkout counts and announcements do not inflate. Different holder: HTTP 409 `checkout_held`. No migration and no revoke. **Re-derived in r13; the default is unchanged.** | F2, F3: the runtime is self-asserted, and a revoke would break merge attribution. #255 adds release, which the lease reads and never writes. |
| D3 | Second brain guides (P8) | Add the guides, and change `docs/GOVERNANCE.md:14` to point at them. | F15: the repo's own doc forbids a duplicate today. |
| D4 | Merge queue (P15, P16) | The generator learns `merge_group` inline, with no repo-local script, and keeps the four `pull_request` types #255 set (`opened, synchronize, reopened, edited`). The verify route accepts `merge_group` OIDC with `prNumber` bound to the queue ref. In merge-group mode, verify accepts an expired stamp only when the gate already passed that PR head for its task; it makes no GitHub read, and it rejects a revoked or released stamp as `pull_request` mode does. `pull_request` mode keeps #255's open-PR exception (F11). The portal regenerates, bumps `GEN_SHA`, updates its CI test, and deletes the stopgap; `scripts/merge-group-prs.mjs` stays, because the CI test imports it (F10). Turning on the queue stays a repo-admin action outside this plan. **Re-derived in r13; the default is unchanged.** **Two refinements confirmed by Vince on 29 Sep 2026** (2026-09-29T19:55:37Z; the draft's section-16 item 4): in `merge_group` mode the gate never calls `loadPrState`, and a released stamp blocks there (with the text reason #262 gives every block: `checkout released — re-checkout the task`, F2). | F10, F11. Adding `merge_group` to `plx-mc-compliance.yml` alone would make two workflows emit `compliance` and fail CI. The queue only re-confirms a head that already passed, so it needs no GitHub read, and the bearer path stays safe (P16). |
| D5 | Brain key (P14) | **Changed in r13** on the swarm retirement spec's instruction (its section 10, D3, R7, R11). Use a brain key: a `BRAIN_API_KEY` issued for the Cursor Team MCP registration, from the brain's `BRAIN_API_KEYS` (every brain key starts with `brn_`). Never the `VMC_API_KEY` value, and never a `VMC_SCOPED_API_KEYS` department key: those are VMC and trading keys, and R11 stops the brain from accepting them. Record the key name, never the value. Until R11, no key limits what the connector reads or writes. **Confirmed by Vince on 29 Sep 2026:** r12's yes covered r12's default, so r13 needed Vince's yes (the header's `r13_yes`). The yes to this change has one form, the phrase `D5 as r13` (r13 is the revision that changed D5, whatever revision the yes is given against), and Vince gave it in the yes on r13 (`yes r13, D5 as r13`, 2026-09-29T18:09:35Z; header `d5_r13_yes`). P14 records it in `brain-register.md` (`d5_confirmed`, `d5_confirmed_at`, `d5_confirmed_in: yes on r13`), its acceptance checks the phrase as a fixed line and against the header, and P14 records the brain's own log line for its self-check under `## raw` (key tier `brain`, step 6), where the acceptance rejects a VMC or scoped tier and pins no wording that retirement R4 does not promise; round 10 reviewed D5, D14, F26, P13 and P14 on 29 Sep 2026 (D13, SC-13). | Retirement D3 and R5: the brain holds only hashes of VMC's keys (`VMC_API_KEY_SHA256`, `BRAIN_SCOPED_KEY_SHA256`), and its own keys in `BRAIN_API_KEYS` (F26) rotate alone. r12's default (a VMC department key, else `VMC_API_KEY`) would send a trading-capable key to the brain's own name (retirement D3, B26). |
| D6 | Writer lock scope (P7) | **Withdrawn in r12,** with P7. The retirement spec's R1 plans to turn both writers off. | F25: the writers touch only the swarm repo, which no phase edits now. |
| D7 | High-tier bundle for P4 | P4 sends the high-tier bundle (`testRun` plus rollback) to `mc_complete_task`, even though its paths classify as standard. No PR relies on a label to set the tier. | `gh pr create` adds labels after `opened`, and the gate does not run on `labeled`, so a `risk:high` label may never reach it (F17). The P16 PRs are high tier by path (`.github/workflows/`). |
| D8 | Failed canary | A repo whose P9 canary fails does not enter P10. Vince decides its next step separately. | A safety section on a slice that does not load cannot help. |
| D9 | Meter views | `cursor`, `claude`, `codex`, `hermes`. `cursor-min` is dropped. | No document defines `cursor-min`, and no phase uses it. |
| D11 | Bucket PRD for high-tier PRs (P16) | P15 records whether `BKT-INFRA` and `BKT-PROD` have a PRD link (read with `mc_get_context { depth: "full" }`): since #263 the gate counts `prd` as present only when it is an http(s) URL (F17), so P15 writes `present` only for such a value and pastes the raw rows; the rows its r12 run read on 29 Sep 2026 hold GitHub URLs. If either is absent, P16 does not open that PR. Vince either sets `prd` on the bucket with `mc_update_bucket` and confirms it with the same read, (for example, a link to the approved copy of this spec), or names another path. No agent edits a bucket. | F17: `prd: null`, or a `prd` that is not an http(s) link, blocks every high-tier PR, and both P16 PRs are high tier by path. |
| D12 | Portal complete-order fix (P8) | **Confirmed 28 Sep 2026.** P8 gains a portal half. It replaces each F14 portal line with the locked sentence, keeping the rest of that line, including on-demand skills, prompts, and runbooks. Line-scoped: no other edit. P10 then only trims. | The fix should not wait on the portal canary (D8). Two of those files (`mc-sync`, `babysit`) sit on the PR-open path. |
| D10 | Swarm handshake carrier (P8) | **Withdrawn in r12,** with the swarm half of P8. | F25: the swarm is retiring; its own complete-order lines (F14) stay; the trading lab owns that repo after the retirement spec renames it. |
| D13 | PLX_MC PR #255 (P4, P15, P16) | **Applied in r13.** #255 merged on 28 Sep 2026 as `f6d2bab7670a` (F24). P4's code branch and P16 start only under r13 or later, after Vince's yes on r13, and only after round 10 has reviewed the r13 changes to P4, P15 and P16 and its findings are applied (the yes given and the review closed on 29 Sep 2026: header `r13_yes_at`, and `round_10_done_at`, set when the round-10 text merges; each phase's later yes is given after both, and its acceptance checks that). Round 10 also reviews the r13 changes that swarm retirement r12 section 10 required (D5, D14, F26, P13, P14); P14 starts only after that review, its later yes and Vince's `D5 as r13` (D5). P4's no-code branch (P3 outcome `same-stamp` or `409`) never waited. r13 re-derives F1, F2, F6, F10, F11, D2 and D4, and every test-file line P4 and P16 cite, against PLX_MC `main` `fc7ceef3d123` and portal `2b656d8adf33`. P16's former test "`pull_request` with an expired stamp still blocks" no longer holds and is replaced. The P16 portal half also owns the portal `.cursor/rules/mc-compliance.mdc` lines that say "Do not add `edited` in this repo" and name the three trigger types (`:128-131` and `:301-309` at `2b656d8adf33`), and the sentence "Until TASK-2011 is live, the Hub may still block an expired stamp; do not restamp ahead of that verdict." (`:137-139`; stale since #255 deployed, F24; Vince accepted this edit on 2026-09-29T19:55:37Z, the draft's section-16 item 2), wherever P8 and P10 leave them; that half runs after P8 and P10 on the portal, with no after-P8-alone path (Vince, 2026-09-29T19:55:37Z; if the portal canary fails and P10 portal never runs, D8, the half stays blocked until he decides again). Its rewrite stays within P10's caps and keeps every needle and P8's carrier rule, and its acceptance re-runs those checks, so it cannot undo either phase unseen. P15 records `pr255: merged f6d2bab7670a` and `gate_pr_types`. An r12 run of P15 does not satisfy r13: P15 runs again under r13 before P16 starts, and the P16 PLX_MC acceptance reads both r13 lines from `merge-queue-audit.md`. P4 and P16 record `pr255:` and `spec_revision:` in their evidence. | F24: #255 changed what "live" means for a stamp, and it edited files that P4 and P16 edit or cite. |
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
- **SC-8:** the brain registration takes only the server name (`plx-brain`) and the header names (`X-API-Key`, `X-MCP-Session`, `X-Agent-Name`) from swarm `docs/runbooks/brain-mcp.md:32,34-36` (at `b1117811cbd7`, the ref P14 cites). The URL comes from D14 (the retirement spec's R6a) and the header value from D5 (a brain key from `BRAIN_API_KEYS`, confirmed by Vince as `D5 as r13` on 29 Sep 2026). The runbook's auth row (`:17`), its URL row (`:33`) and the key value in its `X-API-Key` row (`:34`) name the old host and VMC keys; they are superseded for P14, while the header name in `:34` is one of the rows P14 takes, and no frontier phase edits that runbook (SC-12). `brain-register.md` records the key name and the key's sha256 prefix, the pre-check and the Team MCP list's state before registration, the later yes that named `BRAIN_URL`, the `D5 as r13` yes and where Vince gave it, the brain's own log line for the self-check (key tier `brain`), and the two write tools, and never a VMC key. The review and writing sessions do not register it.
- **SC-9:** exactly one portal workflow defines job `compliance` and triggers on `merge_group`: the generated `plx-mc-compliance.yml`. `compliance` stays required. `COMPLIANCE_MODE` is unchanged.
- **SC-10:** T3, Hindsight, a new agent roster, Hermes cloud, a Grok cloud environment, an AWS `--apply` bootstrap, and turning on the merge queue stay out of every phase.
- **SC-11:** every code-phase PR carries a live `MC-Checkout: dsp_*` line at open. That stamp's `actor.repo` equals the PR's repo, and the PR's `compliance` check ends SUCCESS.
- **SC-12:** no phase edits `petralabx/agentic-swarm`. Its own competing lines (F14: `AGENTS.md:20`, `CLAUDE.md:32`) stay: the trading lab owns that repo after the retirement spec renames it.
- **SC-13:** P4's code branch, the P15 re-run, P14 and P16 start only under r13 or later, after Vince's yes on r13 and after round 10 has reviewed the r13 changes to P4, P15 and P16 (D13) and to D5, D14, F26, P13 and P14 (retirement section 10). P16 also waits for the P15 re-run: an r12 run of P15 does not satisfy r13. P14 also waits for the later yes that names `BRAIN_URL` and for Vince's `D5 as r13` (given in a yes on r13 or in that later yes), and `brain-register.md` records both. #255 merged on 28 Sep 2026 as `f6d2bab7670a`. Vince's yes on r13 (2026-09-29T18:09:35Z) and round 10 (closed 29 Sep 2026) are recorded with their UTC times: `r13_yes_at` in the header, and `round_10_done_at`, which the orchestrator sets in its execution copy in the store (the copy that holds the approval fields, `docs/specs/README.md`) to the time the round-10 text merged to PLX_MC `main`, with no second PR. The acceptance of each gated phase reads `r13_yes`, `round_10` and `r13_yes_at` from the spec on PLX_MC `main`, derives the merge time of the round-10 text from `main`'s first-parent history, fails while the execution copy's `round_10_done_at` is not set or differs from that time, and requires the phase's `later_yes_at` (P4, P16, P14) or `audited_at` (the P15 re-run) to be later than both.

## Scope

- **In:**
  - P1: a fresh Claude web proof on `PLX Portal + MC`.
  - P2: one Codex Cloud stamp on `PLX portal staging` via `~/bin/plx-mc-stamp`, repo `petralabx/plx-customer-portal`. Search before creating a task.
  - P3: a double-checkout record on the deployed Hub. P4: a lease in `petralabx/PLX_MC`, base `main`, only when that record is `second-stamp`.
  - Context diet on three governed repos (portal, PLX_MC, plx_secondbrain): one short root guide, and long rules load only when the task needs them. The swarm is measured only. Slices: measurement (P5), meter (P6), complete-order sentence (P8), loader canary (P9), guide trim (P10).
  - P11, P12: correct `portal/src/app/AGENTS.md`, `portal/src/components/AGENTS.md`, `portal/src/lib/AGENTS.md`, and `portal/prisma/AGENTS.md` on `petralabx/plx-customer-portal`, base `staging`.
  - P13, P14: register Team MCP server `plx-brain`, with the server name and header names from `petralabx/agentic-swarm` `docs/runbooks/brain-mcp.md` (its URL row and its key values are superseded, SC-8), the URL from the retirement spec's R6a (D14), and a brain key from `BRAIN_API_KEYS` (D5).
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
SPEC_EXEC=<abs path>                    # the execution copy of this spec in the store (docs/specs/README.md); its round_10_done_at line is what the r13-gated acceptances read (SC-13)
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
- P4's code branch and the PLX_MC half of P16 waited for PLX_MC PR #255, which merged on 28 Sep 2026. Both start only under r13 or later, after Vince's yes on r13 and its round-10 review (D13, SC-13; the yes is recorded in the header, and round 10's time, `round_10_done_at`, is set when its text merges; each then waits for its later yes, given after that time). P15 runs again under r13 on the same terms, before P16: an r12 run of P15 does not satisfy r13. P14 also starts only under r13 or later, after that yes, after round 10 has reviewed D5, D14, F26, P13 and P14, and after Vince's `D5 as r13` (all three given or done on 29 Sep 2026), and then after its later yes that names `BRAIN_URL` (SC-13).
- A swarm-retirement PR that edits the same files as a frontier phase never runs alongside it on the same repo; the second branches from base after the first merges. Known overlaps: retirement R7 edits PLX_MC `config/governance-contract.yaml` and regenerates its guides (P8 and P10 on PLX_MC); retirement S7 edits portal `CLAUDE.md` and PLX_MC guides (P8 and P10); retirement R7's portal PR edits `.cursor/rules/session-knowledge-artifact.mdc`, which P10 portal owns through `.cursor/rules/**`. Retirement R7's operator step said, through r12, to update the Cursor team MCP registration (retirement r12 `:546-547`), and only its B16 (`:50`) said that frontier P14 registers the brain. That registration is P14's (D14, SC-8). Retirement r13 (29 Sep 2026, on Vince's answer to round-10 open question 3, 2026-09-29T19:54:30Z) amends R7: it leaves the Cursor Team MCP entry to frontier P14 and records `team_mcp: left to frontier P14`, and its B16 and section 10 say the same. P14's own pre-step still guards the entry: the operator reads the Team MCP list before registration and records `team_mcp_plx_brain_before: none`; an existing `plx-brain` entry stops P14, which records `present` and registers nothing, and Vince decides. So the entry exists once, registered by P14, and never at the old host.
- P4 and the PLX_MC half of P16 never run at the same time, because both edit `src/lib/compliance/service.ts`. Whichever starts second branches from `main` after the first merges.
- The P8 portal half merges before P10 portal starts, because both edit root guides and rules. The P16 portal half branches from `staging` after the P8 and P10 portal PRs have merged, because all three edit `.cursor/rules/mc-compliance.mdc`, and P10 and P16 both edit `.cursor/rules/auto-merge-after-push.mdc` (D13; no after-P8-alone path: Vince, 2026-09-29T19:55:37Z). The P16 portal acceptance re-runs P10's cap and needle checks and P8's carrier rule on the rules it edits, so its rewrite cannot undo either phase unseen. P12 touches only the four nested guides, so it is independent of all three.
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
   8. If a checkout returns 409 `checkout_held` (after P4 deploys), stop and report the 409 message (task, repo and expiry) to Vince. The holder is the `permissionActorId` on that stamp's oldest `checkout` event, which Vince can read in Mission Control; the message does not name it (Vince: expiry only, 2026-09-29T19:50:13Z; round 10, open question 1). Never create a new task to get around it.
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
- **depends_on:** `[P3]`. The code branch also needs D13: #255 merged, so it runs under r13 or later, after Vince's yes on r13 and round 10 (the yes recorded in the header; round 10's time, `round_10_done_at`, set when its text merges), and after the later yes that names P4, given after `round_10_done_at` and recorded in `lease-closeout.md` (`later_yes`, `later_yes_at`; SC-13). Never runs at the same time as the PLX_MC half of P16.
- **branch on P3:**
  - If P3 records `outcome: same-stamp` or `outcome: 409`, write `closed: no-code` in `lease-closeout.md`. Make no product diff and open no PR.
  - If P3 records `outcome: second-stamp`, build the lease below.
- **lease contract (D2):**
  - Candidates come from a new unbounded query in `repo.ts`, `liveDispatchesForTask(taskId)`: rows where `task_id = $1 AND NOT revoked AND released_at IS NULL AND expires_at > now()` (the "live" test `listDispatches` uses since #255, `repo.ts:281`, unchanged from `fc7ceef3d123` through `7f79712657e3`), ordered by `issued_at` ascending. Keep only rows where `dispatchRepoMatches(row.repo, input.repo, input.repo)` is true: the third argument makes a full slug bind to a full slug (`dispatchRepoMatches`, `service.ts:94-97` at `7f79712657e3`, unchanged since `fc7ceef3d123`), so a stamp minted for `evil/PLX_MC` never holds the lease for `petralabx/PLX_MC`, while a bare `PLX_MC` still matches its full name (`:100-105`), as verify treats them (the case `prefers an available full slug and rejects a same-bare-name foreign checkout`, `tests/compliance-server.test.ts:383-403` at `7f79712657e3`).
  - A candidate holds the lease unless a `task.completed` event has `payload.checkoutId` equal to its id. Read this with a new query in `repo.ts`, `completedCheckoutIds(taskId)`, which selects `payload->>'checkoutId'` from events where `task_id = $1` and `kind = 'task.completed'` (no limit, so a busy task cannot push the event out of a window).
  - The holder of a leased dispatch is `payload.permissionActorId` on its first `checkout` event. Read it with a new query, `checkoutHolder(checkoutId)`, which selects that field from the oldest `checkout` event whose `payload->>'checkoutId'` equals the id. Null counts as its own value.
  - If several dispatches hold a lease, the oldest `issued_at` wins.
  - If `input.actor?.id ?? null` equals the holder, take that holder's leased dispatch with the latest `expires_at`. If it has at least 60 minutes left, return its `checkoutId` and insert no dispatch. Otherwise mint a new stamp as today (same holder, so no 409), so a caller never gets a stamp that is about to expire. A re-mint appends a normal `checkout` event, so `checkoutHolder` finds its holder. When, and only when, an existing id is returned, append one `checkout.reused` event (same payload as `checkout`, including `door`), not a second `checkout`, so `activity.ts`, `go-live-announcer.ts`, and routing counts do not change.
  - If the holder differs, throw `ApiError("checkout_held", "<task> is checked out on <repo> by another principal until <expires_at>.", 409)`. Insert nothing.
  - With no leased dispatch, mint as today. The lease ends at complete or at the TTL, whichever comes first (D2). A released stamp (its PR merged or closed, F2) is not a candidate, so release frees the lease; a reopened PR un-releases its stamp, which then holds the lease again while it is unexpired. Release and reopen change the lease only for a stamp that is not yet completed, and an expired stamp on an open PR holds no lease, although it still passes verify (F2).
  - Every door (`mc_checkout_task`, `POST /api/cursor/checkout`, `POST /api/compliance/checkout`) goes through `checkout()`, so all of them change together.
- **known limit:** two concurrent first calls can both insert. No DB constraint prevents it, and this phase does not fix that race (see Risks).
- **owns:**
  - `src/lib/compliance/service.ts`
  - `src/lib/compliance/repo.ts` (the three new queries only)
  - `tests/checkout-lease.test.ts`
  - `docs/modules/compliance/README.md` (the checkout contract section only: describe the lease)
  - `$PROOFS/lease-closeout.md` (code branch: also `pr255: merged f6d2bab7670a`, `spec_revision: r<n>`, n ≥ 13, `later_yes: yes P4` in Vince's words, and `later_yes_at: <UTC>`, later than the header's `r13_yes_at` and `round_10_done_at`)
  - the `vi.mock("@/lib/compliance/repo", …)` factories in `tests/*.test.ts`: add the functions `checkout()` now calls (`liveDispatchesForTask`, `completedCheckoutIds`, `checkoutHolder`), and reset shared mock state in `beforeEach` where a test file lacks it. Never change or delete an existing `expect(`.
- **forbidden:** any edit to `tests/checkout-shared-core.test.ts`; `db/migrations/**`; `src/app/api/compliance/verify/**`; `scripts/generate-compliance-gate.py`; `.github/workflows/**`; `plugins/**`; Jev globs
- **tests:** commit `tests/checkout-lease.test.ts` first, using the mocked-repo pattern of `tests/compliance-server.test.ts:10-142` at `7f79712657e3` (from the `github` hoist to the end of the root `beforeEach`: the `github` and `db` hoists, the `vi.mock` factories for `@/lib/compliance/repo`, `@/lib/sync/repo`, `@/lib/sync` and `@/lib/compliance/projection`, `taskish` and the root `beforeEach`; the range was `:10-137` at `fc7ceef3d123`, before #262 and #263 added a `bucketsThrow` flag, a throwing `getBuckets` mock and three `beforeEach` lines; P16 copies the same range; every line in this bullet is at `7f79712657e3`, and P4 re-checks them at the code of the day before it starts, facts preamble). The `db` and the repo factory alone are not enough: `checkout()` also calls `getEntity` (`service.ts:251`) and `patchTask` (`:254`), and `service.ts:44` imports `github-pr`. Since #255 the dispatch rows carry `releasedAt` and `releasedReason`, and the factory mocks `releaseDispatches`, `unreleaseDispatches` and `eventTaskIdByDedupKey`. The holders are `actor` objects that the policy allows for `task.checkout`, for example `{ kind: "service", id: "sp_mcp_codex", status: "active" }` and the same with `sp_mcp_cursor`: the `MCP_AGENT_CAPABILITIES` list and `SERVICE_GRANTS` in `src/lib/permissions/grants.ts` (`:51-72` at `fc7ceef3d123`) and the `MCP_AGENT_SERVICE_PRINCIPAL_IDS` array in `src/lib/permissions/types.ts` (`:131-138` at `fc7ceef3d123`; #259 added `sp_mcp_agent_runner` to it, and #261, merged 2026-09-29T21:24:23Z as `25ff88b7234b`, added `sp_mcp_portal` to it and gave that principal its own least-privilege grant in `SERVICE_GRANTS` (`PORTAL_MCP_CAPABILITIES`: `task.read` and `task.create` only, decision CG-07b), so read both files by symbol, not by line; `sp_mcp_codex` and `sp_mcp_cursor` still carry `MCP_AGENT_CAPABILITIES`, with `task.checkout`, and `sp_mcp_portal` is not a valid holder); with `input.actor` set, `checkout()` runs `authorizeStaged` (`service.ts:228-242`; `src/lib/permissions/enforcement.ts:213`, unchanged since `fc7ceef3d123`, whose decision record is fire-and-forget). The null holder is a call without `actor`; no existing checkout test passes one. The copied `insertDispatch` mock (`compliance-server.test.ts:45-46` at `7f79712657e3`; `:44-45` at `fc7ceef3d123`) sets `expiresAt` to `Date.now() + 3_600_000`, exactly 60 minutes, so a stamp it mints has under 60 minutes left by the time the next `checkout()` runs and the lease re-mints: the "same holder gets the same id" case sets a longer expiry on the held stamp before the second call (120 minutes is enough), and the under-60-minutes case sets its own shorter one. It covers:
  - the same holder gets the same id, with one `checkout.reused` event and no new dispatch
  - the same holder with under 60 minutes left gets a new stamp, recorded with a normal `checkout` event
  - after that re-mint, once the first stamp expires, the same holder's next call returns the new stamp with no 409
  - a different holder gets 409
  - a completed stamp frees the lease
  - a released stamp (its PR merged or closed) frees the lease: the next call mints a new one. Its `it` title contains the phrase `released stamp frees the lease`. The acceptance reads it from the last ` > ` segment of each `npx vitest list` line, which is the `it` title (a `describe` title does not count); `vitest list` prints one line per collected test and nothing from the file body. A grep of the file text cannot serve here, because the copied mock factory already contains `releasedAt`, `releasedReason`, `releaseDispatches` and `unreleaseDispatches`.
  - an expired or revoked stamp mints a new one
  - a different repo mints a new one
  - a same-bare-name repo under another owner (a stamp for `evil/PLX_MC`, then a call for `petralabx/PLX_MC`) mints a new one. Its `it` title contains the phrase `another owner mints a new stamp`; the acceptance reads it from the `it` titles of `npx vitest list` in the same way.
  - a bare repo (`PLX_MC`) matches its full name (`petralabx/PLX_MC`)

  The first commit must fail; record `failing_first: <sha> fail`. The existing provenance test (`records door provenance on the checkout audit payload (P5)`, `compliance-server.test.ts:289-307` at `7f79712657e3`) and the TASK-2011 block (`open PR checkout lifetime (TASK-2011)`, `:144-274`) must pass unchanged.

  Every case mocks `repo`, so no test reaches the SQL of `liveDispatchesForTask`. The acceptance therefore also extracts the body of `liveDispatchesForTask` from the PR head's `src/lib/compliance/repo.ts` (from its `export` line to the next `export`) and requires `released_at IS NULL` and `expires_at > now()` in it, so a comment or another line elsewhere in the file cannot satisfy the check.
- **after merge:** CIP lands the PR. The operator confirms that `mc.plxcustomer.io` deployed the merge SHA and records `deployed_sha: <12 hex>`.
- **rollback:** revert the P4 commits on PLX_MC `main` and redeploy. There is no schema change to undo.

Acceptance (P4, cwd = P4 worktree):
```bash
. "$TOOLS/accept.sh"; L=$PROOFS/lease-closeout.md
if grep -qxF 'outcome: second-stamp' "$PROOFS/double-checkout.md"; then
  SPEC=$(git -C "$PLX_MC_REPO" show origin/main:docs/specs/frontier-implementation-spec.md) || fail "spec on PLX_MC main"
  HDR=$(printf '%s\n' "$SPEC" | awk '/^```$/{n++; next} n==1'); n() { printf '%s\n' "$1" | sed -E 's/\.[0-9]+Z$/Z/'; }
  printf '%s\n' "$HDR" | grep -qE '^r13_yes: yes r13, D5 as r13 ' || fail "r13_yes is not recorded on PLX_MC main (SC-13)"
  printf '%s\n' "$HDR" | grep -qE '^round_10: done ' || fail "round 10 is not done on PLX_MC main (SC-13)"
  YES_AT=$(printf '%s\n' "$HDR" | sed -nE "s/^r13_yes_at: ($TS)$/\1/p"); [ -n "$YES_AT" ] || fail "r13_yes_at is missing from the header (SC-13)"
  # round_10_done_at lives in the execution copy (README). It must equal the time the round-10 text merged to main: the committer time of the first first-parent commit that carries the round_10 line.
  R10L=$(grep -E '^round_10: done ' "$SPEC_EXEC") || fail "round_10 is not done in the execution copy (SC-13)"
  printf '%s\n' "$HDR" | grep -qxF -- "$R10L" || fail "the execution copy's round_10 line is not the one on PLX_MC main now: an amendment changed it, so round_10_done_at must be set again from its merge (SC-13)"
  R10C=''; while read -r c; do T=$(git -C "$PLX_MC_REPO" show "$c:docs/specs/frontier-implementation-spec.md" 2>/dev/null) && printf '%s\n' "$T" | grep -qxF -- "$R10L" && { R10C=$c; break; }; done < <(git -C "$PLX_MC_REPO" log --first-parent --reverse --format=%H origin/main -- docs/specs/frontier-implementation-spec.md)
  [ -n "$R10C" ] || fail "no commit on PLX_MC main carries the execution copy's round_10 line: the round-10 text has not merged (SC-13)"
  R10_MERGED=$(TZ=UTC git -C "$PLX_MC_REPO" show -s --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ "$R10C") || fail "commit time of $R10C"
  R10_AT=$(sed -nE "s/^round_10_done_at: ($TS) \(PR #[0-9]+.*\)$/\1/p" "$SPEC_EXEC"); [ -n "$R10_AT" ] || fail "round_10_done_at is not set in the execution copy (SC-13)"
  [ "$(n "$R10_AT")" = "$R10_MERGED" ] || fail "round_10_done_at ($R10_AT) is not the time the round-10 text merged to PLX_MC main ($R10_MERGED, $R10C)"
  rline 'later_yes: yes P4.*' "$L"; rline "later_yes_at: $TS" "$L"; LY=$(sed -nE "s/^later_yes_at: ($TS)$/\1/p" "$L")
  [[ "$(n "$LY")" > "$(n "$YES_AT")" && "$(n "$LY")" > "$(n "$R10_AT")" ]] || fail "the P4 later yes predates the yes on r13 or round 10 (SC-13)"
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
  LL=$(npx vitest list tests/checkout-lease.test.ts) || fail "vitest list"
  LT=$(printf '%s\n' "$LL" | awk -F ' > ' '{print $NF}')   # the it titles: the last " > " segment of each line; a describe title does not count
  printf '%s\n' "$LT" | grep -qiF 'released stamp frees the lease' || fail "no released-stamp case in the lease test's it titles (D2, F2)"
  printf '%s\n' "$LT" | grep -qiF 'another owner mints a new stamp' || fail "no foreign-owner case in the lease test's it titles (D2)"
  Q=$(awk '/^export (async )?function liveDispatchesForTask/{p=1} p&&/^export /&&!/liveDispatchesForTask/{exit} p' src/lib/compliance/repo.ts)
  [ -n "$Q" ] || fail "no liveDispatchesForTask in repo.ts (D2)"
  printf '%s\n' "$Q" | grep -qF 'released_at IS NULL' || fail "liveDispatchesForTask ignores release (D2, F2)"
  printf '%s\n' "$Q" | grep -qF 'expires_at > now()' || fail "liveDispatchesForTask ignores expiry (D2)"
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
  - Record that the swarm retirement spec's R4 gives the new brain service in plx_secondbrain its key check (a brain key from `BRAIN_API_KEYS`), R6 routes this path to that service, R6a gives the brain its own address, and R7 moves each caller to it (F26; the template's `moves_to` line names R4, R6 and R7, as retirement section 10 does). P14 registers that address with a brain key (D5, D14).
  - Record `registered: no`. Never paste a key.
- **r13:** only the R6a fact above changed (retirement section 10: "P13 runs as it is"); the gate, the template and the acceptance are r12's, and the template's `moves_to` line keeps its r12 wording. A P13 run under r12 stays valid for P14, and an r12 run that records "R7 gives the brain its own address" is harmless: P14 takes the address from D14 (`BRAIN_URL`), never from `brain-audit.md`. Round 10 reviewed this change with P14 on 29 Sep 2026 (D13, SC-13).
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

- **gate:** later yes that names `BRAIN_URL` (D14), given against r13 or later and after `round_10_done_at` (header; D13, SC-13), plus Vince's yes to D5 as changed in r13. The D5 yes has one form, the phrase `D5 as r13`, and Vince gave it once, in the yes on r13 on 29 Sep 2026 (`yes r13, D5 as r13`; header `d5_r13_yes`), so the later yes is `yes P14, BRAIN_URL=https://brain.plxcustomer.io` (it may repeat `, D5 as r13`). `r13` names the revision that changed D5, whatever revision the yes is given against, so the phrase stays the same under r14 or later and the acceptance checks it as a fixed line and against the header. The later yes is the explicit enablement this write-capable integration needs, and the D5 phrase is Vince's yes to the changed default (the rule under "Decisions a yes confirms"); r12's yes covered r12's D5 only. · **executor:** operator (cursor.com dashboard; the pre-check and the log copy from an operator machine) · **recorder:** orchestrator · **repo edit:** none
- **depends_on:** `[P13]`, plus Vince's yes on r13 and round 10 applied to the r13 changes to D5, D14, F26, P13 and P14 (the yes given and the review closed on 29 Sep 2026; `round_10_done_at` set when the round-10 text merges; D13, SC-13), plus Vince's `D5 as r13` (given in the yes on r13), plus the pre-check of step 2: `brain_self_check` answering at `$BRAIN_URL/api/vmc/knowledge/mcp` with a brain key (retirement R6a is done; the rest of R7 need not be done), plus a `BRAIN_API_KEY` issued for the Cursor Team MCP registration: retirement R4 accepts, and R5 holds in the secret `prod/plx-brain`, `BRAIN_API_KEYS`; the operator makes the key off the brain host and off every trading host (R6a: no key material is typed on the brain host) and adds it by R5's change procedure (update the secret, re-render `brain.env`, `systemctl restart plx-brain`, check `agent/status`), which does not wait for R7 (retirement section 10 says P14 needs only the host answering `brain_self_check`), plus the Team MCP list holding no `plx-brain` entry before P14 registers one (step 3; Scheduling: retirement r13 leaves that entry to P14)
- **owns:** `$PROOFS/brain-register.md`
- **forbidden:** `.cursor/mcp.json`, `.mcp.json`, and any stdio `plx-brain` block in a committed file; `plugins/**`, `.github/workflows/**`; `PLX_MC_MCP_API_KEY`, the `VMC_API_KEY` value or any `VMC_SCOPED_API_KEYS` department key as the header value (D5); Jev globs
- **stop rule:** if one of the four runbook rows P14 takes is missing from swarm `docs/runbooks/brain-mcp.md` at `origin/main` or no longer carries its name (the server name `plx-brain`, `:32` at `b1117811cbd7`, and the header names `X-API-Key`, `:34`, `X-MCP-Session`, `:35`, and `X-Agent-Name`, `:36`; row `:34` counts by its header name only, because its value, a VMC key, is superseded for P14 by D5, so a changed value there does not stop P14; the URL row `:33` and the auth row `:17` are superseded for P14, SC-8, and do not count), if no brain key has been issued for this registration (`depends_on`: R5 holds it in `prod/plx-brain`; P14 never registers with any other key), if the pre-check (step 2) does not answer `ok` at `$BRAIN_URL/api/vmc/knowledge/mcp` with the brain key (a 401 means the brain's MCP auth path does not accept brain keys yet), or if the Team MCP list already has a `plx-brain` entry (step 3), stop and register nothing.
- **steps:**
  1. The orchestrator records the yeses in `brain-register.md` before anything is registered: `spec_revision: r<n>` (the revision the later yes was given against; n ≥ 13); `later_yes: yes P14, BRAIN_URL=<BRAIN_URL>` or `later_yes: yes P14, BRAIN_URL=<BRAIN_URL>, D5 as r13` (Vince's words, in the gate's form) and `later_yes_at: <UTC>`, later than the header's `r13_yes_at` and `round_10_done_at`; `d5_confirmed: D5 as r13`, `d5_confirmed_at: <UTC, when Vince gave the yes that carried the phrase>` and `d5_confirmed_in: yes on r<n>` (the yes on r13, or on the revision current when he gave it) or `d5_confirmed_in: P14 later yes`. For `yes on r13`, `d5_confirmed_at` is the header's `d5_r13_yes` time (2026-09-29T18:09:35Z), and the acceptance compares the two. Without a yes from Vince that carries `D5 as r13`, P14 does not start.
  2. **Pre-check** (operator, from an operator machine; never the brain host, never a trading host): call `brain_self_check` at `$BRAIN_URL/api/vmc/knowledge/mcp` with `X-API-Key` set to the brain key, read from an environment variable and never typed inline, and `X-Agent-Name: plx-brain`. The route is stateless Streamable HTTP with JSON responses (swarm `apps/vmc-web/src/app/api/vmc/knowledge/mcp/route.ts:46-49` at `b1117811cbd7`, which retirement R4 copies), so an MCP client or one `POST` carrying a JSON-RPC `tools/call` for `brain_self_check` (`Accept: application/json, text/event-stream`; an `initialize` request first if the server asks for one) serves. Record `precheck_at: <UTC>` and `precheck: ok`; `brain_host_live_at` is the `precheck_at` of the first pre-check that answered. On a 401, stop and register nothing: the brain's MCP auth path resolves the key against `VMC_API_KEY` (swarm `mcp-http-auth.ts:56-61`, apart from the REST handler at `api/api-handler.ts:201,261`), which the brain never holds (retirement R4 `env.names`: `never`), so until R4 rewires that path too the route answers 401 "Server-side VMC_API_KEY is not configured" (`mcp-http-auth.ts:63-71`); report it to the retirement operator.
  3. **The list before:** at cursor.com/agents → MCP servers, record `team_mcp_plx_brain_before: none` when the Team MCP list has no `plx-brain` entry. If one exists, record `present`, stop and register nothing; Vince decides (Scheduling).
  4. At cursor.com/agents → MCP servers → Add server, enter the name `plx-brain` and use the header names `X-API-Key`, `X-MCP-Session` and `X-Agent-Name`: the only rows P14 takes from swarm `docs/runbooks/brain-mcp.md` (four rows: `:32`, `:34`, `:35` and `:36` at `b1117811cbd7`; SC-8). The URL is `$BRAIN_URL/api/vmc/knowledge/mcp` (the R6a address, D14), not the runbook's `:33`; the `X-API-Key` value is the brain key chosen by D5 (a `brn_` key from `BRAIN_API_KEYS`), not the value in the runbook's `:17` or `:34`, which name VMC keys. Row `:34` gives P14 its header name only; the URL row, the auth row and that value are superseded for P14, and every row stays unedited (SC-12). Set `X-Agent-Name: plx-brain` (the identity's actor, swarm `mcp-http-auth.ts:37-43`; the default actor is also `plx-brain`, `:43`, and retirement R4 does not promise that the log prints it, so this header identifies nothing in the log, step 6). Optionally add `X-MCP-Session: plx-brain`. Record `key_name: BRAIN_API_KEY:<label>` (the label the operator gave the key when it was issued; it never starts with `brn_`, so the acceptance's key-material check cannot mistake it for a key) and `key_sha256_prefix: <the first 12 hex of sha256 of the key value>`, computed off the brain host and off every trading host, so that rotation and retirement R11 can find the entry in `BRAIN_API_KEYS`; never the value.
  5. Reload MCP in a Cursor Cloud agent and run `brain_self_check`. Record `registered_at` and `brain_self_check: ok`.
  6. **The brain's own evidence:** copy the brain service log for the window from `registered_at` off the brain host (as retirement R6a does). Retirement R4 promises one thing about that log (`:303-304`): every request logs its key tier (the `VMC_API_KEY` value, a brain key or a scoped key), never the key. It fixes no wording, and it does not say that a line carries the agent name or the MCP tool name: the swarm route the service copies writes no request line (`mcp/route.ts:35` at `b1117811cbd7` logs unhandled errors only), and `mcp-http-auth.ts:37-43` (the same ref) reads `X-Agent-Name` into the identity, whose default actor is also `plx-brain`. So the operator identifies the line: the request in the window that is the step-5 self-check (the Cursor agent's calls to the MCP route after `registered_at`, with a brain tier). The window can hold other callers' lines, some with a VMC tier while callers still reach the brain through the R6 block; only the identified line counts. Record its time as `self_check_log_at` and its tier as `self_check_key_tier: brain`, and paste the line as the brain wrote it under `## raw`, beneath the heading `### brain log line (step 6)` (secrets removed; the line holds no key). The acceptance requires that heading under `## raw` with at least one pasted line beneath it, rejects the template placeholder, rejects the VMC and scoped tier names in those lines (`vmc_api_key`, `legacy`, `scoped`, `dept`, case-insensitive: swarm `docs/knowledge-os/KEY_TIERS.md` names the tiers "Legacy (unscoped)" and "Department-scoped"), and checks the typed lines and the time order. It pins no token that R4 does not promise, so it cannot tell the self-check's line from another brain-tier line in the window: the proof is the brain's line as the operator identified it, like every other operator phase's `## raw` evidence. A pinned proof needs a fixed log wording (tier, actor and tool) or a key source in the `brain_self_check` result, which is retirement R4 code (review log, open question 8: open, not yet put to Vince, for r14 or follow-up work; P14 does not wait on it). A tier of `VMC_API_KEY` or a scoped key fails P14 (D5). Record `service_commit: <12 hex>`, the plx_secondbrain commit the brain host serves: from `GET $BRAIN_URL/api/health` when the brain's own route reports one (retirement R4 gives the brain its own `/api/health` and does not say what it reports; VMC's route on the old host, B13, is not the brain's), else read by the operator from the brain host's deployed checkout; the acceptance requires it to be on plx_secondbrain `origin/main`.
- **evidence template:**
  ```
  registered_name: plx-brain
  spec_revision: r<n>
  later_yes: yes P14, BRAIN_URL=<BRAIN_URL>[, D5 as r13]
  later_yes_at: <UTC, when Vince gave that yes; later than the header's r13_yes_at and round_10_done_at>
  d5_confirmed: D5 as r13
  d5_confirmed_at: <UTC, when Vince gave the yes that carried the phrase>
  d5_confirmed_in: <yes on r<n> | P14 later yes>
  brain_url: <BRAIN_URL>
  url: <BRAIN_URL>/api/vmc/knowledge/mcp
  precheck_at: <UTC, step 2>
  precheck: ok
  brain_host_live_at: <UTC, the precheck_at of the first pre-check that answered (retirement R6a)>
  team_mcp_plx_brain_before: none
  service_commit: <12 hex of the plx_secondbrain main commit the brain host serves, step 6>
  key_kind: brain
  key_name: BRAIN_API_KEY:<label the operator gave the key when it was issued; it never starts with brn_>
  key_sha256_prefix: <first 12 hex of sha256 of the key value>
  registered_by: <email>
  registered_at: <UTC>
  brain_self_check: ok
  self_check_log_at: <UTC, the brain's log line for the step-5 self-check>
  self_check_key_tier: brain
  writes: brain_ingest, brain_propose_relation
  stdio_in_committed_mcp_json: no
  kill_switch: BRAIN_MCP_HTTP_ENABLED=0

  ## raw
  ### brain log line (step 6)
  <the brain's log line for the step-5 self-check, as the brain wrote it; no key>
  ```
- **rollback:** remove the server from the Team MCP list. In an emergency, set `BRAIN_MCP_HTTP_ENABLED=0` on the brain service's host. That disables brain HTTP MCP for every client.

Acceptance (P14):
```bash
. "$TOOLS/accept.sh"; F=$PROOFS/brain-register.md
for l in 'registered_name: plx-brain' 'brain_self_check: ok' 'stdio_in_committed_mcp_json: no' \
         'writes: brain_ingest, brain_propose_relation' 'kill_switch: BRAIN_MCP_HTTP_ENABLED=0' \
         'precheck: ok' 'team_mcp_plx_brain_before: none' 'key_kind: brain' 'self_check_key_tier: brain'; do line "$l" "$F"; done
case "$BRAIN_URL" in https://missioncontrol.tayloralton.com*) fail "BRAIN_URL is the old host (D14)" ;; https://?*) ;; *) fail "BRAIN_URL must be https" ;; esac
SPEC=$(git -C "$PLX_MC_REPO" show origin/main:docs/specs/frontier-implementation-spec.md) || fail "spec on PLX_MC main"
HDR=$(printf '%s\n' "$SPEC" | awk '/^```$/{n++; next} n==1'); n() { printf '%s\n' "$1" | sed -E 's/\.[0-9]+Z$/Z/'; }
printf '%s\n' "$HDR" | grep -qE '^r13_yes: yes r13, D5 as r13 ' || fail "r13_yes is not recorded on PLX_MC main (SC-13)"
printf '%s\n' "$HDR" | grep -qE '^round_10: done ' || fail "round 10 is not done on PLX_MC main (SC-13)"
YES_AT=$(printf '%s\n' "$HDR" | sed -nE "s/^r13_yes_at: ($TS)$/\1/p"); [ -n "$YES_AT" ] || fail "r13_yes_at is missing from the header (SC-13)"
# round_10_done_at lives in the execution copy (README). It must equal the time the round-10 text merged to main: the committer time of the first first-parent commit that carries the round_10 line.
R10L=$(grep -E '^round_10: done ' "$SPEC_EXEC") || fail "round_10 is not done in the execution copy (SC-13)"
printf '%s\n' "$HDR" | grep -qxF -- "$R10L" || fail "the execution copy's round_10 line is not the one on PLX_MC main now: an amendment changed it, so round_10_done_at must be set again from its merge (SC-13)"
R10C=''; while read -r c; do T=$(git -C "$PLX_MC_REPO" show "$c:docs/specs/frontier-implementation-spec.md" 2>/dev/null) && printf '%s\n' "$T" | grep -qxF -- "$R10L" && { R10C=$c; break; }; done < <(git -C "$PLX_MC_REPO" log --first-parent --reverse --format=%H origin/main -- docs/specs/frontier-implementation-spec.md)
[ -n "$R10C" ] || fail "no commit on PLX_MC main carries the execution copy's round_10 line: the round-10 text has not merged (SC-13)"
R10_MERGED=$(TZ=UTC git -C "$PLX_MC_REPO" show -s --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ "$R10C") || fail "commit time of $R10C"
R10_AT=$(sed -nE "s/^round_10_done_at: ($TS) \(PR #[0-9]+.*\)$/\1/p" "$SPEC_EXEC"); [ -n "$R10_AT" ] || fail "round_10_done_at is not set in the execution copy (SC-13)"
[ "$(n "$R10_AT")" = "$R10_MERGED" ] || fail "round_10_done_at ($R10_AT) is not the time the round-10 text merged to PLX_MC main ($R10_MERGED, $R10C)"
rline 'spec_revision: r(1[3-9]|[2-9][0-9])' "$F"
grep -qxF -e "later_yes: yes P14, BRAIN_URL=$BRAIN_URL" -e "later_yes: yes P14, BRAIN_URL=$BRAIN_URL, D5 as r13" "$F" || fail "later_yes must be Vince's P14 yes that names BRAIN_URL, with or without 'D5 as r13' (D14, D5)"
rline "later_yes_at: $TS" "$F"; LY=$(sed -nE "s/^later_yes_at: ($TS)$/\1/p" "$F")
[[ "$(n "$LY")" > "$(n "$YES_AT")" && "$(n "$LY")" > "$(n "$R10_AT")" ]] || fail "the P14 later yes predates the yes on r13 or round 10 (SC-13)"
line 'd5_confirmed: D5 as r13' "$F"; rline "d5_confirmed_at: $TS" "$F"; rline 'd5_confirmed_in: (yes on r(1[3-9]|[2-9][0-9])|P14 later yes)' "$F"
if grep -qxF 'd5_confirmed_in: P14 later yes' "$F"; then line "later_yes: yes P14, BRAIN_URL=$BRAIN_URL, D5 as r13" "$F"; else
  D5AT=$(printf '%s\n' "$HDR" | sed -nE "s/^d5_r13_yes: D5 as r13 \(in the yes on r13, ($TS)\)$/\1/p"); [ -n "$D5AT" ] || fail "the header does not record D5 as r13 in the yes on r13 (D5)"
  line "d5_confirmed_at: $D5AT" "$F"; fi
line "brain_url: $BRAIN_URL" "$F"; line "url: $BRAIN_URL/api/vmc/knowledge/mcp" "$F"
rline "precheck_at: $TS" "$F"; rline "brain_host_live_at: $TS" "$F"
rline 'service_commit: [0-9a-f]{12}' "$F"; SC=$(sed -nE 's/^service_commit: ([0-9a-f]{12})$/\1/p' "$F")
git -C "$SECONDBRAIN_REPO" merge-base --is-ancestor "$SC" origin/main || fail "service_commit is not on plx_secondbrain main"
rline 'key_name: BRAIN_API_KEY:[A-Za-z0-9_.-]+' "$F"; rline 'key_sha256_prefix: [0-9a-f]{12}' "$F"
! grep -qE 'VMC_API_KEY|VMC_SCOPED_API_KEYS|brn_[A-Za-z0-9_-]{6,}' "$F" || fail "a VMC key name or key material in the P14 evidence (D5)"
rline 'registered_by: [^ ]+@[^ ]+' "$F"; rline "registered_at: $TS" "$F"; rline "self_check_log_at: $TS" "$F"
RA=$(sed -nE "s/^registered_at: ($TS)$/\1/p" "$F"); SL=$(sed -nE "s/^self_check_log_at: ($TS)$/\1/p" "$F")
[[ "$(n "$SL")" > "$(n "$RA")" ]] || fail "the brain's self-check log line predates the registration (D5)"
# The brain's log line (step 6). Retirement R4 fixes only that each request logs its key tier, so this pins no wording: it takes the lines pasted beneath
# the step-6 heading under ## raw, requires one, rejects the placeholder, and rejects the VMC and scoped tier names (swarm docs/knowledge-os/KEY_TIERS.md).
RAW=$(sed -n '/^## raw$/,$p' "$F"); LOGL=$(printf '%s\n' "$RAW" | awk '/^### brain log line \(step 6\)$/{p=1; next} /^###/{p=0} p && NF')
[ -n "$LOGL" ] || fail "no brain log line beneath '### brain log line (step 6)' under ## raw (D5)"
! printf '%s\n' "$LOGL" | grep -q '^<' || fail "the step-6 log line is still the template placeholder (D5)"
! printf '%s\n' "$LOGL" | grep -qiE 'vmc_api_key|legacy|scoped|dept' || fail "the brain's log line names a VMC or scoped key tier (D5)"
! git -C "$SWARM_REPO" grep -q plx-brain -- .cursor/mcp.json .mcp.json || fail "plx-brain in swarm MCP config"
! git -C "$PORTAL_REPO" grep -q plx-brain -- .mcp.json .cursor/mcp.json.example || fail "plx-brain in portal MCP config"
```

### P15 — Audit the compliance merge-queue path

- **gate:** first yes for the r12 run. The r13 re-run waits for Vince's yes on r13 and round 10 (D13, SC-13): the yes is recorded in the header, and the re-run starts once `round_10_done_at` is set (the merge of the round-10 text) · **executor:** orchestrator (mechanical) for the code lines; a repo admin (operator) for the settings lines · **repo:** none (read-only)
- **depends_on:** `[]` for the r12 run. For the r13 re-run: the header's `r13_yes`, `round_10` and `r13_yes_at` lines on PLX_MC `main`, and `round_10_done_at` in the execution copy, which the acceptance reads and checks against `main`; `audited_at` is later than `r13_yes_at` and `round_10_done_at`.
- **owns:** `$PROOFS/merge-queue-audit.md`
- **forbidden:** `.github/workflows/**`, `scripts/generate-compliance-gate.py`, `src/app/api/compliance/**`; ruleset changes; any PR; Jev globs
- **deliverables:**
  - **Code lines (orchestrator):** record these, then release the slot.
    - The `on:` block and job id of portal `plx-mc-compliance.yml` and of the stopgap.
    - `NAME_AND_PR_TRIGGER` from PLX_MC `scripts/generate-compliance-gate.py:58-63` (the same lines from `fc7ceef3d123` through `7f79712657e3`; the r13 re-run quotes them at its own `plx_mc_sha`), with its `pull_request` types (four since #255).
    - The `merge_group` triggers of `lint-typecheck-build` and `Validate ledgers`.
    - The TASK-2008 test in `ci-staged-gate.test.mjs:871-956`, and the import of `scripts/merge-group-prs.mjs` at `:20` with its test at `:958-980`.
    - The drift check's `GEN_SHA`.
    - The verify facts in F11.
  - **Settings lines (admin):**
    - The required checks and "Require merge queue" state of ruleset `18632985`.
    - Org ruleset `18679471`: its rule type (for example `workflows`), the workflow path and ref it runs, and the branches it targets.
    - The `prd` field of buckets `BKT-INFRA` and `BKT-PROD`. Read it with `mc_get_context { depth: "full" }`, which returns full bucket rows (`mc_list_buckets` omits `prd`). Paste the two raw rows under `## raw`. Write `present` only when the value is an http(s) URL: since #263 (TASK-2112, 29 Sep 2026) the gate counts nothing else as a PRD (F17, D11); the rows the r12 run read hold GitHub URLs.
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
  pr255_deployed: yes
  pr255_deployed_source: gate0.md (GitHub deployment 6721728347, 2026-09-28T22:11:43Z)
  spec_revision: r<n>
  plx_mc_sha: <40 hex of the PLX_MC main commit audited; fc7ceef3d123 or a descendant>
  audited_at: <UTC>
  code_edit: no
  pr: none
  ```
    - Whether the portal secret `COMPLIANCE_CI_TOKEN` exists (name only).
    - Which auth path the latest `plx-mc-compliance` run used, from its `auth=` log line: `oidc`, `bearer`, or `bearer-fallback`; `skipped` when the run logged "compliance gate skipped".
- **#255 (D13):** record `pr255: merged f6d2bab7670a` (F24) and the generator's `pull_request` types (`gate_pr_types`). An r12 run of P15 does not satisfy r13. P15 runs again under r13 before P16 starts. The r12 run has no `gate_pr_types` line, so it fails the acceptance below whatever it recorded for `pr255`, and the P16 PLX_MC acceptance reads both r13 lines from `merge-queue-audit.md`. The re-run also records `spec_revision: r<n>` (n ≥ 13), `plx_mc_sha` (the PLX_MC `main` commit it audited: `fc7ceef3d123` or a descendant) and `audited_at`, later than the header's `r13_yes_at` and `round_10_done_at`, and it quotes `NAME_AND_PR_TRIGGER` verbatim under `## raw` (`scripts/generate-compliance-gate.py:58-63` at `plx_mc_sha`). It records `pr255_deployed: yes` with the orchestrator's `gate0.md` as its source, the record of the #255 production deploy (GitHub deployment 6721728347, 2026-09-28T22:11:43Z; F24): `pr255_deployed_source: gate0.md (GitHub deployment 6721728347, 2026-09-28T22:11:43Z)`, as Vince chose on 2026-09-29T19:55:37Z (the draft's section-16 item 5). The acceptance reads those lines, checks that `plx_mc_sha` is on PLX_MC `main` (an unmerged descendant of `fc7ceef3d123` fails), reads the generator at `plx_mc_sha` for the four types, and reads the header from the spec on PLX_MC `main` and `round_10_done_at` from the execution copy (checked against `main`), so an r12 file with two lines appended cannot pass.

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
line 'pr255_deployed: yes' "$F"; line 'pr255_deployed_source: gate0.md (GitHub deployment 6721728347, 2026-09-28T22:11:43Z)' "$F"
rline 'spec_revision: r(1[3-9]|[2-9][0-9])' "$F"; rline 'plx_mc_sha: [0-9a-f]{40}' "$F"; rline "audited_at: $TS" "$F"
SHA=$(sed -nE 's/^plx_mc_sha: ([0-9a-f]{40})$/\1/p' "$F")
git -C "$PLX_MC_REPO" merge-base --is-ancestor "$SHA" origin/main || fail "plx_mc_sha is not on PLX_MC main: the audit read an unmerged commit (D13)"
git -C "$PLX_MC_REPO" merge-base --is-ancestor fc7ceef3d123 "$SHA" || fail "the audited PLX_MC main predates #255 (D13)"
G=$(git -C "$PLX_MC_REPO" show "$SHA:scripts/generate-compliance-gate.py") || fail "generator at plx_mc_sha"
printf '%s\n' "$G" | grep -qF 'types: [opened, synchronize, reopened, edited]' || fail "the generator at plx_mc_sha lacks the four types (F24)"
RAW=$(sed -n '/^## raw$/,$p' "$F"); printf '%s\n' "$RAW" | grep -qF 'reopened, edited]' || fail "no raw quote of NAME_AND_PR_TRIGGER (D13)"
SPEC=$(git -C "$PLX_MC_REPO" show origin/main:docs/specs/frontier-implementation-spec.md) || fail "spec on PLX_MC main"
HDR=$(printf '%s\n' "$SPEC" | awk '/^```$/{n++; next} n==1'); n() { printf '%s\n' "$1" | sed -E 's/\.[0-9]+Z$/Z/'; }
printf '%s\n' "$HDR" | grep -qE '^r13_yes: yes r13, D5 as r13 ' || fail "r13_yes is not recorded on PLX_MC main (SC-13)"
printf '%s\n' "$HDR" | grep -qE '^round_10: done ' || fail "round 10 is not done on PLX_MC main (SC-13)"
YES_AT=$(printf '%s\n' "$HDR" | sed -nE "s/^r13_yes_at: ($TS)$/\1/p"); [ -n "$YES_AT" ] || fail "r13_yes_at is missing from the header (SC-13)"
# round_10_done_at lives in the execution copy (README). It must equal the time the round-10 text merged to main: the committer time of the first first-parent commit that carries the round_10 line.
R10L=$(grep -E '^round_10: done ' "$SPEC_EXEC") || fail "round_10 is not done in the execution copy (SC-13)"
printf '%s\n' "$HDR" | grep -qxF -- "$R10L" || fail "the execution copy's round_10 line is not the one on PLX_MC main now: an amendment changed it, so round_10_done_at must be set again from its merge (SC-13)"
R10C=''; while read -r c; do T=$(git -C "$PLX_MC_REPO" show "$c:docs/specs/frontier-implementation-spec.md" 2>/dev/null) && printf '%s\n' "$T" | grep -qxF -- "$R10L" && { R10C=$c; break; }; done < <(git -C "$PLX_MC_REPO" log --first-parent --reverse --format=%H origin/main -- docs/specs/frontier-implementation-spec.md)
[ -n "$R10C" ] || fail "no commit on PLX_MC main carries the execution copy's round_10 line: the round-10 text has not merged (SC-13)"
R10_MERGED=$(TZ=UTC git -C "$PLX_MC_REPO" show -s --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ "$R10C") || fail "commit time of $R10C"
R10_AT=$(sed -nE "s/^round_10_done_at: ($TS) \(PR #[0-9]+.*\)$/\1/p" "$SPEC_EXEC"); [ -n "$R10_AT" ] || fail "round_10_done_at is not set in the execution copy (SC-13)"
[ "$(n "$R10_AT")" = "$R10_MERGED" ] || fail "round_10_done_at ($R10_AT) is not the time the round-10 text merged to PLX_MC main ($R10_MERGED, $R10C)"
AT=$(sed -nE "s/^audited_at: ($TS)$/\1/p" "$F")
[[ "$(n "$AT")" > "$(n "$YES_AT")" && "$(n "$AT")" > "$(n "$R10_AT")" ]] || fail "the P15 re-run predates the yes on r13 or round 10 (SC-13)"
```

### P16 — merge_group in the compliance generator and verify service

- **gate:** later yes · **executor:** orchestrator (builder) · **repos:** `petralabx/PLX_MC` base `main` first, then `petralabx/plx-customer-portal` base `staging`. Two MC tasks, two PRs. **Tier:** high; both PRs touch `.github/workflows/`.
- **depends_on:** `[P15]` run under r13 (an r12 run does not satisfy r13; the PLX_MC acceptance reads P15's r13 lines), plus a bucket PRD `present` for each half's bucket (D11: `BKT-INFRA` for PLX_MC, `BKT-PROD` for portal), plus D13 (#255 merged; this half runs under r13 or later, after Vince's yes on r13 and round 10 (the yes recorded in the header; `round_10_done_at` set when the round-10 text merges), and after the later yes that names P16, given after `round_10_done_at` and recorded in `merge-group.md` as `later_yes` and `later_yes_at`; SC-13). The PLX_MC half never runs at the same time as P4. The portal half starts, and checks out, only after the PLX_MC PR is merged and deployed (8-hour rule), and only after the P8 and P10 portal PRs have merged (`cap: met repo: petralabx/plx-customer-portal` in `guide-trim.md` shows that P10 portal's acceptance passed on its PR head; the merge shows in `staging` itself, and this half's acceptance re-runs the cap and slice checks on a branch from `staging`, so an unmerged P10 fails them; D13). Vince confirmed this on 2026-09-29T19:55:37Z (round 10, open question 2: "wait for P10"): there is no after-P8-alone path. If P10 does not run for the portal (`canary: fail`, D8, or Vince declines it), the portal half stays blocked until Vince decides again.
- **PLX_MC PR (D4):**
  - **Generator:**
    - `NAME_AND_PR_TRIGGER` adds `merge_group:` with `types: [checks_requested]` and no `paths` filter, beside the existing `pull_request` types, which stay `[opened, synchronize, reopened, edited]` (#255; `tests/test_generate_compliance_gate.py:49-55` pins that exact list, at `fc7ceef3d123` and unchanged through `7f79712657e3`).
    - The downstream job keeps id `compliance` and branches inside its shell on `$GITHUB_EVENT_NAME`. The `pull_request` branch stays the same.
    - The `merge_group` branch gets `GH_TOKEN: ${{ github.token }}`. It parses `N` from `github.event.merge_group.head_ref` (`gh-readonly-queue/<base>/pr-<N>-<sha>`). With `gh api`, inline, and no repo-local script, it reads PR `N`'s body, head SHA, labels, and changed files. It extracts the `MC-Checkout` lines and posts the existing verify payload plus `event: "merge_group"`, with `prNumber: N` and PR `N`'s head SHA.
    - When it cannot parse `N` or read the PR, it prints `merge_group: could not resolve the pull request` and joins the existing block-verdict path, which exits 1 in hard mode and prints the soft-mode notice and exits through the existing soft-mode exit otherwise. It adds no new exit.
  - **Regenerate:** regenerate PLX_MC's own `.github/workflows/compliance-gate.yml`, so `generate-compliance-gate.py --check` passes. The trigger stays inert in PLX_MC, which has no queue.
  - **Verify route:**
    - `src/app/api/compliance/verify/route.ts` accepts an optional body field `event: z.enum(["pull_request", "merge_group"]).optional()`, with no zod default, so a body without `event` is forwarded unchanged. `verifyPr` treats a missing `event` as `pull_request`.
    - For OIDC it requires `event` to equal `claims.eventName`. A missing `event` counts as `pull_request`. A null `eventName` claim keeps today's behavior for `pull_request` (`route.ts:88-90` at `7f79712657e3`, unchanged since `fc7ceef3d123`) and never enters `merge_group` mode: with `event: "merge_group"` and no claim, the binding fails, because null matches nothing (round-3 nit 8, closed in round 10).
    - For `merge_group` it requires `ref` to match `^refs/heads/gh-readonly-queue/[^/]+/pr-(\d+)-[0-9a-f]+$`, with that number equal to `body.prNumber`, plus the existing repo and workflow binding.
    - `pull_request` binding does not change.
    - Bearer (`COMPLIANCE_CI_TOKEN`) requests keep today's rule: the body is trusted, including `event`. This is safe because merge-group mode only re-confirms a stamp that already passed on the same head.
  - **Service:** `verifyPr` takes `event`, so `VerifyPrInput` (`service.ts:357-367` at `7f79712657e3`; every line in this bullet is at that ref, PLX_MC `main` after #262 and #263) gains `event?: "pull_request" | "merge_group"`; `verifyPrOrQueue` queues the whole input (`:1041-1054`), so a replay verifies in the same mode. For `merge_group`, it resolves each stamp with a queue resolver, not `prDispatchResolver`: `resolveDispatch` first (`:141-153`: `unknown_checkout`, `revoked`, `released`, `repo_mismatch`, `expired`, in that order); on `expired` only, it accepts the stamp when `eventTaskIdByDedupKey(gateDedupKey(repo, prNumber, headSha, taskId, "pass"))` returns that task (the `resolveDispatchForMerge` rule, `:198-209`), else it blocks with reason `expired`. It never calls `loadPrState` in `merge_group` mode. The queue resolver returns the same `CheckoutBlockReason` values as `resolveDispatch`, and `verifyPr`'s loop turns each into its text through `checkoutBlockReason` (#262, TASK-2111: `CHECKOUT_BLOCK_TEXT`, `:108-134`; the loop, `:471-477`), so a released stamp blocks as `checkout released — re-checkout the task`; the loop's own checks after resolution, a missing task (`task_deleted`) and a `verified` task (`task_closed`), apply in both modes unchanged. `pull_request` resolution does not change: it keeps #255's `prDispatchResolver` (`:177-187`; F11). A `merge_group` verdict replaces the check row for that head and task, because `checkId` is the same in both modes (`:68-70`) and `recordCheck` upserts on it (`repo.ts:340-348`, unchanged since `fc7ceef3d123`); the gate event deduplicates on the pass key (`gateDedupKey`, `:191-193`), so the prior-pass lookup still works.
  - **Tests:** add cases, failing first. Route cases go in `tests/compliance-verify-route.test.ts`. Service cases go in a new `tests/compliance-merge-group.test.ts`, using the mocks of `tests/compliance-server.test.ts:10-142` at `7f79712657e3` (the `github` and `db` hoists, the four `vi.mock` factories, `taskish` and the root `beforeEach`; `:10-137` at `fc7ceef3d123`, before #262 and #263; P4 also edits that file's repo factory and may run first, and compliance code was still changing on 29 Sep 2026, so every line cited here is at `7f79712657e3`, the symbol names hold when lines move, and P16 re-checks them at the code of the day before it starts, facts preamble). They already include `eventTaskIdByDedupKey` and a `loadPrState` mock, so the string `loadPrState` is in the new file before any case asserts on it. Every new test name contains `merge_group`. Put it, and the two fixed titles below, in the `it` title itself, not only in a `describe` title: the acceptance reads the last ` > ` segment of each `npx vitest list` line, the `it` title, so a `describe` titled `merge_group` does not count, and a grep of the file text proves nothing here:
    - an OIDC `merge_group` with a matching `pr-N` passes the binding; a mismatched `N` fails
    - `event` must match the claim; an OIDC token with no `event_name` claim and `event: "merge_group"` fails the binding (nit 8)
    - `merge_group: an expired stamp with a prior pass on the same head passes without loadPrState`, this exact title. The prior pass is an entry in the mock's `db.dedupKeys` equal to the gate's dedup key for that repo, PR, head, task and `pass` (`gateDedupKey`, `service.ts:191-193` at `7f79712657e3`; the mock `eventTaskIdByDedupKey` at `tests/compliance-server.test.ts:42-44`, at `7f79712657e3`, answers `TASK-900` for any key present, so the stamp's task is `TASK-900`). The case asserts verdict `pass` and `expect(github.loadPrState).not.toHaveBeenCalled()`, the idiom of the TASK-2011 `describe` in `tests/compliance-server.test.ts` (`:196,202` at `7f79712657e3`).
    - `merge_group: an expired stamp with no prior pass blocks without loadPrState`, this exact title. The `loadPrState` mock resolves `{ open: true, checkoutIds: [<the stamp>] }`, as the copied root `beforeEach` (`:130-142` at `7f79712657e3`) does for `dsp_old`, so a resolver that fell through to `prDispatchResolver` (`service.ts:177-187`) would pass the stamp and fail this case. The case asserts verdict `block` and `expect(github.loadPrState).not.toHaveBeenCalled()`.
    - a released stamp blocks in `merge_group` (its `it` title contains `merge_group`): the case sets `releasedAt` on an unexpired stamp and asserts that `tasks[0].reasons` equals `["checkout released — re-checkout the task"]`, the text `checkoutBlockReason("released")` gives since #262 (`CHECKOUT_BLOCK_TEXT`, `service.ts:120-130` at `7f79712657e3`; the TASK-2011 case `blocks released unexpired checkouts without a GitHub read`, `tests/compliance-server.test.ts:199-203`, asserts the same text), not the bare word `released`, which #262 removed from the verdict, and that `loadPrState` was not called
    - `pull_request` with an expired stamp keeps #255's rule: it passes when `loadPrState` says the PR is open and carries the stamp, and blocks when the PR is closed or the stamp is not in the body (the TASK-2011 `describe`, `tests/compliance-server.test.ts:144-274` at `7f79712657e3`, pins this; the new case shows that `merge_group` support did not change it; its `it` title also contains `merge_group`, for example `merge_group support leaves the pull_request expiry rule unchanged`, so it counts toward the title floor, round-2 nit 8)

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
    - Replace the five `compliance` stopgap assertions (`:927-932`) with three lines on `generated`: `assert.match(generated, /github\.event\.merge_group\.head_ref/);`, `assert.match(generated, /MC-Checkout: dsp_/);` and `assert.match(generated, /gh api/);`.
    - In `protection`, re-point `/1339f1196d4e56377953fb90d41f2238402e8750/` (`:943`) to the new `GEN_SHA` and `/compliance-merge-group\.yml/` (`:945`) to `/plx-mc-compliance\.yml/`.
    - Leave every other assertion (the `ci.yml` preflight and build checks, ledger, the other runbook lines, and `autoMerge`, `:949-955`) unchanged. Leave the import at `:20` and the test at `:958-980` unchanged: `scripts/merge-group-prs.mjs` stays, as dead code, until a later cleanup removes both together (F10). The acceptance pins 33 fragments of the assertions that must survive (the three unchanged `required` rows `:873` and `:875-876`, the loop `:878-887`, `:891`, `:897`, `:907-925`, `:933-934`, `:936-942`, `:944`, `:946-955`; not `:874`, `:943` or `:945`, which the edit re-points), each unique in the file at `2b656d8adf33` (anchored to its `preflight`, `protection` or `autoMerge` subject where the regex alone repeats), and seven fragments this edit writes (the re-pointed row, the inverted trigger assertion, the three lines on `generated`, and the two re-pointed `protection` pins: the new `GEN_SHA` and `/plx-mc-compliance\.yml/`); it rejects the stopgap row, `queueTrigger`, `/gh pr view/` and the old `GEN_SHA`. So deleting a surviving assertion, or skipping part of the edit, fails the check.
  - Update `docs/runbooks/BRANCH-PROTECTION-STAGING.md` (the merge-queue section `:305-385` at `2b656d8adf33`: the table row `:312`, the paragraph `:316-327`, the `merge_method` row `:344`, whose "which compliance uses to find every PR in the group" is false after this PR (keep the word `Squash`, which `ci-staged-gate.test.mjs:938` pins), the `max_entries_to_merge` row `:346`, the PLX_MC dependency list `:360-385`, and `GEN_SHA` at `:378`) and the "Merge queue (TASK-2008)" section of `.cursor/rules/auto-merge-after-push.mdc` (`:125-144` at `2b656d8adf33`: its three paragraphs; the rationale paragraph at `:146` follows), so neither names `compliance-merge-group` any more; that section's `:127` says "The three required checks also run on `merge_group`", and there are four since TASK-2037 (`workbench-api`; the Current set table `:85-92`), so write four (round-3 nit 12, closed in round 10). Keep the `/merge_group/` mention that the CI test pins, and keep it outside the "Current set" table (`:83-92`), which that test requires to stay free of `merge_group`. The generated job verifies only PR `N` from the queue ref, so the runbook must say that `max_entries_to_merge` stays 1 and `grouping_strategy` stays `ALLGREEN`, and must drop the line "The compliance job still resolves every PR if this is raised later".
  - **`edited` lines (D13):** in `.cursor/rules/mc-compliance.mdc`, or in the rule P10 moved them to, rewrite the restamp item that says a body-only edit does not re-run the gate, that the generated workflow "still triggers only on opened/synchronize/reopened", and "Do not add `edited` in this repo" (`:128-131` at `2b656d8adf33`), and the paragraph that says the workflow "triggers on `pull_request: [opened, synchronize, reopened]`" and tells the agent to push an empty commit (`:301-309`). After this PR the generated file triggers on `opened, synchronize, reopened, edited` and on `merge_group`, so write the fixed line "A body edit re-runs the gate (`edited`)." in the rule, drop the instruction to push an empty commit, and say that nobody hand-edits `.github/workflows/*compliance*`; the acceptance requires that fixed line and rejects the old wording in any form, reading each rule with its whitespace squeezed so that a phrase wrapped across lines counts. It rejects, in every tracked rule, as r13 did, because only `mc-compliance.mdc` carries them today and P10 may move them: the trigger-list wording (the three-type list; `opened/synchronize/reopened` in any spelling, with or without spaces or a line break at a slash, and also when `/edited` follows it, so name the four types, if at all, as the generated file does: `opened, synchronize, reopened, edited`; a bracket trigger list without `edited`) and the sentence "A body-only edit does not re-run the gate" (`:128` at `2b656d8adf33`; false once the regenerated file carries `edited`; the landing edit of 29 Sep 2026 added this rejection); it rejects the empty-commit wording (`empty commit`, `commit (empty`, `empty is fine`) only in the rule this PR edits: `mc-compliance.mdc` and any rule that carries the fixed line. Portal `pr-watch-until-green.mdc:49-50` says "push a commit (empty is fine)"; that rule is not this PR's, and correcting it is follow-up work (Risks; round 10, open question 7). In the same PR, delete the sentence "Until TASK-2011 is live, the Hub may still block an expired stamp; do not restamp ahead of that verdict." (`mc-compliance.mdc:137-139` at `2b656d8adf33`, or the rule P10 moved it to): TASK-2011 is #255, merged and deployed (F24), so the sentence is stale. Delete only that sentence; `:134-137` describe #255 and stay. Vince accepted this edit on 2026-09-29T19:55:37Z (the draft's section-16 item 2), and the acceptance rejects `Until TASK-2011 is live` in every tracked rule, whitespace squeezed. Change no other line of `mc-compliance.mdc`; P8 (D12) and P10 own the rest. The rewrite stays within P10's caps and keeps every needle and P8's carrier rule: the slice `.cursor/rules/mc-compliance.mdc` stays at or under 2457 bytes, `measure.py --check-caps --check-needles` still passes, and every rule this PR edits still passes `carrier` where P10 required it. The acceptance re-runs those checks.
  - If P15 recorded that org ruleset `18679471` runs PLX_MC `compliance-gate.yml` on the portal's `staging`, that org workflow also gains `merge_group` from the regenerated canonical file. Both call the same verify service with the same payload. Record this in `merge-group.md` as `org_workflow_on_staging: yes`; otherwise record `no`.
  - `COMPLIANCE_MODE` does not change. The unset-`PLX_MC_BASE_URL` branch does not change. Add no `continue-on-error`, no job-level `if:`, and no new `exit 0`.
  - Other consumers keep their pinned `GEN_SHA` and do not change.
- **owns:**
  - PLX_MC: `scripts/generate-compliance-gate.py`, `.github/workflows/compliance-gate.yml`, `docs/modules/compliance/README.md` (the verify and merge-queue sections only), `src/app/api/compliance/verify/route.ts`, `src/lib/compliance/service.ts` (`verifyPr`, its `VerifyPrInput` type and stamp resolution only; r13 named `verifyPr` and stamp resolution and required `verifyPr` to take `event`, which changes that type, so round 10 named the type here: an `owns` change that Vince confirmed under the yes on r13 at 2026-09-29T19:54:30Z, review log open questions 6 and 9), `tests/compliance-verify-route.test.ts`, `tests/compliance-merge-group.test.ts` (new), `tests/test_generate_compliance_gate.py`
  - evidence: `$PROOFS/merge-group.md` with `pr255: merged f6d2bab7670a`, `spec_revision: r<n>` (n ≥ 13), `later_yes: yes P16` in Vince's words and `later_yes_at: <UTC>` (later than the header's `r13_yes_at` and `round_10_done_at`), `failing_first: <sha> fail`, `pr_plx_mc: <URL>`, `deployed_sha: <12 hex>`, `pr_portal: <URL>`, and the D11 confirmation read by Vince: `bucket_prd_confirmed: BKT-INFRA present` and `bucket_prd_confirmed: BKT-PROD present`
  - portal: `.github/workflows/plx-mc-compliance.yml`, `.github/workflows/compliance-gate-drift.yml`, `.github/workflows/compliance-merge-group.yml` (delete), `scripts/ci-staged-gate.test.mjs` (the TASK-2008 test only), `docs/runbooks/BRANCH-PROTECTION-STAGING.md`, `.cursor/rules/auto-merge-after-push.mdc`, `.cursor/rules/mc-compliance.mdc` (the `edited` and trigger-type lines and the "Until TASK-2011 is live" sentence only, D13; or the rule P10 moved them to). Not owned: `scripts/merge-group-prs.mjs` stays, because `scripts/ci-staged-gate.test.mjs:20` imports it (F10).
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
rline 'spec_revision: r(1[3-9]|[2-9][0-9])' "$PROOFS/merge-queue-audit.md"
SPEC=$(git -C "$PLX_MC_REPO" show origin/main:docs/specs/frontier-implementation-spec.md) || fail "spec on PLX_MC main"
HDR=$(printf '%s\n' "$SPEC" | awk '/^```$/{n++; next} n==1'); n() { printf '%s\n' "$1" | sed -E 's/\.[0-9]+Z$/Z/'; }
printf '%s\n' "$HDR" | grep -qE '^r13_yes: yes r13, D5 as r13 ' || fail "r13_yes is not recorded on PLX_MC main (SC-13)"
printf '%s\n' "$HDR" | grep -qE '^round_10: done ' || fail "round 10 is not done on PLX_MC main (SC-13)"
YES_AT=$(printf '%s\n' "$HDR" | sed -nE "s/^r13_yes_at: ($TS)$/\1/p"); [ -n "$YES_AT" ] || fail "r13_yes_at is missing from the header (SC-13)"
# round_10_done_at lives in the execution copy (README). It must equal the time the round-10 text merged to main: the committer time of the first first-parent commit that carries the round_10 line.
R10L=$(grep -E '^round_10: done ' "$SPEC_EXEC") || fail "round_10 is not done in the execution copy (SC-13)"
printf '%s\n' "$HDR" | grep -qxF -- "$R10L" || fail "the execution copy's round_10 line is not the one on PLX_MC main now: an amendment changed it, so round_10_done_at must be set again from its merge (SC-13)"
R10C=''; while read -r c; do T=$(git -C "$PLX_MC_REPO" show "$c:docs/specs/frontier-implementation-spec.md" 2>/dev/null) && printf '%s\n' "$T" | grep -qxF -- "$R10L" && { R10C=$c; break; }; done < <(git -C "$PLX_MC_REPO" log --first-parent --reverse --format=%H origin/main -- docs/specs/frontier-implementation-spec.md)
[ -n "$R10C" ] || fail "no commit on PLX_MC main carries the execution copy's round_10 line: the round-10 text has not merged (SC-13)"
R10_MERGED=$(TZ=UTC git -C "$PLX_MC_REPO" show -s --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ "$R10C") || fail "commit time of $R10C"
R10_AT=$(sed -nE "s/^round_10_done_at: ($TS) \(PR #[0-9]+.*\)$/\1/p" "$SPEC_EXEC"); [ -n "$R10_AT" ] || fail "round_10_done_at is not set in the execution copy (SC-13)"
[ "$(n "$R10_AT")" = "$R10_MERGED" ] || fail "round_10_done_at ($R10_AT) is not the time the round-10 text merged to PLX_MC main ($R10_MERGED, $R10C)"
AT=$(sed -nE "s/^audited_at: ($TS)$/\1/p" "$PROOFS/merge-queue-audit.md"); [ -n "$AT" ] || fail "P15 audited_at"
[[ "$(n "$AT")" > "$(n "$R10_AT")" ]] || fail "the P15 run predates round 10 (D13)"
rline 'later_yes: yes P16.*' "$PROOFS/merge-group.md"; rline "later_yes_at: $TS" "$PROOFS/merge-group.md"; LY=$(sed -nE "s/^later_yes_at: ($TS)$/\1/p" "$PROOFS/merge-group.md")
[[ "$(n "$LY")" > "$(n "$YES_AT")" && "$(n "$LY")" > "$(n "$R10_AT")" ]] || fail "the P16 later yes predates the yes on r13 or round 10 (SC-13)"
grep -qF 'reopened, edited]' scripts/generate-compliance-gate.py || fail "the edited trigger from #255 was dropped"
python3 scripts/generate-compliance-gate.py --check || fail "generator drift"
grep -q 'merge_group:' scripts/generate-compliance-gate.py || fail "no merge_group"
.venv/bin/python -m pytest tests/test_generate_compliance_gate.py -q || fail "generator tests"
npm ci || fail "npm ci"; npx vitest run || fail "vitest"; npm run typecheck || fail typecheck
! git diff --quiet origin/main...HEAD -- src/app/api/compliance/verify/route.ts || fail "route unchanged"
! git diff --quiet origin/main...HEAD -- src/lib/compliance/service.ts || fail "verifyPr unchanged"
L=$(npx vitest list tests/compliance-verify-route.test.ts tests/compliance-merge-group.test.ts) || fail "vitest list"
T=$(printf '%s\n' "$L" | awk -F ' > ' '{print $NF}')   # the it titles: the last " > " segment of each line; a describe titled merge_group does not count
N=$(printf '%s\n' "$T" | grep -c merge_group)
[ "$N" -ge 6 ] || fail "expected at least 6 merge_group it titles, found $N"
for t in 'merge_group: an expired stamp with a prior pass on the same head passes without loadPrState' \
         'merge_group: an expired stamp with no prior pass blocks without loadPrState'; do
  printf '%s\n' "$T" | grep -qF -- "$t" || fail "the merge_group it titles lack the case '$t' (D4)"
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
# Rules wrap long lines, so each rule is read with its whitespace squeezed to one space before the wording checks, and the slash list allows a space at each slash, so a list wrapped at a slash or spaced around them counts.
# The trigger-list wording, the sentence "A body-only edit does not re-run the gate" and the stale "Until TASK-2011 is live" sentence are rejected in every tracked rule (only mc-compliance.mdc carries them today, and P10 may move them). The empty-commit
# wording is rejected only in the rule this PR edits: mc-compliance.mdc and any rule that carries the fixed line. pr-watch-until-green.mdc:49-50
# says "push a commit (empty is fine)" and is not P16's (Risks).
FIXED=0; EDITED=''
while IFS= read -r f; do
  J=$(tr -s '[:space:]' ' ' < "$f")
  printf '%s\n' "$J" | grep -qiE 'Do not add `edited`|still triggers only on|opened, synchronize, reopened\]|opened ?/ ?synchronize ?/ ?reopened|body-only edit does not re-run the gate' && fail "$f still forbids the edited trigger, names three trigger types or says a body-only edit does not re-run the gate (D13)"
  printf '%s\n' "$J" | grep -oE '\[[^][]*reopened[^][]*\]' | grep -qv 'edited' && fail "$f names a trigger list without edited (D13)"
  printf '%s\n' "$J" | grep -qiF 'Until TASK-2011 is live' && fail "$f still says that TASK-2011 is not live (D13, F24)"
  if printf '%s\n' "$J" | grep -qF 'A body edit re-runs the gate (`edited`).'; then FIXED=1; EDITED="$EDITED $f"; fi
done < <(git ls-files -- .cursor/rules)
[ "$FIXED" -eq 1 ] || fail "no rule says that a body edit re-runs the gate (D13)"
for f in .cursor/rules/mc-compliance.mdc $EDITED; do
  J=$(tr -s '[:space:]' ' ' < "$f") || fail "no $f"
  printf '%s\n' "$J" | grep -qiE 'empty commit|commit \(empty|empty is (fine|enough)' && fail "$f still tells the agent to push an empty commit (D13)"
done
! grep -q 'three required checks' .cursor/rules/auto-merge-after-push.mdc || fail "the auto-merge rule still counts three required checks (TASK-2037; nit 12)"
SPEC=$(git -C "$PLX_MC_REPO" show origin/main:docs/specs/frontier-implementation-spec.md) || fail "spec on PLX_MC main"
HDR=$(printf '%s\n' "$SPEC" | awk '/^```$/{n++; next} n==1'); n() { printf '%s\n' "$1" | sed -E 's/\.[0-9]+Z$/Z/'; }
YES_AT=$(printf '%s\n' "$HDR" | sed -nE "s/^r13_yes_at: ($TS)$/\1/p"); [ -n "$YES_AT" ] || fail "r13_yes_at is missing from the header (SC-13)"
# round_10_done_at lives in the execution copy (README). It must equal the time the round-10 text merged to main: the committer time of the first first-parent commit that carries the round_10 line.
R10L=$(grep -E '^round_10: done ' "$SPEC_EXEC") || fail "round_10 is not done in the execution copy (SC-13)"
printf '%s\n' "$HDR" | grep -qxF -- "$R10L" || fail "the execution copy's round_10 line is not the one on PLX_MC main now: an amendment changed it, so round_10_done_at must be set again from its merge (SC-13)"
R10C=''; while read -r c; do T=$(git -C "$PLX_MC_REPO" show "$c:docs/specs/frontier-implementation-spec.md" 2>/dev/null) && printf '%s\n' "$T" | grep -qxF -- "$R10L" && { R10C=$c; break; }; done < <(git -C "$PLX_MC_REPO" log --first-parent --reverse --format=%H origin/main -- docs/specs/frontier-implementation-spec.md)
[ -n "$R10C" ] || fail "no commit on PLX_MC main carries the execution copy's round_10 line: the round-10 text has not merged (SC-13)"
R10_MERGED=$(TZ=UTC git -C "$PLX_MC_REPO" show -s --format=%cd --date=format-local:%Y-%m-%dT%H:%M:%SZ "$R10C") || fail "commit time of $R10C"
R10_AT=$(sed -nE "s/^round_10_done_at: ($TS) \(PR #[0-9]+.*\)$/\1/p" "$SPEC_EXEC"); [ -n "$R10_AT" ] || fail "round_10_done_at is not set in the execution copy (SC-13)"
[ "$(n "$R10_AT")" = "$R10_MERGED" ] || fail "round_10_done_at ($R10_AT) is not the time the round-10 text merged to PLX_MC main ($R10_MERGED, $R10C)"
rline 'later_yes: yes P16.*' "$PROOFS/merge-group.md"; LY=$(sed -nE "s/^later_yes_at: ($TS)$/\1/p" "$PROOFS/merge-group.md"); [ -n "$LY" ] || fail "later_yes_at"
[[ "$(n "$LY")" > "$(n "$YES_AT")" && "$(n "$LY")" > "$(n "$R10_AT")" ]] || fail "the P16 later yes predates the yes on r13 or round 10 (SC-13)"
# The assertions that survive the TASK-2008 edit (:873, :875-876, :878-887, :891, :897, :907-925, :933-934, :936-942, :944, :946-955 at 2b656d8adf33; not :874, :943 or :945, which the edit re-points). Each pin is unique in
# scripts/ci-staged-gate.test.mjs at that commit, so deleting its assertion fails this check.
while IFS= read -r p; do grep -qF -- "$p" scripts/ci-staged-gate.test.mjs || fail "the TASK-2008 test lost the assertion on $p"; done <<'EOF'
["ci.yml", "lint-typecheck-build"]
["mc-quality-ledger.yml", "Validate ledgers (vmc-quality-ledger/v1)"]
["workbench-api.yml", "workbench-api"]
for (const [file, check] of required)
const group = eventBlock(src, "merge_group");
assert.match(group, /checks_requested/
/^\s+paths:/m.test(group),
on.merge_group.paths would leave ${check} unreported on the queue
assert.match(src, new RegExp(check.replace(
activeLines(triggerSection(generated)), /pull_request:/
jobBlocks(generated).has("compliance"), true
github\.event\.merge_group\.head_ref \|\| github\.event\.pull_request\.number \|\| github\.ref
github\.event\.merge_group\.base_sha
github\.event\.merge_group\.head_sha
preflight, /EVENT_NAME" = "merge_group"/
git diff --name-only "\$BASE_SHA" "\$HEAD_SHA"
EVENT_NAME" = "pull_request" \] \|\| \[ "\$EVENT_NAME" = "merge_group" \]
EVENT_NAME" = "push"
EVENT_NAME" != "pull_request"
build, /github\.event\.merge_group\.head_ref/
github\.event_name == 'push'
protection, /18632985/
/Squash/
/max_entries_to_merge/
/check_response_timeout_minutes/
/18679471/
protection, /petralabx\/PLX_MC/
/compliance-gate-drift/
/Do not hand-edit/
/Do not apply this from a feature PR/
autoMerge, /merge_group/
autoMerge, /18632985/
autoMerge.slice(autoMerge.indexOf("Current set"), autoMerge.indexOf("Reporting-only")),
EOF
# The lines the edit writes (the portal PR list above), and the stopgap lines it removes.
while IFS= read -r p; do grep -qF -- "$p" scripts/ci-staged-gate.test.mjs || fail "the TASK-2008 test edit is missing $p"; done <<'EOF'
["plx-mc-compliance.yml", "compliance"]
activeLines(triggerSection(generated)), /merge_group:/
generated, /github\.event\.merge_group\.head_ref/
generated, /MC-Checkout: dsp_/
generated, /gh api/
/plx-mc-compliance\.yml/
EOF
grep -qF "/$SHA/" scripts/ci-staged-gate.test.mjs || fail "the TASK-2008 test does not pin the new GEN_SHA in the runbook"
for p in '["compliance-merge-group.yml", "compliance"]' 'queueTrigger' '/gh pr view/' '1339f1196d4e56377953fb90d41f2238402e8750'; do ! grep -qF -- "$p" scripts/ci-staged-gate.test.mjs || fail "the TASK-2008 test still carries the stopgap line $p"; done
python3 "$PLX_MC_REPO/scripts/agent-context/measure.py" --check-caps --check-needles "$PWD" || fail "caps or needles (P10, D13)"
[ "$(wc -c < .cursor/rules/mc-compliance.mdc)" -le 2457 ] || fail "slice > 2457 (P10, D13)"
for f in .cursor/rules/mc-compliance.mdc $(git diff --name-only origin/staging...HEAD -- .cursor/rules); do
  if grep -qiE "$COMPETING|$LOCKED" "$f" || [ "$f" = .cursor/rules/mc-compliance.mdc ]; then carrier "$f"; fi
done
! grep -q 'still resolves every PR' docs/runbooks/BRANCH-PROTECTION-STAGING.md || fail "runbook still promises multi-PR groups"
grep -qF '`max_entries_to_merge` | `1`' docs/runbooks/BRANCH-PROTECTION-STAGING.md || fail "the runbook must keep max_entries_to_merge at 1"
! grep -q 'to find every PR in the group' docs/runbooks/BRANCH-PROTECTION-STAGING.md || fail "runbook still says compliance finds every PR from squash subjects"
sweep . || fail "competing wording left in portal"
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
- **A team-wide brain registration lets every Cursor agent write to `memory.items`.** Mitigation: the writes are idempotent and rate-limited, with no delete (F16); the key follows D5, which Vince confirmed as `D5 as r13` in the yes on r13 (29 Sep 2026), and P14 records the brain's own log line for the self-check (key tier `brain`), which the acceptance checks under `## raw` for a VMC or scoped tier (retirement R4 fixes no other wording of that log; review log, open question 8, not yet put to Vince, open for r14 or follow-up work; P14 does not wait on it); the registration uses the brain's own address (D14). Rollback: remove the server, or use the kill switch.
- **The P16 rewrite of the `edited` lines grows the portal slice past P10's cap, or drops a needle or the locked sentence (D13).** Mitigation: the portal-half acceptance re-runs `measure.py --check-caps --check-needles`, the 2457-byte slice check and `carrier` on the rules it edits, runs `sweep` over the portal (the half also edits a runbook in `INSTR_FILES`), and it requires P10 portal's `cap: met` line first. Rollback: revert the portal PR.
- **PLX_MC PR #255 landed before P4 and P16 (F24).** r13 applies it: D2's lease reads release and never writes it; D4's queue rule is narrower than #255's open-PR exception, not a subset of it (it accepts an expired stamp only on a prior pass of the same head and tests neither the PR state nor the body), and makes no GitHub read. The portal's `mc-compliance.mdc` still says that the generated workflow triggers only on `opened/synchronize/reopened` and that a body-only edit does not re-run the gate (`:128-131`, `:301-309` at `2b656d8adf33`). That is true today: the portal's copy is pinned at `GEN_SHA` `1339f119…`, which predates #255, and `plx-mc-compliance.yml:10` still reads `types: [opened, synchronize, reopened]` (F10). It becomes false the moment the P16 portal half regenerates the workflow, so that half rewrites those lines in the same PR (D13). Its "Until TASK-2011 is live" sentence (`:137-139`) is false now, because TASK-2011 is #255, merged and deployed (F24); the same PR deletes it. Lines outside `.cursor/rules/` that say the same are follow-up work outside this plan (residual risk below; round 10, open question 7: open, not yet put to Vince; no phase waits on it).
- **A reopened PR un-releases its stamp (F2).** If another principal checked out the task while the PR was closed, two live stamps with different holders exist. This needs a stamp that is not yet completed (D2); under the contract's order, complete before the PR opens, the stamp on a reopened PR is normally completed and holds no lease, so the case is rare. D2's oldest-`issued_at` rule decides; the newer holder gets 409 until the older stamp completes, expires or is released again. The 409 message names the task, repo and expiry, and not the holder (Vince: expiry only, 2026-09-29T19:50:13Z); the holder is on the stamp's oldest `checkout` event in Mission Control (contract step 2.8).
- **A high-tier PR is blocked for a missing bucket PRD, or for a `prd` that is not an http(s) link (#263, F17).** Mitigation: P15 reads the bucket rows at the first yes and again in its r13 re-run, records `present` only for a link, and D11 puts the decision with Vince before P16 opens a PR; the rows read on 29 Sep 2026 hold GitHub URLs.
- **The P16 portal half lands before the Hub deploy.** Mitigation: the portal half starts only after the deploy. The trigger stays inert until an admin turns on the queue.
- **A `merge_group` run is "fixed" by making the job pass.** Mitigation: no `continue-on-error`, no job `if:`, no new `exit 0`, and the job id stays `compliance`. An expired stamp passes only where the same head already passed. Rollback: revert both PRs, portal first.
- **Someone installs a Jev product during a phase.** Rollback: remove the plugin directory and any `~/.claude` enablement. Do not merge a PR that adds `jev-rules`, `jevgrep`, `jev-code`, or a Typesafe/Jev plugin entry.
- **The portal hygiene audit goes critical on 30 Sep 2026 (F21).** Mitigation: every portal acceptance uses `hygiene_gate`, which accepts only the expired-shim failures that the branch point already has. Retiring or re-dating those shims is separate work outside this plan.
- **Residual risk outside this plan:**
  - Running the portal `scripts/sync-agents-md.py` would regenerate the retired roster.
  - The Lobster pipelines commit to `main` from the EC2 checkout, which `.cursor/rules/ec2-deploy-safety.mdc:10` forbids. The swarm retirement spec's R1 plans to turn both writers off.
  - Portal `CLAUDE.md:151` still names `taylorvalton/plx-customer-portal`.
  - After P16, portal lines outside `.cursor/rules/` still say that a body-only edit does not re-run the gate, and no phase owns them (at `2b656d8adf33`): `.cursor/skills/mc-sync/SKILL.md:49-50`, `docs/runbooks/CONTRIBUTING.md:262-263` (which also says the generated workflow has no `edited` trigger) and `CLAUDE.md:106` (the gate "does not re-read edited bodies"; it names no trigger list). `pr-watch-until-green.mdc:49-50` still says "push a commit (empty is fine)" (round 10, open question 7). The landing edit of 29 Sep 2026 found the first three.

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
r13 itself needed Vince's yes, because it changes D5, an approved default: r12's yes
covered r12's D5, and the rule under "Decisions a yes confirms" puts a changed default
to Vince. Vince gave it on 29 Sep 2026 as `yes r13, D5 as r13`, and round 10 closed the
same day (header; its time for the gates, `round_10_done_at`, is the merge of its
text: an approval field that the orchestrator sets in its execution copy when the
round-10 PR merges). The phrase `D5 as r13` confirms D5; P14 records it in `brain-register.md` and
does not start without it. P4, P14 and P16 are later-yes phases; the later yes that
names one of them is given against r13, or a later revision, after `round_10_done_at`
(D13, SC-13), and the phase's evidence records it (`later_yes`, `later_yes_at`). Each
also waits for its `depends_on` evidence. The P15 re-run starts once
`round_10_done_at` is set. The r13 approval question below records the yes on r13.

It does not start the later-yes phases:

| Phase | Why it waits | Repo |
|---|---|---|
| P3 | May mint a second stamp; must run before P2's `expires_at` | none |
| P4 | Edits PLX_MC `checkout()`; #255 merged, so its code branch runs under r13 after Vince's yes on r13 and round 10 (the yes given and round 10 closed on 29 Sep 2026, D13); its later yes is given after `round_10_done_at`, the merge of the round-10 text | `petralabx/PLX_MC` base `main` |
| P6 | Edits PLX_MC (meter) | `petralabx/PLX_MC` base `main` |
| P8 | Edits PLX_MC, second brain, and portal guides (complete order only) | two repos on base `main`, portal on base `staging` |
| P10 | Edits governed guides; name the repo | one repo per PR |
| P12 | Edits portal guides | `petralabx/plx-customer-portal` base `staging` |
| P14 | Registers a team-wide, write-capable connector; name `BRAIN_URL` (D14); Vince's `D5 as r13` (D5) came in the yes on r13; after Vince's yes on r13 and round 10 (the yes given and round 10 closed on 29 Sep 2026, D13); its later yes is given after `round_10_done_at` | none (cursor.com dashboard) |
| P16 | Edits the generator, the verify service, and the portal workflows; #255 merged, so it runs under r13 after Vince's yes on r13, round 10 (the yes given and round 10 closed on 29 Sep 2026) and the P15 re-run (D13); its later yes is given after `round_10_done_at` | PLX_MC base `main`, then portal base `staging` |

P9 (operator canary, after the P8 close) starts when its `depends_on` evidence is on
disk. It does not need a separate question. P7 is withdrawn.

Every code phase also waits on the evidence named in its `depends_on`: P4 on P3 (and
D13 for its code branch), P6 on P5, P8 on P6 (merged), P10 on P9, P12 on P11, and P16 on P15 (run under r13) and D13.
P14 waits on P13, on Vince's yes on r13 and round 10 (the yes given and the review closed; `round_10_done_at` set at the merge of the round-10 text, D13), on Vince's `D5 as r13` (given) and on the later yes that names `BRAIN_URL`, plus its pre-checks.

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
run under r13 after Vince's yes on r13 and its round-10 review (D13). P9 starts without a later yes
once its evidence is on disk. P7 is withdrawn, because no phase edits the swarm repo.
Every code phase waits on the evidence named in `depends_on`.

r13 changes later-yes phases (P4, P14, P16), two audits that keep their first-yes gate
(P13, P15; P15 runs again under r13 before P16), and one default (D5). It needs no new
first yes. It needed Vince's yes on r13, because D5 is a changed default and r12's
yes covered r12's D5 only; Vince gave it on 29 Sep 2026. The later yes that names P4,
P14 or P16 is given against r13, after that yes and round 10 (D13, SC-13). D5's
confirmation is the phrase `D5 as r13`, given once, in that yes (D5). The section below
records the yes on r13.

## Approval question for r13 (answered yes on 29 Sep 2026)

r13 needed Vince's yes. It changes one approved default, D5, on the swarm retirement
spec's instruction (its section 10, D3, R11): P14 registers the brain with a brain key
from `BRAIN_API_KEYS`, never the `VMC_API_KEY` value or a `VMC_SCOPED_API_KEYS`
department key. r12's yes covered r12's D5 (a VMC department key, else `VMC_API_KEY`),
so the rule under "Decisions a yes confirms" puts this change to Vince. The rest of r13
re-derives P4, P15 and P16 and the facts and decisions they rest on (D2, D4, D13) with
the same defaults, and takes D14 and F26 from retirement section 10 with D14's rule
unchanged.

Do you approve r13, with D5 as r13 states it? The answer has one form:

- `yes r13, D5 as r13`.

**Answered.** Vince answered `yes r13, D5 as r13` at 2026-09-29T18:09:35Z, against PR
#260 head `8ed919f5e59f`, in the orchestrator chat session. The header records it
(`r13_yes`, `r13_yes_at`, `d5_r13_yes`, `approved_by`, `approved_at`), and the review
log records it under round 10. The two variants this question offered (`yes r13` alone,
which would have left D5 for the P14 later yes, and `yes r13, except D5: as r12`, which
would have kept r12's D5 until r14 reconciled the two specs before retirement R11) are
void by that answer. The second was never a safe path: it would have registered the
`VMC_API_KEY` value or a department key at the brain's own name, which retirement D3,
R7 and section 10 forbid and P14's forbidden list and acceptance block.

The yes came before round 10. Round 10 closed the same day (header `round_10`; record:
`frontier-review-log.md`); its time for the gates, `round_10_done_at`, is the merge of
its text, an approval field that the orchestrator sets in its execution copy when the
round-10 PR merges. The yes named no rule for what it covers, so the round-10 text
stated the author's reading and put it to Vince (review log, open question 6). Vince
confirmed it at 2026-09-29T19:54:30Z ("stand under r13"): a round-10 fix stands under
the yes when it tightens an acceptance check, corrects a citation or a fact, adds an
evidence line or a stop condition, or restates SC-13 or the header in a phase's own
gate or `depends_on` lines; the changes round 10 made to the P4, P15, P16 and P14
gate, `depends_on`, stop-rule and `owns` lines, listed in the review log, stand under
it, and round 10 changed no default. A fix that would change a default, let a phase
start earlier or on fewer conditions, change `owns` (a file, a region or a symbol), or
narrow `forbidden` goes to Vince before the affected phase starts. Round 10 found four
such points. Three went to him, and he answered them: the P16 portal half when P10
portal does not run ("wait for P10", 2026-09-29T19:55:37Z); retirement R7's Team MCP
step ("yes", 2026-09-29T19:54:30Z: retirement r13 amends R7); and the `VerifyPrInput`
type in P16's `owns` (with open question 6: it stands under the yes on r13). The
fourth, the empty-commit line in portal `pr-watch-until-green.mdc:49-50`, which P16
does not own, was not put to him: it is open for r14 or follow-up work (review log,
open question 7), and no phase waits on it. He also accepted the draft's
section-16 items 2, 4 and 5 at 2026-09-29T19:55:37Z (reading confirmed at
20:03:53Z). P14 records the phrase in `brain-register.md` (`d5_confirmed`,
`d5_confirmed_at`, `d5_confirmed_in: yes on r13`).

The r12 approval stands for every phase r13 does not change (the header's
`approval_covers`), and those phases keep running. The four phases the r13 changes gate
wait for `round_10_done_at`: the P15 re-run then starts, with no later yes; P4's code
branch, P16 and P14 then wait for their later yes (each given against r13 or later and
after that time) and their `depends_on` evidence: P4 for P3, P16 for the P15 re-run and
the bucket PRDs, P14 for `BRAIN_URL` and its pre-checks (D13, SC-13). P15 runs again
under r13 before P16. P13 keeps its first-yes gate, and a run under either revision is
valid.

## Questions left after the r13 yes (the draft's `CHANGES.md` section 16), and their dispositions

The landing edit of 29 Sep 2026 (PR #260 head `f96a92c468d1`) copied this list into the
spec, because `CHANGES.md`, `gate0.md` and `r13.diff` live in the orchestrator store,
not in this repo. Round 10 read it. Every item is settled; the review log's "Round 10"
section holds the record, under its own question numbers, which differ from these.

1. **The yes on r13.** Answered: `yes r13, D5 as r13` at 2026-09-29T18:09:35Z (header
   `r13_yes`).
2. **Portal `mc-compliance.mdc:128-139`.** The P16 portal half rewrites the `edited`
   lines (`:128-131`) and deletes the "Until TASK-2011 is live" sentence (`:137-139`);
   Vince accepted the deletion at 2026-09-29T19:55:37Z (review log, question 5, item 2).
   The P16 portal acceptance fails while "A body-only edit does not re-run the gate" or
   "Until TASK-2011 is live" remains in any tracked rule.
3. **D8 and the P16 portal half.** Answered "wait for P10" at 2026-09-29T19:55:37Z
   (review log, question 2): the half starts only after the P8 and P10 portal PRs, with
   no after-P8-alone path; if P10 portal never runs, it stays blocked until Vince
   decides again. r14 replaces nothing in that acceptance.
4. **D4's two readings.** They are the re-derived D4, written in P16, not a second
   default; Vince confirmed them at 2026-09-29T19:55:37Z (review log, question 5,
   item 4), and D4 records it.
5. **The deploy of `f6d2bab7670a`.** The P15 re-run records `pr255_deployed: yes` and
   `pr255_deployed_source: gate0.md (GitHub deployment 6721728347,
   2026-09-28T22:11:43Z)`, as Vince chose at 2026-09-29T19:55:37Z (review log, question
   5, item 5); F24 cites that record. No phase gate depends on the deploy.
6. **The P14 key label.** Settled by P14's steps and `depends_on`: the operator makes
   the key off the brain host and off every trading host by retirement R5's procedure,
   labels it, and P14 records `key_name: BRAIN_API_KEY:<label>` and
   `key_sha256_prefix`. Not a decision a phase waits on; not put to Vince.
7. **`scripts/merge-group-prs.mjs`.** Dead code after P16, kept alive by its test (F10).
   Removing both is follow-up work outside this plan; not put to Vince.
8. **The phrase `D5 as r13`.** In the yes on r13 (header `d5_r13_yes`); P14 records it
   as `d5_confirmed_in: yes on r13` and does not start without it.

Round 10's own open questions 7 (the empty-commit line in portal
`pr-watch-until-green.mdc:49-50`) and 8 (the brain's request-log wording, retirement R4)
are a different list; they stay open for r14 or follow-up work in the review log, and no
phase waits on them.

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
