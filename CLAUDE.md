# CLAUDE.md â€” Developer Tooling Context

<!-- Tool-facing guidance for Claude Code sessions. Keep this file thin:
     it points at the canonical docs and carries the generated governance
     block. Add CODEX.md / GROK.md / GEMINI.md clones (and register them in
     config/governance-contract.yaml surfaces.marker_files) as you adopt
     more agent runtimes. -->

## Purpose

Claude Code-specific guidance for working in this repository. Runtime source
of truth is maintained in `AGENTS.md`, `SOUL.md`, `TOOLS.md`, and `LESSONS.md`.
The pipeline contract below is the same rule set Cursor, Grok, Codex, and
swarm agents get from `AGENTS.md` / `docs/AGENT-PR-SOP.md`.

## Pipeline contract (all agent runtimes)

Before first edit or any `PR_CREATE` on a tracked consumer:

1. Search projects, buckets and existing `TASK-*` first. On a real miss,
   `mc_create_task` in the registry default bucket
   (`config/tracked-repos-registry.json`), then check it out. Never create a
   task to escape incomplete evidence on a live checkout.
2. `mc_checkout_task` on the Hub connector, passing `repo=owner/name`
   so `actor.repo` matches the repo under edit (including portal).
   Confirm returned `taskId` is a non-null string. Copy `prBodyLine`
   exactly. A stamp whose `actor.repo` does not match the PR repo
   fails GitHub verify with `taskId:null`.
3. Never invent a `dsp_*` id. Never write `MC-Checkout: pending` and
   open a PR. If tools are missing, stop — do not open the PR.
