# Agent governance consolidation

- Slug: `agent-governance-consolidation` (this file is `docs/workstreams/agent-governance-consolidation.md`)
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/nice-albattani-rand8f`, `claude/nice-albattani-rand8f-ci`
- MC tasks: TASK-4201 (W01), TASK-4204 (W02), TASK-4205 (W03), TASK-4206 (W04), TASK-4207 (W06),
  TASK-3928, TASK-4257, TASK-4346, TASK-4348, TASK-4378; handshake adoption, one per repo:
  TASK-4352, TASK-4353, TASK-4354, TASK-4355, TASK-4356, TASK-4357, TASK-4358; CI speed in other
  repos: TASK-4359, TASK-4360; open asks: TASK-4168, TASK-1166; draft DRF-4
- SharePoint handoff: n/a. The plan is the Agent Governance Handoff bundle of 2026-10-30. The
  zero-drift and CI speed plans are on the Governance Handoff Status page:
  https://claude.ai/artifact/Fv26Dp57T5pa1bE1Vcftyv

## Goal

Fold PRJ-ENGINEERING-GOVERNANCE, PRJ-FLEET-COMPLIANCE and PRJ-SESSION-NUDGE-MCP into one
project with three buckets (Governance rules, Compliance enforcement, Session nudges). Then make
the rules, the code and the docs agree: `config/governance-contract.yaml` is the one rule file,
and every other copy is generated from it or not written.

## Status

active, as of 2026-10-31. Zero-drift items 3 and 4 (TASK-4378) are being built; the other plan
items wait on the people named under Open questions. This note names PRs and tasks only: the
SessionStart hook prints their live stage, PRs and gates from Mission Control.

## Done

- P0-1: Claude's MC access works in Claude Code on the web through the session proxy.
- P0-3: the 73 open tasks of the three projects are mapped to a bucket and a verdict: 54 keep and
  move, 2 covered (W15, W16, W18), 5 done, 12 drop. The table is in DRF-4's research context.
- P0-4: DRF-4 is submitted. Its author is vince@petrasoap.com.
- W01 (#519, `c19e90f`), W02 (#522, `6ab7489`), W03 (#521, `4795130`), W04 (#523, `dd59ba2`),
  W06 (#520, `fa128f5`) and TASK-4257 (#525, `937fcc5`) merged on 2026-10-31.
- TASK-4346 (#538): PLX_MC CI runs as parallel jobs, 25 min 20 s to 6 min 50 s per PR.
- TASK-4348 (#539): the contract's handshake feeds both MCP servers' instructions and a marked
  block in each tracked repo (`--fleet`).
- 2026-10-31 drift audit of the nine repos: 10 contradictions, listed with pinned line links on
  the status page. The adoption PRs fix them: furgenics#19, for-and-against#32, 1hr-after#46,
  local-inference#70, plx_secondbrain#10, agentic-swarm#1810, plx-customer-portal#3235.
- Every ask for a person is an MC question or gate (zero-drift item 6), listed under Open
  questions.

## Next steps

1. TASK-4378 lands in petralabx/skills, the note tooling's source, and in PLX_MC. Then each other
   repo takes it with skills' `scripts/apply-workstream-bundle.py`, one PR per repo, after that
   repo's adoption PR lands. skills and test-perms-check adopt the handshake block too.
2. Monday 2026-11-02: open the portal CI PR for TASK-4360 (one workflow PR per repo per week).
3. CI plan items 1 (queue reuse), 6 (one fast pre-push hook) and 8 (TypeScript 7). The portal's
   two TypeScript 7 errors are fixed on `claude/nice-albattani-rand8f-ts7`.
4. internal-seller-api: register it in `config/tracked-repos-registry.json` or record it as
   untracked.
5. After Vince accepts DRF-4: one `mc_update_tasks` batch moves the 54 kept tasks, and W07 to
   W22 start, W13 first. W09 replaces PLX_MC's hand-written CLAUDE.md copy.

## Decisions and why

- 2026-10-30 D1 to D8 were made as recommended and are in the contract (#520). Decided by: Vince.
- 2026-10-30 PRJ-FLEET-COMPLIANCE stays the umbrella: it holds 57 of the 73 open tasks. Decided by:
  the bundle's P0-3 rule.
- 2026-10-30 One branch and PR per item. Why: one theme per PR, and one approval does not hold up
  the others. Decided by: the user of this session.
- 2026-10-30 Drafts are saved with operator vince@petrasoap.com; MC refuses cos@ as a service
  mailbox. Gates are raised as cos@, so Vince, not the requester, can decide them.
- 2026-10-30 TASK-4257: a push or a ready PR never moves a task back from In QA or In Review.
  Decided by: the user of this session; Vince confirms or overrules it (question below).
- 2026-10-31 The handshake lives in the contract and reaches agents through the MCP server
  instructions, filled in per repo. Why: a contract change then reaches every MCP-connected agent at
  the next deploy, with no copy to update. Decided by: the user of this session (CoS).
- 2026-10-31 `--fleet` replaces only a marked block or a section headed "Mission Control
  handshake", and never appends. Why: the portal's and agentic-swarm's rule files are laid out
  differently and need a person to place the markers.
- 2026-10-31 New tasks go in BKT-INFRA until DRF-4's buckets exist; they move with W01 to W06.
- 2026-10-31 Notes name work and never type its state; the SessionStart hook reads it from MC
  (TASK-4378). Why: a note edit after every merge needs an agent that is no longer there. The
  tooling's one source stays petralabx/skills, whose bundle script already copies and checks it,
  so PLX_MC's generator does not copy it a second way.

- 2026-10-31 CI item 4 (CIP arms on the event) is not built. The 25 portal PRs merged that
  afternoon waited 0 to 7 minutes beyond the 13-minute queue run. lint-typecheck-build went green
  last in 15, and the ai-review/verdict status, 4 to 23 minutes after a push, in 9. Re-measure on a
  night or weekend sample, when CIP is not polling, before building it.

## Open questions

- Vince: DRF-4, accept it or send it back.
- Vince: is W03 a compliance-check change under D2? q_a5de7a8ad7e73eb3 on TASK-4205.
- Vince: may he decide a gate he raised? q_5f0490c7fe604176 on TASK-4168.
- Vince: keep TASK-4257? q_c12ec4faa9d3cc89 on TASK-4257.
- Vince: P0-2, the production settings W15 to W19 start from. q_e2eedfb131c553ac on TASK-1166.
- Stephen: decline the superseded gate apg_5dcd1e94e89f3226. q_8ebcb7a8e39ce1ca on TASK-4346.
  q_ba06872661e84aba asked Vince the same by mistake; he cannot decide a gate raised as him.
- CoS: W05, replace the bot rules list with the bundle's bot-rules.md.
- Environment owner: the cloud environment's `MC_MCP_API_KEY` is invalid (`invalid_api_key`).
  curl reaches MC only because the session proxy swaps the Authorization header; Node's fetch
  bypasses the proxy, so the SessionStart hook reads nothing here until the key is replaced.
- W13, portal half: does a body edit start the portal's compliance check?

## Files / areas touched

- `config/governance-contract.yaml` and the files generated from it, including
  `src/lib/mcp/handshake.generated.ts` and `tools/plx-mc-mcp/lib/handshake.generated.mjs`.
- `scripts/generate-governance-surfaces.py`, `src/lib/mcp/create-http-server.ts`,
  `tools/plx-mc-mcp/index.ts`, `src/lib/mcp/actions.ts`, `docs/modules/mcp/README.md`.
- The note tooling: `scripts/workstream-note.mjs` and its test, `docs/workstreams/_template.md`,
  the handoff and resume-workstream commands for Claude and Cursor.
- `.github/workflows/ci.yml`, `.github/actions/plx-mc-setup/`, `scripts/preflight.sh`,
  `docs/runbooks/CI-PIPELINE.md`.

## How to run the tests

```bash
python scripts/generate-governance-surfaces.py --check
python scripts/generate-governance-surfaces.py --fleet .. --check
python -m pytest tests/test_generate_governance_surfaces.py -q
node --test scripts/workstream-note.test.mjs
npx vitest run tests/mcp-complete-evidence.test.ts tests/mcp-handshake-instructions.test.ts tests/workstream-note.test.ts
./scripts/preflight.sh --mode pre-commit
```

## Blockers or dependencies on other workstreams

- W07 to W22 wait for Vince to accept DRF-4.
- W05, P0-2 and the settings track (W15 to W19) need a person.
- Claude Code on the web has no Docker, so the 7 Postgres harness suites run only in CI.

## Last updated

2026-10-31 by claude-code/claude-code (Claude Code on the web).
