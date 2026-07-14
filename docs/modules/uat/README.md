# Module: uat

## What

The UAT (User Acceptance Testing) parity surface tying the three repos together
around go-live testing. It is **not** new runtime code in MC — it is the contract
that makes UAT visible and consistent across `plx-customer-portal` (where UAT is
executed and recorded), `agentic-swarm` (where agents run UAT via a skill), and
`PLX_MC` (where UAT posture surfaces under `BKT-UAT`). MC stays read-only over the
portal's committed UAT ledger; it does not author or mutate UAT results.

## Why

Before this, UAT was lopsided (scoping Axis B): the portal carried the real UAT
surface (SOP, test-data tooling, a UAT Feedback SharePoint list), `PLX_MC` had only a
placeholder `BKT-UAT` bucket, and `agentic-swarm` had no live UAT capability (only
archived reports). There was no single, consistent way to see UAT progress or have an
agent run UAT and have it land in the same governed record. This module declares the
one model so the three repos cannot drift.

## How

Pull-based, mirroring the loop-ledgers contract (no portal→MC push):

```
plx-customer-portal                 agentic-swarm                 PLX_MC
  docs/portal/quality-ledger/         .cursor/skills/uat-runner/    BKT-UAT (bucket)
    uat.artifacts.json   <─ writes ──   (runs UAT cases,             + tasks/milestones
    (vmc-quality-ledger/v1)             writes evidence)              (M-6 Parallel
        │                                                              System Testing,
        │  pulled via GitHub API (loop-ledgers GithubApiSource)       M-7 Go-Live)
        ▼                                                                  ▲
  PLX_MC loop-ledgers module → /api/loop-ledgers → MC dashboard ──────────┘
```

1. **Portal publishes** a `uat` module in its quality-ledger
   (`docs/portal/quality-ledger/uat.artifacts.json`, schema `vmc-quality-ledger/v1`
   — see `docs/templates/quality-ledger/`). One artifact per UAT area/case, with
   evidence. *(Lands behind operator approval — portal is a separate go-live repo.)*
2. **Swarm runs UAT** via the `uat-runner` skill (`agentic-swarm/.cursor/skills/uat-runner/`),
   which executes UAT scenarios and writes results/evidence into that portal ledger
   (and checks out the MC task via the PLX-MC MCP, so the run is governed).
3. **MC surfaces it**: the portal `uat` ledger appears in the Loop Ledgers screen; the
   `BKT-UAT` initiative carries the go-live milestones (`M-6`, `M-7`) and parallel
   testing tasks. No new MC ingest code — it rides the existing pull.

Invariant: UAT results have **one** system of record (the portal ledger / its
SharePoint UAT Feedback list); MC and swarm are a read lens and a runner, never a
second source of truth. The same pull-based pattern is generalized for other
initiative buckets via **bucket projection** — see `docs/modules/loop-ledgers/README.md`
§ Bucket projection.

## Dependencies

- `loop-ledgers` (MC) — reads the portal `uat` ledger via the registry.
- `mcp` (PLX-MC) — the swarm `uat-runner` checks out / completes the MC task.
- `plx-customer-portal` — owns UAT execution, the `uat.artifacts.json` ledger, the
  UAT Feedback SharePoint list, and `scripts/create-uat-test-customers.ts`.

### Key Files

- `docs/modules/uat/README.md` — this contract.
- `config/loop-ledgers-registry.json` — the portal row whose ledger glob includes `uat.artifacts.json`.
- `src/lib/mc-data/data.ts` — `BKT-UAT` initiative + `M-6`/`M-7` milestones.
- (portal) `docs/portal/quality-ledger/uat.artifacts.json` — UAT ledger source (G-PORTAL).
- (swarm) `.cursor/skills/uat-runner/SKILL.md` — the UAT runner skill.

## Owner

Vince

## Criticality

Medium — UAT gates go-live; if the parity contract breaks, UAT progress becomes
invisible or inconsistent across repos, but no production runtime path depends on it.
