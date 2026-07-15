# Runbook: MC Commit/PR Routing Rollout

**Audience:** operators enabling routing pilots, responding to metric breaches,
or killing a routing surface.  
**Owner:** Vince · **Effective:** 2026-07-14  
**Module:** `docs/modules/routing/README.md` · **Declaration:** `config/integrations.yaml` → `mc-routing`

> The central runtime is ready and `plx-customer-portal` is the only active
> downstream metadata workflow. Every other downstream repo remains pending its
> own activation PR, task, and live proof.

---

## 1. Modes

| Mode | Behavior |
|------|----------|
| **shadow** | Score/persist metrics; no visible suggestions; no mutation |
| **suggestion** | MCP / checkout / generic workflow summary + authenticated MC link; no candidate details or auto-link in GitHub |
| **confirmation** | Authorized confirm / attach / Task create (not enabled in this rollout) |

Configured per pilot in `config/routing-pilots/*.json`. Three cohorts are
configured for **suggestion** and five for **shadow**. Confirmation remains off.
Rolling-window breach demotes **confirmation → suggestion** if a later approved
rollout ever enables it.

**Fuzzy auto-link is disabled for every pilot** and cannot be promoted by this
project (`src/lib/routing/rollout.ts` + `FUZZY_AUTOLINK_ENABLED=false`).

Enable and health-check the Routing Inbox before setting
`PLX_MC_ROUTING_SUGGEST_ENABLED=1`. In suggestion mode, GitHub shows only
“An MC suggestion is ready” and an authenticated MC link. Shadow mode returns
no link and no visible candidates. Human PRs remain normal and non-blocking;
agent checkout/evidence compliance remains unchanged.

---

## 2. Pilots

| Cohort / repo | Tier | Branch | Default Bucket | Mode | Activation | MC task | Accountable owner |
|---------------|------|--------|----------------|------|------------|---------|-------------------|
| `petralabx/PLX_MC` | hub | `main` | `BKT-INFRA` | suggestion | `central_ready` | `TASK-452` | `vince@petrasoap.com` |
| `petralabx/plx-customer-portal` | product_app | `staging` | `BKT-PROD` | suggestion | **active** | `TASK-447` | `vince@petrasoap.com` |
| `petralabx/agentic-swarm` | product_platform | `main` | `BKT-INFRA` | suggestion | `pending_downstream_pr` | `TASK-448` | `vince@petrasoap.com` |
| `petralabx/skills` | skills | `main` | `BKT-INFRA` | shadow | `pending_downstream_pr` | `TASK-449` | `vince@petrasoap.com` |
| `petralabx/local-inference` | tooling | `main` | `BKT-INFRA` | shadow | `pending_downstream_pr` | `TASK-450` | `vince@petrasoap.com` |
| `petralabx/1hr-after` | tooling | `main` | `BKT-INFRA` | shadow | `pending_downstream_pr` | `TASK-453` | `vince@petrasoap.com` |
| `petralabx/furgenics` | tooling | `main` | `BKT-INFRA` | shadow | `pending_downstream_pr` | `TASK-454` | `vince@petrasoap.com` |
| `petralabx/for-and-against` | tooling | `main` | `BKT-INFRA` | shadow | `pending_downstream_pr` | `TASK-455` | `vince@petrasoap.com` |

Central config: `config/mc-routing-rollout.json`.  
Workflow template: `docs/templates/mc-routing-manifest.json` →
`.github/plx-mc-routing-manifest.json` via scaffold.

The eight rows above are the routing fleet. The pending-adoption sandbox
`petralabx/test-perms-check` is excluded. The rollout health invariant is
`pilots===8`; the independent fuzzy-promotion research threshold remains
`minRepos===5`.

The table is the authoritative routing activation map and mirrors
`config/tracked-repos-registry.json`. Marketing repos are `tooling`, not a new
tier. These are the actual MC Task IDs; owner is Vince for every row.

The copied manifest is a declaration and digest contract. Optional
`.plx/mc-routing.json` path rules are **not consumed by the current central
runtime**; do not claim path-rule activation or enforcement.

