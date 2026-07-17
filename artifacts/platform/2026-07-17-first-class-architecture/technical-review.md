# Technical proxy review (P6 closeout)

> Generated, non-authoritative consumer. Canonical architecture remains in
> `AGENTS.md` and `docs/modules/*`.

## Review scope

Spot-check against the shipped first-class architecture surface (P1–P5) plus
P6 discoverability links. Sources: in-app `/?screen=architecture`, maintained
pack under `docs/architecture/`, and canonical docs.

## Verdict

**PASS** — all five required invariants are recoverable from the Architecture
screen, diagram footers, and linked module contracts.

## Five invariants

1. **Everything resolves to a Task — YES.** Context/containers center Task as
   the central work item; MCP manages checkout/progress/completion; Task links
   SharePoint, audit, and GitHub delivery.
2. **SharePoint is SoR; Postgres separate — YES.** SharePoint labeled official
   Task record; Postgres in a separate operational data store boundary; no
   merged authority node.
3. **Web/sync boundary preserves authority — YES.** People → web workspace →
   sync ↔ SharePoint; sync maturity honest (delta current; Graph
   change-notifications deferred P11); generated-consumer disclosure on screen
   and in pack README.
4. **Routing deterministic; MCP/swarm controlled — YES.** Routing described as
   rule-based suggestions requiring fresh sync data; MCP opt-in agent tool
   interface; swarm external/operator-local, not inside Vercel deploy.
5. **Checkout, completion, audit, evidence traceable — YES.** MCP → task
   lifecycle; task → audit/evidence; task → GitHub delivery records; lifecycle
   view footer states interaction map, not runtime sequence.

## Authority model

- **Generated-consumer authority:** diagrams and in-app SVG catalog are derived
  consumers; `docs/architecture/README.md` and screen disclosure state docs win
  on conflict.
- **Hosting resolved:** footers and `AGENTS.md` cite Vercel @
  `mc.plxcustomer.io`; no "Production hosting unknown".
- **Hub seed thin slice:** `knowledge-entry.json` is discovery metadata only
  (`derived`, `generated_consumer`); full Knowledge Hub product deferred.

## Residual notes

- Integration PR to `main` (SC9) is orchestrator follow-on, not P6 branch scope.
- Optional human spot-check on production URL after integration merge recommended.
