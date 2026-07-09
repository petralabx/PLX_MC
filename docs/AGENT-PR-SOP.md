# Agent PR & MC-Checkout discipline

**Audience:** anyone driving an AI agent (Cursor, Claude Code, ChatGPT/Codex, swarm)
against a PLX-tracked repo.

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-09

> **TL;DR** — Agents execute; a **named human** owns the outcome. Before an agent
> opens a PR, **check out** the Mission Control task(s), stamp **one
> `MC-Checkout: dsp_…` line per task**, carry the **risk-tier bundle**, and never
> edit the compliance workflow to force a pass.

This SOP is the agent-focused companion to
[`docs/COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md). Humans working by hand can skip
checkout; agents cannot.

---

## 1. Why this exists

Tracked repos run a **`compliance`** check on every PR. For **agent** authorship
the gate is hard: no valid checkout → **block**. Checkout is how MC attributes
work, verifies the tier bundle, and keeps SharePoint / audit trails honest.

Canonical fleet list: `config/tracked-repos-registry.json` (org: **`petralabx`**).

| Repo | Integration branch | Notes |
|------|--------------------|-------|
| `petralabx/PLX_MC` | `main` | Hub; hard gate |
| `petralabx/plx-customer-portal` | `staging` | Product; hard gate; ledger on `staging` |
| `petralabx/agentic-swarm` | `main` | Platform; hard gate; requires `## Rollback Plan` |

Live cockpit: [https://mc.plxcustomer.io](https://mc.plxcustomer.io)

---

## 2. Provision the effort (before code)

Do this **once per logical theme** (a PR may close several related tasks).

1. **Name the human accountable owner** (Petra email, e.g. `you@petrasoap.com`).
2. **Pick or create MC task(s)** in Mission Control (or let the capture hook
   auto-create with `MC_TASK_TITLE` + `MC_BUCKET`).
3. **Check out** each task against the repo you will push to.
4. Keep the checkout id(s) for the PR body.

### Preferred: PLX-MC MCP

Enable per [`docs/runbooks/plx-mc-mcp-team-registration.md`](runbooks/plx-mc-mcp-team-registration.md)
and the in-repo `mc-sync` skill:

| Step | Tool |
|------|------|
| Start | `mc_checkout_task` → copy `MC-Checkout: dsp_*` from `meta.links.checkoutStamp` |
| Milestones | `mc_report_progress` (~every 10–15 min on long work) |
| Finish | `mc_complete_task` with summary, commit SHA, PR URL, verification commands |

Env (team MCP / `.cursor/mcp.json`):

```bash
PLX_MC_MCP_ENABLED=1
MC_BASE_URL=https://mc.plxcustomer.io
MC_MCP_API_KEY=…          # from secrets manager
MC_OPERATOR_EMAIL=you@petrasoap.com
MC_REPO=petralabx/plx-customer-portal   # or petralabx/PLX_MC, petralabx/agentic-swarm
```

Verify with `mc_self_check`.

### Fallback: capture hook / HTTP

```bash
export COMPLIANCE_CAPTURE=1
export MC_BASE_URL=https://mc.plxcustomer.io
export MC_ACCOUNTABLE=you@petrasoap.com
export MC_REPO=petralabx/PLX_MC
export MC_TASK_ID="TASK-123"   # or MC_TASK_TITLE + MC_BUCKET to auto-create
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

## 3. Stamp the PR

One line **per** task (gate verifies every stamp):

```text
MC-Checkout: dsp_xxxxxxxx
MC-Checkout: dsp_yyyyyyyy
```

Also include:

- Clear **Summary** (what / why)
- **`## Rollback Plan`** for anything beyond docs/tests (required on
  `agentic-swarm` non-docs PRs)
- Evidence + linked PRD when the change is **high** risk
- Human accountable owner named in the body or PR author metadata the gate expects

Risk labels: `risk:low` / `risk:high` override auto-tier when needed.

---

## 4. Risk-tier bundle (what the gate expects)

| Tier | Typical triggers | Bundle |
|------|------------------|--------|
| **low** | docs-only / test-only | Short summary |
| **standard** | normal product code | Description + rollback note |
| **high** | DB migrations, auth, infra, `.github/workflows`, deploy | Evidence + rollback + linked PRD |

Full matrix: Collaborator SOP §2.

---

## 5. Local gates before push

Compliance is a **backstop**, not a substitute for repo CI.

| Repo | Before commit / push |
|------|----------------------|
| `PLX_MC` | `./scripts/preflight.sh --mode pre-commit` then `--mode pre-push` |
| `plx-customer-portal` | `cd portal && npm run test && npm run build && npm run audit:hygiene`; ledger `--check` on milestone work |
| `agentic-swarm` | repo preflight / wterm gate as documented there |

Portal-specific delivery (branches, ledger path, release):  
`plx-customer-portal` → `docs/runbooks/CONTRIBUTING.md` and
`docs/runbooks/MISSION-CONTROL-LEDGER.md`.

---

## 6. Do's and don'ts

**Do**

- One logical theme per PR; multiple **related** MC tasks are fine.
- Report progress and complete the task with evidence when the PR merges.
- Keep company skills installed separately from MCP (Skills SOP).

**Don't**

- Don't open an agent PR without checkout.
- Don't edit or disable `.github/workflows/*compliance*` to pass the check.
- Don't put secrets in dispatch messages or PR bodies.
- Don't treat soft-mode warnings as optional forever — fleet hard cutover is live
  on active repos.

---

## 7. If blocked

| Reason | Fix |
|--------|-----|
| No valid checkout | Check out + stamp `MC-Checkout` (§2–3) |
| Missing rollback | Add `## Rollback Plan` |
| Missing evidence/PRD | Attach proof or fix the risk label |
| MC unreachable | Fail-closed; re-run when MC is up |

Escalation: Vince. Do not admin-bypass without owner approval.

---

## 8. Related

- Collaborator SOP — `docs/COLLABORATOR-SOP.md`
- Rollback requirements — `docs/ROLLBACK-PLAN-SOP.md`
- Repo hygiene — `docs/REPO_HYGIENE_SOP.md`
- MCP team registration — `docs/runbooks/plx-mc-mcp-team-registration.md`
- Company skills — `docs/SKILLS-SOP.md`
