# Specs

Implementation specs that an orchestrator agent reads and builds from. Each spec
names its phases, the repo each phase touches, and the acceptance check that
proves the phase is done. Accountable human for all three: vince@petrasoap.com.

| File | Revision | Status | What it covers |
|---|---|---|---|
| [`frontier-implementation-spec.md`](frontier-implementation-spec.md) | r12 | Approved 28 Sep 2026 | The frontier stack: checkout leases, merge queue, the cloud proofs and the rest of the five workstreams. |
| [`frontier-review-log.md`](frontier-review-log.md) | rounds 1–9 | Record | The adversarial review of the frontier spec, finding by finding. |
| [`agent-fleet-spec.md`](agent-fleet-spec.md) | r5 | D1–D22 confirmed; D23 proposed; not reviewed | Agents registered in the portal, run on an always-on runner, on any model through one gateway. COS is the chief of staff, one agent reached from the portal, the COS Companion and Grok Bot. |
| [`swarm-retirement-spec.md`](swarm-retirement-spec.md) | r4 | Decisions confirmed; not reviewed | Retire `petralabx/agentic-swarm` and VMC: measure use, move the brain to `plx_secondbrain`, retire the rest. The trading lab is not touched and keeps the repo. |

## How the specs depend on each other

- Frontier P4 (code branch) and P16 wait on PLX_MC PR #255 (frontier D13).
- Frontier P14 waits on `BRAIN_URL`, the brain's own address from retirement R7
  (frontier D14).
- The fleet spec retires Mission Control's agents module (fleet D15, P9). The
  retirement spec lists the swarm pieces the fleet replaces.
- No frontier phase edits the swarm (frontier SC-12).
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
