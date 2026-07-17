# Knowledge Hub Handoff — Architecture pack seed (P5 / TASK-477 thin slice)

> **Generated, non-authoritative consumer.** Canonical architecture remains in
> `AGENTS.md` and `docs/modules/*`. This handoff records what landed in the
> first-class architecture P5 thin vertical — it does **not** implement a full
> Knowledge Hub product.

## What landed (this phase)

| Deliverable | Location | Notes |
|-------------|----------|-------|
| Hub-compatible seed | `docs/architecture/knowledge-entry.json` | Collection `architecture`; `source_type: git`; `authority.classification: derived`; `x_generated_consumer.classification: generated_consumer` |
| Provenance panel | Architecture screen (`/?screen=architecture`) | “Sources / provenance” bound to `source-map.json` via thin read API |
| Thin read API | `GET /api/architecture/provenance?view=…` | Serves a slim summary from `docs/architecture/source-map.json` — no DB |
| Source map (existing) | `docs/architecture/source-map.json` | Per-node/edge path-and-line provenance (P2 pack); unchanged unless refresh required |
| Maintained diagram pack | `docs/architecture/*.{mmd,svg}` + README | Generated consumers of Git authority |

Git is the **only** canonical system for this collection. The seed is
content-free discovery metadata: it points at `AGENTS.md` and the
`docs/architecture/` pack; it does **not** copy module bodies into an editable
hub wiki or invent a second system of truth.

## What remains deferred

| Capability | Status |
|------------|--------|
| Full multi-collection Knowledge Hub UI (SOP, runbook, skill, business-procedure, …) | **Deferred** |
| Live Second Brain / brain ingest POST pipeline | **Deferred** (not required for this seed) |
| SharePoint adapters for business procedures / operational records | **Deferred** |
| Hub authoring / wiki-style edits | **Out of scope** — authoring returns via Git PR |
| OpenFlowKit / Structurizr as required runtime | **Out of scope** (Mermaid + static SVG) |

## Authority model

- **`source_type`: `git`** — canonical technical architecture lives in the repo.
- **`authority.classification`: `derived`** — hub/discovery role only.
- **`x_generated_consumer.classification`: `generated_consumer`** — diagrams and
  the in-app catalog are consumers; when they disagree with docs, **docs win**.
- Second Brain (if/when wired) stores derived memory only and must never become
  the sole canonical path.

## Degradation

- Canonical Git links must work without Second Brain availability.
- Missing, stale, or contradictory sources surface a visible degraded state.
- Live brain availability is **not** a prerequisite for reading architecture.

## Ingestion

`knowledge-entry.json` is a **seed record** for TASK-477. No live Second Brain
POST is performed in P5. Full ingestion lifecycle, multi-collection adapters,
and hub UI require separate approval beyond this thin slice.

## Verification

```bash
test -f docs/architecture/knowledge-entry.json
rg -n "derived|generated_consumer|source_type" docs/architecture/knowledge-entry.json
npm run typecheck
./scripts/preflight.sh --mode pre-commit
```

## References

- Schema (pilot): `.orchestrator/repo-visualization-tooling/P1/knowledge-entry.schema.json` (historical)
- Project SPEC: `.orchestrator/first-class-architecture/SPEC.md` § P5 / SC7
- MC: TASK-477 (hub seed), TASK-501 (P5 delivery)
- In-app: `/?screen=architecture`
