# Agent governance consolidation

- Slug: `agent-governance-consolidation` (this file is `docs/workstreams/agent-governance-consolidation.md`)
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/sleepy-cray-3x363i`
- MC tasks: TASK-4201 (W01)
- SharePoint handoff: n/a. The plan is the Agent Governance Handoff bundle of 2026-10-30:
  https://claude.ai/artifact/HUuysvBvQyDjbyQtxRTs36

## Goal

Fold PRJ-ENGINEERING-GOVERNANCE, PRJ-FLEET-COMPLIANCE and PRJ-SESSION-NUDGE-MCP into one
project with three buckets (Governance rules, Compliance enforcement, Session nudges). Then make
the rules, the code and the docs agree: `config/governance-contract.yaml` is the one rule file.

## Status

active, as of 2026-10-30. Phase 0 and the "now" track (W01 to W06) are in progress. The bundle's
`bundle.json` holds every work item (W01 to W22), its checks and its rollback.

## Done

- P0-1: Claude's MC access works in Claude Code on the web. The proxy-injected key
  authenticates as `sp_mcp_lane_claude_vince`, and `self-check` returns 200.
- P0-3: the 73 open tasks of the three projects are mapped to a bucket and a verdict. The table
  goes into the consolidation draft's research context (P0-4).
- W01 (TASK-4201): the review-links rule (TASK-3168) is in the contract and the seven generated
  rule files. Branch `claude/sleepy-cray-3x363i`.

## Next steps

1. Land W01 before 2026-11-01 04:00 UTC: CIP's merge-queue session arms and merges it (D1).
2. W02 to W04: create each task in BKT-INFRA, check it out and open its own draft PR.
3. W06: apply the bundle's `contract-decisions.patch` after W01 merges. Vince approves the PR in MC.
4. P0-4: save and submit the consolidation draft once the W04 and W06 task ids exist.

## Decisions and why

- 2026-10-30 D1 to D8 were made as recommended. W06 writes them into the contract, and Vince's
  signed merge approval of that PR records them in MC. Decided by: Vince.
- 2026-10-30 PRJ-FLEET-COMPLIANCE stays the umbrella. It holds 57 of the 73 open tasks. Why:
  P0-3 proposes another umbrella only when most open work sits elsewhere. Decided by: the bundle.
- 2026-10-30 The checkout agent is `claude-code/claude-code`. Why: earlier Claude Code sessions on
  this repo use it, so the Agent trailer matches. Decided by: claude-code/claude-code.

## Open questions

- P0-2: the production values of the settings in `bundle.json` → `phase0`. A person reads them in
  Vercel and on each repo's Actions variables.
- TASK-4168 asks to let Vince decide a gate he raised. It conflicts with the rule that a person
  other than the requester decides a gate. The bundle does not settle it: Vince.

## Files / areas touched

- `config/governance-contract.yaml` and the files generated from it: `AGENTS.md`, `CLAUDE.md`,
  `CODEX.md`, `GROK.md`, `GEMINI.md`, `HERMES.md`, `.cursor/rules/governance.mdc`.

## How to run the tests

```bash
python scripts/generate-governance-surfaces.py --check
./scripts/preflight.sh --mode pre-commit
node scripts/workstream-note.mjs check --strict
```

## Blockers or dependencies on other workstreams

- W07 to W22 wait for Vince to accept the consolidation draft.
- W05 (the bot rules list) and the settings track (W15 to W19) need a person.

## Last updated

2026-10-30 by claude-code/claude-code (Claude Code on the web).
