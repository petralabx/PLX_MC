# AGENTS.md â€” Canonical Architecture

<!-- This is the single canonical operations + architecture doc. Agent
     runtimes (Cursor, Claude Code, Codex, ...) read it on every session.
     Keep it current; it outranks any other description of the system. -->

## System Overview

PLX Mission Control is the human cockpit over Petra Lab-X's background agents:
agents do work (code, PRDs, QA); humans review, approve, assign, and resolve.
Two invariants define the system: **everything resolves to a Task**, and
**SharePoint is the canonical system of record** â€” the app is a fast lens over
a two-way mirror of the `/sites/plx-mission-control` site, with manual
conflict resolution and a full audit log. The product spec lives in
`docs/product/` (handoff bundle: README, SHAREPOINT_INTEGRATION, DATA_MODEL,
DESIGN_TOKENS).

## Runtime Entry Points

- `npm run dev` â€” Next.js dev server (App Router, `app/`).
- `npm run build` / `npm run start` â€” production build and serve.
- `./scripts/preflight.sh --mode pre-commit|pre-push|ci` â€” the one gate command.
- SharePoint sync: five-minute delta sweep + Graph subscription renewal /
  notification queue (see `docs/modules/sync/README.md`).
- Routing maintenance cron: `GET /api/cron/routing-maintenance` (hourly) —
  retention expiry + rolling-breach cohort demotion; authorized only for
  `sp_routing_maintenance`. Rollout runbook:
  `docs/runbooks/mc-routing-rollout.md`.

## Architecture

| Layer | What | Where |
|---|---|---|
| Web app | Next.js (App Router) + TypeScript; all screens from the design handoff | `app/`, `src/` |
| Brand surface | PLX design system, fourth brand surface per ADR-003; `--p-*` tokens, opt-in `.brand-plx` boundary | `src/styles/`, `src/components/brand/`, `docs/design-system/` |
| Sync engine (planned) | Two-way Microsoft Graph mirror: outbound PATCH on mutation, inbound delta + webhooks, conflict queue, audit log | spec: `docs/product/SHAREPOINT_INTEGRATION.md` |
| Governance tooling | Contract generator + drift gate, hygiene checker, preflight wrapper (Python 3.12) | `scripts/`, `config/` |

## Module Ownership

<!-- Every module gets an owner and a criticality. This table is the index;
     each module's contract lives at docs/modules/<module>/README.md. -->

| Module | Owner | Criticality |
|---|---|---|
| governance | Vince | High |
| design-system | Vince | High |
| web | Vince | Critical |
| sync | Vince | Critical |
| routing | Vince | Critical |
| permissions | Vince | Critical |
| meeting-intake | Vince | Medium |
| loop-ledgers | Vince | Medium |
| github-app | Vince | Medium |
| mcp | Vince | Critical |
| vendor-spend | Vince | Medium |
| compliance | Vince | Critical |

## Canonical Operations Docs

- `SOUL.md` â€” mission and non-negotiables
- `AGENTS.md` â€” architecture, module ownership, runtime policy (this file)
- `TOOLS.md` â€” tool access, scope, and safety boundaries
- `LESSONS.md` â€” operational learnings
- `docs/modules/` â€” module contracts
- `docs/REPO_HYGIENE_SPEC.md` â€” file placement, naming, archival

## Mandatory Commit/Push Gate (All Coding Agents)

All coding agents and humans must run the canonical gate command:

- Before commit: `./scripts/preflight.sh --mode pre-commit`
- Before push/PR update: `./scripts/preflight.sh --mode pre-push`

Enforcement surfaces: `.pre-commit-config.yaml` (local hooks) and
`.github/workflows/ci.yml` (CI re-runs the same script).

## PLX-MC MCP Integration (Runtime)

Team-distributed MCP server **`PLX-MC`** exposes MC task lifecycle tools, audit trail,
standard `{ data, meta }` envelope, and composed swarm delegation.

