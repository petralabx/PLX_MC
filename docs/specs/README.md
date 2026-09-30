# Specs

Implementation specs that an orchestrator agent reads and builds from. Each spec
names its phases, the repo each phase touches, and the acceptance check that
proves the phase is done. Accountable human for all three: vince@petrasoap.com.

| File | Revision | Status | What it covers |
|---|---|---|---|
| [`frontier-implementation-spec.md`](frontier-implementation-spec.md) | r13 | r13 approved 29 Sep 2026 (`yes r13, D5 as r13`, 18:09:35 UTC), merged to `main` the same day (#260, `697373e00719`), and round 10 done the same day (27 findings verified: 22 fixes applied in full, 3 closed on Vince's answers the same day, 2 applied in part with the rest open for r14 or follow-up work; Vince answered every question the round put to him on 29 Sep 2026; the two open points were not put to him, and no phase waits on them; every nit of the draft's critic has a disposition in the log, and none stays open; no default changed; after the round, PLX_MC `main` gained #262 and #263, so the round-10 text pins the P4 and P16 code citations at `7f79712657e3` and corrects F17; below). r12 approved 28 Sep 2026; that approval stands for every phase r13 does not change, and those phases run under it. r13, written under D13 after PLX_MC PR #255 merged, changes P4, P15 and P16 (D13) and applies swarm retirement r12 section 10 to D5, D14, F26, P13 and P14. The four phases the r13 changes gate wait for `round_10_done_at` (the merge of the round-10 text to `main`; an approval field that the orchestrator sets in its execution copy, and each gated acceptance checks it against `main`): the P15 re-run then starts, with no later yes; P4's code branch (P3), P16 (the P15 re-run, the bucket PRDs) and P14 (`BRAIN_URL`, its pre-checks) then wait for their later yes and their `depends_on` evidence. P13 and the r12 run of P15 keep their first-yes gate, and a P13 run under either revision is valid. | The frontier stack: checkout leases, merge queue, the cloud proofs and the rest of the five workstreams. |
| [`frontier-review-log.md`](frontier-review-log.md) | rounds 1–10 | Record. Round 10 is the review of r13 (below), logged with its 27 findings, the nits it closed, the questions it put to Vince with his answers, and the two points not yet put to him, open for r14 or follow-up work; the r13 approval is logged after it. | The adversarial review of the frontier spec, finding by finding. |
| [`agent-fleet-spec.md`](agent-fleet-spec.md) | r13 | D1–D26 confirmed; reviewed in seven rounds plus one pass on r13 (28 Sep 2026) | Agents registered in the portal, run in parallel on an always-on runner, on any model through the fleet's own proxy on its own EC2 host. A version passes an eval before it goes live. COS is the chief of staff, one agent reached from the portal, the COS Companion and Grok Bot. |
| [`agent-fleet-review-log.md`](agent-fleet-review-log.md) | rounds 1–7, r13 pass | Record | The adversarial review of the fleet spec, finding by finding. |
| [`swarm-retirement-spec.md`](swarm-retirement-spec.md) | r13 | D1–D13 confirmed; reviewed in seven rounds, then closed by the operator; r12 follows fleet r13 (28 Sep 2026); r13 (29 Sep 2026) amends R7 so that it leaves the Cursor Team MCP entry to frontier P14 and records `team_mcp: left to frontier P14`, on Vince's answer to frontier round-10 open question 3; its B16 and the P14 bullet of its section 10 say the same, and no decision, default or other step changed | Retire `petralabx/agentic-swarm` and VMC: measure use, move the brain to `plx_secondbrain`, retire the rest. The trading lab is not touched and keeps the repo. |
| [`swarm-retirement-review-log.md`](swarm-retirement-review-log.md) | rounds 1–7 | Record | The adversarial review of the retirement spec, finding by finding. |

## Round 10 — the review of frontier r13 (done 29 Sep 2026)

Round 10 was the independent critics' review of every r13 change, blind, then the
author's verification, in the form of rounds 2–9. It ran on 29 Sep 2026 on PR #260 at
head `8ed919f5e59f`, after the draft's own critic had approved the draft (five rounds,
six blockers, all applied; `CHANGES.md` section 18). #260 merged to `main` the same day
(`697373e00719`, 21:42:13 UTC) with a landing edit that recorded the yes and corrected
citations; the round-10 text is built on that merged text and keeps those corrections
(the review log's round-10 background lists them). Three critics returned 27 findings
(8 major, 19 minor, no blocker); a fourth pass returned none. The author verified all
27 against the code and the specs: 22 fixes are applied in the spec text in full, 3
were applied in part and closed on Vince's answers the same day (the P16 portal half
waits for P10 portal; retirement r13 leaves the Team MCP entry to P14; the round-10
gate, `depends_on`, stop-rule and `owns` changes stand under the yes on r13), 2 (one
merged pair) are applied in part with the rest open for r14 or follow-up work (the
brain's proof of the key tier for P14, which needs retirement R4 to fix its log
wording; P14 does not wait on it), and no default changed. Vince also answered the
round's other questions on 29 Sep 2026: the P4 409 message names the expiry only, the
later yes for P4 and P16 is given again after `round_10_done_at`, and the draft's
section-16 items 2, 4 and 5 are accepted. The record is in `frontier-review-log.md`
under "Round 10", and the spec header's `round_10:` line records the date, the counts
and the answers. The time the gates read, `round_10_done_at`, is the time the
round-10 text merges to `main`; it is an approval field, the orchestrator sets it in
its execution copy (the copy that holds the approval fields, below) when the round-10
PR merges, with no second PR, and each gated acceptance derives it from `main`. Until
then every r13-gated acceptance fails, so no later yes given before that merge counts.

