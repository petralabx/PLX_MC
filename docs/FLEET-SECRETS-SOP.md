# Fleet secrets & CI tokens

**Audience:** org admins wiring compliance on a PLX-tracked repo — GitHub
secrets/variables, MC Vercel Production env, and operator MCP keys.

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-13 · **Slug:**
`mc-sop-fleet-secrets`

> **TL;DR** — Secrets live in **AWS Secrets Manager** (`prod/ec2-secrets`,
> `us-east-1`); never commit them. Each tracked repo needs **`PLX_MC_BASE_URL`**
> + **`COMPLIANCE_CI_TOKEN`** (GitHub secrets) and **`COMPLIANCE_MODE`** (GitHub
> variable). MC Production holds the control-plane secrets. **OIDC is preferred**
> for `POST /api/compliance/verify`; **`COMPLIANCE_CI_TOKEN` is break-glass**
> until OIDC dogfood evidence exists. Rotate allowlists and MCP keys
> deliberately; use kill switches only with a rollback plan.

Live reference:
[Governance SOPs — Fleet secrets](https://mc.plxcustomer.io/?screen=governance-sops&sop=mc-sop-fleet-secrets)

Companion runbooks:
[compliance-gate-rollout.md](runbooks/compliance-gate-rollout.md) (activation +
OIDC dogfood), [REPO-ONBOARDING.md](runbooks/REPO-ONBOARDING.md) (fleet
enrollment). PR discipline: [COLLABORATOR-SOP.md](COLLABORATOR-SOP.md),
[AGENT-PR-SOP.md](AGENT-PR-SOP.md). MCP registration:
[plx-mc-mcp-team-registration.md](runbooks/plx-mc-mcp-team-registration.md).

---

## 1. Source of truth

| Layer | Location | Rule |
|-------|----------|------|
| **Canonical secrets store** | AWS Secrets Manager — `prod/ec2-secrets` (`us-east-1`) | Write new values here first |
| **Operator local load** | `~/load-secrets.ps1` | Hydrates env for local ops; do not paste values into chat, PRs, or commits |
| **Per-repo gate config** | GitHub repo **Secrets** + **Variables** | Set by org admin during onboarding |
| **MC runtime** | Vercel **Production** env on `mc.plxcustomer.io` | Redeploy after any change |

**Never** commit secrets, `.env` files with live values, or screenshots that
expose tokens. Use placeholders in docs and evidence bundles.

---

## 2. Secrets inventory

### 2a. Per tracked repo (GitHub)

Set these when onboarding or auditing a fleet repo. See
[REPO-ONBOARDING.md](runbooks/REPO-ONBOARDING.md) for the full checklist.

| Name | Type | Value / purpose |
|------|------|-----------------|
| `PLX_MC_BASE_URL` | **Secret** | `https://mc.plxcustomer.io` — gate calls MC verify + webhook mirror |
| `COMPLIANCE_CI_TOKEN` | **Secret** | Bearer token for `POST /api/compliance/verify` when OIDC minting is unavailable (**break-glass / fallback**) |
| `COMPLIANCE_MODE` | **Variable** | `soft` (warn only) or `hard` (block merge on fail). **Active fleet repos are `hard`.** |

The compliance workflow is **safe by default**: if `PLX_MC_BASE_URL` is unset,
the gate **skips** (no outbound calls).

### 2b. MC Vercel Production (control plane)

These env vars are **not** copied into consumer repos. Operators set them from
Secrets Manager during deploy or rotation.

| Name | Purpose |
|------|---------|
| `COMPLIANCE_CI_TOKEN` | Same bearer as repo secret — verify fallback when OIDC is off or fails |
| `COMPLIANCE_WEBHOOK_SECRET` | HMAC for GitHub App webhook → `POST /api/compliance/webhook` |
| `COMPLIANCE_OIDC_ENABLED` | `1` — prefer GitHub Actions OIDC on verify |
| `COMPLIANCE_OIDC_AUDIENCE` | Audience verified on OIDC tokens (e.g. `plx-mc-compliance-verify`) |
| `COMPLIANCE_OIDC_REPO_ALLOWLIST` | Comma-separated `org/repo` list allowed to mint OIDC tokens |
| `PLX_MC_ALLOWED_USERS` | Comma-separated Petra emails — MC sign-in + MCP operator allowlist |
| `PLX_MC_MCP_API_KEY` | Server-side MCP API key (clients use `MC_MCP_API_KEY`; see §5) |

Full activation sequence:
[compliance-gate-rollout.md](runbooks/compliance-gate-rollout.md).

---

## 3. OIDC vs bearer (verify auth)

`POST /api/compliance/verify` accepts **two** auth paths. MC tries OIDC first
when configured.

| Path | When | Operator action |
|------|------|-----------------|
| **OIDC (preferred)** | `COMPLIANCE_OIDC_ENABLED=1` + audience + repo on allowlist | Add repo to `COMPLIANCE_OIDC_REPO_ALLOWLIST` on Vercel; redeploy MC |
| **Bearer (break-glass)** | `COMPLIANCE_CI_TOKEN` set on repo **and** MC | Keep during dogfood and until OIDC is proven fleet-wide |

**Do not remove `COMPLIANCE_CI_TOKEN`** from GitHub repos or Vercel until:

1. OIDC dogfood on `petralabx/PLX_MC` has recorded evidence (successful verify
   via OIDC), and
2. The target repo is on `COMPLIANCE_OIDC_REPO_ALLOWLIST`, and
3. A follow-up rotation PR explicitly retires bearer for that repo.

Until then, bearer is the rollback path if OIDC minting breaks.

---

## 4. Allowlist rotation

### 4a. `PLX_MC_ALLOWED_USERS` (Vercel Production)

Controls who may sign in to MC and invoke MCP as an operator.

1. Edit comma-separated Petra emails in Vercel Production env (source value from
   Secrets Manager if mirrored there).
2. **Redeploy** MC Production.
3. Confirm: affected user runs `mc_self_check` or loads MC UI.
4. Remove departed users promptly — stale emails are a standing access risk.

### 4b. `COMPLIANCE_OIDC_REPO_ALLOWLIST` (Vercel Production)

Controls which repos may mint OIDC tokens for verify.

TASK-456 provisioned the exact production fleet allowlist:
`petralabx/PLX_MC`, `petralabx/plx-customer-portal`,
`petralabx/agentic-swarm`, `petralabx/skills`,
`petralabx/local-inference`, `petralabx/1hr-after`,
`petralabx/furgenics`, and `petralabx/for-and-against`. Rotate this set
deliberately; do not add the excluded `test-perms-check` sandbox.

1. Append `org/repo` (comma-separated, no spaces) for each fleet repo entering
   OIDC.
2. **Redeploy** MC Production.
3. Open a test PR on that repo; confirm verify succeeds via OIDC (check MC
   compliance audit / workflow logs).
4. Do **not** add repos that are not yet onboarded per
   [REPO-ONBOARDING.md](runbooks/REPO-ONBOARDING.md).

Selected organization Actions variables are separate from the Vercel OIDC
allowlist. On the GitHub organization `free` plan, public selected repositories
consume `PLX_MC_BASE_URL` and `PLX_MC_ROUTING_METADATA_ENABLED`; the private
portal required equivalent repository-level variables for runtime consumption.
Never treat selected membership alone as consumption evidence.

---

## 5. MCP API key rotation

| Store | Name | Consumer env name |
|-------|------|-------------------|
| AWS Secrets Manager | `PLX_MC_MCP_API_KEY` | `MC_MCP_API_KEY` (stdio / team MCP config) |
| Vercel Production | `PLX_MC_MCP_API_KEY` | Validated server-side on `/api/cursor/mcp` |

**Rotation procedure:**

1. Generate a new key; write to **Secrets Manager** (`prod/ec2-secrets`).
2. Update **Vercel Production** `PLX_MC_MCP_API_KEY`; **redeploy**.
3. Update every team MCP registration
   ([plx-mc-mcp-team-registration.md](runbooks/plx-mc-mcp-team-registration.md))
   — `x-api-key` header or `MC_MCP_API_KEY` env.
4. Operators reload MCP; run `mc_self_check`.
5. **Revoke** the old key value (overwrite in Secrets Manager; confirm old
   header returns 401).

Committed `.cursor/mcp.json` ships with `PLX_MC_MCP_ENABLED=0` — enable per
operator session only.

---

## 6. Kill switches

Use only with a documented rollback plan. See
[compliance-gate-rollout.md](runbooks/compliance-gate-rollout.md) kill-switch
section.

| Switch | Effect | Scope |
|--------|--------|-------|
| **Unset `PLX_MC_BASE_URL`** (repo secret) | Compliance workflow **skips** — no verify, no block | Single repo |
| **`COMPLIANCE_MODE=soft`** (repo variable) | Check runs; **warn only** — merge not blocked by compliance | Single repo |
| **Remove `COMPLIANCE_CI_TOKEN`** | Bearer verify path disabled; OIDC-only if enabled | Repo + MC — **only after OIDC proven** |
| **`PLX_MC_MCP_ENABLED=0`** (Vercel) | MCP tools return disabled; UI/session may still work | MC Production |

**Hard fleet rollback** for an active repo: set `COMPLIANCE_MODE=soft` first;
only unset `PLX_MC_BASE_URL` if soft is insufficient. Never disable the
compliance **workflow file** in the repo — that is a governance violation
([COLLABORATOR-SOP.md](COLLABORATOR-SOP.md)).

---

## 7. Onboarding checklist (org admin)

Use when adding or re-auditing a tracked repo.

| Step | Action | Verify |
|------|--------|--------|
| 1 | Repo enrolled in `config/tracked-repos-registry.json` per [REPO-ONBOARDING.md](runbooks/REPO-ONBOARDING.md) | Registry entry `status: active` |
| 2 | Set GitHub secret `PLX_MC_BASE_URL=https://mc.plxcustomer.io` | Workflow no longer skips |
| 3 | Set GitHub secret `COMPLIANCE_CI_TOKEN` (from Secrets Manager) | Bearer verify returns 200 on test PR (soft mode) |
| 4 | Set GitHub variable `COMPLIANCE_MODE` — `soft` for dogfood, `hard` when ready | Soft = warn; hard = block on fail |
| 5 | GitHub App installed; webhook secret matches MC `COMPLIANCE_WEBHOOK_SECRET` | PR events appear in MC audit |
| 6 | Add repo to `COMPLIANCE_OIDC_REPO_ALLOWLIST` when moving to OIDC | OIDC token accepted on verify |
| 7 | Branch protection: require `compliance` status on protected branches (hard mode) | Merge blocked without pass |
| 8 | Document accountable owner for fleet rollout task in MC | Task evidence links this SOP |

---

## 8. Who does what

| Actor | Responsibility |
|-------|----------------|
| **Org admin** | GitHub secrets/variables, App install, branch protection, registry updates |
| **MC operator (Vince)** | Vercel Production env, OIDC allowlist, `PLX_MC_ALLOWED_USERS`, MCP key, migrations/deploy |
| **Repo maintainer** | Does **not** hold production secrets; requests onboarding via MC task |
| **Agents / contributors** | Never edit compliance workflow or secrets; follow [AGENT-PR-SOP.md](AGENT-PR-SOP.md) |

---

## 9. Verification commands (no secret values)

Run after any rotation or onboarding. Substitute your operator context; do not
log tokens.

```bash
# MC MCP health (requires allowlisted operator + MCP key)
# Tool: mc_self_check  OR  GET https://mc.plxcustomer.io/api/cursor/self-check

# Verify endpoint posture (expect 401 without auth, not 503 once configured)
curl -s -o /dev/null -w "%{http_code}" -X POST https://mc.plxcustomer.io/api/compliance/verify

# Open a test PR on the repo; confirm compliance check + MC audit event
```

**503** on verify means OIDC and bearer are both unconfigured on MC. **401**
without a token is expected. A passing compliance check on a test PR in `soft`
mode confirms end-to-end wiring before flipping to `hard`.

---

## 10. Related artifacts

| Artifact | Path |
|----------|------|
| Fleet registry | `config/tracked-repos-registry.json` |
| Gate generator | `scripts/generate-compliance-gate.py` |
| Tracked-repo scaffold | `scripts/scaffold-tracked-repo.sh` |
| Windows secrets bootstrap | `scripts/bootstrap-windows-secrets.py` |
| Governance contract (integrations) | `config/governance-contract.yaml` |

For activation history, OIDC dogfood order, and reconciliation cron:
[compliance-gate-rollout.md](runbooks/compliance-gate-rollout.md).
