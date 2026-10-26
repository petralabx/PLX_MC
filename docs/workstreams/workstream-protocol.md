# Workstream protocol rollout

- Slug: `workstream-protocol`
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/trusting-albattani-44ngue` (one PR in each of the 10 repos)
- MC tasks: TASK-3953 (rollout), TASK-3988 (package and CI decisions)
- SharePoint handoff: n/a

## Goal

Every petralabx repo keeps workstream handoff notes in `docs/workstreams/`, so the next session or
teammate starts from files that travel with the code. Each repo gets the protocol in its shared
guide, `/handoff` and `/resume-workstream`, Claude Code hooks, a PR template checkbox and
gitignored worktree folders.

## Status

active, as of 2026-10-26. The rollout landed in all 10 repos. The package PR,
[petralabx/skills#44](https://github.com/petralabx/skills/pull/44), is open.

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
- Landed in all 10 repos on 2026-10-26 (TASK-3953), each with a merge commit:
  [PLX_MC#457](https://github.com/petralabx/PLX_MC/pull/457),
  [agentic-swarm#1790](https://github.com/petralabx/agentic-swarm/pull/1790),
  [plx-customer-portal#3026](https://github.com/petralabx/plx-customer-portal/pull/3026),
  [local-inference#68](https://github.com/petralabx/local-inference/pull/68),
  [skills#43](https://github.com/petralabx/skills/pull/43),
  [plx_secondbrain#8](https://github.com/petralabx/plx_secondbrain/pull/8),
  [1hr-after#44](https://github.com/petralabx/1hr-after/pull/44),
  [for-and-against#31](https://github.com/petralabx/for-and-against/pull/31),
  [furgenics#18](https://github.com/petralabx/furgenics/pull/18),
  [test-perms-check#3](https://github.com/petralabx/test-perms-check/pull/3).

## Next steps

1. Land [petralabx/skills#44](https://github.com/petralabx/skills/pull/44) (TASK-3988):
   `handoff` and `resume-workstream` join `plx-engineering-core`, catalog v1.6.13. Then run
   `scripts/distribute-to-repos.sh`, so consumers' `.cursor/skills/` get them. After that run,
   check whether Cursor lists both the skill and the `.cursor/commands/` copy, and drop the command
   copies if it does.
2. Watch the Stop reminder in real sessions and tune it if it nags.
3. Hold `node scripts/workstream-note.mjs check --strict` out of CI until org ruleset phase 2.
   Then add it as one workflow PR per repo, each with its own signed MC merge approval.
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
- 2026-10-26 `check --strict` stays out of CI until org ruleset phase 2. It then lands as one
  workflow PR per repo, each with its own signed MC merge approval. Decided by Vince.
- 2026-10-26 `handoff` and `resume-workstream` join the `plx-engineering-core` package, so
  `distribute-to-repos.sh` carries them to new repos. Decided by Vince.

## Open questions

- `distribute-to-repos.sh` writes only `.cursor/skills/`. A new repo still needs
  `scripts/workstream-note.mjs`, `docs/workstreams/`, the Claude Code hooks and the
  `.claude/skills/` copies from the workstream bundle. Should the distribute script carry those
  too? (Vince)

## Files / areas touched

- Every repo: the shared guide (or `config/governance-contract.yaml`), `docs/workstreams/`,
  `scripts/workstream-note.mjs` and its test, `.claude/settings.json` hooks,
  `.claude/skills/handoff/` and `.claude/skills/resume-workstream/`,
  `.cursor/rules/workstreams.mdc`, `.cursor/commands/`, the PR template, `.gitignore`.
- petralabx/skills: `manifest.json` (the `plx-engineering-core` package, v1.6.13).

## How to run the tests

```bash
node --test scripts/workstream-note.test.mjs
node scripts/workstream-note.mjs check --strict
npx vitest run tests/workstream-note.test.ts   # PLX_MC only
python scripts/validate-manifest.py            # petralabx/skills only
```

## Blockers or dependencies on other workstreams

- Part of [ci-redesign](https://github.com/petralabx/agentic-swarm/blob/main/docs/workstreams/ci-redesign.md).
  Next step 3 waits on its org ruleset phase 2.
- Owned elsewhere (Chief of Staff, 2026-10-26): CIP has the AI-review marker gap outside the
  portal; Ledger has adding plx_secondbrain and test-perms-check to Mission Control's task-repo
  list.

## Last updated

2026-10-26 by Claude Code (session_01DW6fhZg59f33Z4WRBToyCQ).
