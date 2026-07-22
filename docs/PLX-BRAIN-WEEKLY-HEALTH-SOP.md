# SOP — Weekly Second Brain health triage

**Audience:** operators
**Owner:** Vince · **Status:** active · **Effective:** 2026-07-22

> **TL;DR** — Every Monday, spend ~10 minutes (ET) checking eval, lint, cron
> watchdog, and ingest freshness. Follow alert playbooks when red; add monthly
> noise quarantine and session-artifact replay on the first Monday.

## Purpose

Catch Second Brain drift early — retrieval quality, lint health, cron liveness,
and ingest freshness — before agents trust a silent failure.

This file is a **pointer summary**. Full playbook is canonical in
`petralabx/agentic-swarm`. Times below are **Eastern Time** (`America/New_York`).

## Monday checklist (~10 min)

| # | Check | Where | Green criteria |
|---|---|---|---|
| 1 | Weekly eval | GitHub Actions `second-brain-eval-weekly.yml` | Latest run green; floors in eval scorecard (P@5 ≥ 0.79, R@10 ≥ 0.75, etc.) |
| 2 | Lint health | `GET /api/vmc/second-brain/health` | Latest `kb_lint_report` green; stale/orphan flat or falling |
| 3 | Cron watchdog | `second-brain-cron-watchdog` (:15/:45 hourly) | No alerts (≥2 consecutive error rows fires) |
| 4 | Ingest status | `GET /api/vmc/second-brain/ingest-status` | Recent `lastSuccessAt`; no unexpected `lastErrorAt` |

## Alert playbooks (summary)

| Signal | First move |
|---|---|
| Eval red | Reproduce with `npx tsx eval/second-brain/harness.ts --mode=score`; diff `baseline.json`; never re-freeze baseline just to go green |
| Lint red | Inspect stale/orphan counts; superseded auto-archive is ingest-side — rising stale despite archive means investigate ingest |
| Watchdog | Check ingest-status last-10 runs; `skipReason: "<FLAG> is not set"` is expected pre-activation, not an error |
| Ingest stale | Confirm flags / crontab / `vmc-cron-runner.sh` logs |

## Monthly extras

- Noise quarantine (dry-run then `--apply`):
  `PYTHONPATH=. python scripts/knowledge/quarantine_noise_chunks.py`
- Offline session-artifact replay:
  `python scripts/cursor-hooks/replay-session-artifacts.py --apply`

## Exit criteria

- [ ] Eval status known (green or ticketed)
- [ ] Lint not silently red
- [ ] Watchdog / crons accounted for
- [ ] Ingest freshness acceptable or escalated
- [ ] (Monthly) quarantine + artifact replay considered

## Canonical source

Authoritative SOP (edit there, not here):

- https://github.com/petralabx/agentic-swarm/blob/main/docs/knowledge-os/SOP_WEEKLY_HEALTH_TRIAGE.md

Related (agentic-swarm): `eval/second-brain/README.md`,
`docs/runbooks/second-brain-freshness-alerting.md`,
`docs/runbooks/second-brain-activation.md`.
