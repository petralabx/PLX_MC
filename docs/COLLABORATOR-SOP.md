# PLX Mission Control — Collaborator SOP

**Audience:** anyone who opens pull requests against a PLX-tracked repo
(`PLX_MC`, `agentic-swarm`, `plx-customer-portal`), whether you work by hand or
drive an AI agent (Cursor, Claude Code, ChatGPT/Codex, etc.).

**Owner:** Vince · **Status:** active · **Effective:** 2026-06-23

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

| Repo | Gate | Mode today | What that means |
|---|---|---|---|
| `PLX_MC` | ✅ on | **hard (required)** | A PR **cannot merge** until `compliance` passes. |
| `agentic-swarm` | ✅ on | **soft (warn-only)** | The check runs + records, but does **not** block merge yet. |
| `plx-customer-portal` | ✅ on | **soft (warn-only)** | Same — runs + records, does not block yet. |

> Soft repos will move to **hard** later, once they've run clean for a while. Treat
> a soft warning as a real signal now so the cutover is a non-event.

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
     export MC_REPO=PLX_MC
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
       -d '{"taskId":"TASK-123","runtime":"cursor","accountableHuman":"you@petrasoap.com","repo":"PLX_MC"}'
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
