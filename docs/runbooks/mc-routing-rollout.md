# Runbook: MC Commit/PR Routing Rollout

**Audience:** operators enabling routing pilots, responding to metric breaches,
or killing a routing surface.  
**Owner:** Vince · **Effective:** 2026-07-14  
**Module:** `docs/modules/routing/README.md` · **Declaration:** `config/integrations.yaml` → `mc-routing`

> This project delivers **central runtime + generated artifacts**. It does **not**
> claim downstream activation in `plx-customer-portal`, `agentic-swarm`, `skills`,
> or `local-inference` — those need separate activation PRs / MC follow-up tasks.

---

## 1. Modes

| Mode | Behavior |
|------|----------|
| **shadow** | Score/persist metrics; no visible suggestions; no mutation |
| **suggestion** | MCP / checkout / workflow summary / deep links; no auto-link |
| **confirmation** | Authorized confirm / attach / Task create (exact/credentialed trust only) |

Configured per pilot in `config/routing-pilots/*.json`. Default for all five
pilots: **shadow**. Rolling-window breach demotes **confirmation → suggestion**.

**Fuzzy auto-link is disabled for every pilot** and cannot be promoted by this
project (`src/lib/routing/rollout.ts` + `FUZZY_AUTOLINK_ENABLED=false`).

---

## 2. Pilots

| Cohort | Repo | Activation |
|--------|------|------------|
| `plx-mc` | `petralabx/PLX_MC` | `central_ready` — local manifest `.plx/mc-routing.json` |
| `plx-customer-portal` | `petralabx/plx-customer-portal` | `pending_downstream_pr` |
| `agentic-swarm` | `petralabx/agentic-swarm` | `pending_downstream_pr` |
| `skills` | `petralabx/skills` | `pending_downstream_pr` |
| `local-inference` | `petralabx/local-inference` | `pending_downstream_pr` |

Central config: `config/mc-routing-rollout.json`.  
Workflow template: `docs/templates/mc-routing-manifest.json` →
`.github/plx-mc-routing-manifest.json` via scaffold.

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
| `PLX_MC_GRAPH_WEBHOOK_ENABLED` | `0` | Disable subscriptions; keep 5-min delta recovery |
| `PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED` | `0` | Admission-only until centralized auth is on |

Emergency stop for writers: set `PLX_MC_ROUTING_CONFIRM_ENABLED=0` and
`PLX_MC_ROUTING_PROPOSALS_ENABLED=0`, then investigate. Do **not** re-enable
sparse operator-PR Task creation.

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
rolloutHealth(); // pilots===5, fuzzyAutoLinkEnabled===false
```

- MCP: `mc_self_check`
- Inbox: UI hidden when `PLX_MC_ROUTING_INBOX_ENABLED != 1`
- Cron: 503 if `CRON_SECRET` unset; 401 on bad bearer; 403 if principal missing
  under permissions enforcement

---

## 7. Fallback and sparse retirement

| Failure | Fallback |
|---------|----------|
| Confirm breached / kill switch | Suggestion-only for that cohort |
| Proposals disabled | Explicit triage/audit row — **no** silent Task |
| Metadata disabled | Compliance gate unchanged |
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

## 9. Downstream activation checklist

For each pending pilot:

1. MC follow-up task exists (activation PR owner + done-when)
2. Central descriptor `enabled: true`, `fuzzyAutoLinkEnabled: false`
3. Scaffold metadata workflow + routing manifest in the consumer repo
4. OIDC allowlist / secrets verified
5. Live health evidence recorded
6. Only then flip cohort mode beyond shadow

Generated evidence for the central delivery:
`artifacts/platform/2026-07-14-commit-pr-mc-routing/`.

---

## 10. Related

- `docs/AGENT-PR-SOP.md` — agent suggest / markers
- `docs/HUMAN-MC-SOP.md` — Routing Inbox
- `docs/runbooks/REPO-ONBOARDING.md` — fleet + routing enrollment
- `config/integrations.yaml` — `mc-routing` declaration
- `TOOLS.md` — tool surface row
