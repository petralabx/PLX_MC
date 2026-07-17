# P5 — Knowledge Hub architecture seed (TASK-477 thin slice)

## Branch
`proj/first-class-architecture/phase-5-hub-seed`

## Base
`proj/first-class-architecture/phase-4-architecture-ui` @ `4951f50d5b7f51331e5d05ac2d165cd0728e53d2` (P4-a winner)

## Delivered
1. `docs/architecture/knowledge-entry.json` — hub-compatible seed (`source_type: git`, `authority.classification: derived`, `x_generated_consumer.classification: generated_consumer`); collection `architecture`; points at AGENTS.md + module contracts + pack paths as derived-memory.
2. `docs/architecture/KNOWLEDGE-HUB-HANDOFF.md` — landed vs deferred (full multi-collection hub / Second Brain ingest deferred).
3. `docs/architecture/source-map.json` — retained from P2 tip (no refresh required for provenance panel).
4. Architecture “Sources / provenance” panel + `GET /api/architecture/provenance` + `src/lib/architecture/*` summarizing source-map (no DB, no live Second Brain POST).

## Out of scope / deferred
- Full Knowledge Hub UI across collections
- Live Second Brain ingest
- Changes to `.github/workflows/**` or `scripts/preflight.sh`

## MC
- Task: TASK-501 / `dsp_mrozcfc51hd10o`
- Checkout stamp: `MC-Checkout: dsp_mroztjtv77zb5v`
- Human owner: Vince

## Acceptance
All gates exit 0 (see `commands.log` / `preflight.out`).
