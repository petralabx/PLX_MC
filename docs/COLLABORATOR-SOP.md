# PLX Mission Control — Collaborator SOP

**Audience:** anyone who opens pull requests against one of the eight active
PLX-tracked repos listed below, whether you work by hand or drive an AI agent
(Cursor, Claude Code, ChatGPT/Codex, etc.).

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-09

> **TL;DR** — Every PR now runs a **compliance check** and every PR event is
> mirrored into Mission Control's audit log. **Humans are recorded but not
> blocked. Agents must link their work to a Mission Control task.** Never edit a
> repo's compliance workflow to make the check pass.

---

## 1. What changed

Two things now happen automatically on PRs to a tracked repo:

1. **Compliance gate** — a `compliance` status check runs on every PR. It calls
   Mission Control (MC) and returns **pass** or **block** based on what the change
   is and who made it.
2. **Audit mirror** — PR opened/updated/merged/closed events are recorded in MC's
   append-only event log (the "system of record"). Nothing about your code is
   stored — only PR metadata (repo, PR number, changed paths, labels, author).

### Where it's on, and how strict

The authoritative fleet list is `config/tracked-repos-registry.json`. Snapshot:

| Repo | Tier | Gate | Status |
|---|---|---|---|
| `petralabx/PLX_MC` | hub | hard | active |
| `petralabx/plx-customer-portal` | product_app | hard | active |
| `petralabx/agentic-swarm` | product_platform | hard | active |
| `petralabx/skills` | skills | hard | active |
| `petralabx/local-inference` | tooling | hard | active |
| `petralabx/1hr-after` | tooling | hard | active |
| `petralabx/furgenics` | tooling | hard | active |
| `petralabx/for-and-against` | tooling | hard | active |
| `petralabx/test-perms-check` | sandbox | soft | pending adoption |

> Hard cutover 2026-07-08: active repos block merge on `compliance` fail.
> The fleet has **eight active repos**. `test-perms-check` is a sandbox and is
> excluded from that count and from routing rollout; it stays soft. Rollback:
> fleet-compliance-hard-cutover runbook.
> New repos join the fleet via `docs/runbooks/REPO-ONBOARDING.md` +
> `scripts/scaffold-tracked-repo.sh` — never by copying governance files by hand.
> For control-plane shape (baseline files, per-tier minimums, folder map, and
> engineering-root stability), see **Repository control-plane tier** in that
> onboarding runbook — descriptive metadata only; this SOP and
> `config/governance-contract.yaml` remain authoritative for checkout, evidence,
> and compliance modes.

---

## 2. What the gate actually checks

The gate classifies each PR into a **risk tier** and resolves **who** made it.

**Risk tier** (from the changed paths + labels):

| Tier | Triggered by | Bundle the gate expects |
|---|---|---|
| **low** | docs-only / test-only changes | a short summary |
| **standard** | normal product code | complete description; agent PRs need **`task.evidence`** with summary + rollback |
| **high** | DB migrations, auth/permissions, infra, `.github/workflows`, deploy | **`task.evidence`** with tests/screenshots + rollback + linked bucket PRD |

You can override the tier with a PR label: **`risk:high`** or **`risk:low`**.

**Who made it:**

- **Operator (a human) PR** → **passes** and is recorded (decision: humans are
  trusted, audited, not gated).
- **Agent PR** → **must be linked to a checked-out MC task** (see §4). An agent PR
  with no valid checkout is **blocked**, and it must carry a **human accountable
  owner** plus complete **`task.evidence`** on each stamped task (`mc_complete_task`
  writes summary, rollback, verification, and high-tier test shots as required).

---

## 3. Working WITHOUT an agent (you, by hand)

You're treated as an operator — your PR will **pass and be recorded**. Just keep
PRs clean so they sail through (and survive the future hard cutover):

1. Write a clear PR description of **what** changed and **why**.
2. For anything beyond docs/tests, add a **`## Rollback Plan`** section in the PR
   body — what to do to undo it (revert, disable, feature-flag, restore). Example:

   ```markdown
   ## Rollback Plan
   Revert this PR. No schema/data changes; reverting fully restores prior behavior.
   ```

   > Human PRs are not gated on `task.evidence`. The MC gate still reads
   > **`task.evidence`** for agent PRs (`mc_complete_task`). PR-body rollback is
   > also **required** by `petralabx/agentic-swarm` on non-docs PRs (its evidence
   > check) — keep both where applicable.
3. Use a `risk:low` / `risk:high` label if the auto-classification is wrong.
4. Don't worry about MC checkout — that's for agents.

---

## 4. Working WITH an agent (Cursor, Claude Code, ChatGPT/Codex, etc.)