---

## 2a. Authority boundaries

| Authority | Canonical responsibility |
|-----------|--------------------------|
| Mission Control | Projects, Buckets, Tasks, accountable owners, explicit routing decisions |
| GitHub | Repository/PR identity and PR lifecycle metadata |
| Repository governance | Team ownership in repo `AGENTS.md`, module contracts, and `CODEOWNERS`, plus local CI/branch rules and reviewed manifest declarations |
| Fleet governance | Active-repo registry, cohort descriptors, tier/default-Bucket priors, manifest path/schema/digest |

GitHub metadata can recommend but never authorize an MC mutation. Fleet defaults
are priors, not Task decisions. Repo-local path declarations are not runtime
authority until a separately verified consumer enables them. Routing never
overrides the team ownership declared in `AGENTS.md`, module contracts, or
`CODEOWNERS`.

---

## 2b. Actions variable and OIDC wiring

Use organization Actions variables with **selected-repository** visibility:

- `PLX_MC_BASE_URL=https://mc.plxcustomer.io`
- `PLX_MC_ROUTING_METADATA_ENABLED=1` only for a repo being activated

Probe the current `gh` credential before mutation:

```bash
unset GH_TOKEN GITHUB_TOKEN
gh auth status --hostname github.com
gh api user --jq .login
gh api orgs/petralabx/actions/variables --jq '.variables[].name'
```

A fine-grained repo PAT may push code yet still lack organization Actions
variable administration. If the probe is denied, do not broaden or print that
PAT: unset `GITHUB_TOKEN` / `GH_TOKEN` and use the `gh` keyring OAuth identity
that has `petralabx` organization-admin capability. If organization-level
selected-repo variables are unavailable, set the same variables per repository
and record that fallback in the activation task.

Set selected-repo organization variables with the keyring OAuth admin identity:

```bash
gh variable set PLX_MC_BASE_URL --org petralabx --visibility selected \
  --repos PLX_MC,plx-customer-portal,agentic-swarm,skills,local-inference,1hr-after,furgenics,for-and-against \
  --body https://mc.plxcustomer.io
gh variable set PLX_MC_ROUTING_METADATA_ENABLED --org petralabx \
  --visibility selected --repos <repos-being-activated> --body 1
```

Capture evidence without exposing credentials:

```bash
# Selected visibility includes a public repo and the private portal repo.
gh api orgs/petralabx/actions/variables/PLX_MC_BASE_URL/repositories \
  --jq '.repositories[].full_name'
gh api orgs/petralabx/actions/variables/PLX_MC_ROUTING_METADATA_ENABLED/repositories \
  --jq '.repositories[].full_name'

# The excluded sandbox must not appear in either selected-repository list.
gh api orgs/petralabx/actions/variables/PLX_MC_ROUTING_METADATA_ENABLED/repositories \
  --jq '[.repositories[].full_name] | contains(["petralabx/test-perms-check"])'

# Confirm the secret name exists without reading its value.
gh secret list --repo petralabx/<repo> | awk '$1=="COMPLIANCE_CI_TOKEN"{print $1}'
```

The sandbox query must print `false`; public `PLX_MC` and private
`plx-customer-portal` must appear where selected. If org variables are
unavailable, use repository variables and retain the same evidence:

For a non-selected repo, absence from the selected list plus a skipped
`vars.PLX_MC_ROUTING_METADATA_ENABLED == '1'` job is the denial proof; do not
temporarily expose the variable merely to test denial.

```bash
gh variable set PLX_MC_BASE_URL --repo petralabx/<repo> \
  --body https://mc.plxcustomer.io
gh variable set PLX_MC_ROUTING_METADATA_ENABLED --repo petralabx/<repo> --body 1
```

### Prove consumption before fleet assignment

Selected membership alone is not activation evidence. Before assigning all
eight repos, use the existing copied workflow and an activation PR in:

- public `petralabx/PLX_MC`; and
- private `petralabx/plx-customer-portal`.

