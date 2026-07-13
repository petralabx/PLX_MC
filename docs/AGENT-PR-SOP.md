# Agent — How to Use Mission Control

**Audience:** AI agents and operators driving agents (Cursor, Claude Code, ChatGPT/Codex, swarm) against a PLX-tracked repo.

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-13

> **TL;DR** — Agents execute; a **named human** owns the outcome. Before an agent opens a PR: **check out** the Mission Control task(s), stamp **one `MC-Checkout: dsp_…` line per task**, hand in evidence via **`mc_complete_task`**, carry the **risk-tier bundle**, and **never** edit the compliance workflow to force a pass.

Live cockpit: [https://mc.plxcustomer.io](https://mc.plxcustomer.io)

Companion docs: [`COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md) (all PR authors), [`HUMAN-MC-SOP.md`](HUMAN-MC-SOP.md) (human UI workflows), [`ROLLBACK-PLAN-SOP.md`](ROLLBACK-PLAN-SOP.md).

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
| (+ other tooling repos) | tooling | `main` | hard |
| `petralabx/test-perms-check` | sandbox | `main` | soft |

Company skills catalog: **`petralabx/skills`** pinned at **~v1.2.0** via `config/skills-catalog.json`. Legacy `taylorvalton/plx-cursor-skills` v1.0.0 is deprecated — bootstrap from `petralabx/skills` per [`SKILLS-SOP.md`](SKILLS-SOP.md).

---

## 4. Dual registries (do not confuse them)

| Registry | Location | Governs |
|----------|----------|---------|
| **Fleet governance** | `config/tracked-repos-registry.json` in `petralabx/PLX_MC` | Compliance gate enrollment, scaffold script, tier metadata, default buckets, quality-ledger paths |
| **MC operational allow-list** | Postgres `repos` table + MC UI **Repos** screen | Which repos may be attached to buckets/tasks; Request → Approve flow |

A repo can exist on GitHub and in the fleet registry but still be **off-list** in MC until an approver approves a **Request repo** in the UI. Task mutations clamp repo attachments to the MC allow-list (`src/lib/mc-data/repos.ts`).

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
| Find work | `mc_search_tasks` | Filter by `q`, `bucket`, `stage`, `limit` |
| Create task | `mc_create_task` | Requires `title` + `bucket`; optional `description`, `priority`, `repos` |
| Start | `mc_checkout_task` | Copy `MC-Checkout: dsp_*` from `meta.links.checkoutStamp` |
| Milestones | `mc_report_progress` | Every ~10–15 min on long runs; `stage`, `notes`, `progressPct` |
| Hand in evidence | `mc_complete_task` | Writes structured `task.evidence` — see §7 |

**MCP cannot create projects or buckets.** Operators create those in the MC UI ([`HUMAN-MC-SOP.md`](HUMAN-MC-SOP.md)).

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

---

## 7. Evidence — what the gate actually checks

The compliance gate evaluates **`task.evidence`** on the checked-out task entity (`verifyCompliance` → `evidenceCompleteForTier(task.evidence, tier)`). It does **not** primarily parse PR-body prose for rollback or proof.

| Source | What it does |
|--------|--------------|
| **`mc_complete_task`** (`actionComplete`) | **Authoritative** — writes `task.evidence`: summary, checklist items, `rollback`, optional `testRun`/`shots` |
| **PR body `## Rollback Plan`** | Human-readable; may satisfy **repo-specific** checks (e.g. `petralabx/agentic-swarm` evidence workflow) but is **not** the primary MC gate input |

### `mc_complete_task` fields that matter

| Field | Tier impact |
|-------|-------------|
| `summary` | Required at all tiers |
| `rollback` | Required for standard/high |
| `verificationCommands` | Marks verification checklist item done |
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

Compliance is a **backstop**, not a substitute for repo CI.

| Repo | Before commit / push |
|------|----------------------|
| `PLX_MC` | `./scripts/preflight.sh --mode pre-commit` then `--mode pre-push` |
| `plx-customer-portal` | Portal test/build/hygiene per `docs/runbooks/CONTRIBUTING.md` |
| `agentic-swarm` | Repo preflight / wterm gate as documented there |

---

## 12. Do's and don'ts

**Do**

- One logical theme per PR; multiple **related** MC tasks are fine (one stamp each).
- Report progress and complete with evidence when work is ready for gate/merge.
- Install company skills separately from MCP ([`SKILLS-SOP.md`](SKILLS-SOP.md)).
- Keep `MC_REPO` set to the full `petralabx/<name>` slug you are pushing to.

**Don't**

- Don't open an agent PR without checkout.
- Don't edit or disable `.github/workflows/*compliance*` to pass the check.
- Don't put secrets in dispatch messages or PR bodies.
- Don't treat soft-mode warnings as optional forever on repos slated for hard cutover.
- Don't use `/api/sync/sweep` to refresh Loop Ledgers.

---

## 13. If blocked

| Reason | Fix |
|--------|-----|
| No valid checkout | `mc_checkout_task` + stamp `MC-Checkout` |
| Missing evidence on task | `mc_complete_task` with summary, rollback, verification, testRun/shots as tier requires |
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
| Compliance rollout | [`docs/runbooks/compliance-gate-rollout.md`](runbooks/compliance-gate-rollout.md) |
| GitHub App provisioning | [`docs/runbooks/github-app-provisioning.md`](runbooks/github-app-provisioning.md) |
| Company skills | [`docs/SKILLS-SOP.md`](SKILLS-SOP.md) |
| Repo hygiene | [`docs/REPO_HYGIENE_SOP.md`](REPO_HYGIENE_SOP.md) |
