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
| MC UI | `/?screen=brain-ask` on `mc.plxcustomer.io` |
| VMC UI | `/vmc/second-brain` (session-authed) |

Follow up with `brain_get_node` **including `content`**, `brain_get_subgraph`,
`brain_trail`, or `brain_timeline` when a hit looks relevant. Check prior
decisions before re-debating settled questions.

## Open is full body

Search hits stay snippet-sized (`excerpt` / `snippet`, cap 280). Opening a hit
must load full markdown via:

- MCP: `brain_get_node` with `include: ["content"]`
- HTTP: `GET /api/vmc/knowledge/agent/node/{id}?include=content`
- MC UI: click a hit on `/?screen=brain-ask` → `GET /api/brain-ask/article?id=`

Map the response to the portal `KnowledgeArticle` DTO (`id`, `title`,
`markdown`, `namespace`, `trustTier`, `source`). Reject any reader that renders
the search excerpt as the article body.

Missing `VMC_API_KEY` on the MC Vercel app → Ask fail-opens with
`status: not_configured` and an empty list (`configured: false`). Search does
not work until the key is set. A live VMC that does not respond or returns
4xx/5xx is **not** a zero-hit query: the API reports
`upstream_unreachable` or `upstream_error` while `configured` stays true.
Zero hits with `status: ok` means VMC answered and found nothing.

MCP `brain_search` and VMC `/vmc/second-brain` use their own credentials and
stay independent. A 404 or empty body on an open still returns not-found.
Portal Hub how-tos stay at `https://staging.plxcustomer.io/admin/knowledge`.

Do not rewrite VMC `second-brain-detail.tsx`.

## MC Ask reliability (ASK-H1–H4)

| ID | Rule |
|---|---|
| ASK-H1 | `GET /api/brain-ask/search` and article open report `status`: `not_configured` \| `upstream_unreachable` \| `upstream_error` \| `ok`. Empty `hits` with `ok` is a real zero-hit result. |
| ASK-H2 | `mc_self_check` reports `brainAskConfigured` (key presence) plus `brainAskSearchOk` and `brainAskSearchStatus` from a live VMC search probe. Booleans and HTTP status only — never snippets, hits, or the key. |
| ASK-H3 | Ask UI names those states. It never claims search works while VMC is down. |
| ASK-H4 | After deploy, signed-in smoke on `https://mc.plxcustomer.io/?screen=brain-ask` — `configured: true` and ≥1 hit, or an explicit error. Not portal staging. |

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
- [ ] Opened relevant hits with full `content`, not the search snippet
- [ ] Treated sub-0.30 hits as weak
- [ ] Ingested outcomes with provenance + ladder tags
- [ ] Proposed relations where edges are durable
- [ ] Confirmed session artifact delivered or queued

## Canonical source

Authoritative SOP (edit there, not here):

- https://github.com/petralabx/agentic-swarm/blob/main/docs/knowledge-os/SOP_ASK_THE_BRAIN.md

Related (agentic-swarm): `docs/knowledge-os/GOVERNANCE.md`,
`docs/runbooks/brain-mcp.md`, `docs/runbooks/knowledge-os-agent-read-loop.md`.
