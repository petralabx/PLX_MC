# Agent governance consolidation

- Slug: `agent-governance-consolidation` (this file is `docs/workstreams/agent-governance-consolidation.md`)
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/nice-albattani-rand8f` and its `-ci`, `-adopt`, `-notes`, `-ts7`, `-prepush`,
  `-owner`, `-review-lane` and `-isa` siblings, one per PR
- MC tasks in flight (the SessionStart hook reads the first 20 ids a note names): review lane for
  every repo TASK-4397; internal-seller-api enrollment TASK-4398; note tooling TASK-4378 and its
  sync TASK-4386; handshake adoption TASK-4352, TASK-4353, TASK-4354, TASK-4355, TASK-4356,
  TASK-4357, TASK-4380, TASK-4383; CI speed TASK-4359, TASK-4360. Draft DRF-4. Finished tasks are
  under Done.
- SharePoint handoff: n/a. The plan is the Agent Governance Handoff bundle of 2026-10-30. The
  zero-drift and CI speed plans are on the Governance Handoff Status page:
  https://claude.ai/artifact/Fv26Dp57T5pa1bE1Vcftyv

## Goal

Fold PRJ-ENGINEERING-GOVERNANCE, PRJ-FLEET-COMPLIANCE and PRJ-SESSION-NUDGE-MCP into one
project with three buckets (Governance rules, Compliance enforcement, Session nudges). Then make
the rules, the code and the docs agree: `config/governance-contract.yaml` is the one rule file,
and every other copy is generated from it or not written.

## Status

active, as of 2026-11-01. The open PRs in the eight non-portal repos wait on `ai-review/verdict`,
which no lane reviews there yet; TASK-4397 fixes that. The other plan items wait on the people
named under Open questions. This note names PRs and tasks only: the
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
- 2026-10-31: TASK-4389 (PLX_MC#544, pre-push checks the changed files), TASK-4168 (PLX_MC#545,
  the owner decides an agent-raised gate), TASK-4358 (portal#3235), TASK-4382 (portal#3250) and
  TASK-4384 (portal#3251) merged. TASK-4205: Vince approved W03's gate.

## Next steps

1. TASK-4397 (agentic-swarm, review lane): after it lands, Infra runs `install.sh --apply` on
   coding-1, clones each repo to `/home/coder/repos/<name>` and enables `plx-auto-astra@<name>.timer`
   per repo (infra/coding-1/README.md, Review lane for every repo). Then the verdicts post.
2. CIP lands the open PRs once their verdict is green; skills#50 before the seven TASK-4386 sync
   PRs, so source and copies agree. test-perms-check's TASK-4383 commit waits for the session user
   to allow the push.
3. Monday 2026-11-02: open the portal's weekly workflow PR for TASK-4360. TypeScript 7 stays out of
   it: TS7 has no JS API yet (CI item 8).
4. TASK-4398, internal-seller-api: PLX_MC#547 (pending_adoption) and internal-seller-api#2
   (adoption) are open. After #2 lands and its gate runs green, a PLX_MC PR sets it active and hard.
5. After Vince accepts DRF-4: one `mc_update_tasks` batch moves the 54 kept tasks, and W07 to
   W22 start, W13 first. W08 is done by TASK-4380, and W07 shrinks to the portal's
   mc-compliance.mdc and CONTRIBUTING.md (both noted on DRF-4). W09 replaces PLX_MC's hand-written
   CLAUDE.md copy.

## Decisions and why

- 2026-10-30 D1 to D8 were made as recommended and are in the contract (#520). Decided by: Vince.
- 2026-10-30 PRJ-FLEET-COMPLIANCE stays the umbrella: it holds 57 of the 73 open tasks. Decided by:
  the bundle's P0-3 rule.
- 2026-10-30 One branch and PR per item. Why: one theme per PR, and one approval does not hold up
  the others. Decided by: the user of this session.
- 2026-10-30 Drafts are saved with operator vince@petrasoap.com; MC refuses cos@ as a service
  mailbox. Gates are raised as cos@, so Vince, not the requester, can decide them.
- 2026-10-30 TASK-4257: a push or a ready PR never moves a task back from In QA or In Review.
  Decided by: the user of this session; Vince kept it on 2026-10-31 (q_c12ec4faa9d3cc89).
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
- 2026-10-31 W03 counts as a compliance-check change under D2: an agent raised a signed approval
  of #521's head (`apg_387a54e46825564a`) instead of a revert. Decided by: Vince
  (q_a5de7a8ad7e73eb3).
- 2026-10-31 The owner may decide a gate he raised only when an agent raised it on his behalf
  (TASK-4168, PLX_MC#545). Decided by: Vince (q_5f0490c7fe604176).
- 2026-10-31 CI item 1 (the queue reuses a green PR run) is not built: of the last 30 merges, the
  base had not moved for 9 in PLX_MC and 2 on the portal, about 1 to 2 min saved per merge, against
  a signed workflow PR per repo.
- 2026-10-31 CI item 6: pre-push checks the changed files (portal TASK-4384, PLX_MC TASK-4389),
  and Claude Code sessions install the portal's git hooks, as Cursor's already did.
- 2026-10-31 The plx-agents review lane reviews every repo where `ai-review/verdict` runs, one
  auto-astra timer instance per repo (TASK-4397). Decided by: Vince (q_5b5f596b3bce35cb).
- 2026-10-31 internal-seller-api is enrolled: pending_adoption, then an adoption PR, then active and
  hard (TASK-4398). Decided by: Vince (q_c567d65b5f3ddaff).
- 2026-10-31 CI item 4 (CIP arms on the event) is not built. The 25 portal PRs merged that
  afternoon waited 0 to 7 minutes beyond the 13-minute queue run. lint-typecheck-build went green
  last in 15, and the ai-review/verdict status, 4 to 23 minutes after a push, in 9. Re-measure on a
  night or weekend sample, when CIP is not polling, before building it.

## Open questions

- Vince: DRF-4, accept it or send it back.
- Vince: the signed approval `apg_6ce74147869971c7` (internal-seller-api#2, workflow files) and the
  flags approval `apg_60b5f11530d77e3d` (its compliance variables and secret), both on TASK-4398.
- An MC Owner or Admin: add internal-seller-api to MC's repo allow-list (Request repo, then approve),
  so tasks can name it.
- Infra: the coding-1 steps after TASK-4397 lands (Next steps 1).
- Vince: P0-2, the production settings W15 to W19 start from. He will paste them
  (q_e2eedfb131c553ac on TASK-1166).
- CoS: W05, replace the bot rules list with the bundle's bot-rules.md.
- CoS: allow the push of test-perms-check's TASK-4383 commit, or drop it.
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

2026-11-01 by claude-code/claude-code (Claude Code on the web).