| Surface | Location |
|---------|----------|
| Stdio client | `tools/plx-mc-mcp/index.ts` |
| Cursor REST API | `/api/cursor/*` |
| Streamable HTTP MCP | `/api/cursor/mcp` |

| Attribute | Value |
|---|---|
| Owner | Vince (human accountable; agents execute) |
| Scope | Runtime — stdio client + HTTPS cursor API on `mc.plxcustomer.io`; swarm leg loopback `127.0.0.1:8900` |
| Auth source | `PLX_MC_MCP_API_KEY` + `PLX_MC_ALLOWED_USERS` operator email (AWS Secrets Manager); swarm via `SWARM_KEY_CMD` / `get_secret` |
| Default state | **Disabled** — `PLX_MC_MCP_ENABLED=0` in committed `.cursor/mcp.json` |
| Kill switch | `PLX_MC_MCP_ENABLED=0` and/or remove `PLX-MC` from MCP config; `SWARM_DISPATCH_ENABLED=0` for dispatch only |
| Health check | `mc_self_check` → `GET /api/cursor/self-check` |
| Fallback path | `scripts/compliance-checkout.mjs` + `/api/compliance/*`; `bin/swarm ask` for dispatch |
| Data/audit boundary | All MC tool calls append `mcp.tool.invoked` to `mc_events`; task writes via sync engine only |

To enable: set `PLX_MC_MCP_ENABLED=1`, `MC_MCP_API_KEY`, `MC_OPERATOR_EMAIL`, `MC_REPO`
in team MCP env ([runbook](docs/runbooks/plx-mc-mcp-team-registration.md)). Swarm:
`SWARM_DISPATCH_ENABLED=1`. All changes still pass `./scripts/preflight.sh`.

## Agentic Swarm Delegation (composed)

Swarm dispatch is **composed into PLX-MC** (`dispatch_to_swarm`, `list_swarm_teams`,
`swarm_health`). Standalone `swarm-dispatch` MCP remains as a compatibility shim only.

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

- Every change to a tracked repo must resolve to a Mission Control (MC) task. An agent run that opens a PR must first check out an MC task (or create one) and stamp the PR body with `MC-Checkout: <id>` for each task it completes.
- Humans (operators) are recorded but not gated; autonomous agents are gated on a complete bundle — link the work to a task so the gate can attribute and verify it.
- One logical theme per PR. Multiple related MC tasks may be completed in a single PR — add one `MC-Checkout: <id>` line per task; the gate verifies every referenced task and blocks if any is incomplete.
- Carry the tier-appropriate bundle: a clear description always; a `## Rollback Plan` for anything beyond docs/tests; evidence (tests/screenshots) plus a linked PRD for high-risk changes (DB migrations, auth/permissions, infra, `.github/workflows`, deploy).
- Name a human accountable owner for agent-driven work: agents execute, a person owns the outcome.
- Never edit, disable, or bypass a repo's compliance gate workflow to make the check pass — that is a governance violation.
- Prefer the automated capture hook (it checks out or creates the task and stamps the PR) over manual steps; never run an autonomous agent against a tracked repo without a checked-out task.
- These rules apply to every agent runtime (Cursor, Claude Code, ChatGPT/Codex, the swarm). This contract is the single source — change it here, regenerate, and every runtime's rule file updates.

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
- Delete branches immediately after PR merge or abandonment
- Do not let multiple agents push to the same branch without coordination
- File issues for code defects only — not for environment or toolchain problems

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
- Session-artifact capture runtime coverage: the Cursor `sessionEnd` hook (`scripts/compliance-closeout.mjs`) captures automatically; runtimes without hook support use the session-brain skill (see the agentic-swarm repo's `.cursor/skills/session-brain`) to submit manually
- Session-artifact capture is fail-open and gated by the SESSION_BRAIN_ENABLED kill switch (default enabled) — capture failure must never block a session; failed submissions queue to `artifacts/session-brain/<date>/<session_id>.json` for manual replay

<!-- governance:auto:end -->
