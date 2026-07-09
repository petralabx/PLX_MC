# PLX Mission Control — Collaborator SOP

**Audience:** anyone who opens pull requests against a PLX-tracked repo
(`PLX_MC`, `agentic-swarm`, `plx-customer-portal`), whether you work by hand or
drive an AI agent (Cursor, Claude Code, ChatGPT/Codex, etc.).

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
> `test-perms-check` stays soft. Rollback: fleet-compliance-hard-cutover runbook.
> New repos join the fleet via `docs/runbooks/REPO-ONBOARDING.md` +
> `scripts/scaffold-tracked-repo.sh` — never by copying governance files by hand.

---

## 2. What the gate actually checks

The gate classifies each PR into a **risk tier** and resolves **who** made it.

**Risk tier** (from the changed paths + labels):

| Tier | Triggered by | Bundle the gate expects |
|---|---|---|
| **low** | docs-only / test-only changes | a short summary |
| **standard** | normal product code | a complete description **+ a rollback note** |
| **high** | DB migrations, auth/permissions, infra, `.github/workflows`, deploy | full evidence (tests/screenshots) **+ rollback plan + a linked PRD** |

You can override the tier with a PR label: **`risk:high`** or **`risk:low`**.

**Who made it:**

- **Operator (a human) PR** → **passes** and is recorded (decision: humans are
  trusted, audited, not gated).
- **Agent PR** → **must be linked to a checked-out MC task** (see §4). An agent PR
  with no valid checkout is **blocked**, and it must carry a **human accountable
  owner** plus the tier bundle above.

---

## 3. Working WITHOUT an agent (you, by hand)

You're treated as an operator — your PR will **pass and be recorded**. Just keep
PRs clean so they sail through (and survive the future hard cutover):

1. Write a clear PR description of **what** changed and **why**.
2. For anything beyond docs/tests, add a **Rollback Plan** section — what to do to
   undo it (revert, disable, feature-flag, restore). Example:

   ```markdown
   ## Rollback Plan
   Revert this PR. No schema/data changes; reverting fully restores prior behavior.
   ```

   > `agentic-swarm` **requires** this `## Rollback Plan` section on non-docs PRs
   > (its "Agentic PR Evidence" check fails without it). It's good practice
   > everywhere.
3. Use a `risk:low` / `risk:high` label if the auto-classification is wrong.
4. Don't worry about MC checkout — that's for agents.

---

## 4. Working WITH an agent (Cursor, Claude Code, ChatGPT/Codex, etc.)

The principle is the same for **every** agent tool: **link the agent's work to a
Mission Control task before it opens a PR.** This is what lets the gate attribute
the work and pass it, and it's how autonomous changes stay accountable.

### The flow

1. **Pick the MC task(s)** the agent is working on (a PR may complete several
   related tasks), and a **human accountable owner**. No task yet? The capture
   hook can **auto-create** one for you (`MC_TASK_TITLE` + `MC_BUCKET`).
2. **Check the task out** — this mints a credential tied to `{task, human, repo}`:
   - **Cursor (PLX_MC):** the capture hook does it automatically at session start
     when you opt in — it checks out the task(s) (or auto-creates one) and stamps
     the PR for you. Set these in your run environment and start the session:
     ```bash
     export COMPLIANCE_CAPTURE=1
     export MC_BASE_URL=https://mc.plxcustomer.io
     export MC_ACCOUNTABLE=you@petrasoap.com
     export MC_REPO=petralabx/PLX_MC
     # either: an existing task (or several — comma/space-separated, one PR)
     export MC_TASK_ID="TASK-123, TASK-124"
     # or: let it auto-create a task when you don't have one
     # export MC_TASK_TITLE="Short title"; export MC_BUCKET=BKT-WMS
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
4. Make sure the PR meets the **tier bundle** (rollback note, evidence, PRD as
   required) and names the **human accountable owner**.

> **Full agent provisioning guide:** Mission Control → **SOP guide** →
> **Agent PR & MC-Checkout discipline** (`docs/AGENT-PR-SOP.md`).

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
| Missing rollback plan | Add a `## Rollback Plan` section to the PR body. |
| Missing evidence/PRD on a high-risk change | Attach tests/screenshots; link the bucket PRD; or relabel `risk:low` if mis-tiered. |
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
- Don't commit secrets — everything comes from the secrets manager. (Tokens like
  `PLX_MC_BASE_URL` / `COMPLIANCE_CI_TOKEN` are set as repo secrets by the owner.)
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

Instead, bootstrap from **`taylorvalton/plx-cursor-skills`** (29 published skills):

**Windows:** `.\scripts\bootstrap-company-skills.ps1` · **macOS/Linux:** `./scripts/bootstrap-company-skills.sh`

Then start a **new** Cursor session. See **Company Skills SOP** for verify, refresh, and share workflows.

### 9.2 PLX-MC MCP (task governance)

Follow `docs/runbooks/plx-mc-mcp-team-registration.md`:

- Set `MC_MCP_API_KEY`, `MC_OPERATOR_EMAIL`, `PLX_MC_MCP_ENABLED=1`.
- Register `https://mc.plxcustomer.io/api/cursor/mcp` (remote) or the stdio client
  under `tools/plx-mc-mcp/`.
- Set `MC_REPO` to the full slug you are working in (e.g. `petralabx/PLX_MC` or
  `petralabx/plx-customer-portal`).
- Verify with tool `mc_self_check`.

### 9.3 Sharing a personal skill

See **Company Skills SOP** (SOP guide in Mission Control) — §8 covers submit via
**Skills directory** / `mc_submit_skill`, reviewer approval, and the direct-PR
fallback to `taylorvalton/plx-cursor-skills` (skills catalog; platform repos live
under `petralabx/*`).