Temporarily select only those canaries, close/reopen (or rerun) each activation
PR, and capture run metadata without printing variable or secret values:

```bash
gh run list --repo petralabx/PLX_MC --workflow "MC Routing Metadata" \
  --limit 5 --json databaseId,event,headBranch,status,conclusion,url
gh run list --repo petralabx/plx-customer-portal \
  --workflow "MC Routing Metadata" --limit 5 \
  --json databaseId,event,headBranch,status,conclusion,url
gh run view <run-id> --repo petralabx/<repo> \
  --json databaseId,conclusion,jobs,url
```

For each canary, record the run ID/URL, routing job conclusion, proposal ID, and
matching MC audit event. That proves the Actions variable was consumed, OIDC
bound to the full repository, and the proposal reached MC.

Then prove both negative/override paths:

1. Install the copied workflow on a third activation PR while that repo remains
   non-selected. Close/reopen it; record a skipped routing job and no proposal.
2. On one selected canary, set repository
   `PLX_MC_ROUTING_METADATA_ENABLED=0`, close/reopen, and record skipped/no
   proposal. Remove the repository override, close/reopen, and record a new
   successful run/proposal. This proves repository `0` precedence.
3. If org-variable consumption fails, set equivalent per-repo variables only on
   that canary and repeat the same run/proposal evidence before wider rollout.

Never include variable values, OIDC tokens, `COMPLIANCE_CI_TOKEN`, or raw
workflow environment output in evidence.

The generated workflow reads `vars.PLX_MC_BASE_URL` first and retains
`secrets.PLX_MC_BASE_URL` only as a legacy URL fallback. A repository variable
`PLX_MC_ROUTING_METADATA_ENABLED=0` overrides the organization value and is the
per-repo emergency stop.

`PLX_MC_BASE_URL` is public configuration, not a token.
`COMPLIANCE_CI_TOKEN` remains a GitHub secret; never print its value or place it
in variables, logs, evidence, or PR text.

Before requesting OIDC, the copied workflow:

1. accepts only the exact destination `https://mc.plxcustomer.io` (optional
   trailing slash; no credentials, path, query, or fragment);
2. rejects a fork whose source repository ID/full name differs from the target;
3. reads PR file metadata; then
4. requests audience **`plx-mc-compliance-verify`**.

Dependabot PRs are not activation evidence; their restricted credential/OIDC
path is treated as a warn-only skip. Forks are skipped before OIDC. Delivery has
a 20-second timeout and every destination, metadata, OIDC, transport, and HTTP
failure is warning-only; compliance is unaffected.

The workflow is metadata-only: no checkout, PR code, dependency install, cache,
or `pull_request_target`. Keep it as a copied generated workflow. Do not replace
it with a reusable workflow or expand GitHub App Checks, organization rulesets,
or required-workflow policy in this rollout.

---

## 2c. Full-slug compliance migration

Generated compliance workflows prefer `repoFullName` (`petralabx/<repo>`) and
also send the legacy bare repository name under
`module-shim — remove after 2026-10-15`.
`PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED` defaults to `1`: when both the
signed caller and checkout dispatch carry full slugs, matching is exact and
case-insensitive. OIDC rejects a supplied `repoFullName` that differs from its
signed repository claim and replaces/sets the request value from that claim.
Legacy bare dispatch rows remain accepted by the dated shim.

Setting the flag to `0` downgrades checkout matching to bare repository names.
That is a temporary emergency migration escape hatch, not normal rollout.
Retire the bare fallback only after all eight fleet compliance gates are
regenerated/refreshed and old checkout dispatches from pre-refresh workflows
have expired.

---

## 3. Kill switches

