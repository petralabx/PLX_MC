# SOP — Ask the Brain (before and after work)

**Audience:** PLX Mission Control operators and agent runtimes (Cursor, Claude, swarm)
**Owner:** Vince · **Status:** active · **Effective:** 2026-07-22

> **TL;DR** — Search the company brain before you start; write back with provenance
> and ladder tags when you finish. Session artifacts close the loop when hooks are healthy.

## Purpose

Keep agent and operator work grounded in PLX-Brain so decisions reuse prior
knowledge, and so new lessons re-enter the repo → project → department → company
ladder.

This file is a **pointer summary** for the MC SOP Guide. The full procedure is
canonical in `petralabx/agentic-swarm`.

## Before work — search

| Surface | How |
|---|---|
| MCP (preferred) | `brain_search` on the `plx-brain` server |
| HTTP | `GET /api/vmc/knowledge/agent/search?q=...&limit=5` with `X-API-Key` |
| UI | `/vmc/second-brain` (session-authed) |

Follow up with `brain_get_node`, `brain_get_subgraph`, `brain_trail`, or
`brain_timeline` when a hit looks relevant. Check prior decisions before
re-debating settled questions.

## Interpreting scores

- Results carry `score` / `rawScore`.
- Default floor: `KNOWLEDGE_SEARCH_MIN_SIMILARITY` = **0.30**.
- Hits below the floor are weak — verify against provenance before relying on them.
- If nothing useful clears the floor, say so and use primary sources.

## After work — write back

1. **Ingest** durable findings via `brain_ingest` (idempotent by content hash).
   Include provenance (PR/commit links) and ladder tags (`repo`, optional
   `project_slug`, `department`).
2. **Relate** with `brain_propose_relation` (inferred links; operator promotes hard edges).
3. Never ingest secrets or personal data into shared namespaces.

## Session artifacts

- Cursor / Claude hooks capture `SessionArtifact v1` on stop (fail-open).
- Offline queue: `artifacts/session-brain/<yyyy-mm-dd>/<session_id>.json` in agentic-swarm.
- Replay: `python scripts/cursor-hooks/replay-session-artifacts.py --apply`
- Kill switch: `SESSION_BRAIN_ENABLED=0`

Trivial read-only Q&A with no decision or code change is exempt.

## Quick checklist

- [ ] Searched before planning
- [ ] Treated sub-0.30 hits as weak
- [ ] Ingested outcomes with provenance + ladder tags
- [ ] Proposed relations where edges are durable
- [ ] Confirmed session artifact delivered or queued

## Canonical source

Authoritative SOP (edit there, not here):

- https://github.com/petralabx/agentic-swarm/blob/main/docs/knowledge-os/SOP_ASK_THE_BRAIN.md

Related (agentic-swarm): `docs/knowledge-os/GOVERNANCE.md`,
`docs/runbooks/brain-mcp.md`, `docs/runbooks/knowledge-os-agent-read-loop.md`.