The principle is the same for **every** agent tool: **link the agent's work to a
Mission Control task before it opens a PR.** This is what lets the gate attribute
the work and pass it, and it's how autonomous changes stay accountable.

### The flow

1. **Resolve the MC task(s) before the agent edits the repo** (a PR may complete
   several related tasks), and name a **human accountable owner**. If the Task
   ID is unknown, the agent stays stopped:
   - in a suggestion-enabled cohort, call `mc_suggest_work`, then an operator
     explicitly selects existing work or approves creation;
   - in a shadow cohort, unknown cohort, or unavailable suggestion service, the
     accountable human searches MC and creates/assigns a Task in the registry
     `default_bucket` when none exists.
   There is no agent auto-create fallback and no edit begins without the Task.
2. **Check the task out** — this mints a credential tied to `{task, human, repo}`:
   - **Cursor (PLX_MC):** the capture hook does it automatically at session start
     when you opt in — it checks out known task(s) and stamps the PR for you.
     Set these in your run environment and start the session:
     ```bash
     export COMPLIANCE_CAPTURE=1
     export MC_BASE_URL=https://mc.plxcustomer.io
     export MC_ACCOUNTABLE=you@petrasoap.com
     export MC_REPO=petralabx/PLX_MC
     # existing task(s), comma/space-separated for one PR
     export MC_TASK_ID="TASK-123, TASK-124"
     # against the gated staging app, also: export MC_BASIC_AUTH="user:pass"
     ```
   - **Any agent / repo (manual):** call the checkout endpoint and copy the id
     (repeat per task):
     ```bash
     curl -sS -X POST https://mc.plxcustomer.io/api/compliance/checkout \
       -H 'content-type: application/json' \
       -d '{"taskId":"TASK-123","runtime":"cursor","accountableHuman":"you@petrasoap.com","repo":"petralabx/PLX_MC"}'
     # → {"data":{"checkoutId":"dsp_..."}}
     ```
3. **Stamp the PR body** with the checkout id — **one line per task** (the capture
   hook adds these for you; otherwise paste them):
   ```
   MC-Checkout: dsp_xxxxxxxx
   MC-Checkout: dsp_yyyyyyyy   # one per task on a multi-task PR
   ```
4. Call **`mc_complete_task`** (or equivalent) so **`task.evidence`** is complete
   before the gate runs — summary, rollback, verification commands, test shots/PRD
   as tier requires. Also add PR-body **`## Rollback Plan`** when repo CI expects
   it (e.g. `agentic-swarm`). Name the **human accountable owner**.

> **Full agent provisioning guide:** Mission Control → **SOP guide** →
> **Agent — How to Use Mission Control** (`docs/AGENT-PR-SOP.md`).
> Humans working in the UI: **Human — How to Use Mission Control** (`docs/HUMAN-MC-SOP.md`).

### Rules for agent-driven work

- **One logical theme per PR — but multiple related tasks are fine.** Add one
  `MC-Checkout` line per task; the gate verifies **every** one and blocks the PR
  if **any** task's bundle is incomplete.
- **A human is always accountable.** Agents execute; a named person owns the
  outcome. The gate enforces this.
- **Never let an agent edit the compliance workflow** (`.github/workflows/*compliance*`)
  to make the check pass — that defeats the gate and is treated as a violation.
- Agents must follow the repo's governance contract (`AGENTS.md` / `CLAUDE.md`)
  and run the repo's preflight/CI before pushing. The gate is a backstop, not a
  substitute for those.
- Routing suggestions do not change the checkout rule. Suggestion-mode PR jobs
  show only a generic summary plus an authenticated MC link; candidate IDs and
  reasons stay in MC. Shadow cohorts expose neither links nor candidates.
- Humans continue through the normal PR path. An unresolved routing proposal is
  advisory and non-blocking; autonomous-agent compliance remains merge-blocking.
- During an MC outage, an agent without a valid checkout and complete evidence
  does not push. Preserve local work and resume after MC health is restored.
- Generated compliance callers send preferred `repoFullName` plus a legacy bare
  name. `PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED` defaults to `1`; setting
  it to `0` is an emergency migration downgrade only. The bare-name
  `module-shim — remove after 2026-10-15` stays until every fleet gate refreshes
  and old checkout dispatches expire.

---

## 5. Reading the result / if your PR is blocked

- **`compliance` = pass** → you're good.
- **`compliance` = block** (hard repos stop the merge; soft repos just warn):
  open the check's log and read the `reasons`. On a multi-task PR each reason is
  prefixed with the task it belongs to (e.g. `TASK-124: missing a rollback plan`),
  so you know exactly which task to fix. Common fixes:

| Reason | Fix |
|---|---|
| Agent PR with no valid checkout | Check out the task and add `MC-Checkout: <id>` (see §4). |
| Missing rollback on task | `mc_complete_task` with `rollback` in **`task.evidence`** (MC gate). |
| Missing PR-body rollback (repo CI) | Add `## Rollback Plan` to the PR body (e.g. `agentic-swarm`). |
| Missing evidence/PRD on a high-risk change | Complete **`task.evidence`** (testRun/shots); link bucket PRD in MC; or relabel `risk:low` if mis-tiered. |
| "MC unreachable" | MC is temporarily down (fail-closed). Re-run the check once it's back; it auto-recovers via the reconcile sweep. |

If you're stuck or believe the verdict is wrong, ping the owner (Vince) — don't
work around the gate.

---

## 6. Do's and don'ts

**Do**
- Keep PRs scoped to one logical theme (one or more related MC tasks).
- Add a rollback plan for anything beyond docs/tests.
- Label risk explicitly when the auto-tier is wrong.
- Let the App see your PRs — it only reads PR metadata.

**Don't**
- Don't edit or disable the compliance workflow to pass the check.
- Don't commit secrets — credentials come from the secrets manager.
  `PLX_MC_BASE_URL` is public configuration; `COMPLIANCE_CI_TOKEN` remains a
  repo secret and its value must not appear in logs or evidence.
- Don't bypass a hard gate with admin merge unless the owner approves it.
- Don't run an autonomous agent against a tracked repo without a checked-out task.

---

## 7. What's recorded (transparency)

Every PR event and every gate verdict appends to MC's audit log (`mc_events`),
queryable at `GET https://mc.plxcustomer.io/api/events` (operator-credentialed).
This is the audit trail + the feed for Mission Control's roll-ups. Only PR
metadata is captured — never your source code.

---

## 8. Help & escalation

- **Owner:** Vince — for gate questions, false blocks, or enrollment of a new repo.
- **Per-repo CI** still applies on top of the gate (each repo has its own tests /
  validation / hygiene checks). Green compliance ≠ green CI.
- **Kill switch (owner only):** a repo can be reverted to soft (`COMPLIANCE_MODE=soft`)
  or the gate removed entirely; the audit log is append-only and retains history.

---

## 9. Personal environment — company skills + PLX-MC MCP

> **Full guide:** Mission Control → **SOP guide** → **Company Skills SOP**
> (`docs/SKILLS-SOP.md`) — install, verify, share skills, troubleshooting.

**PLX-MC access and company skills are separate.** Registering the PLX-MC MCP server
(checkout / progress / complete) does **not** install Cursor or Claude skills on your
machine. Do both steps below once per laptop (and again after the company catalog
changes).

### 9.1 Company-approved skills (quick start)

The full `agentic-swarm` repo contains operator-only skills. **Do not** run the
all-skills installer on a team laptop.

Instead, bootstrap from **`petralabx/skills`** (catalog pin ~v1.2.0 in
`config/skills-catalog.json`):

**Windows:** `.\scripts\bootstrap-company-skills.ps1` · **macOS/Linux:** `./scripts/bootstrap-company-skills.sh`

Then start a **new** Cursor session. See **Company Skills SOP** for verify, refresh, and share workflows.

### 9.2 PLX-MC MCP (task governance)

Follow `docs/runbooks/plx-mc-mcp-team-registration.md`:

- Set `MC_MCP_API_KEY`, `MC_OPERATOR_EMAIL`, `PLX_MC_MCP_ENABLED=1`.
- Register `https://mc.plxcustomer.io/api/cursor/mcp` (remote) or the stdio client
  under `tools/plx-mc-mcp/`.
- Set `MC_REPO` to the full slug you are working in (e.g. `petralabx/PLX_MC` or
  `petralabx/plx-customer-portal`).
- When creating tasks, `repos[]` is a **different** namespace — MC registry ids,
  not GitHub slugs:

  | Purpose | Portal value |
  |---|---|
  | `MC_REPO` / `X-MC-Repo` (checkout, compliance) | `petralabx/plx-customer-portal` |
  | `task.repos[]` / bucket / project repos (allow-list) | `portal-web` |

- Verify with tool `mc_self_check`.

### 9.3 Sharing a personal skill

See **Company Skills SOP** (SOP guide in Mission Control) — §8 covers submit via
**Skills directory** / `mc_submit_skill`, reviewer approval, and the direct-PR
fallback PR to **`petralabx/skills`** (canonical catalog; legacy
`taylorvalton/plx-cursor-skills` is pre-migration only).

