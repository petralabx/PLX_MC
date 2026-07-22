# Sweep + self-check SLO baseline (TASK-498)

**Date:** 2026-07-22
**MC-Checkout:** `dsp_mrw4askd1tb0lz` (TASK-498)
**Scope:** measurement-only production baseline before P11 — no runtime instrumentation

## Files

| File | Purpose |
|---|---|
| `measure.mjs` | Sequential sampler (concurrency 1, exit on first failed observation) |
| `percentiles.mjs` | Deterministic nearest-rank p50/p95 |
| `_verify.mjs` | Recompute + hygiene checks on stored samples |
| `meta.json` | Window + schedule metadata (no secrets) |
| `sweep-samples.json` | Sanitized freshness-advance proxy samples |
| `self-check-samples.json` | Sanitized self-check samples |
| `summary.json` | Aggregated latency summary |
| `REPORT.md` | Human-readable baseline + proposed thresholds |
