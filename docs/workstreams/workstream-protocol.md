# Workstream protocol rollout

- Slug: `workstream-protocol`
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/trusting-albattani-44ngue` (one PR in each of the 10 repos)
- MC tasks: TASK-3953
- SharePoint handoff: n/a

## Goal

Every petralabx repo keeps workstream handoff notes in `docs/workstreams/`, so the next session or
teammate starts from files that travel with the code. Each repo gets the protocol in its shared
guide, `/handoff` and `/resume-workstream`, Claude Code hooks, a PR template checkbox and
gitignored worktree folders.

## Status

active, as of 2026-10-26. One PR is open in each of the 10 repos.

## Done

- `scripts/workstream-note.mjs` (`session-start`, `stop`, `path`, `check`), with
  `scripts/workstream-note.test.mjs` (8 tests) and, in PLX_MC, `tests/workstream-note.test.ts`.
- Hook behaviour checked against the Claude Code docs on 2026-10-26:
  - SessionStart (`startup|resume|clear|compact`) adds its stdout to the context, so the note comes
    back after compaction too.
  - PreCompact cannot reach the model.
  - Stop asks at most once every 45 minutes, and only when the note is older than the branch's
    latest change. It honours `stop_hook_active`.
- `/resume` is a built-in command, so the skill is `/resume-workstream`.
- The canonical skills are in petralabx/skills (catalog v1.6.12). PLX_MC and agentic-swarm carry
  the protocol in `config/governance-contract.yaml`, so their Codex, Grok, Gemini, Hermes and
  Cursor files regenerate with it.

## Next steps

1. Land the 10 PRs (TASK-3953).
2. Watch the Stop reminder in real sessions and tune it if it nags.
3. Decide whether CI runs `node scripts/workstream-note.mjs check --strict`. That is a workflow
   change in each repo, so each needs an MC approval. Consider a CI scorecard metric for PRs that
   update a workstream note.
4. Add Cursor hooks once Cursor's hook docs can be read. They were unreachable from the building
   session, and a Cursor forum report says `sessionStart` `additional_context` is not injected.
   Cursor gets the rule and the two commands meanwhile.

## Decisions and why

- 2026-10-26 Notes are keyed by workstream slug, not branch. Why: Claude Code on the web names its
  own branches. Decided by Vince.
- 2026-10-26 The index is low-churn: a row changes only when a workstream opens, closes or changes
  status. Why: the portal lands about 40 PRs a day through its merge queue. Decided by Vince.
- 2026-10-26 SharePoint `Agent Handoffs/` stays the system of record. Repo notes are the agents'
  working copy, and SharePoint wins on conflict. Decided by Vince.
- 2026-10-26 Roll out to all 10 repos at once. Decided by Vince.
- 2026-10-26 The brand repos keep `docs/sessions.md` as their per-session log; notes cover work
  that spans more than one PR or session. Why: the brand team's session rules use the log.
  Decided by the building session; Vince can overrule.

## Open questions

- Should CI enforce the note format, or stay advisory? (Vince)
- Should `handoff` and `resume-workstream` join the `plx-engineering-core` package, so
  `distribute-to-repos.sh` carries them to new repos? (Vince)

## Files / areas touched

- Every repo: the shared guide (or `config/governance-contract.yaml`), `docs/workstreams/`,
  `scripts/workstream-note.mjs` and its test, `.claude/settings.json` hooks,
  `.claude/skills/handoff/` and `.claude/skills/resume-workstream/`,
  `.cursor/rules/workstreams.mdc`, `.cursor/commands/`, the PR template, `.gitignore`.

## How to run the tests

```bash
node --test scripts/workstream-note.test.mjs
node scripts/workstream-note.mjs check --strict
npx vitest run tests/workstream-note.test.ts   # PLX_MC only
```

## Blockers or dependencies on other workstreams

- Part of [ci-redesign](https://github.com/petralabx/agentic-swarm/blob/main/docs/workstreams/ci-redesign.md).
  No blockers.

## Last updated

2026-10-26 by Claude Code (session_01DW6fhZg59f33Z4WRBToyCQ).
