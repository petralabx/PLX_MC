---
project: ds-gov-cloud-enforcement
created: 2026-07-24T11:52:30Z
status: approved
approved_by: Vince
approved_at: 2026-07-24T12:01:00Z
model_plan:
  planner: frontier-orchestrator
  builder: frontier-orchestrator
  mechanical: local-coder
  critic: frontier-orchestrator
budget:
  max_parallel_phases: 2
  max_attempts_per_phase: 3
  time_budget_min: 0
mc:
  bucket: BKT-MISSION-CONTROL-OPS
  tasks:
    planning: TASK-681
    cloud_wiring: TASK-682
    portal_p1: TASK-683
    mc_p2: TASK-684
    p3_hold: TASK-685
  checkout_planning: dsp_mryvrl8gj222kz
  checkout_cloud_wiring: dsp_mryw4pv5w1uabx
---

# Design System + Governance Cloud Enforcement

## Mission

Make PLX design-system and governance contracts actually bind Cursor Cloud Agents: first by wiring Cloud so existing fleet contracts are always reachable (MC checkout + thin governance slice + PLX-MC MCP), then by shipping the still-proposed design-system authority package and consumer pin/parity machine so adoption is versioned, auditable, and CI-enforced — without forcing PLX portal tokens onto intentional opt-out repos.

## Success Criteria

- [ ] Fresh Cloud Agent run always-applies a thin fleet governance/MC-checkout slice (not only ad hoc cross-repo ops rules)
- [ ] Cloud Agent environment can call `mc_self_check` / `mc_checkout_task` with kill switch intact (swarm dispatch stays default-OFF)
- [ ] Portal ships versioned `design-system/` authority package (ADR-005) with integrity-hashed `manifest.json` + release gate
- [ ] PLX_MC records adoption via `plx-brand.json` pin + sync/parity preflight (existing BrandBoundary / no-raw-hex gates remain)
- [ ] Opt-out repos (e.g. `local-inference`) keep recorded non-adoption; no portal-token blast radius
- [ ] P3 adopt/decline automation stays blocked until Vince locks semver + auto-adopt policy
- [x] This SPEC is human-approved before execute phases start (Vince, 2026-07-24)

## Scope

- In:
  - Cloud/team always-apply rule slice + PLX-MC MCP enablement in Cloud env (ops track)
  - Portal authority package + release gate (code track P1; separate portal PR / orchestrator run)
  - PLX_MC consumer pin + sync/parity (code track P2; separate MC PR / orchestrator run)
  - Open ADR decision capture (release channel, cross-repo auth, semver, auto-adopt)
- Non-goals:
  - Single mega PR across portal + MC + Cloud dashboard
  - Enabling swarm dispatch in Cloud by default
  - Forcing `--p-*` tokens onto brand sites / `local-inference`
  - Starting P3 auto-adopt before P1/P2 proof and policy lock
  - Creating MC Project/Bucket via MCP (UI-only; tasks live under `BKT-MISSION-CONTROL-OPS`)

## Open decisions (human lock before P3; preferred defaults for P1/P2)

| Decision | Options | Proposed default |
|---|---|---|
| Release channel | `staging` vs `main` | `staging` (matches current MC handoff provenance) |
| Cross-repo auth | GitHub App vs fine-grained PAT | GitHub App (least privilege) |
| Semver for tokens | major=remove/rename; minor=add; patch=value tweak | Yes — document in ADR-005 |
| Agent auto-adopt | human-gate all → later patch/minor auto | Human-gate all for P3 v1 |

## Phases

### P0 — Spec + decision lock
- deliverables: this SPEC validated; kickoff evidence bundle; MC tasks TASK-681..685 created; open decisions table filled or explicitly deferred; SPEC `status: approved` after Vince sign-off
- depends_on: []
- owns: [".orchestrator/ds-gov-cloud-enforcement/**", "artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/**"]
- forbidden: ["src/**", "portal/**", "config/governance-contract.yaml"]
- acceptance: `bash .cursor/skills/project-orchestrator/scripts/spec-validate.sh .orchestrator/ds-gov-cloud-enforcement/SPEC.md`
- role: planner
- competitive: false
- mc_task: TASK-681

