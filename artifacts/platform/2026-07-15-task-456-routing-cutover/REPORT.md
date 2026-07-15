# TASK-456 — GitHub routing configuration and live cutover

## Verdict
DONE with capability matrix. Public repos consume selected-repository organization variables. Private portal Actions did not consume org selected vars on GitHub org plan `free` (job skipped while selected); approved **repo-level fallback** proven with live proposal acceptance. Central production redeployed and healthy. Canaries closed unmerged. Confirm/fuzzy remain off. No downstream activation PRs opened.

## Checkouts
| Task | Checkout | Repo scope |
|------|----------|------------|
| TASK-456 | `dsp_mrm79dtiblefim` | petralabx/PLX_MC |
| TASK-460 (portal canary) | `dsp_mrm83u54vz227q` | petralabx/plx-customer-portal |

Accountable owner: vince@petrasoap.com

## Org capability
| Item | Result |
|------|--------|
| Org plan | `free` (exposed via API) |
| Admin account | taylorvalton (keyring OAuth) |
| Scopes used | admin:org, repo, workflow (token not printed) |
| Selected-repo org vars API | Available |
| Org vars created | PLX_MC_BASE_URL, PLX_MC_ROUTING_METADATA_ENABLED (visibility=selected) |
| Private Actions org-var consumption | **Unavailable in practice** (selected membership true; workflow `if` skipped) |
| Fallback | repo-level vars on portal; legacy URL secret unchanged |

## Capability matrix (sanitized)

| Repo | Visibility | Selected | Effective source | Run ID | Expected | Observed | Notes |
|------|------------|----------|------------------|--------|----------|----------|-------|
| petralabx/PLX_MC | public | yes | org selected | 29427125494 | job runs, consumes BASE_URL | success; MC_BASE_URL set | after new deploy |
| petralabx/PLX_MC | public | yes | repo override 0 | 29427219322 | skip | skipped | override proof |
| petralabx/PLX_MC | public | yes | org inheritance restored | 29427311823 | job runs | success | restore proof |
| petralabx/plx-customer-portal | private | yes | org selected (attempt) | 29427383273 / 29427471336 | run | skipped | org runtime not consumed |
| petralabx/plx-customer-portal | private | n/a | **repo fallback** | 29427532483 | run + submit | success; proposal `rpp_petralabx_plx-customer-portal:209` | fallback path |
| petralabx/plx-customer-portal | private | n/a | repo override 0 | 29427607779 | skip | skipped | override proof |
| petralabx/test-perms-check | public | **no** | none | n/a | no org routing vars | selected=false; repo vars count=0 | non-selected denial |

## OIDC allowlist (exact)
- petralabx/PLX_MC
- petralabx/plx-customer-portal
- petralabx/agentic-swarm
- petralabx/skills
- petralabx/local-inference
- petralabx/1hr-after
- petralabx/furgenics
- petralabx/for-and-against

No wildcard / sandbox / test-perms-check.

Org Actions selected membership expanded to the same eight after canaries. test-perms-check excluded.

## Vercel Production (names/scopes)
Environment: Production · project: plx-mission-control

Flags (verified via env pull):
- PLX_MC_ROUTING_SHADOW_ENABLED=1
- PLX_MC_ROUTING_SUGGEST_ENABLED=1
- PLX_MC_ROUTING_INBOX_ENABLED=1
- PLX_MC_ROUTING_PROPOSALS_ENABLED=1
- PLX_MC_ROUTING_METADATA_ENABLED=1
- PLX_MC_ROUTING_MAINTENANCE_ENABLED=1
- PLX_MC_ROUTING_CONFIRM_ENABLED=0
- PLX_MC_ROUTING_FUZZY_AUTOLINK_ENABLED=0

OIDC: COMPLIANCE_OIDC_ENABLED=1; audience plx-mc-compliance-verify; allowlist exact eight above.

Not modified: permissions enforcement, Graph/webhook, SharePoint/sync, unrelated secrets.

## Deployments
| Role | ID | State | Domain |
|------|----|-------|--------|
| Previous (rollback) | dpl_CvqG6WEpjrU9TCceeumNkw21dfXX | READY (preserved) | — |
| New | dpl_2s42C7kwHPYdwG7jw7LVeWSbbxSY | READY | https://mc.plxcustomer.io |

Source: petralabx/PLX_MC @ main / `4b8a0f185cc8c0e8902711795f0d85af5382cc80`  
Provenance: manual `vercel deploy --prod` from clean detached worktree; gitSource/meta null.

## Live health
- mc_self_check: ok (mcpEnabled=true)
- Routing Inbox API `GET /api/routing/inbox` authenticated: HTTP 200; counts personal=0 project=11 bucket=11 unrouted=0
- Compliance: remained active on canary PRs (gate ran; agent canaries blocked for missing evidence summary — expected for draft canaries)
- Confirm/fuzzy: remain 0

## Canary cleanup
- Closed unmerged: PLX_MC#137, portal#209
- Branches deleted via `gh pr close --delete-branch`
- Deploy worktree removed
- No TASK-448/449/450/453/454/455 activation PRs opened

## Actions run URLs
- https://github.com/petralabx/PLX_MC/actions/runs/29427125494
- https://github.com/petralabx/PLX_MC/actions/runs/29427219322
- https://github.com/petralabx/PLX_MC/actions/runs/29427311823
- https://github.com/petralabx/plx-customer-portal/actions/runs/29427532483
- https://github.com/petralabx/plx-customer-portal/actions/runs/29427607779