Its scope, in full:

- Under D13 (PLX_MC PR #255 merged as `f6d2bab7670a`): P4, P15 and P16, with the
  facts and decisions they rest on (F1, F2, F6, F10, F11, F13's portal lines, F23 and
  F24; D2, D4 and D13, re-derived with the same defaults). That includes P4's lease
  query and its released-stamp test; P15's two new lines (`pr255: merged f6d2bab7670a`
  and `gate_pr_types`) and its re-run rule (an r12 run of P15 does not satisfy r13, so
  P15 runs again under r13 before P16); the P16 PLX_MC acceptance that reads those two
  lines; the P16 `merge_group` resolver and its fixed test titles; and the P16 portal
  half's `edited` lines, kept within P10's caps.
- Under swarm retirement r12 section 10: D5 (a brain key from `BRAIN_API_KEYS`; a
  changed default), D14 (R6a, no quiet window), F26 (the R6 routes stay), the P13 fact
  line, and P14's gate, template and acceptance, including its `D5 as r13` lines.
- The Scheduling bullet on retirement R7's Team MCP step (added by a finding).
- The nits the draft's critic rounds left for it, and the questions the draft left open
  (its `CHANGES.md` section 16, which the landing edit of 29 Sep 2026 copied into the
  spec as "Questions left after the r13 yes"; `CHANGES.md` is in the orchestrator store,
  not in this repo). The log gives each of the 37 nits (13, 11 and 13 in rounds 1-3) a
  disposition: 3 came back as blockers (R10-3, R10-5, R10-6) and closed there, 31 are
  applied in the r13 or round-10 text (6 of them by the ninth check of that text), and 3
  are closed without a change, with the reason. None stays open.

Main moved after the round. PLX_MC `main` gained #262 (TASK-2111, `5658c055bccc`,
22:09:53 UTC) and #263 (TASK-2112, `7f79712657e3`, 22:22:59 UTC) on 29 Sep 2026, after
round 10's packet was cut. #262 changed `src/lib/compliance/service.ts` and
`tests/compliance-server.test.ts`, which P4 and P16 cite and edit: every block reason the
gate records is now a text (a released stamp blocks as `checkout released — re-checkout
the task`). #263 made the gate count a bucket PRD only when it is an http(s) link (F17,
D11; the two bucket rows P15 read hold GitHub URLs, so both stay present) and edited one
line of the frontier spec on `main` (step 8's PRD messages). A ninth check of the
round-10 text pinned the P4 and P16 code citations at `7f79712657e3` by line and by
symbol, said which ref each fact's citations use, corrected F17, D11 and the P16
released-stamp case, kept #263's line, and told each builder to re-check its citations
at the code of the day before it starts. A tenth check pinned the last bare ranges the
same way (F3, F6 and F15) and corrected this index's retirement row, which had said that
retirement r13 changed nothing else. An eleventh check corrected the two ranges of the
TASK-2008 assertions that survive the P16 portal edit, which had counted the three
re-pointed lines among the survivors; the 33 pins themselves were right.

What the round changed, in short: every r13-gated acceptance block (P4's code branch,
the P15 re-run, both P16 halves, P14) now reads the spec header from PLX_MC `main` and
`round_10_done_at` from the execution copy, checked against the merge on `main`, fails
until that time is set, and requires the phase's later yes, or the P15
`audited_at`, to be later than the yes on r13 and `round_10_done_at`; P15's re-run
carries its own revision, SHA and time; P14 gains a pre-check of the brain's MCP route
with the brain key, a check of the Team MCP list before registration, and the brain's
own log line for the self-check, pasted under `## raw` and checked there for a VMC or
scoped tier (retirement R4 fixes no other wording of that log), as the evidence of the
key tier; P4's repo match, its test pointer and two
weak checks are corrected; P16's citations, ownership, runbook lines and portal checks
are tightened, including the wrapped wording in the portal rules and 33 unique pins on
the assertions that survive the TASK-2008 test edit, plus the lines the edit writes.

The D5 yes. r13 changed D5, an approved default, so r13 needed Vince's yes. Vince
gave it as `yes r13, D5 as r13` at 2026-09-29T18:09:35Z, before round 10. The header
records the yes, the head it was given against, and what it covers. The yes named no
rule, so the round-10 text stated the author's reading and put it to Vince (open
question 6): a round-10 fix stands under the yes when it tightens an acceptance check,
corrects a citation or a fact, adds an evidence line or a stop condition, or restates
SC-13 or the header in a phase's own gate or `depends_on` lines; a fix that would
change a default, let a phase start earlier or on fewer conditions, change `owns`, or
narrow `forbidden` goes to Vince before the affected phase starts. He confirmed that
reading at 19:54:30 UTC ("stand under r13"): every gate, `depends_on`, stop-rule and
`owns` line round 10 changed, which the log lists, stands under the yes, the
`VerifyPrInput` type in P16's `owns` included, and no r14 is needed for them. His
other answers the same day: the P16 portal half waits for P10 portal, with no
after-P8-alone path (19:55:37 UTC); retirement r13 leaves the Team MCP entry to P14
(19:54:30 UTC); the P4 409 message names the expiry only (19:50:13 UTC); the `yes P4`
and `yes P16` of 18:14:39Z, given before round 10 closed, are not counted and are
given again after `round_10_done_at` (19:50:13 UTC); and the draft's section-16
items 2, 4 and 5 are accepted (19:55:37 UTC, reading confirmed 20:03:53 UTC). Two
points, not yet put to Vince, stay open for r14 or follow-up work, and no phase waits
on them: the
empty-commit line in portal `pr-watch-until-green.mdc:49-50`, which P16 does not
own, and whether retirement R4 should fix the brain's log wording so that P14 can pin
the self-check's line. P14 records the phrase in `brain-register.md`
(`d5_confirmed_in: yes on r13`) and does not start without it.

