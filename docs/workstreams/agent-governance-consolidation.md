# Agent governance consolidation

- Slug: `agent-governance-consolidation` (this file is `docs/workstreams/agent-governance-consolidation.md`)
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/nice-albattani-rand8f` (TASK-4348), `claude/nice-albattani-rand8f-ci` (TASK-4346).
  Merged: W01 to W04, W06 and TASK-4257 (#519 to #525)
- MC tasks: TASK-4201 (W01), TASK-4204 (W02), TASK-4205 (W03), TASK-4206 (W04), TASK-4207 (W06),
  TASK-3928, TASK-4257, TASK-4346, TASK-4348; draft DRF-4
- SharePoint handoff: n/a. The plan is the Agent Governance Handoff bundle of 2026-10-30. The
  status and the zero-drift and CI speed plans are on the Governance Handoff Status page:
  https://claude.ai/artifact/Fv26Dp57T5pa1bE1Vcftyv

## Goal

Fold PRJ-ENGINEERING-GOVERNANCE, PRJ-FLEET-COMPLIANCE and PRJ-SESSION-NUDGE-MCP into one
project with three buckets (Governance rules, Compliance enforcement, Session nudges). Then make
the rules, the code and the docs agree: `config/governance-contract.yaml` is the one rule file,
and every other copy is generated from it or not written.

## Status

active, as of 2026-10-31. Every "now" item (W01 to W04, W06, TASK-4257) is in main. DRF-4 waits
for Vince. Two follow-ups are in PRs: TASK-4348 (the contract feeds both MCP servers' instructions
and each repo's handshake block) and TASK-4346 (PLX_MC CI runs as parallel jobs). This note names
PRs and tasks; GitHub and Mission Control hold their state.

## Done

- P0-1: Claude's MC access works in Claude Code on the web through the proxy-injected key. A
  request that sends the environment's `MC_MCP_API_KEY` in `x-api-key` overrides it and gets 401.
- P0-3: the 73 open tasks of the three projects are mapped to a bucket and a verdict: 54 keep and
  move, 2 covered (W15, W16, W18), 5 done, 12 drop. The table is in DRF-4's research context.
- P0-4: DRF-4 is submitted (in review, version 1). Its author is vince@petrasoap.com.
- W01 (#519, `c19e90f`), W02 (#522, `6ab7489`), W03 (#521, `4795130`), W04 (#523, `dd59ba2`),
  W06 (#520, `fa128f5`) and TASK-4257 (#525, `937fcc5`) merged on 2026-10-31 through CIP's queue.
- 2026-10-31 drift audit of the nine repos: 10 contradictions between the copies of the handshake
  and the contract. The list, with pinned line links, is on the status page.

## Next steps

1. Vince decides gate `apg_6e5c8db52d26f8f2` (TASK-4346, PLX_MC#538, a workflow change). CIP
   lands it.
2. TASK-4348 lands. Then adopt the generated block in each consumer repo, one docs PR per repo:
   `python scripts/generate-governance-surfaces.py --fleet ..` rewrites the hand-written section in
   furgenics, for-and-against, 1hr-after and local-inference. The portal, agentic-swarm and
   plx_secondbrain need the markers placed by hand (portal: W07 in DRF-4).
3. Vince accepts DRF-4. Then move W01 to W06, TASK-4257, TASK-4346 and TASK-4348 into its buckets,
   and start W07 to W22, W13 first. W09 replaces PLX_MC's hand-written CLAUDE.md copy.
4. A person applies the 17 closures Vince approved on 2026-10-26 (Ledger or CoS for the 3 duplicates).

## Decisions and why

- 2026-10-30 D1 to D8 were made as recommended and are in the contract (#520). Decided by: Vince.
- 2026-10-30 PRJ-FLEET-COMPLIANCE stays the umbrella: it holds 57 of the 73 open tasks. Decided by:
  the bundle's P0-3 rule.
- 2026-10-30 One branch and draft PR per item. Why: one theme per PR, and one approval does not
  hold up the others. Decided by: the user of this session.
- 2026-10-30 Drafts are saved with operator vince@petrasoap.com; MC refuses cos@ as a service
  mailbox. Gates are raised as cos@, so Vince, not the requester, can decide them.
- 2026-10-30 TASK-4257: a push or a ready PR never moves a task back from In QA or In Review.
  Decided by: the user of this session; Vince can overrule it.
- 2026-10-31 The handshake lives in the contract and reaches agents through the MCP server
  instructions, filled in per repo. Why: a contract change then reaches every MCP-connected agent at
  the next deploy, with no copy to update. Decided by: the user of this session (CoS).
- 2026-10-31 `--fleet` replaces only a marked block or a section headed "Mission Control
  handshake", and never appends. Why: the portal's and agentic-swarm's rule files are laid out
  differently and need a person to place the markers.
- 2026-10-31 TASK-4346 and TASK-4348 were created in BKT-INFRA, because DRF-4's buckets do not
  exist yet. They move with W01 to W06 once DRF-4 is accepted.

## Open questions

- W13, portal half: does a body edit start the portal's compliance check? The PLX_MC half is
  answered: a body edit started run 341 on #520.
- P0-2: the production values of the settings in `bundle.json` → `phase0`. A person reads them.
- TASK-4168 asks to let Vince decide a gate he raised; the bot rules say another person decides.
- W03 landed after an approval in CIP chat. If it is a compliance-check change under D2, it needed
  a signed MC approval. Vince decides.
- No plx-agents review reached #519 to #525, and Claude reviews never count on Claude Code PRs.
  Vince or Infra: is the review lane on plx-coding-1 running?

## Files / areas touched

- `config/governance-contract.yaml` and the files generated from it, including
  `src/lib/mcp/handshake.generated.ts` and `tools/plx-mc-mcp/lib/handshake.generated.mjs`.
- `scripts/generate-governance-surfaces.py`, `src/lib/mcp/create-http-server.ts`,
  `tools/plx-mc-mcp/index.ts`, `docs/modules/mcp/README.md`.
- Earlier items: `src/lib/mcp/`, `src/lib/compliance/risk.ts`, `src/lib/compliance/projection.ts`,
  `docs/modules/compliance/README.md`, `LESSONS.md`.
- TASK-4346 (its own branch): `.github/workflows/ci.yml`, `.github/actions/plx-mc-setup/`,
  `scripts/preflight.sh`, `docs/runbooks/CI-PIPELINE.md`.

## How to run the tests

```bash
python scripts/generate-governance-surfaces.py --check
python scripts/generate-governance-surfaces.py --fleet .. --check
python -m pytest tests/test_generate_governance_surfaces.py -q
npx vitest run tests/mcp-handshake-instructions.test.ts
./scripts/preflight.sh --mode pre-commit
npx vitest run --exclude 'tests/*postgres*.test.ts'
node scripts/workstream-note.mjs check --strict
```

## Blockers or dependencies on other workstreams

- W07 to W22 wait for Vince to accept DRF-4.
- W05 (the bot rules list), P0-2 and the settings track (W15 to W19) need a person.
- TASK-4346 waits for Vince's signed approval of PLX_MC#538's head.
- Claude Code on the web has no Docker, so the 7 Postgres harness suites run only in CI.

## Last updated

2026-10-31 by claude-code/claude-code (Claude Code on the web).