| Env | Default | Effect when off |
|-----|---------|-----------------|
| `PLX_MC_ROUTING_SHADOW_ENABLED` | `0` | No shadow scoring surface |
| `PLX_MC_ROUTING_SUGGEST_ENABLED` | `0` | No MCP/checkout/workflow suggestions |
| `PLX_MC_ROUTING_CONFIRM_ENABLED` | `0` | No confirm/attach/create mutations |
| `PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED` | forced `0` | Always off in code + config |
| `PLX_MC_ROUTING_PROPOSALS_ENABLED` | `1` | Off → explicit triage/audit; **never** restore sparse Tasks |
| `PLX_MC_ROUTING_METADATA_ENABLED` | `1` | Skip metadata submission; compliance unchanged |
| `PLX_MC_ROUTING_INBOX_ENABLED` | `0` | Hide UI/session APIs; keep proposal/audit data |
| `PLX_MC_ROUTING_MAINTENANCE_ENABLED` | `1` | Cron no-ops retention/demotion writers |
| `PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED` | `1` | `0` temporarily downgrades checkout matching to legacy bare names; compliance still runs |
| `PLX_MC_GRAPH_WEBHOOK_ENABLED` | `0` | Disable subscriptions; keep 5-min delta recovery |
| `PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED` | `0` | Admission-only until centralized auth is on |

Emergency stop for writers: set `PLX_MC_ROUTING_CONFIRM_ENABLED=0` and
`PLX_MC_ROUTING_PROPOSALS_ENABLED=0`, then investigate. Do **not** re-enable
sparse operator-PR Task creation.

Normal rollout order:

1. keep confirmation and fuzzy auto-link at `0`;
2. enable and verify Inbox;
3. enable shadow scoring/metadata for the selected repo;
4. enable suggestions only for the declared suggestion cohorts.

---

## 4. Promotion thresholds (research / SPEC)

Fuzzy auto-link (future, out of this project) would require **all** of:

- ≥ **300** human-reviewed proposals over ≥ **30** days
- ≥ **5** repositories; ≥ **20** reviewed cases per enabled cohort
- Top-1 precision ≥ **98%**; 95% CI lower bound ≥ **95%**
- Duplicate-Task rate ≤ **0.5%**
- Bucket/Project correction ≤ **1%**
- **Zero** authorization / cross-repository incidents

Any rolling **100**-decision window that breaches a ceiling demotes that cohort
to **suggestion-only**.

---

## 5. SLA and retention

| Signal | Threshold |
|--------|-----------|
| Unresolved alert | 24 hours |
| Unresolved UI expire | 7 days |
| Stop expansion if unresolved | >10% after 24h or >2% after 7d |
| Proposal/candidate detail | 90 days after resolution |
| Final links + audit | Task lifetime + 1 year |
| Raw PR bodies | **Never persisted** |

Maintenance cron `GET /api/cron/routing-maintenance` (hourly `:15`, `vercel.json`):

1. Outer admission: `Authorization: Bearer $CRON_SECRET`
2. Authorize only durable `sp_routing_maintenance` + `routing.maintain`
3. Expire provisional sessions (24h idle / 7d absolute) and proposal detail
4. Evaluate rolling breaches → demote confirmation cohorts to suggestion
5. **Preserve** final typed links and append-only audit events

---

## 6. Health checks

```ts
import { rolloutHealth, killSwitchSnapshot } from "@/lib/routing";
rolloutHealth(); // pilots===8, fuzzyAutoLinkEnabled===false
```

- `rolloutHealth()` returns `scope: "descriptor_config"` and is
  **descriptor-valid/config health only**. `ok` means: eight unique enabled
  pilots exactly intersect the active non-sandbox registry; configured modes
  are 3 suggestion / 5 shadow / 0 confirmation; descriptor tier/default Bucket
  match the registry; and fuzzy is off. `reasons[]` names count, duplicate,
  intersection, mode-distribution, tier, Bucket, or fuzzy mismatches. It does
  not prove a downstream workflow is live.
- Rollout research config intentionally remains `thresholds.minRepos===5`.
- MCP: `mc_self_check`
- Inbox: UI hidden when `PLX_MC_ROUTING_INBOX_ENABLED != 1`
- Cron: 503 if `CRON_SECRET` unset; 401 on bad bearer; 403 if principal missing
  under permissions enforcement
