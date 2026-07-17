# First-Class Architecture — P6 Evidence Report

> **Generated, non-authoritative consumer.** Canonical architecture remains in
> `AGENTS.md` and `docs/modules/*`. This bundle records dual-audience spot-check
> evidence and Success Criteria verdicts for the first-class architecture
> project closeout (P6).

## Verdict

| Criterion | Result | Notes |
|-----------|--------|-------|
| SC1 — Production hosting documented | **pass** | `AGENTS.md` Production Hosting table + diagram footers cite Vercel `plx-mission-control` @ `https://mc.plxcustomer.io`; MCP/swarm operator-local |
| SC2 — Maintained diagram pack | **pass** | `docs/architecture/*.{mmd,svg}` + README regen contract; delta current / P11 deferred; no "hosting unknown" |
| SC3 — CI parity gate | **pass** | `scripts/check-architecture-diagrams.py` wired in preflight (P3 merge) |
| SC4 — In-app Architecture screen | **pass** | `/?screen=architecture`; PLX DS; view switcher; generated-consumer disclosure (P4) |
| SC5 — Nav + command palette + e2e | **pass** | System of record sidebar + palette entry + route registry (P4) |
| SC6 — Discoverability links | **pass** | `AGENTS.md` Runtime + Architecture table and root `README.md` link to screen + `docs/architecture/` |
| SC7 — Knowledge Hub seed | **pass** | `knowledge-entry.json` derived/generated_consumer; provenance panel (P5 thin slice — not full hub) |
| SC8 — Dual-audience spot-check | **pass** | This bundle: `technical-review.md` + `nontechnical-review.md`; five invariants recoverable |
| SC9 — Integration PR + pre-push | **pending** | P6 branch only; integration PR to `main` is follow-on orchestrator work |

## Five invariants (recoverable)

Both proxy reviews confirm all five architecture invariants are recoverable from
the in-app Architecture screen and maintained diagram pack:

1. Everything resolves to a Task
2. SharePoint is SoR; Postgres is separate operational store
3. Web/sync boundary preserves authority (generated consumer disclosure)
4. Routing deterministic; MCP/swarm controlled / operator-local
5. Checkout, completion, audit, and evidence traceable

## Generated-consumer authority

Diagrams and the in-app catalog are **generated consumers** — when they disagree
with `AGENTS.md` or module contracts, **the docs win**. Hub seed
(`knowledge-entry.json`) is `derived` / `generated_consumer` only; Git remains
canonical. No second system of record.

## Hosting resolved

Production hosting is documented (not unknown): Vercel deploy @
`https://mc.plxcustomer.io`; PLX-MC MCP stdio and agentic swarm are
operator-local and not part of the Vercel deploy.

## Knowledge Hub (TASK-477 thin slice)

P5 landed hub-compatible seed + in-app provenance panel only. Full
multi-collection hub UI and live Second Brain ingest remain deferred per
`docs/architecture/KNOWLEDGE-HUB-HANDOFF.md`.

## Acceptance (P6)

```text
rg -n "screen=architecture|docs/architecture" AGENTS.md README.md
test -f artifacts/platform/*-first-class-architecture/REPORT.md
python scripts/check-architecture-diagrams.py
./scripts/preflight.sh --mode pre-push
```

## Delivery

- MC task: TASK-501
- Checkout: `MC-Checkout: dsp_mrozcfc51hd10o`
- Human owner: Vince
- Phase branch: `proj/first-class-architecture/phase-6-discoverability`
