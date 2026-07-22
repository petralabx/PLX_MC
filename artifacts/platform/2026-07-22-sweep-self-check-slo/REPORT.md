# Sweep + self-check SLO baseline (TASK-498)

**Date:** 2026-07-22
**MC-Checkout:** `dsp_mrw4askd1tb0lz` (TASK-498)
**Production host:** `https://mc.plxcustomer.io`
**Scope:** measurement-only baseline before P11 — no runtime instrumentation, cadence change, or provider integration

## Verdict

Production latency baseline captured in a single sequential window. All 30 direct self-check requests returned HTTP 2xx. Each of the 12 sweep-proxy samples observed a 2xx self-check response with a newer inbound watermark; no `/api/cron/sweep` HTTP response status was observed in proxy mode. `_verify.mjs` recomputes p50/p95 deterministically from sanitized JSON.

## Count / window / method

| Parameter | Value |
|---|---|
| Window target | 55 minutes (`3,300,000 ms`) |
| Window actual | 55.1 minutes (`3,304,892 ms`) |
| Started | `2026-07-22T13:58:30.898Z` |
| Finished | `2026-07-22T14:53:35.791Z` |
| Concurrency | 1 (strict sequential schedule) |
| Stop policy | Exit on first failed observation |
| Sweep samples | 12 at 5-minute spacing (`offsetMs` 0 … 3,300,000) |
| Self-check samples | 30 evenly spaced across the same window |
| Percentile method | Nearest-rank on ascending `durationMs` |

### Sweep measurement transport

Workstation direct `Authorization: Bearer $CRON_SECRET` returned **401** against live production. The cause was not established; possible explanations include a local secret mismatch or edge authorization behavior. Scheduled platform cron remains healthy (`mc_self_check` fresh, `boringGateMet=true`).

Sweep samples therefore use **authorized** `vercel crons run /api/cron/sweep` plus **self-check inbound freshness advance** as completion proxy (`meta.sweepTransport=vercel-trigger-self-check-completion`). This measures elapsed time from trigger request to an oracle-observed freshness advance, not the route's HTTP wall time. The sweep sample `status` is the actual self-check HTTP status at that observation, not a synthesized sweep-route status.

Self-check samples are direct `GET /api/cursor/self-check` (MCP API key + operator headers).

## Results

| Endpoint | n | min | p50 | p95 | max |
|---|---:|---:|---:|---:|---:|
| Sweep freshness-advance proxy | 12 | 4,236 ms | **4,467 ms** | **5,163 ms** | 5,163 ms |
| `/api/cursor/self-check` | 30 | 98 ms | **206 ms** | **629 ms** | 2,246 ms |

Raw sanitized samples: `sweep-samples.json`, `self-check-samples.json`. Aggregates: `summary.json`.

## Proposed warning + critical thresholds (pre-P11)

Formula (deterministic, applied to measured p95): `warning = ceil(p95 × 1.2)`, `critical = ceil(p95 × 1.5)`.

| Signal | Baseline p95 | Warning | Critical | Notes |
|---|---:|---:|---:|---|
| Sweep freshness-advance proxy | 5,163 ms | **6,196 ms** | **7,745 ms** | Route `maxDuration=60s`; direct GET baseline may differ once bearer auth works from operator network |
| Self-check | 629 ms | **755 ms** | **944 ms** | Includes DB + Graph probe work; not a functional SLO |

Treat as **latency envelopes** for observability scaffolding — not error-rate or freshness SLOs. Conflict/freshness gates remain separate (`SOUL.md`, boring gate).

## Limitations

1. **Single egress path** — one workstation session; no multi-region sampling.
2. **Trigger attribution** — twelve authorized cron triggers ran during the normal five-minute schedule. A concurrent scheduled sweep could produce the observed watermark advance, so this baseline is an oracle-observed freshness envelope, not exclusive attribution to each manual trigger.
3. **Sweep bearer gap** — external bearer auth failed (401); completion proxy used instead of full GET wall time until workstation secret matches deployed runtime or edge allows bearer.
4. **Self-check tail** — one sample at 2,246 ms (still 2xx); p95 remains 629 ms; monitor tail separately if alerting on max.
5. **No secrets in repo** — auth hydrated from session-only sources; sample JSON contains timestamp/status/duration only.

## Verification

```text
node artifacts/platform/2026-07-22-sweep-self-check-slo/_verify.mjs  → PASS
python scripts/check-repo-hygiene.py                                   → PASS (after REPORT.md)
```

## Follow-ups (out of scope — parent / TASK-499)

- Reconcile workstation `CRON_SECRET` with deployed runtime for direct GET sweep timing.
- Wire thresholds into P11 observability after mirror-is-boring gate review.