- Live activation health additionally requires selected variables, successful
  full-slug OIDC/repository binding, the copied generated workflow at the target
  ref, and a recorded proposal/run ID plus matching MC audit evidence.

---

## 7. Fallback and sparse retirement

| Failure | Fallback |
|---------|----------|
| Confirm breached / kill switch | Suggestion-only for that cohort |
| Proposals disabled | Explicit triage/audit row — **no** silent Task |
| Metadata disabled | Compliance gate unchanged |
| Suggestion mode | Generic GitHub summary + authenticated MC link; candidates stay private |
| Shadow/unknown/suggestion unavailable | Agent stops before edit; accountable human searches MC and creates/assigns in registry default Bucket |
| Graph webhook disabled | Five-minute delta sweep remains recovery |
| Sync stale / conflict | Fail closed (`sync_stale`) — no mutation |

Operator PRs without confirmed work create/update an idempotent routing
proposal (`action_required`) with an authenticated MC deep link. Sparse
`sparse-pr` Task creation is retired.

---

## 8. GitHub App Checks — deferred

Phase one does **not** request `checks:write` or `check_run.requested_action`.
The existing App stays read-only Contents/Metadata. Interactive Checks require
a **new approved spec**, separate accessor, default-off flag, health check,
audit family, and rollback. Do not broaden the App silently.

---

## 8a. Stop and rollback contracts

- **Branch/PR lease conflict:** stop. Do not transfer, overwrite, push, or open a
  competing PR until the accountable operator resolves the lease.
- **MC outage:** agents without a currently valid checkout and complete
  tier-appropriate evidence do not push. Preserve local work; do not treat
  warning-only routing as compliance permission.
- **Warning replay:** record every warning workflow run ID in the activation
  task. After MC health returns, rerun/replay each ID and attach the successful
  proposal evidence; do not discard warning runs as noise.
- **OIDC/repository mismatch:** stop the line. Do not fall back to another repo,
  audience, destination, or token; correct the descriptor/variable/workflow
  binding first.
- **Per-repo rollback proof:** set repository
  `PLX_MC_ROUTING_METADATA_ENABLED=0`, close/reopen the activation PR, and
  capture the skipped routing job while compliance still runs. Restore the
  intended variable, close/reopen again, and capture a healthy proposal before
  calling activation complete.
- **Fleet rollback order:** first disable suggestion and Inbox exposure, then
  set routing metadata to `0` for affected repositories. Leave the compliance
  workflow, checkout/evidence policy, and required compliance check unchanged.

---

## 9. Downstream activation checklist

For each pending pilot:

1. MC task exists (activation PR owner + done-when); authoritative map is
   `TASK-452` central, `TASK-447` portal, `TASK-448` swarm, `TASK-449` skills,
   `TASK-450` local-inference, `TASK-453` 1hr-after, `TASK-454` furgenics, and
   `TASK-455` for-and-against. Accountable owner: Vince.
2. Central descriptor `enabled: true`, `fuzzyAutoLinkEnabled: false`
3. Run `scripts/scaffold-tracked-repo.sh --routing-only` with the registry tier,
   branch, and target. Confirm its exact three files; do not convert the copied
   workflow to a reusable workflow.
4. Configure selected-repo Actions variables and verify the exact URL/OIDC
   contract; keep the repository `0` override ready
5. Verify the PR is same-repository and non-Dependabot, then record live health
   evidence and all warning run IDs for replay
6. Enable/verify Inbox before suggestion visibility
7. Only then update activation status; confirmation and fuzzy remain off

Generated evidence for the central delivery:
`artifacts/platform/2026-07-14-commit-pr-mc-routing/`.

---

## 10. Related

- `docs/AGENT-PR-SOP.md` — agent suggest / markers
- `docs/HUMAN-MC-SOP.md` — Routing Inbox
- `docs/runbooks/REPO-ONBOARDING.md` — fleet + routing enrollment
- `config/integrations.yaml` — `mc-routing` declaration
- `TOOLS.md` — tool surface row
