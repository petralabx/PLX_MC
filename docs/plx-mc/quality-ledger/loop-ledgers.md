# Loop Ledgers — quality ledger

**Module:** loop-ledgers  
**Schema:** vmc-quality-ledger/v1  
**Generated:** 2026-06-23  
**Branch:** proj/loop-ledger  

Read-only cross-repo hardening-ledger observatory inside PLX Mission Control.
Three artifacts track the core operator promises; all are **verified** with committed
`.txt` evidence under `evidence/`.

## Summary

| Metric | Count |
|---|---|
| Total artifacts | 3 |
| Verified | 3 |
| Critical / red safety | 0 |

## Artifacts

### LL-001 — Cross-repo index before hardening loops

Operator sees all loop ledgers across configured repos in scariest-first order,
with stat cards and a detail drill-down. Routes: `GET /api/loop-ledgers`,
`GET /api/loop-ledgers/[ref]`.

**Evidence:** `evidence/ll-route.txt`, `evidence/ll-ui.txt`, `evidence/ll-e2e.txt`

### LL-002 — Degraded sources stay visible and loud

Missing, stale, invalid, unreachable, permission-denied, and empty-glob sources
render as degraded rows in the index and in the degraded gallery tab — never
filtered out. Adapter contract tests cover distinct failure reasons.

**Evidence:** `evidence/ll-adapters.txt`, `evidence/ll-e2e.txt`

### LL-003 — No mutation affordances

API routes expose GET only (route tests assert no mutating methods). The MC screen
has no sync, repair, rerun, or edit controls (Playwright E2E asserts absence).

**Evidence:** `evidence/ll-route.txt`, `evidence/ll-e2e.txt`

## Validator evidence

Core `vmc-quality-ledger/v1` invariant tests (46 cases): `evidence/ll-validator.txt`
