# Workstream protocol rollout

- Slug: `workstream-protocol`
- Owner: Vince Alton (accountable) · agents: claude-code/claude-code
- Branches: `claude/trusting-albattani-44ngue` (one PR in each of the 10 repos)
- MC tasks: TASK-3953 (rollout), TASK-3988 (package and CI decisions), TASK-3991 (distribute bundle)
- SharePoint handoff: n/a

## Goal

Every petralabx repo keeps workstream handoff notes in `docs/workstreams/`, so the next session or
teammate starts from files that travel with the code. Each repo gets the protocol in its shared
guide, `/handoff` and `/resume-workstream`, Claude Code hooks, a PR template checkbox and
gitignored worktree folders.

## Status

active, as of 2026-10-26. The rollout landed in all 10 repos, and `distribute-to-repos.sh` now
carries the package and the full bundle. Nothing has been distributed yet.

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
- The canonical skills are in petralabx/skills, in `plx-engineering-core` since catalog v1.6.13
  ([skills#44](https://github.com/petralabx/skills/pull/44), TASK-3988). PLX_MC and agentic-swarm carry
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
- [skills#45](https://github.com/petralabx/skills/pull/45) (TASK-3991): `scripts/distribute-to-repos.sh`
  applies the full bundle with `scripts/apply-workstream-bundle.py`. It copies the hook script and
  its test, the note template, the Cursor rule and commands, and the two `.claude/skills/`. It adds
  the index, the hooks, the worktree ignore lines, the guide section and the PR checkbox only when
  missing, and skips generated guides. All nine other repos pass its `--check` on their default
  branch.
- [PLX_MC#458](https://github.com/petralabx/PLX_MC/pull/458): this note recorded the 2026-10-26
  decisions.

## Next steps

1. Run `scripts/distribute-to-repos.sh` from petralabx/skills to sync catalog v1.6.13 into the six
   consumers in its `BASE_MAP`. It pushes one branch per repo; land each PR. The bundle part
   changes no file there today. Then check whether Cursor lists both the `handoff` skill and the
   `.cursor/commands/` copy. If it does, drop the command copies from the bundle (`COPIED` in
   `scripts/apply-workstream-bundle.py`) and from each repo.
2. A new repo gets the protocol by joining `BASE_MAP` in `distribute-to-repos.sh` and running it.
   agentic-swarm, plx_secondbrain and test-perms-check are not in `BASE_MAP`; they already carry the
   bundle.
3. Watch the Stop reminder in real sessions and tune it if it nags.
4. Hold `node scripts/workstream-note.mjs check --strict` out of CI until org ruleset phase 2.
   Then add it as one workflow PR per repo, each with its own signed MC merge approval. In
   petralabx/skills, the same PR can run `python3 scripts/apply-workstream-bundle.py --selftest`.
5. Add Cursor hooks once Cursor's hook docs can be read. They were unreachable from the building
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
- 2026-10-26 `distribute-to-repos.sh` carries the full bundle, not only the package, so a new repo
  gets the whole protocol in one run. The skills repo's own copy of the bundle is the source.
  Decided by Vince.

## Open questions

- None.

## Files / areas touched

- Every repo: the shared guide (or `config/governance-contract.yaml`), `docs/workstreams/`,
  `scripts/workstream-note.mjs` and its test, `.claude/settings.json` hooks,
  `.claude/skills/handoff/` and `.claude/skills/resume-workstream/`,
  `.cursor/rules/workstreams.mdc`, `.cursor/commands/`, the PR template, `.gitignore`.
- petralabx/skills: `manifest.json` (the `plx-engineering-core` package, v1.6.13),
  `scripts/apply-workstream-bundle.py`, `scripts/distribute-to-repos.sh`, `README.md`.

## How to run the tests

```bash
node --test scripts/workstream-note.test.mjs
node scripts/workstream-note.mjs check --strict
npx vitest run tests/workstream-note.test.ts   # PLX_MC only
python3 scripts/validate-manifest.py           # petralabx/skills only
python3 scripts/apply-workstream-bundle.py --selftest   # petralabx/skills only
```

## Blockers or dependencies on other workstreams

- Part of [ci-redesign](https://github.com/petralabx/agentic-swarm/blob/main/docs/workstreams/ci-redesign.md).
  Next step 4 waits on its org ruleset phase 2.
- Owned elsewhere (Chief of Staff, 2026-10-26): CIP has the AI-review marker gap outside the
  portal; Ledger has adding plx_secondbrain and test-perms-check to Mission Control's task-repo
  list.

## Last updated

2026-10-26 by Claude Code (session_01DW6fhZg59f33Z4WRBToyCQ).
