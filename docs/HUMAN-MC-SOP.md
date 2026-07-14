# Human — How to Use Mission Control

**Audience:** human collaborators working in Mission Control directly — creating work, reviewing agent output, approving repos. Not for agent runtime discipline (see [`AGENT-PR-SOP.md`](AGENT-PR-SOP.md)).

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-13

> **TL;DR** — Create projects, buckets, and tasks in the MC UI. Name a **human accountable owner** on every agent task. Approve repos into the MC allow-list after an admin creates them on GitHub. Review agent evidence on the task entity. Your own PRs **pass without checkout**; agents cannot.

Live cockpit: [https://mc.plxcustomer.io](https://mc.plxcustomer.io)

---

## 1. What humans do in MC

| Activity | Where |
|----------|-------|
| Plan initiatives | Projects + Buckets |
| Assign and track work | Tasks (stages, owners, evidence) |
| Govern codebases | Repos screen (allow-list) |
| Observe quality posture | Loop Ledgers screen |
| Review agent PRs | Task detail + compliance audit |

Agents execute; you own outcomes, approve scope, and verify evidence.

---

## 2. Hierarchy — create work top-down

```
Project (optional)
  └── Bucket / Initiative
        └── Task
```

### Projects

Optional umbrella grouping (e.g. "PLX Portal Go-Live"). Set owner, target date, linked repos, PRD when applicable.

### Buckets / Initiatives

Primary planning unit. Each bucket carries:

- Owner (human)
- Health, target, description
- Linked repos (from MC allow-list only)
- Optional parent project
- PRD link (required for high-risk agent changes on tasks in that bucket)

### Tasks

Atomic work items. Minimum fields to set before agent handoff:

| Field | Guidance |
|-------|----------|
| **Title / description** | What done looks like |
| **Bucket** | Required |
| **Accountable owner** | Human Petra email — **required before stage passes Planned** |
| **Assignee** | Human or agent executor |
| **Repos** | Subset of MC allow-list |
| **Priority / due** | As needed |

**MCP agents can create tasks** (`mc_create_task`) but **cannot create projects or buckets** — you create those in the UI first.

---

## 3. Accountable owner

Every agent-driven task needs a **human accountable owner** (`accountableOwner`):

- Use a Petra-domain email (`@petrasoap.com` or `@petralabx.com`).
- Distinct from **assignee** (who executes — may be an agent).
- Gate blocks agent PRs when accountable owner is missing.
- Set in task edit UI before moving past **Planned**.

---

## 4. Dual registries (simple view)

Two lists serve different purposes:

| Registry | What it is | Who maintains it |
|----------|------------|------------------|
| **Fleet governance** (`config/tracked-repos-registry.json`) | Which repos run compliance gates, scaffold, tiers | Maintainer PR to `petralabx/PLX_MC` |
| **MC operational allow-list** (Repos screen / Postgres `repos`) | Which repos can attach to buckets and tasks | Request → Approve in MC UI |

A repo must typically be in **both** for full fleet participation:

1. GitHub repo exists under `petralabx` (admin-created).
2. MC **Request repo** → Owner/Admin **Approve**.
3. Fleet registry PR + scaffold per [`docs/runbooks/REPO-ONBOARDING.md`](runbooks/REPO-ONBOARDING.md).

Task and bucket repo pickers only show MC-approved repos. Off-list attachments are silently dropped at the server boundary.

---

## 5. Requesting and approving repos

### Step 1 — GitHub (admin only)

Org **owner/admin** creates the repository in **`petralabx`**. Standard members cannot create org repos.

### Step 2 — MC request (any collaborator)

1. Open **Repos** screen in MC.
2. Click **+ Request repo**.
3. Enter repo name and one-line scope.
4. MC validates against allowed orgs (`petralabx`, legacy `taylorvalton` during migration). Unverified requests stay **pending** — never auto-promoted.

### Step 3 — Approve (Owner/Admin only)

Approver reviews pending requests → **Approve** or **Reject**. Approved repos join the allow-list immediately for task/bucket attachment.

### Step 4 — Fleet enrollment (maintainer)

Follow [`docs/runbooks/REPO-ONBOARDING.md`](runbooks/REPO-ONBOARDING.md): registry entry, scaffold, compliance workflows, activate.

---

## 6. Reviewing agent work

### Before the PR

Confirm the agent (or operator) has:

- Checked out the correct task(s)
- Named you (or another human) as accountable owner
- Placed work in the right bucket

### Evidence hand-in

Agents submit evidence via **`mc_complete_task`**, which writes **`task.evidence`**:

| Evidence field | You verify |
|----------------|------------|
| `summary` | Accurate description of change |
| Checklist items | Verification commands actually run |
| `rollback` | Credible undo path |
| `qa` / `shots` | Present for high-risk changes |

The compliance gate reads **`task.evidence`**, not PR-body prose. PR `## Rollback Plan` is still good practice and may be required by repo-specific checks (e.g. `agentic-swarm`).

### After merge

- Task projects to **`merged`** via webhook/compliance projection; merge SHA recorded.
- Advance to **`verified`** only when evidence bundle is complete and you have confirmed deploy/acceptance.
- Complete the MC task with final notes if your workflow requires it.

---

## 7. Humans vs agents — checkout rule

| Author | Checkout required? | Gate behavior |
|--------|-------------------|---------------|
| **Human operator PR** | No | Pass — recorded; **routing proposal** / Routing Inbox when unlinked (sparse Task auto-create is **retired**) |
| **Agent PR** | Yes — `MC-Checkout: dsp_*` per task | Block without valid checkout + complete evidence |

You do **not** need `MC-Checkout` stamps on your own PRs. Agents **must** have them. See [`AGENT-PR-SOP.md`](AGENT-PR-SOP.md).

### Routing Inbox (human confirmation)

When `PLX_MC_ROUTING_INBOX_ENABLED=1`, open **Routing** in the MC chrome for:

- Personal “Needs your decision” queue
- Project/Bucket-scoped queues
- Global Unrouted queue

Accept / change / transfer / explicitly confirm Task creation. SLA: alert at 24h,
expire unresolved UI detail after 7 days. Rolling metric breaches demote a
cohort from confirmation to **suggestion-only**. Fuzzy auto-link stays off.
Kill switches and pilot status: [`docs/runbooks/mc-routing-rollout.md`](runbooks/mc-routing-rollout.md).

GitHub App **Checks requested actions** are deferred (phase one uses workflow
summary + authenticated MC deep link only).

---

## 8. PR and task projection (not every commit)

MC mirrors **pull request events** into the audit log and may update linked tasks:

| Event | Task effect |
|-------|-------------|
| PR opened / updated | Stage may move to `progress` |
| PR merged | Stage `merged`, `prs[]` updated, merge SHA recorded |
| PR closed (unmerged) | Recorded; task stage unchanged unless you adjust |

There is **no** general per-commit feed. Individual pushes are not mirrored unless tied to a PR webhook event.

---

## 9. Loop Ledgers observatory

**Screen:** Sidebar → System of record → **Loop Ledgers**

Read-only cross-repo view of `vmc-quality-ledger/v1` artifacts committed in fleet repos.

### What you see

| View | Content |
|------|---------|
| **Index** | All configured repos, scariest-first sort |
| **Detail** | Per-module artifacts, freshness, validation |
| **Degraded gallery** | Every failure mode — never hidden |

### What "degraded" means

| Reason | Typical cause |
|--------|---------------|
| `not_found` | Wrong slug/path, or App installation cannot see a private repo (owner routing) |
| `permission_denied` | GitHub App not installed / wrong installation for that owner |
| `token_missing` | No App or fallback token configured |
| `no_ledgers` | Glob matched zero files |
| `stale` / freshness warn | Ledger older than 7d (warn) or 30d (stale) |
| `invalid` | Schema/count/enum validation failed |

### Auth model

Ledgers are fetched live via **`GET /api/loop-ledgers`** using GitHub App tokens with **owner-aware routing** (`resolveGithubToken({ repoOwner })`). Mixed `petralabx` and legacy-org repos each need correct App installation coverage.

### What Loop Ledgers is NOT

- **Not** a writer — no sync, repair, rerun, or edit controls.
- **Not** refreshed by **`POST /api/sync/sweep`** — that endpoint syncs SharePoint ToDos/Risk Register.

Troubleshooting runbook: [`docs/runbooks/github-app-provisioning.md`](runbooks/github-app-provisioning.md).

---

## 10. Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Private repo ledger 404 / `permission_denied` | Wrong App installation for that owner | Confirm `GITHUB_APP_INSTALLATION_ID_PLX` for `petralabx`; App installed on org |
| Repo not in task picker | Not in MC allow-list | Request → Approve on Repos screen |
| Agent PR blocked, evidence reasons | `task.evidence` incomplete | Agent re-runs `mc_complete_task` with rollback + proof |
| Agent PR blocked, no checkout | Missing `MC-Checkout` stamp | Agent checks out task, stamps PR |
| Ledger stale | No recent commit to artifacts file | Update quality ledger in source repo |
| Used sync sweep for ledgers | Wrong subsystem | Use Loop Ledgers screen or `GET /api/loop-ledgers` only |

Escalation: Vince.

---

## 11. Risk tiers (for review)

When reviewing agent PRs, confirm tier-appropriate evidence on the **task**:

| Tier | You expect |
|------|------------|
| **low** | Summary |
| **standard** | Summary + checklist + rollback on task |
| **high** | Above + test proof or screenshots + bucket PRD |

Details: [`ROLLBACK-PLAN-SOP.md`](ROLLBACK-PLAN-SOP.md), [`COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md) §2.

---

## 12. Related

| Doc | Path |
|-----|------|
| Agent / operator MCP discipline | [`docs/AGENT-PR-SOP.md`](AGENT-PR-SOP.md) |
| All PR authors (gate rules) | [`docs/COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md) |
| Fleet repo onboarding | [`docs/runbooks/REPO-ONBOARDING.md`](runbooks/REPO-ONBOARDING.md) |
| MC routing rollout / kill switches | [`docs/runbooks/mc-routing-rollout.md`](runbooks/mc-routing-rollout.md) |
| Rollback requirements | [`docs/ROLLBACK-PLAN-SOP.md`](ROLLBACK-PLAN-SOP.md) |
| MCP team setup | [`docs/runbooks/plx-mc-mcp-team-registration.md`](runbooks/plx-mc-mcp-team-registration.md) |
| Loop Ledgers module | [`docs/modules/loop-ledgers/README.md`](modules/loop-ledgers/README.md) |
| GitHub App setup | [`docs/runbooks/github-app-provisioning.md`](runbooks/github-app-provisioning.md) |
