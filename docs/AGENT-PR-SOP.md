# Agent — How to Use Mission Control

**Audience:** AI agents and operators driving agents (Cursor, Claude Code, ChatGPT/Codex, Grok, swarm) against a PLX-tracked repo.

**Owner:** Vince · **Status:** active · **Effective:** 2026-08-28

> **TL;DR** — Agents execute; a **named human** owns the outcome. Before first
> edit or any `PR_CREATE`: **search existing `TASK-*`**, then **`mc_checkout_task`**
> on the Hub connector with **`repo=owner/name`**. Confirm returned `taskId` is a
> **non-null string** and copy **`prBodyLine` exactly**. Never invent a `dsp_*`.
> Never write `MC-Checkout: pending`. If checkout tools are missing, **stop —
> do not open the PR**. Hand in evidence via **`mc_complete_task`** with
> **non-empty `verificationCommands` AND `rollback`**, then run
> **`node scripts/compliance-pr-verify.mjs --wait`**. Carry the **risk-tier
> bundle**, and **never** edit the compliance workflow to force a pass.

Live cockpit: [https://mc.plxcustomer.io](https://mc.plxcustomer.io)

Companion docs: [`COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md) (all PR authors), [`HUMAN-MC-SOP.md`](HUMAN-MC-SOP.md) (human UI workflows), [`ROLLBACK-PLAN-SOP.md`](ROLLBACK-PLAN-SOP.md), [`docs/runbooks/CI-PIPELINE.md`](runbooks/CI-PIPELINE.md) (org CI layers L0–L3).

---

## 0. Pipeline contract (before first edit / PR_CREATE)

This SOP is the canonical copy. Claude, Cursor, Grok, Codex, and swarm
runtimes that start from `PLX_MC` follow it. Portal consumer files are
updated in a separate PR — do not edit those repos from here.

| # | Rule |
|---|------|
| 1 | Search existing `TASK-*`. Do **not** auto-create unless routing found nothing **AND** the conductor said to create. |
| 2 | `mc_checkout_task` on the **Hub** connector. Pass `repo=owner/name` so returned `actor.repo` matches the repo under edit (including `petralabx/plx-customer-portal`). Confirm returned `taskId` is a non-null string. Copy `prBodyLine` exactly. A stamp whose `actor.repo` does not match the PR repo fails GitHub verify with `taskId:null`. |
| 3 | Never invent a `dsp_*` id. Never write `MC-Checkout: pending` and open a PR. If tools are missing, **stop — do not open the PR**. |
| 4 | `mc_complete_task` must include non-empty `verificationCommands` **AND** `rollback`. |
| 5 | Local push uses the consumer's pre-push handshake when present. Never `--no-verify`. |
| 6 | Portal required merge checks: `lint-typecheck-build`, `compliance`, `Validate ledgers`. |
| 7 | On portal, `silent-failure-audit` is a real fail. Do not raise `BASELINE`. Fix new catch-empty-returns with `QueryResult<T>`. |

There is no create-a-task-then-stamp shortcut. A pending stamp is not a
valid checkout. `MC-Checkout: pending` is a forbidden placeholder.

---

## 1. Mission and accountability

| Role | Responsibility |
|------|----------------|
| **Agent** | Executes work — code, tests, PRs, evidence hand-in |
| **Named human** | Accountable owner (Petra email); owns outcome and review |
| **Compliance gate** | Blocks agent PRs without valid checkout + complete `task.evidence` |

Humans working by hand are **recorded but not gated** on checkout. Agents **cannot** skip checkout on hard-mode fleet repos.

---

## 2. MC hierarchy

Work is organized in three layers:

```
Project (optional umbrella)
  └── Bucket / Initiative
        └── Task
```

| Layer | Purpose | Agent/MCP access |
|-------|---------|------------------|
| **Project** | Optional parent above buckets (e.g. go-live umbrella) | **UI only** — MCP cannot create projects |
| **Bucket / Initiative** | Initiative with PRD link, repos, health | **UI only** — MCP cannot create buckets |
| **Task** | Unit of accountable work; checkout target | `mc_search_tasks`, `mc_create_task`, `mc_checkout_task` |

Compliance auto-create and projection always target a **bucket**, never a project.

---

## 3. Fleet context

Canonical fleet governance list: `config/tracked-repos-registry.json` (org: **`petralabx`**).

| Repo | Tier | Integration branch | Gate |
|------|------|--------------------|------|
| `petralabx/PLX_MC` | hub | `main` | hard |
| `petralabx/plx-customer-portal` | product_app | `staging` | hard |
| `petralabx/agentic-swarm` | product_platform | `main` | hard |
| `petralabx/skills` | skills | `main` | hard |
| `petralabx/local-inference` | tooling | `main` | hard |
| `petralabx/1hr-after` | tooling | `main` | hard |
| `petralabx/furgenics` | tooling | `main` | hard |
| `petralabx/for-and-against` | tooling | `main` | hard |
| `petralabx/test-perms-check` | sandbox | `main` | soft |

The first eight rows are the active fleet. `test-perms-check` is an excluded
pending-adoption sandbox, not a routing cohort.

**M365 identities:** SSO, daemon Graph, RBAC apply, and Office Nested App Auth
are separate Entra apps. Do not put `brk-multihub://` on `PLX_Cursor_Graph`.
Catalog: [`docs/runbooks/M365-IDENTITY-CATALOG.md`](runbooks/M365-IDENTITY-CATALOG.md)
(fleet) and portal `docs/runbooks/M365-IDENTITY-CATALOG.md` (operator Entra steps).

Company skills catalog: **`petralabx/skills`** pinned at tag **`v1.6.10`** via `config/skills-catalog.json`. Legacy `taylorvalton/plx-cursor-skills` v1.0.0 is deprecated — bootstrap from `petralabx/skills` per [`SKILLS-SOP.md`](SKILLS-SOP.md).

---

## 4. Dual registries (do not confuse them)

| Registry | Location | Governs |
|----------|----------|---------|
| **Fleet governance** | `config/tracked-repos-registry.json` in `petralabx/PLX_MC` | Compliance gate enrollment, scaffold script, tier metadata, default buckets, quality-ledger paths |
| **MC operational allow-list** | Postgres `repos` table + MC UI **Repos** screen | Which repos may be attached to buckets/tasks; Request → Approve flow |

A repo can exist on GitHub and in the fleet registry but still be **off-list** in MC until an approver approves a **Request repo** in the UI. Task mutations clamp repo attachments to the MC allow-list (`src/lib/mc-data/repos.ts`).

### Four authorities

| Authority | Owns | Does not own |
|-----------|------|--------------|
| **Mission Control** | Projects, Buckets, Tasks, accountable owners, confirmed routing decisions | GitHub PR identity or repository-local path ownership |
| **GitHub** | Repository/PR identity and opened/reopened/synchronize/closed metadata | MC planning state or authorization to link/create work |
| **Repository governance** | Team ownership in repo `AGENTS.md`, module contracts, and `CODEOWNERS`, plus local CI/branch policy and reviewed routing-manifest declarations | Fleet enrollment or an MC Task decision |
| **Fleet governance** | `tracked-repos-registry.json`, cohort enrollment, tier/default-Bucket priors, central pilot descriptors | Repo-local path semantics or human planning decisions |

The copied `.github/plx-mc-routing-manifest.json` is a governed declaration.
Optional `.plx/mc-routing.json` path rules are **not runtime-active** in this
rollout and must not be described as enforced routing behavior. Routing never
overrides the accountable team/owner declared by `AGENTS.md`, module contracts,
or `CODEOWNERS`.

**Onboarding sequence:**

1. **Org owner/admin** creates the GitHub repo in `petralabx` (members cannot create org repos).
2. Operator files **Request repo** in MC UI — validates against the allowed org at request time.
3. Owner/Admin **approves** → repo joins MC allow-list.
4. Maintainer opens PLX_MC PR adding entry to `tracked-repos-registry.json` and scaffolds consumer repo per [`docs/runbooks/REPO-ONBOARDING.md`](runbooks/REPO-ONBOARDING.md).

---

## 5. MCP tools (PLX-MC)

Enable per [`docs/runbooks/plx-mc-mcp-team-registration.md`](runbooks/plx-mc-mcp-team-registration.md). Verify with `mc_self_check`.

### Required env

```bash
PLX_MC_MCP_ENABLED=1
MC_BASE_URL=https://mc.plxcustomer.io
MC_MCP_API_KEY=…          # from secrets manager
MC_OPERATOR_EMAIL=you@petrasoap.com
MC_REPO=petralabx/PLX_MC   # full slug for the repo you are pushing to
```

### Task lifecycle tools

| Step | Tool | Notes |
|------|------|-------|
| Find work | `mc_search_tasks` | Filter by `query` (alias `q`), `bucket`, `stage`, `limit`; `meta.filter` echoes what was applied |
| Create task | `mc_create_task` | **Not the default.** Search existing `TASK-*` first. Create only when routing found nothing **AND** the conductor said to create. Requires `title` + `bucket`; optional `description`, `priority`, `repos` (registry **ids**, not GitHub slugs — see table below) |
| Start | `mc_checkout_task` | Live repo-scoped checkout. Confirm `data.taskId` is a non-null string. Copy `prBodyLine` / `meta.links.checkoutStamp` exactly. Never invent a `dsp_*`. Never write `MC-Checkout: pending`. |

#### Two repo namespaces (do not mix)

| Purpose | Portal value |
|---|---|
| `MC_REPO` / `X-MC-Repo` (checkout, compliance) | `petralabx/plx-customer-portal` |
| `task.repos[]` / bucket / project repos (allow-list) | `portal-web` |

`MC_REPO` is the full GitHub slug for the repo you are pushing to. `repos[]` on create/patch is the MC registry **id** (`portal-web`, `plx-mc`, `agentic-swarm`). The API also accepts a unique registry `name` or `owner/name` slug and normalizes to the id before persist — prefer the id.
| Milestones | `mc_report_progress` | Every ~10–15 min on long runs; `stage`, `notes`, `progressPct` |
| Hand in evidence | `mc_complete_task` | Writes structured `task.evidence` — see §7 |

**MCP cannot create projects or buckets.** Operators create those in the MC UI ([`HUMAN-MC-SOP.md`](HUMAN-MC-SOP.md)).

### Checkout handshake (before first edit / PR_CREATE)

A successful tool call is not enough. Validate the returned checkout once:

- `data.taskId` is a **non-null string** and equals the expected Task.
- `data.actor.repo` (checkout receipt) or `meta.actor.repo` equals the exact full target slug (`petralabx/<repo>`). One Hub connector stamps every petralabx repo: pass `repo=owner/name` on `mc_checkout_task` to bind allowlisted consumers (`petralabx/local-inference`, `petralabx/skills`, `petralabx/1hr-after`, `petralabx/furgenics`, `petralabx/for-and-against`, `petralabx/agentic-swarm`, `petralabx/plx-customer-portal`). Omitted `repo` keeps the connector `X-MC-Repo`. Unknown slugs fail closed. Portal is no longer Portal-connector-only.
- The PR uses `data.prBodyLine` exactly; never reconstruct the stamp.
- Missing or mismatched task/repo metadata makes the checkout invalid.
- If the connector or script cannot return a live `dsp_*`, **stop**. Do not
  invent an id and do not write `MC-Checkout: pending`.
- Use `COMPLIANCE_CAPTURE=1 node scripts/compliance-checkout.mjs` with explicit
  `MC_REPO` when the MCP registration is missing or mis-scoped. The script
  performs this handshake in the checkout call and exits nonzero on mismatch.
  That is still a live checkout — it is not permission to open a PR with a
  placeholder stamp.

### Fallback: capture hook / HTTP

```bash
export COMPLIANCE_CAPTURE=1
export MC_BASE_URL=https://mc.plxcustomer.io
export MC_ACCOUNTABLE=you@petrasoap.com
export MC_REPO=petralabx/PLX_MC
export MC_TASK_ID="TASK-123"
# node scripts/compliance-checkout.mjs
```

Manual checkout:

```bash
curl -sS -X POST https://mc.plxcustomer.io/api/compliance/checkout \
  -H 'content-type: application/json' \
  -d '{"taskId":"TASK-123","runtime":"cursor","accountableHuman":"you@petrasoap.com","repo":"petralabx/PLX_MC"}'
# → {"data":{"checkoutId":"dsp_..."}}
```

### Repository identity migration

Always send the strict full slug (`petralabx/<repo>`) in `MC_REPO` and checkout
calls. Generated compliance workflows now send both `repoFullName` and a legacy
bare `repo` under the dated `module-shim — remove after 2026-10-15` contract.
`PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED` defaults to `1`; OIDC binds
`repoFullName` to its signed repository claim, and checkout matching prefers an
exact full slug when the dispatch also has one. Legacy bare dispatch rows remain
shim-compatible. Setting the flag to `0` is a temporary emergency migration
downgrade to bare-name matching, not normal operation. Retire the bare fallback
only after every fleet compliance gate is refreshed and all pre-refresh
dispatches have expired.

---

## 6. Stamp the PR

One line **per** checked-out task (gate verifies **every** stamp):

```text
MC-Checkout: dsp_xxxxxxxx
MC-Checkout: dsp_yyyyyyyy
```

Also include:

- Clear **Summary** (what / why)
- Human accountable owner named in task or PR metadata
- Risk label override if needed: `risk:low` / `risk:high`
- **`## Review links`** in the **PR body**, with **absolute URLs** (preview,
  staging, design refs). Reviewers must not have to open a second file.

Agents must **not** commit a shared review-links index from a feature PR
(for example portal `docs/runbooks/AGENT-PR-REVIEW-LINKS.md`). That file is an
optional operator index, not an agent close-out artifact.

**MRP / ERP milestone registers:** cite `MRP-M-XXX` / `ERP-M-XXX` in the PR
title and commit messages when the work maps to a milestone. Do **not**
require editing the shared register markdown on the feature branch — stamp the
register after merge so agent PRs do not rebase-fight on one file.

---

## 6a. Close-out verify (required before claiming done)

`mc_complete_task` writes `task.evidence`. It does **not** mean the GitHub
`compliance` check passed. On `petralabx/local-inference#11`, `complete()`
returned ok and the gate BLOCKED 19 seconds later (wrong-scope checkout).

Before treating an agent PR as ready:

```bash
# Mint stamps with the exact repo slug (Cloud default when Team MCP is Hub/Portal only)
COMPLIANCE_CAPTURE=1 MC_REPO=petralabx/<this-repo> \
  MC_BASE_URL=https://mc.plxcustomer.io MC_ACCOUNTABLE=cos@petrasoap.com \
  MC_MCP_API_KEY=… MC_TASK_ID=TASK-NNN \
  node scripts/compliance-checkout.mjs

# After PR open + evidence hand-in — must exit 0
MC_REPO=petralabx/<this-repo> MC_MCP_API_KEY=… \
  node scripts/compliance-pr-verify.mjs --wait
```

`compliance-pr-verify.mjs` checks: actor.repo scope, stamp/task parity, task
evidence completeness, and the GitHub `compliance` conclusion. Prefer this over
claiming done from a successful `complete()` alone.

---

## 7. Evidence — what the gate actually checks

The compliance gate evaluates **`task.evidence`** on the checked-out task entity (`verifyCompliance` → `evidenceCompleteForTier(task.evidence, tier)`). It does **not** primarily parse PR-body prose for rollback or proof.

| Source | What it does |
|--------|--------------|
| **`mc_complete_task`** (`actionComplete`) | **Authoritative** — writes `task.evidence`. Must include non-empty `verificationCommands` **AND** `rollback` (plus summary; optional `testRun`/`shots` by tier) |
| **PR body `## Rollback Plan`** | Human-readable; may satisfy **repo-specific** checks (e.g. `petralabx/agentic-swarm` evidence workflow) but is **not** the primary MC gate input |

### `mc_complete_task` fields that matter

| Field | Tier impact |
|-------|-------------|
| `summary` | Required at all tiers |
| `rollback` | **Required** — non-empty string. The gate treats a blank rollback as incomplete. |
| `verificationCommands` | **Required** — non-empty string array. Marks the verification checklist item done. |
| `testRun` or `shots` | Required for **high** tier (migrations, auth, infra, workflows, deploy) |
| `commitSha`, `prUrl` | Audit trail; recorded on completion event |

Call `mc_complete_task` **before** or as part of PR open — the gate reads the persisted task, not just the completion event log.

---

## 8. Risk-tier bundle

| Tier | Typical triggers | Gate expects on `task.evidence` |
|------|------------------|--------------------------------|
| **low** | docs-only / test-only | Non-empty summary |
| **standard** | normal product code | Summary + complete checklist + rollback |
| **high** | DB migrations, auth, infra, `.github/workflows`, deploy | Above + test run or screenshots + bucket PRD link |

Override auto-tier with PR labels `risk:low` / `risk:high` when classification is wrong.

Full matrix: [`COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md) §2, [`ROLLBACK-PLAN-SOP.md`](ROLLBACK-PLAN-SOP.md).

---

## 9. PR visibility (not a commit feed)

MC records **PR lifecycle events** — opened, synchronized, merged, closed — via GitHub webhooks and compliance projection. On merge, tasks may advance to `merged` and record merge SHA in `task.merge` / `prs[]`.

MC does **not** mirror every commit push. Do not expect a per-commit activity feed in MC.

Query audit trail: `GET https://mc.plxcustomer.io/api/events` (operator-credentialed). Only PR metadata is captured — never source code.

---

## 10. Loop Ledgers (read-only observatory)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/loop-ledgers` | Cross-repo quality-ledger index (scariest-first) |
| `GET /api/loop-ledgers/[ref]` | Per-module detail |

- Auth: GitHub App installation token via `resolveGithubToken({ repoOwner })` — **owner-aware routing** for mixed `petralabx` / legacy org repos.
- **Read-only** — no sync, repair, or rerun affordances.
- Degraded rows (missing, stale, invalid, unreachable, permission_denied) stay **visible and loud**.

**Do not use `POST /api/sync/sweep`** for ledgers. That endpoint mirrors SharePoint ToDos/Risk Register — a different subsystem entirely.

Registry seed: `config/loop-ledgers-registry.json`. Module contract: `docs/modules/loop-ledgers/README.md`.

---

## 11. Local gates before push

Compliance is a **backstop**, not a substitute for repo CI. Org-wide layering
(L0 compliance+secrets, L1 parallel product CI, L2 HITL, L3 post-merge) is
[`docs/runbooks/CI-PIPELINE.md`](runbooks/CI-PIPELINE.md) — do not stuff
Playwright or a Next.js `next build` into the org-required floor.

| Repo | Before commit / push |
|------|----------------------|
| `PLX_MC` | `./scripts/preflight.sh --mode pre-commit` then `--mode pre-push` |
| `plx-customer-portal` | Portal test/build/hygiene per `docs/runbooks/CONTRIBUTING.md`. Required merge checks: `lint-typecheck-build`, `compliance`, `Validate ledgers`. `silent-failure-audit` is a real fail. |
| `agentic-swarm` | Repo preflight / wterm gate as documented there |

Never `--no-verify`. Use the consumer's pre-push handshake when present.

---

## 11a. Routing suggestions (pre-checkout)

For a suggestion-enabled cohort with a healthy suggestion service, a missing
Task ID calls `mc_suggest_work` (or the checkout adapter) **before any repo
edit**, then stops for explicit operator selection or creation intent. For a
shadow cohort, unknown cohort, or unavailable suggestion service, the agent
stays stopped while the accountable human searches MC and creates/assigns a
Task in the fleet registry `default_bucket` if no suitable Task exists. Neither
path auto-creates work.

| Marker | Authority |
|--------|-----------|
| `MC-Task: TASK-*` | Author declaration — ranks candidates; does **not** mutate alone |
| `MC-Routing: rtx_*` | Correlation only — never mutation authority |
| `MC-Checkout: dsp_*` | Credential stamp after authenticated checkout |

Enable the Routing Inbox (`PLX_MC_ROUTING_INBOX_ENABLED=1`) and verify its
authenticated decision path **before** enabling suggestions. Suggestion-mode
GitHub summaries are intentionally generic: they show only that an MC suggestion
is ready plus an authenticated MC link, never candidate IDs or reasons. Shadow
cohorts return no link and no visible candidates.

Humans keep the normal, non-blocking PR path. Confirmation and fuzzy auto-link
remain **off** for this rollout (`PLX_MC_ROUTING_CONFIRM_ENABLED=0`;
`PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED` forced off). Rollout / kill switches:
[`docs/runbooks/mc-routing-rollout.md`](runbooks/mc-routing-rollout.md).

Operator PRs without a confirmed link create/update a routing **proposal**
(`action_required`) instead of a silent sparse Task. Sparse creation is retired.

---

## 12. Do's and don'ts

**Do**

- One logical theme per PR; multiple **related** MC tasks are fine (one stamp each).
- Report progress and complete with evidence; then run `compliance-pr-verify.mjs --wait` and confirm GitHub `compliance` is SUCCESS before claiming done.
- Install company skills separately from MCP ([`SKILLS-SOP.md`](SKILLS-SOP.md)).
- Keep `MC_REPO` set to the full `petralabx/<name>` slug you are pushing to.
- Use `mc_suggest_work` for suggestion-enabled cohorts; otherwise stop for the
  accountable human to search/create/assign in the registry default Bucket.

**Don't**

- Don't open an agent PR without a live repo-scoped checkout.
- Don't invent a `dsp_*` id or write `MC-Checkout: pending` so you can open the PR.
- Don't auto-create a Task then stamp it unless routing found nothing AND the conductor said to create.
- Don't open a PR when checkout tools are missing — stop and wait.
- Don't skip the consumer pre-push handshake (`--no-verify` is forbidden).
- Don't edit or disable `.github/workflows/*compliance*` to pass the check.
- Don't put secrets in dispatch messages or PR bodies.
- Don't treat soft-mode warnings as optional forever on repos slated for hard cutover.
- Don't use `/api/sync/sweep` to refresh Loop Ledgers.
- Don't treat fuzzy routing suggestions as auto-link authority.
- Don't restore sparse operator-PR Task creation when proposals are disabled —
  fall back to explicit triage/audit only.
- Don't commit a shared review-links index or milestone-register markdown from
  a feature PR. Put review URLs in the PR body; cite `MRP-M-*` / `ERP-M-*` in
  titles and commits; stamp registers after merge.
- Don't raise portal `silent-failure-audit` BASELINE. Fix new catch-empty-returns
  with `QueryResult<T>`.

---

## 13. If blocked

| Reason | Fix |
|--------|-----|
| No valid checkout | `mc_checkout_task` on the Hub connector with `repo=owner/name`; copy `prBodyLine`. Do not invent a stamp. |
| Checkout tools missing | **Stop.** Do not write `MC-Checkout: pending`. Do not open the PR. |
| Missing evidence on task | `mc_complete_task` with non-empty `verificationCommands` **AND** `rollback` (plus summary; testRun/shots as tier requires) |
| Missing bucket PRD (high) | Link PRD on bucket in MC UI |
| Repo-specific rollback check | Add `## Rollback Plan` to PR body (e.g. agentic-swarm) |
| MC unreachable | Fail-closed; re-run check when MC is up |

Escalation: Vince. Do not admin-bypass without owner approval.

---

## 14. Related

| Doc | Path |
|-----|------|
| All PR authors | [`docs/COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md) |
| Human MC UI | [`docs/HUMAN-MC-SOP.md`](HUMAN-MC-SOP.md) |
| Rollback requirements | [`docs/ROLLBACK-PLAN-SOP.md`](ROLLBACK-PLAN-SOP.md) |
| MCP registration | [`docs/runbooks/plx-mc-mcp-team-registration.md`](runbooks/plx-mc-mcp-team-registration.md) |
| Fleet repo onboarding | [`docs/runbooks/REPO-ONBOARDING.md`](runbooks/REPO-ONBOARDING.md) |
| Org CI pipeline (L0–L3) | [`docs/runbooks/CI-PIPELINE.md`](runbooks/CI-PIPELINE.md) |
| Compliance rollout | [`docs/runbooks/compliance-gate-rollout.md`](runbooks/compliance-gate-rollout.md) |
| GitHub App provisioning | [`docs/runbooks/github-app-provisioning.md`](runbooks/github-app-provisioning.md) |
| Company skills | [`docs/SKILLS-SOP.md`](SKILLS-SOP.md) |
| Repo hygiene | [`docs/REPO_HYGIENE_SOP.md`](REPO_HYGIENE_SOP.md) |