4. Put the `MC-Checkout: dsp_…` line in the PR body at open. A body edit does not start the compliance gate, but every run reads the live body (PLX_MC#438): after a body fix, re-run the failed `compliance` job. Never an empty commit/push, or a close and reopen, to re-trigger CI.
5. `mc_complete_task` must include non-empty `verificationCommands`
   AND `rollback`.
6. Local push uses the consumer's pre-push handshake when present.
   Never `--no-verify`.
7. Portal required merge checks: `lint-typecheck-build`, `compliance`,
   `Validate ledgers`, `workbench-api`, `ai-review/verdict`, `merge-hold`,
   and `compliance-group` on merge queue groups. The merge queue lands portal
   PRs: arm auto-merge, never squash, never bypass (Vince, 2026-10-24; see
   the Merge path rule below).
8. On portal, `silent-failure-audit` is a real fail. Do not raise
   `BASELINE`. Fix new catch-empty-returns with `QueryResult<T>`.

## Key Commands

```bash
npm install                                # Node deps (web app)
.venv/Scripts/python -m pip install -r requirements.txt  # governance tooling (Windows dev box)
npm run dev                                # Next.js dev server
./scripts/preflight.sh --mode pre-commit   # before every commit
./scripts/preflight.sh --mode pre-push     # before every push
```

## Verification

Always verify work before declaring it done:

- Bug fixes: write the failing test first and watch it fail — that is the only
  proof you fixed the cause and not the symptom. If something is hard to test,
  that is information about the design, not permission to skip it.
- Code changes: run the relevant test command and show exit-0 output.
- API changes: hit the endpoint and confirm the response envelope.
- After every fix: re-run the failing command that surfaced the bug.

## Debugging Discipline

When something breaks, investigate — do not guess. Read the whole error and
stack trace, reproduce the problem before changing anything, and change one
thing at a time. Never paper over an unexpected null with a defensive check —
find out why it is null; the guard just moves the bug somewhere quieter.

## Surgical Diffs

Keep the diff as small as the task allows. Do not touch what you were not asked
to touch, match the existing style, and do not reformat. The test: can you
justify every changed line by the task? If a line is there because "while I was
in there," revert it.

## Learning Loop

After every correction or incident fix, update `LESSONS.md` with a dated entry
documenting what went wrong and what should be different next time. Do not
repeat mistakes already documented there.

## Plan Before Build

For complex tasks (3+ files or architectural changes), produce a written plan
before writing any code: files to change, approach, trade-offs, verification
steps. Every task needs a success criterion before code is written — "add
validation" becomes "reject a malformed email, return 400 with a clear message,
and test both cases."

## Communication and Uncertainty

Say what you did and why, not just a block of code. Flag concerns even when you
did exactly what was asked. Be precise about uncertainty: "I am not sure this
library supports streaming" tells the operator what to verify; "I think this
should work" does not.

## Common Failure Modes (catch yourself)

If you notice yourself in any of these, stop — do not push through:

- **Kitchen Sink** — restructuring half the codebase while you are at it.
- **Wrong Abstraction** — abstracting before the second copy-paste exists.
- **Optimistic Path** — happy path handled, the 500 ignored.
- **Runaway Refactor** — a "fix" that cascades across files.

<!-- governance:auto:start -->

## Core Doctrine Pillars

1. **Mission First** — Every edit, suggestion, and refactor must serve the mission. Do not introduce changes that lack a clear tie to project goals. Do not merge code without a stated connection to the mission.

2. **Simplify Relentlessly** — Prefer the simplest correct solution. Simplify first, optimize second, automate third. Reject unnecessary abstraction. Reduce moving parts before adding new ones.

3. **Reuse Before Create** — Search for existing modules, utilities, and patterns before proposing new ones. Extend what exists; do not duplicate. Before creating any new file: (1) search docs/modules/, (2) search the shared source tree, (3) search scripts/. Duplication without justification is a violation.

4. **Truth Before Action** — When uncertain about intent, scope, or correctness, stop and ask. Do not guess at requirements. Do not proceed on assumptions. Do not fabricate test results, deployment status, or success claims.

5. **Evidence Over Assertion** — Back claims with code, tests, or data. Prefer executable proof over prose explanations. Never claim "all tests passed" without running them. Never claim "deployed to production" without evidence.

6. **Prune Ruthlessly** — Delete dead code, unused imports, and stale docs before adding new material. Less is better. Remove before adding.

7. **Ownership and Precision** — Every requirement, rule, and config value must have a clear owner, rationale, and enforcement path. Ambiguity is a bug.

## Agent Behavioral Contract

1. State assumptions and success criteria before non-trivial work.
2. Prefer the simplest correct change; do not add speculative abstractions.
3. Make surgical edits and clean up only your own mess.
4. Before writing code, read the local file, exports, immediate callers, and obvious shared utilities.
5. Reuse existing modules and conventions before creating new ones.
6. Use models for judgment calls, not deterministic routing, retries, status-code handling, transforms, auth, or permission logic.
7. When repo patterns conflict, choose the newer or more tested pattern, explain why, and flag the other for cleanup.
8. Tests must protect intent and invariants, not just output shape.
9. Checkpoint meaningful multi-step progress by summarizing what changed, what was verified, and what remains.
10. When context grows large or the task starts drifting, summarize the current state and restart from that summary instead of pushing through.
11. Match local conventions even when you would choose differently in new code.
12. Fail visibly: never call work complete when checks, records, migrations, edge cases, or deployments were skipped.

## Agent Task & PR Workflow

- Every change to a tracked repo must resolve to a Mission Control (MC) task. Before first edit or any PR_CREATE: search projects, buckets and existing TASK-* ids first; on a real miss create the task (mc_create_task, default bucket from config/tracked-repos-registry.json) and check it out. Never create a task to escape incomplete evidence on a live checkout.
- Check out via `mc_checkout_task` on the Hub connector, passing `repo=owner/name` so `actor.repo` matches the repo under edit (including portal). Confirm the returned `taskId` is a non-null string. Copy `prBodyLine` exactly. A stamp whose `actor.repo` does not match the PR repo fails GitHub verify with `taskId:null`.
- Never invent a `dsp_*` id. Never write `MC-Checkout: pending` and open a PR. If checkout tools are missing, stop — do not open the PR.
- Humans (operators) are recorded but not gated; autonomous agents are gated on a complete bundle — link the work to a live repo-scoped checkout so the gate can attribute and verify it.
- One logical theme per PR. Multiple related MC tasks may be completed in a single PR — add one live `MC-Checkout: dsp_*` line per task; the gate verifies every referenced task and blocks if any is incomplete.
- Carry the tier-appropriate bundle: a clear description always; a `## Rollback Plan` for anything beyond docs/tests; evidence (tests/screenshots) plus a linked PRD for high-risk changes (DB migrations, auth/permissions, infra, `.github/workflows`, deploy).
- Name a human accountable owner for agent-driven work: agents execute, a person owns the outcome.
- Never edit, disable, or bypass a repo's compliance gate workflow to make the check pass — that is a governance violation.
- `mc_complete_task` must include non-empty `verificationCommands` AND `rollback`. A successful complete is evidence hand-in only — it is not gate success. Do not treat agent work as complete until the stamped PR's GitHub `compliance` check is SUCCESS (or `scripts/compliance-pr-verify.mjs --wait` exits 0).
- Human-verification evidence (TASK-3165): when a person must verify the work (label `verify:human`, a `kind:human-test` task, or a high-risk change), write the task description and the `mc_complete_task` summary in STE-lite. Use one instruction per sentence and the active voice. Keep a numbered step to 20 words, any other sentence to 25 words, and a paragraph to 6 sentences. Code, paths, links and IDs count as one word. Pass `filesChanged` to `mc_complete_task`. The check warns until 2026-10-24, then it blocks.
- Visual evidence (TASK-3166): when a person must verify the work, upload at least one diagram, annotated screenshot or web page with `mc_upload_evidence` before `mc_complete_task`. MC stores it on the PLX SharePoint site, in the Mission Control library. Trading Lab work goes on its own site, never the PLX site. If the call returns `evidence_store_unavailable`, report what it says. Never create a library or grant access. The gate warns while uploads are off and until 2026-11-01, then it blocks.
- Explainer video (TASK-3167): complex work is a high-risk change, a procedure of more than 5 steps, or work on 2 or more systems. When a person must verify complex work, make a short video with the `plx-knowledge-video` skill. Upload it with `mc_upload_evidence` (kind `video`, mp4 or webm, 100 MiB or less). The gate warns while uploads are off and until 2026-11-01, then it blocks.
- Local push uses the consumer's pre-push handshake when present. Never `--no-verify`.
- Confirm `meta.actor.repo` equals the exact full slug of the repo under edit before accepting a checkout stamp; never stamp a Portal- or Hub-scoped `dsp_*` on a different repo (decision 3).
- Portal required merge checks: `lint-typecheck-build`, `compliance`, `Validate ledgers`, `workbench-api`, `ai-review/verdict`, `merge-hold`, and `compliance-group` on merge queue groups. On portal, `silent-failure-audit` is a real fail — do not raise BASELINE; fix new catch-empty-returns with `QueryResult<T>`.
- Who lands work (Vince, 2026-10-25, TASK-3901): every petralabx repo runs one org ruleset, and anyone with write access does the GitHub work: every Grok bot, Claude, Cursor and Codex agent, and every colleague. Anyone may mark a PR ready, fix a conflict with a merge commit, fix a bug or red CI, re-run CI, and land a green PR. On a branch with a merge queue (portal `staging` today) the queue is the only merge path: arm auto-merge with `gh pr merge <num> --auto` and no merge method, and it lands with a merge commit. Where there is no queue yet, merge a green PR with a merge commit. Never squash. Before you push to someone else's PR, take your own checkout on its task and add your `MC-Checkout` line to its body. Put the `hold` label on a PR that must wait: the required `merge-hold` check fails while the label is on (TASK-3860).
- Teammates' PRs (Vince, 2026-10-26, TASK-3993): every agent and CIP may fix, conflict-fix and land a PR by any member of the petralabx GitHub org, Ricardo's included, as they would their own. Today the members are cospetras, gregmpetra, luispetra, plx-uat, rais24, ricardopetra, stephenalton-collab, taylorvalton and tswaterloo; `gh api orgs/petralabx/members` gives the live list. No repo rule or lane may exclude a member's PRs. Use merge commits only: never rebase, amend or force-push a branch you did not create. When such a PR needs a signed MC merge approval, raise `mc_request_approval` (merge scope, its exact head). Then put the gate in front of the PR's author: call `mc_ask_question` with the author's MC directory id or email and the `gateLink`, and @-mention the author on the PR with the same link. If the author cannot decide it, route the gate by the approval-routing rule (TASK-3999). Agents never decide gates.
- A person approves only money, migrations and workflows (Vince, 2026-10-25, TASK-3901). A PR that touches money (payments, billing, invoices, ledgers, pricing, costs, ERP and Business Central posting, trading), migrations (migration folders, backfill, purge and migrate scripts) or workflow files lands only with a signed MC merge approval of its exact head. Raise it with `mc_request_approval` (merge scope); Vince, Ricardo, Rishi or Stephen approves it in MC approvals, and the compliance gate checks it. A revert of merged work needs the same approval. Production migrations need only that MC approval. Nothing else needs a person: never hold other work for Vince or CIP.
- Approval routing (Vince, 2026-10-26, TASK-3999): route a signed MC merge approval to whichever of Ricardo, Rishi or Stephen is available, and to Vince last. Raise `mc_request_approval` (merge scope, the exact head), then call `mc_ask_question` with that approver's MC directory id (`ricardo`, `rishi` or `stephen`) and the `gateLink`. On a teammate's PR, ask its author first when the author is one of the three. Address Vince only when none of them can decide it.
- Review rounds (Vince, 2026-10-26, TASK-3999): batch review fixes. Collect every finding from a review round, fix them together, validate, and push once. Never push while a review of the current head is pending: a new head goes to the back of the review queue.
- Workflow files (Vince, 2026-10-26, TASK-3999): open at most one workflow-file PR per repo per week. Bundle that week's `.github/workflows` changes into it, because each such PR needs its own signed MC merge approval.
- No bypass: never use a ruleset bypass, an admin merge (`gh pr merge --admin`) or a force-push, even when your token allows it. An open P0 or P1 AI-review finding blocks the PR. A re-cut PR carries the open P0/P1 findings of the PR it replaces until a review of its own head clears them.
- Plans go through a draft (Vince, 2026-10-27, Draft Projects decision 3; TASK-4132): a plan that adds a project, or two or more buckets, goes into Mission Control as a draft with `mc_save_draft`, not with `mc_create_project` or `mc_create_bucket`. Submit it with `mc_submit_draft` and give the person its `DRF-*` id. Reviewers review it, and its author accepts it in Mission Control, which creates the live records. Agents never accept a draft. Tasks in an existing bucket, or one new bucket, need no draft. It is a convention: nothing blocks a direct create.
- These rules apply to every agent runtime (Cursor, Claude Code, ChatGPT/Codex, Grok, the swarm). This contract is the single source — change it here, regenerate, and every runtime's rule file updates.

## Repo Hygiene

- FORBIDDEN at repo root: `FINAL_*`
- FORBIDDEN at repo root: `QA_*`
- FORBIDDEN at repo root: `*_SUMMARY.md`
- FORBIDDEN at repo root: `*_REPORT.md`
- FORBIDDEN at repo root: `*_ASSESSMENT.md`
- FORBIDDEN at repo root: `*_COMPLETION*.md`
- FORBIDDEN at repo root: `*_CHECKLIST.md`
- FORBIDDEN at repo root: `*_SPECIFICATION.md`
- FORBIDDEN at repo root: `*_20[0-9][0-9]*.md`
- Reports location: `artifacts/<domain>/<yyyy-mm-dd>-<slug>/REPORT.md`
- Archive location: `archive/<yyyy-mm-dd>-<reason>/`
- No status adjectives in filenames: FINAL, COMPLETE, LATEST, NEW, FIXED
- No case-variant duplicates
- Use lowercase kebab-case for evidence bundle slugs

## Code Standards

### Python

- Run ruff check and ruff format before every commit
- Run pytest before every commit
- Use %s-style formatting in logger calls, not f-strings
- Tests must write transient artifacts to temp directories, not tracked repo paths

### Typescript

- Run npm run typecheck before every commit
- All UI color comes from --p-* design tokens behind the .brand-plx boundary — no raw hex in components (brand authority: plx-customer-portal, see ADR-003)
- All API routes go through one shared route wrapper — no ad hoc handler boilerplate
- Mutating routes (POST/PATCH/PUT/DELETE) require schema validation (e.g. Zod) — no manual typeof checks
- One standard response envelope: { data } on success, { error: { code, message } } on failure
- All frontend API calls go through one shared fetch wrapper — no raw fetch('/api/...')
- No flat file may shadow a module directory barrel — if lib/foo/index.ts exists, lib/foo.ts must not

### Powershell

- Never name a variable or parameter after a PowerShell automatic variable ($Args, $Input, $_, $PSItem, $this, $Host, $Error, $Matches, $Foreach, $Switch) — the reserved automatic silently shadows it (e.g. a parameter named $Args drops every splatted argument), so a native call runs with zero args. Use an explicit name such as $Arguments.
- When splatting arguments to a native command, pass an absolute working directory — a relative path resolves against the spawning process's cwd, not the repo root

### Dependencies

- Governance tooling deps live in requirements.txt — verify a clean install after changes
- Commit lockfiles in the same change that modifies the manifest
- Re-run the typecheck/test gate after any dependency change

## Module Boundaries

- Every module needs a contract README at docs/modules/<name>/README.md with: What, Why, How, Dependencies, Owner
- Import through module entry points (barrel index), not internal module files
- Compatibility shims must include a removal date comment: module-shim — remove after YYYY-MM-DD
- A shim past its expiry date is a CRITICAL violation

## Database Safety

- NEVER use DROP TABLE, TRUNCATE, or DELETE FROM without a WHERE clause
- Treat every connection as if it has full DDL privileges on production data
- All DDL goes through a numbered migration runner — no inline CREATE TABLE or ALTER TABLE in application code
- All SQL uses parameterized placeholders — never string interpolation of user input
- All migration INSERTs must be idempotent (ON CONFLICT DO NOTHING or equivalent)
- Migration failures must crash the deploy (exit 1), never continue with broken schema
- Numbered migrations are globally serialized — two PRs must never ship the same numeric prefix; CI fails on duplicates

## Branch Hygiene

- One PR per logical theme — never stack unrelated work on a shared branch
- PR stacks (Vince, 2026-10-26, TASK-3999): never stack PRs more than two deep. Open a third slice only after the bottom PR lands.
- Delete branches immediately after PR merge or abandonment
- Do not let multiple agents push to the same branch without coordination
- File issues for code defects only — not for environment or toolchain problems
- Workstream protocol (Vince, 2026-10-26, TASK-3953): one workstream per branch and worktree. Flag any edit outside your workstream's scope before you make it. A one-PR change needs no workstream.
- At session start, read your workstream's note, docs/workstreams/<slug>.md; the index in docs/workstreams/README.md maps branches to slugs. Before you end a session, and after any significant decision, update that note in the same branch (/handoff in Claude Code and Cursor; /resume-workstream picks it up).
- Change a workstream's index row (owner, branch, status, dependencies) only when it opens, closes or changes status. SharePoint Agent Handoffs/ stays the system of record for durable handoffs; the note is the agents' working copy, and SharePoint wins when they disagree.

## Testing

- Tests assert invariants, not implementation details
- Every governance enforcement script must have at least one test verifying its exit-code behavior
- Monkeypatch targets must match the module where the symbol is used at runtime, not where it was defined
- Every session that modifies source code must run the relevant verification commands and show exit-0 evidence

## Safety

- Do not fabricate evidence, test results, or deployment claims
- Do not create files that reference nonexistent modules or APIs
- Do not rewrite store/schema-owning modules without reviewing the existing schema first
- Do not add new dependencies without checking existing modules (Pillar 3: Reuse Before Create)
- Secrets come from a secrets manager via one shared accessor — no hardcoded keys, no scattered env lookups

## External Integrations

- Every new external provider, MCP server, or operator-side tool must declare before merge: owner, scope (runtime vs local-only), auth source, default state, kill switch or feature flag, health check, fallback path, and data/audit boundary
- Operator-local tools ship disabled by default in committed config and are never represented as deployed runtime capability
- Integrations that can act autonomously (send, post, join, record) require explicit enablement and auditable state
- Every agent session that changes code, makes a decision, or produces analysis must leave a structured SessionArtifact v1 (repo tag `PLX_MC`) so it feeds the company-brain knowledge graph — POST to `$VMC_BASE_URL/api/vmc/knowledge/session-artifact` (e.g. https://missioncontrol.tayloralton.com) with `$VMC_API_KEY`; trivial read-only Q&A sessions are exempt
- Session-artifact capture runtime coverage: the Cursor `sessionEnd` hook (`.cursor/hooks.json`) and the Claude Code `SessionEnd` hook (`.claude/settings.json`) both run `scripts/compliance-closeout.mjs` and capture automatically; runtimes without hook support use the session-brain skill (see the agentic-swarm repo's `.cursor/skills/session-brain`) to submit manually
- Session-artifact capture is fail-open and gated by the SESSION_BRAIN_ENABLED kill switch (default enabled) — capture failure must never block a session; failed submissions queue to `artifacts/session-brain/<date>/<session_id>.json` for manual replay

<!-- governance:auto:end -->
