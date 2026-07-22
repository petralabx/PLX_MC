# SOP — Department-scoped API key provisioning

**Audience:** operators provisioning P10 department-scoped knowledge API keys
**Owner:** Vince · **Status:** active · **Effective:** 2026-07-22

> **TL;DR** — Put dept keys in `VMC_SCOPED_API_KEYS`, verify **403** on explicit
> over-ask, and remember: auth is **not** isolation until `ctx.keyGrant` is wired
> on knowledge read routes (TASK-541).

## Purpose

Provision department-scoped API keys so MCP clients and automation can call
Knowledge OS under a `dept/<id>` grant (plus listed projects), without handing
out the legacy unscoped `VMC_API_KEY`.

This file is a **pointer summary**. Policy detail:
[`KEY_TIERS.md`](https://github.com/petralabx/agentic-swarm/blob/main/docs/knowledge-os/KEY_TIERS.md)
in agentic-swarm. Full provisioning steps are canonical there too.

## Registry

Secret: `VMC_SCOPED_API_KEYS` (same contract as `VMC_API_KEY` — env /
`~/.secrets-env` / AWS SM via `getSecret`). JSON array. **No hardcoded keys.**

```json
[
  {
    "key": "<opaque-secret>",
    "scope": "dept/trading",
    "projects": ["trading-v2-agentic-module"]
  }
]
```

- `scope` must be `dept/<id>` where `<id>` is a `config/departments.yaml` id
  (`dev`, `research`, `qa`, `ops`, `trading`, `manufacturing`).
- Malformed rows are skipped fail-closed (bad row grants nothing).

## Provisioning steps

1. Generate a strong opaque secret.
2. Append the entry to `VMC_SCOPED_API_KEYS` in AWS Secrets Manager.
3. Restart `vmc-web.service` so env is re-read.
4. Verify with the new key as `X-API-Key` or `Authorization: Bearer`:
   - Omit namespace filter → silently scoped to the grant (empty OK).
   - Explicit out-of-grant namespace → **403 FORBIDDEN**.
   - Personal items stay excluded / not-found-style.

## CRITICAL caveat — not an isolation boundary yet

Until knowledge **read routes** wire `ctx.keyGrant` into namespace helpers
(`resolveReadScopes`, `constrainRequestedNamespaces`,
`buildKeyGrantNamespacePredicate`), department keys **authenticate but may still
see the legacy non-personal surface**.

**Do not** hand dept keys to external MCP clients as multi-tenant isolation
until that wiring lands. Tracked as **TASK-541**.

## Rollback

Remove or empty `VMC_SCOPED_API_KEYS`, restart `vmc-web.service` — only legacy
`VMC_API_KEY` remains.

## Canonical source

Authoritative SOP (edit there, not here):

- https://github.com/petralabx/agentic-swarm/blob/main/docs/knowledge-os/SOP_DEPT_KEY_PROVISIONING.md

Policy companion:

- https://github.com/petralabx/agentic-swarm/blob/main/docs/knowledge-os/KEY_TIERS.md
