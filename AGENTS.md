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
- No cron jobs, webhooks, or services yet; the SharePoint sync service (delta
  poll every 5 min + Graph change webhooks) is specified in
  `docs/product/SHAREPOINT_INTEGRATION.md` and lands as the `sync` module.

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
| meeting-intake | Vince | Medium |
| loop-ledgers | Vince | Medium |

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

<!-- governance:auto:end -->
