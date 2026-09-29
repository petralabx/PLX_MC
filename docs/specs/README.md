# Specs

Implementation specs that an orchestrator agent reads and builds from. Each spec
names its phases, the repo each phase touches, and the acceptance check that
proves the phase is done. Accountable human for all three: vince@petrasoap.com.

| File | Revision | Status | What it covers |
|---|---|---|---|
| [`frontier-implementation-spec.md`](frontier-implementation-spec.md) | r13 (draft) | r12 approved 28 Sep 2026; that approval stands for every phase r13 does not change, and those phases run under it. r13, drafted the same day under D13 after PLX_MC PR #255 merged, changes P4, P15 and P16 (D13) and applies swarm retirement r12 section 10 to D5, D14, F26, P13 and P14. r13 is pending Vince's yes (`yes r13, D5 as r13`; D5 is a changed default) and round 10 (below). Until both, the r13 changes wait: P4's code branch, the P15 re-run, P16 and P14. | The frontier stack: checkout leases, merge queue, the cloud proofs and the rest of the five workstreams. |
| [`frontier-review-log.md`](frontier-review-log.md) | rounds 1–9; round 10 pending | Record. Round 10 is the review of r13 (below); the orchestrator logs it here. | The adversarial review of the frontier spec, finding by finding. |
| [`agent-fleet-spec.md`](agent-fleet-spec.md) | r13 | D1–D26 confirmed; reviewed in seven rounds plus one pass on r13 (28 Sep 2026) | Agents registered in the portal, run in parallel on an always-on runner, on any model through the fleet's own proxy on its own EC2 host. A version passes an eval before it goes live. COS is the chief of staff, one agent reached from the portal, the COS Companion and Grok Bot. |
| [`agent-fleet-review-log.md`](agent-fleet-review-log.md) | rounds 1–7, r13 pass | Record | The adversarial review of the fleet spec, finding by finding. |
| [`swarm-retirement-spec.md`](swarm-retirement-spec.md) | r12 | D1–D13 confirmed; reviewed in seven rounds, then closed by the operator; r12 follows fleet r13 (28 Sep 2026) | Retire `petralabx/agentic-swarm` and VMC: measure use, move the brain to `plx_secondbrain`, retire the rest. The trading lab is not touched and keeps the repo. |
| [`swarm-retirement-review-log.md`](swarm-retirement-review-log.md) | rounds 1–7 | Record | The adversarial review of the retirement spec, finding by finding. |

## Round 10 — the review of frontier r13

Round 10 is the independent critic's review of every r13 change, blind, then the
author's verification, in the form of rounds 2–9. The orchestrator logs it in
`frontier-review-log.md` and then sets the spec header's `round_10:` line from
`pending` to the date and the findings count.

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
- The nits the draft's critic rounds left for it, and the open questions in
  `CHANGES.md` (sections 16 and 18) that Vince has not answered.

Round 10 runs on the r13 draft once the draft's own critic approves it (four rounds so
far, six blockers, all applied; `CHANGES.md` section 18). Its findings are applied
before any r13 change starts: P4's code branch, the P15 re-run, P16 and P14 wait for
round 10 and for Vince's yes on r13 (D13, SC-13). The phases r13 does not change keep
running under r12's approval.

The D5 yes. r13 changes D5, an approved default, so r13 needs Vince's yes. Its form is
`yes r13, D5 as r13`. The phrase `D5 as r13` confirms D5; Vince gives it once, in that
yes or in the P14 later yes (`yes P14, BRAIN_URL=https://brain.plxcustomer.io, D5 as
r13`). `yes r13` alone approves the rest of r13 and leaves D5 for the P14 later yes.
`yes r13, except D5: as r12` keeps r12's D5 and needs r14 to reconcile the two specs
before retirement R11. The orchestrator records the answer in the spec header
(`r13_yes`, `d5_r13_yes`) and in the review log. P14 records the phrase in
`brain-register.md` and does not start without it.

## How the specs depend on each other

- Frontier P4 (code branch) and P16 waited on PLX_MC PR #255 (frontier D13). It
  merged on 28 Sep 2026 as `f6d2bab7670a`. Frontier r13 re-derives the lease and
  merge-queue rules against PLX_MC `fc7ceef3d123` and portal `2b656d8adf33`
  (retirement section 10). Both phases start under r13 or later, after Vince's yes on
  r13 and round 10 (above). P15 runs again under r13 before P16; its r12 run does not
  satisfy r13.
- Frontier P14 waits on `BRAIN_URL`, the brain's own address, which exists after
  retirement R6a (frontier D14). It registers that address with a brain key from
  `BRAIN_API_KEYS`, never a VMC key (retirement D3, R7, R11; frontier D5). That key
  source is r13's changed D5, so P14 also waits on Vince's yes on r13, on round 10 and
  on the phrase `D5 as r13`, given once in the yes on r13 or in the P14 later yes,
  which P14 records in `brain-register.md`. The R6 routes on the old host stay for
  good (retirement D4; frontier F26).
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
  revision lands here first, then the orchestrator copies it.
- A phase is done when its acceptance check passed and its PR merged. The spec
  says where each phase records its evidence.
