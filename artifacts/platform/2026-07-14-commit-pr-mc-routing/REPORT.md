# REPORT — Commit/PR MC Routing (central runtime)

**Bundle:** `artifacts/platform/2026-07-14-commit-pr-mc-routing/`  
**Date:** 2026-07-14  
**Owner:** Vince  
**MC:** TASK-446 (P10 rollout) · project `commit-pr-mc-routing`

> **Historical evidence:** this report records the original five-pilot central
> delivery as of 2026-07-14. It is not the current eight-repo fleet activation
> ledger; later fleet evidence must live in a new dated bundle.

## Verdict

Central PLX_MC routing runtime, pilot descriptors, rollout thresholds, retention
maintenance cron, SOPs, kill switches, and PLX_MC local manifest are delivered
in this project. **Downstream activation is not claimed** — follow-up MC tasks
cover activation PRs in `plx-customer-portal`, `agentic-swarm`, `skills`, and
`local-inference`.

## What shipped (P10)

| Area | Path / note |
|------|-------------|
| Rollout engine | `src/lib/routing/rollout.ts` — modes, metrics, Wilson CI, demotion |
| Retention | `src/lib/routing/retention.ts` — expire detail/provisional; preserve links/audit |
| Maintenance cron | `src/app/api/cron/routing-maintenance` + `vercel.json` (keeps Graph crons) |
| Thresholds | `config/mc-routing-rollout.json` (300/30d/5 repos/20 cohort/98%/95% CI/0.5%/1%/0) |
| Pilots | `config/routing-pilots/*` (five cohorts; fuzzy off; PLX_MC `central_ready`) |
| Local manifest | `.plx/mc-routing.json` |
| Integration declaration | `config/integrations.yaml` → `mc-routing` |
| SOPs / runbooks | AGENT/HUMAN SOPs, REPO-ONBOARDING, `mc-routing-rollout.md` |
| Module ownership | `AGENTS.md` + `TOOLS.md` |
| Tests | `tests/routing-rollout.test.ts`, `tests/routing-retention.test.ts` |

## Hard invariants verified in tests

1. Fuzzy auto-link forced off (env flip ignored)
2. Rolling-window breach demotes confirmation → suggestion-only
3. Final links / audit never expired by retention planner
4. Five pilots enrolled; only PLX_MC marked `central_ready`

## Deferred

- GitHub App `checks:write` / requested actions
- Fuzzy auto-link promotion (separate approved precision campaign)
- Downstream repo activation PRs

## Gates

See `index.md` for command evidence. Acceptance target:

```bash
npx vitest run tests/routing-rollout.test.ts tests/routing-retention.test.ts
./scripts/preflight.sh --mode pre-push
python scripts/check-repo-hygiene.py
```

**Hardener (integration tip `20b97ca`):** session-brain hygiene exemption, Playwright routing-inbox env flags, brand-parity `__file__` repo-root, and `workers: 1` landed. Policy/lint/typecheck/pytest/vitest/build green. Routing-inbox e2e 4/4. Full Windows Playwright suite: **201 passed / 1 flaky** (`tablet` cmdk `page.goto` timeout) that **passed in isolation** — documented as Medium irreducible residual in `.orchestrator/commit-pr-mc-routing/hardener/RESIDUALS.md` (not Critical/High; not routing-invariant).

## Follow-up MC tasks (downstream activation)

| Task | Repo |
|------|------|
| TASK-447 | plx-customer-portal |
| TASK-448 | agentic-swarm |
| TASK-449 | skills |
| TASK-450 | local-inference |