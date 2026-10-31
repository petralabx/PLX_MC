# Agent governance consolidation

- Slug: `agent-governance-consolidation` (this file is `docs/workstreams/agent-governance-consolidation.md`)
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/sleepy-cray-3x363i` (W01), `claude/agent-governance-consolidation-2` (W02),
  `-3` (W03), `-4` (W04), `-6` (W06, stacked on W01)
- MC tasks: TASK-4201 (W01), TASK-4204 (W02), TASK-4205 (W03), TASK-4206 (W04), TASK-4207 (W06),
  TASK-3928; draft DRF-4
- SharePoint handoff: n/a. The plan is the Agent Governance Handoff bundle of 2026-10-30:
  https://claude.ai/artifact/HUuysvBvQyDjbyQtxRTs36

## Goal

Fold PRJ-ENGINEERING-GOVERNANCE, PRJ-FLEET-COMPLIANCE and PRJ-SESSION-NUDGE-MCP into one
project with three buckets (Governance rules, Compliance enforcement, Session nudges). Then make
the rules, the code and the docs agree: `config/governance-contract.yaml` is the one rule file.

## Status

active, as of 2026-10-30. The "now" track is in review as five draft PRs, and the consolidation
draft DRF-4 waits for Vince. The bundle's `bundle.json` holds every work item (W01 to W22).

## Done

- P0-1: Claude's MC access works in Claude Code on the web. The proxy-injected key authenticates
  as `sp_mcp_lane_claude_vince`; the environment's own `MC_MCP_API_KEY` is stale (401).
- P0-3: the 73 open tasks of the three projects are mapped to a bucket and a verdict: 54 keep and
  move, 2 covered (W15, W16, W18), 5 done, 12 drop. The table is in DRF-4's research context.
- P0-4: DRF-4 is submitted (in review, version 1). Its author is vince@petrasoap.com.
- W01 (TASK-4201): #519, the review-links rule in the contract.
- W02 (TASK-4204): #522, MC refuses Verified from agents (403 `verified_needs_person`).
- W03 (TASK-4205): #521, portal Prisma migrations count as high-risk.
- W04 (TASK-4206): #523, a next-step hint for every agent-fixable error code.
- W06 (TASK-4207) and TASK-3928: #520, decisions D1 to D8 and the Oct 28-29 rules in the contract,
  and "save evidence before you open the PR".

## Next steps

1. CIP's merge-queue session lands #519 before 2026-11-01 04:00 UTC, then #520, #521, #522, #523.
2. Vince decides gate `apg_f82bfcced0552147` (#520 at `6312e83`) and rejects the stale
   `apg_3db034d468a80c43`.
3. Vince accepts DRF-4. Then move W01 to W06 into their buckets and start W07 to W22, W13 first.
4. A person applies the 17 closures Vince approved on 2026-10-26 (Ledger or CoS for the 3 duplicates).
5. After each merge: `mc_complete_task` with the PR link, then move the task's stage.

## Decisions and why

- 2026-10-30 D1 to D8 were made as recommended. #520 writes them into the contract, and Vince's
  signed approval of it records them in MC. Decided by: Vince.
- 2026-10-30 PRJ-FLEET-COMPLIANCE stays the umbrella: it holds 57 of the 73 open tasks. Decided by:
  the bundle's P0-3 rule.
- 2026-10-30 One branch and draft PR per item. Why: one theme per PR, and #520's approval does not
  hold up the others. Decided by: the user of this session.
- 2026-10-30 Drafts are saved with operator vince@petrasoap.com; MC refuses cos@ as a service
  mailbox. Gates are raised as cos@, so Vince, not the requester, can decide them.
- 2026-10-30 W04 hints cover the codes thrown under `src/lib/mcp/` and in the compliance service.
  `forbidden`, `not_found` and `invalid_request` get none: their messages name the fix.

## Open questions

- W13, portal half: does a body edit start the portal's compliance check? The PLX_MC half is
  answered: on #520 the gate ran at open (run 340) and again after a body edit (run 341, same head).
- P0-2: the production values of the settings in `bundle.json` → `phase0`. A person reads them.
- TASK-4168 asks to let Vince decide a gate he raised; the bot rules say another person decides.
- W03 changes the risk tier the compliance check applies. Under D2, does Vince decide it?

## Files / areas touched

- `config/governance-contract.yaml` and the seven files generated from it.
- `src/lib/mcp/actions.ts`, `envelope.ts`, `route.ts`, `create-http-server.ts`,
  `src/app/api/cursor/mcp/route.ts`, `src/lib/compliance/risk.ts`.
- `tools/plx-mc-mcp/index.ts`, `tools/plx-mc-mcp/lib/tool-errors.mjs`.
- `docs/modules/mcp/README.md`, `docs/modules/compliance/README.md`, `LESSONS.md`.

## How to run the tests

```bash
python scripts/generate-governance-surfaces.py --check
./scripts/preflight.sh --mode pre-commit
npx vitest run tests/mcp-verified-needs-person.test.ts tests/mcp-error-hints.test.ts tests/compliance.test.ts
npx vitest run --exclude 'tests/*postgres*.test.ts'
node scripts/workstream-note.mjs check --strict
```

## Blockers or dependencies on other workstreams

- W07 to W22 wait for Vince to accept DRF-4.
- W05 (the bot rules list), P0-2 and the settings track (W15 to W19) need a person.
- Claude Code on the web has no Docker, so the 7 Postgres harness suites run only in CI.

## Last updated

2026-10-30 by claude-code/claude-code (Claude Code on the web).