## How the specs depend on each other

- Frontier P4 (code branch) and P16 waited on PLX_MC PR #255 (frontier D13). It
  merged on 28 Sep 2026 as `f6d2bab7670a`. Frontier r13 re-derives the lease and
  merge-queue rules against PLX_MC `fc7ceef3d123` and portal `2b656d8adf33`
  (retirement section 10); the round-10 text pins the P4 and P16 code citations at
  PLX_MC `7f79712657e3` (after #262 and #263), and each builder re-checks them at the
  code of the day before it starts. Vince's yes on r13 is given and round 10 is done (29 Sep
  2026); `round_10_done_at` is set in the execution copy when the round-10 text
  merges. Both phases then wait for their later yes, given after that time, and for
  their `depends_on` evidence (P4 on P3; P16 on the P15 re-run and the bucket PRDs).
  P15 runs again under r13 before P16; its r12 run does not satisfy r13.
- Frontier P14 waits on `BRAIN_URL`, the brain's own address, which exists after
  retirement R6a (frontier D14). It registers that address with a brain key from
  `BRAIN_API_KEYS`, never a VMC key (retirement D3, R5, R7, R11; frontier D5). That key
  source is r13's changed D5, which Vince confirmed as `D5 as r13` in the yes on r13;
  P14 records it in `brain-register.md`, checks the brain's MCP route with the key
  before registering, and records the brain's own log line for the self-check as the
  evidence of the key tier (as far as retirement R4 fixes that log: a tier per request;
  open question 8, a fixed wording in R4, is open for r14 or follow-up work, and P14
  does not wait on it). The R6 routes on the old host stay for good (retirement D4;
  frontier F26). Retirement r13's R7 leaves the Cursor Team MCP entry to P14 and
  records `team_mcp: left to frontier P14` (Vince, 29 Sep 2026); P14 still stops if
  an entry exists before it registers.
- Retirement R5's tailnet fence waits for fleet P1, which creates `tag:fleet-proxy`.
  R8 waits for fleet P1 (the fleet's OpenAI organisation for the brain's embedding
  key), and R9 waits for fleet P1 and P2 (the brain's fleet key).
- The fleet spec retires Mission Control's agents module (fleet D15, P9). The
  retirement spec lists the swarm pieces the fleet replaces.
- No frontier phase edits the swarm (frontier SC-12).
- The review closed with operating detail still to settle. Each build phase's own PR
  review checks it against the code of the day; the review logs list what was found.
- No phase in any of the three specs may affect the trading lab. It keeps the swarm
  repo, the old host, the gateway's `local-driver` lane and both Sparks (retirement
  D8 and Stage 3, fleet D23).

## Rules for these files

- A spec changes only by PR, with a new revision line at the top.
- The orchestrator works from its own copy in its store. After Setup, that copy
  is the execution copy and holds the approval fields and evidence paths. A new
  revision lands here first, then the orchestrator copies it. Frontier
  `round_10_done_at` is one of those fields: the orchestrator sets it in the execution
  copy when the round-10 text merges, with no second PR, and the gated acceptances
  check it against `main` (frontier SC-13).
- A phase is done when its acceptance check passed and its PR merged. The spec
  says where each phase records its evidence.