### P1 — Cloud wiring (ops track)
- deliverables: documented Cloud always-apply fleet slice; Cloud env has PLX-MC MCP enabled with secrets + kill switch; verification note from a fresh Cloud run showing always-applied rules + successful `mc_self_check`
- depends_on: [P0]
- owns: ["docs/runbooks/**", "artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/**", ".cursor/mcp.json", "TOOLS.md", "AGENTS.md"]
- forbidden: ["design-system/**", "src/styles/brand-tokens.css"]
- acceptance: `test -f artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/CLOUD-WIRING-VERDICT.md`
- role: builder
- competitive: false
- mc_task: TASK-682
- notes: Cursor dashboard team-rule / environment changes may be operator-console steps; record exact settings + evidence even when not git-backed.

### P2 — Portal authority package (ADR-005)
- deliverables: portal `design-system/` package + manifest/changelog + release gate workflow + formal ADR-005; baseline v1.0.0; `consumers.yaml` seeded with PLX_MC
- depends_on: [P0]
- owns: ["../plx-customer-portal/design-system/**"]
- forbidden: ["src/**"]
- acceptance: `test -f /agent/repos/plx-customer-portal/design-system/manifest.json`
- role: builder
- competitive: false
- mc_task: TASK-683
- notes: Execute via separate project-orchestrator run / PR in `plx-customer-portal` (integration branch `staging`). Hub SPEC tracks the phase; do not merge portal tree into this PLX_MC PR.

### P3 — PLX_MC consumer pin + parity
- deliverables: root `plx-brand.json` (adopts=true, pinned version/integrity); sync script + SYNC-LOG; preflight parity against pin; BrandBoundary / raw-color gates still green
- depends_on: [P2]
- owns: ["plx-brand.json", "design-system/**", "scripts/sync-brand-from-portal.sh", "scripts/plx-ds-sync*", "scripts/check-brand-portal-parity.py", "scripts/check-mc-brand-application.py", "config/brand-portal-parity.json", "docs/design-system/**", "docs/runbooks/brand-sync-from-portal.md"]
- forbidden: ["../plx-customer-portal/design-system/**"]
- acceptance: `./scripts/preflight.sh --mode pre-commit`
- role: builder
- competitive: false
- mc_task: TASK-684
- notes: Separate PLX_MC PR after portal P2 lands.

### P4 — Adopt/decline automation (HOLD)
- deliverables: authority dispatch + consumer adopt workflow + ledger; auto-adopt policy configurable — **blocked** until open decisions locked and P2/P3 proven
- depends_on: [P1, P3]
- owns: [".github/workflows/design-system-*.yml", "docs/design-system/**", "artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/**"]
- forbidden: []
- acceptance: `test -f artifacts/platform/2026-07-24-ds-gov-cloud-enforcement/P4-UNBLOCKED.md`
- role: builder
- competitive: false
- mc_task: TASK-685
- notes: Do not start until Vince writes `P4-UNBLOCKED.md` with policy locks.

## Risks & Rollback

- Cloud always-apply too broad → opt-out repos inherit portal token rules → mitigate with explicit allow/deny by `plx-brand.json` / repo kind; keep design-token rules repo-scoped
- MCP enabled without secrets → agents fail closed / invent workarounds → mitigate with env secret injection + documented kill switch `PLX_MC_MCP_ENABLED=0`
- Authority package drifts from runtime mirrors → mitigate with integrity hashes + preflight parity before merge
- Premature P4 auto-adopt → unwanted brand changes → keep human-gate default; P4 held
- Rollback: revert Cloud env/MCP flags; leave consumer pins unchanged; close adopt PRs without merging

## Worktree Plan

- base branch: `proj/ds-gov-cloud-enforcement` (hub planning + Cloud wiring docs in PLX_MC)
- phase branches: `proj/ds-gov-cloud-enforcement/phase-<k>-<name>`
- integration branch: `proj/ds-gov-cloud-enforcement/integration` (hub only)
- delivery: **not** one mega PR — hub kickoff/wiring PR(s) in PLX_MC; portal authority PR on `staging`; consumer pin PR in PLX_MC after portal lands
- kickoff branch (this delivery): `cursor/ds-gov-cloud-enforcement-kickoff-4f06`
