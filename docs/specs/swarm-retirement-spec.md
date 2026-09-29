---
title: Swarm retirement — implementation spec
revision: r12 (28 Sep 2026: follows fleet r13, whose proxy moved to its own EC2 host: R5's tailnet fence points at `tag:fleet-proxy`, and R9 no longer repeats a Dell load test. r11: round-7 review applied: 13 findings; the critic found no blocker, and the author raised one (R11's Caddy edit on trading's front door had no window, check or rollback). R11's Caddy edit follows R6's guard; the search proxy is shipped and tested in R4, gets only the two swarm keys, matches one exact path and binds to a free private port; the rollback keeps the dump and an RDS snapshot, rebuilds `brain_t0` with its extensions, and never overwrites a row swarm-prod changed; relation writes alarm in the audit; callers without a brain key work until R11. D5 and D8 list R11 and the client key file. r10: round-6 review applied: 12 findings, 1 of them a blocker. `SWARM_API_KEY` can start trading research runs and delete memory, so the brain never holds it: a search-only proxy on swarm-prod holds the swarm keys, and the brain uses its own token. Callers pick address and key as a pair; department-key holders get brain keys; R11 retires the department-key hashes and makes VMC's Caddy forward only brain keys. Only root reaches the metadata service; `brain_svc` gets its schema; the rollback diffs content against a restored copy of the dump. r9: round-5 review applied: 16 findings; the critic found no blocker, and the author raised two that could put trading credentials on the brain host. The brain host's role reads only `prod/plx-brain`; the copied code drops trading's and economy's pools and a test keeps their names out of its env; callers get brain keys with the new address, so the raw `VMC_API_KEY` never goes to the brain's own name; the brain's own jobs pause for the cutover; the audit knows every shared writer and runs 30 days; the rollback selects on a cutover time and never overwrites trading's rows; the embedding key moves to R8. D3's fallback amended. r8: round-4 review applied: 17 findings, 3 of them blockers after the fact-check; all held against the code. The lessons check sends `project_slug`; the brain holds only hashes of the department keys, which can post paper trades; the swarm keys leave at R8; R10 dumps as `brain_app` (the shared admin never reaches the brain host), restores with `-O -x` into a new `brain_svc` role, and its rollback covers all 12 tables; the brain's egress is an allow-list; the env list comes from the code; V2 never edits `prod/ec2-secrets`; T2 reads the alarm body. r7: round-3 review applied: 20 findings, 2 of them blockers. T2 and R11 use a key-authenticated trading route; R10 dumps from one snapshot in directory format into a database with its extensions, revokes nothing on the shared role, and has a key-safe rollback; the brain host is fenced and holds only a hash of `VMC_API_KEY`. r6: round-2 review applied: 25 findings, 2 of them blockers. Trading's research lessons in `command_center.memory` stay writable, so R10 revokes nothing while a trading writer exists; strings that seed trading ids are never edited; R10's cutover has an exact order and a full rollback; T2 names its commands; R7 swaps only the base URL on the day. r5: round-1 review applied: 58 findings, 10 of them blockers. The brain gets its own host, database instance, env file, keys and base-URL variable, so no step changes `VMC_BASE_URL`, `VMC_API_KEY`, `SWARM_API_KEY` or VMC's secrets; R1's repo side is in agentic-swarm#1629; R2 shipped; T1 and T2 become checklists; a swarm merge counts as a trading deploy. r4: decisions confirmed, trading lab untouched. Record: swarm-retirement-review-log.md)
status: D1–D13 confirmed 28 Sep 2026 (D5 as amended in r5, D3 as amended in r9, and D13); reviewed seven times; the operator closed the review on 28 Sep 2026
accountable human: vince@petrasoap.com
repos: petralabx/agentic-swarm (source; pruned and renamed for the trading lab at the end), petralabx/plx_secondbrain (the brain's new home), petralabx/plx-customer-portal, petralabx/PLX_MC, petralabx/skills, petralabx/local-inference
---

# Swarm retirement — implementation spec

## 1. Goal

Retire `petralabx/agentic-swarm` and its runtime (the VMC web app and the Python
swarm) without breaking anything that people or agents still use.

The order is fixed:
1. Measure what is still used, and stop what should not run.
2. Move the brain: lift it as it is, then simplify it.
3. Leave the trading lab untouched. It keeps this repo, renamed at the end (D8).
4. Decide every other VMC area: retire it, or fold it into PLX_MC.
5. Shut down what retires, snapshot, prune, and rename the repo for the trading lab.

Related work:
- The agent fleet spec replaces the swarm's agent roles. It does not depend on the swarm. Section 9 lists where the two meet.
- The COS Companion and the EventBridge pacer are mostly untouched. Section 9 explains where they meet this spec.
- The frontier spec is r12. Section 10 lists what changed there and what its r13 must pick up.

## 2. Facts — the brain (checked 28 Sep 2026)

Paths below are in `petralabx/agentic-swarm` unless a repo is named.
`vmc/` means `apps/vmc-web/src/`.

| # | Fact | Source |
|---|---|---|
| B1 | Eight callers outside the swarm use the brain. **portal:** the knowledge client (admin Knowledge Hub search and article open), the COS Companion's session record, the IDE session-end hook, the Markdown ingest script. **PLX_MC:** Ask the Brain, `/api/cursor/knowledge/search` and the `mc_search_knowledge` MCP tool, plus the session-end hook. **plx_secondbrain:** the plx-brain MCP server (11 tools). **local-inference:** the SharePoint organizer harness. Inside the swarm, several scripts also call it (R7 lists them). Guides and skills in every repo name the old host (R7). | portal `portal/src/lib/knowledge/service/vmc-client.ts`, `portal/src/lib/agents/cos-session-artifact.ts`, `scripts/session-artifact-closeout.mjs`, `scripts/markitdown/ingest_to_brain.py`; PLX_MC `src/lib/brain-ask/client.ts`, `src/lib/mcp/read-actions.ts:154-225`, `scripts/compliance-closeout.mjs`; plx_secondbrain `src/tools.ts:8-18`, `src/index.ts:100-170`; local-inference `.orchestrator/sharepoint-doc-org-harness/harness/ledger/brain.py` |
| B2 | Every caller sends `X-API-Key` with `VMC_API_KEY`. Most read `VMC_BASE_URL` and fall back to `https://missioncontrol.tayloralton.com` written in the code. plx_secondbrain falls back to `http://localhost:3100`. The two session-end hooks run on every developer and agent machine. | B1 files; PLX_MC `src/lib/secrets.ts:184-195`; plx_secondbrain `src/config.ts:14` |
| B3 | **The portal's brain reads failed until 28 Sep 2026.** Its search called the login-only `/api/vmc/knowledge/search` and its article open called a route that does not exist. Portal #1589 (TASK-2030, merged 28 Sep) moved the client to the key routes (`agent/search`, `agent/node/{id}?include=content`, `agent/document/{id}`), and `selfCheck` now counts only a 2xx from `agent/status`. This was R2. | portal `vmc-client.ts:191,206-207,217` |
| B4 | The brain has 20 route files. 11 use key auth and serve every outside caller: `agent/{search,items,node,document,subgraph,trail,status}`, `ingest`, `relations`, `session-artifact`, `mcp`. `agent/items` exports GET only. 9 use browser-login auth and serve only the VMC web UI; some of them write (`notes` POST and PATCH, `compile`, `second-brain/links` POST and DELETE). The four `/api/vmc/second-brain/*` routes are also login-only; a PLX_MC weekly health checklist opens two of them in a browser. | `vmc/app/api/vmc/knowledge/**`; `vmc/app/api/vmc/second-brain/**`; PLX_MC `docs/PLX-BRAIN-WEEKLY-HEALTH-SOP.md:23-25` |
| B5 | Responses use one envelope: `{ data, meta }` on success, `{ error: { code, message } }` on failure. The `mcp` route speaks MCP JSON-RPC instead. | `vmc/lib/vmc/api/api-handler.ts:366-380` |
| B6 | Search does not run in VMC. The memory and document lanes call the swarm's Python API, `GET /memory/search/v2`. The swarm embeds the query through an OpenAI-compatible `/embeddings` call (default `text-embedding-3-small`) and ranks the results. Rerank and query rewrite are optional, env-gated, and run on `local-driver`. The graph lanes run SQL inside VMC. | `vmc/lib/vmc/knowledge/search-core.ts:236-249,569-604`; swarm `src/api/fastapi_app.py:658-696`; `src/memory/embeddings.py`; `src/memory/search.py:75,300`; `config/models.yaml:119-127` |
| B7 | Of the 11 key routes, only search needs the swarm. The rest read or write Postgres directly, or read the document catalog. Direct writes (`ingest`, `session-artifact`) leave `embedding` empty, and no scheduled job fills it in: only `/memory/put` embeds on write, and `kb_compile` embeds only its own articles. Search ranks unembedded rows by keyword. | `vmc/lib/vmc/knowledge/ingest-core.ts`; `session-artifact/route.ts:51-103`; swarm `src/api/memory_api.py` (`_try_embed_after_write`); `src/pipelines/kb_compile.py:461`; `src/memory/matrix.py:277` |
| B8 | 15 scheduled jobs feed the brain. From VMC's crontab: `second-brain-ingest`, `internal-rag-ingest`, `second-brain-dispatch-ingest`, `second-brain-compile`, `wiki-compile`, `second-brain-lint`, `kb-decisions-sync`, `rollup-distill`, `lessons-auto-extract`, `memory-summarize`, `sharepoint-sync`, and a read-only watchdog. From the Lobster scheduler: `kb-compile` (writes `memory.items` and embeddings), `kb-lint` and `institutional-distill`. `knowledge-extract` has a route but no crontab line. | `config/vmc-web-crontab:77-173`; `src/pipelines/registry.py:192-203`; `tests/test_scheduled_semantic_provider_inventory.py:158-176` |
| B9 | The brain's data is schema `memory` in VMC's main database (`command_center`, `DATABASE_URL`). That database also holds projects, todos, the login tables, and the compute, cron, event and todo tables the trading lab uses. Tables: `memory.items` (pgvector 1536 with an HNSW index, full-text GIN index), `links`, `knowledge_links`, `events`, `attempt_packets`, five `graph_*` tables, and two quantized-embedding tables. Migration `048` also alters `public.vmc_decisions`. | `vmc/lib/vmc/db.ts:7-52`; migrations `004, 021, 022, 029, 030, 032, 042, 047, 048, 052, 053, 068` in `vmc/lib/vmc/db/migrations/` |
| B10 | The brain code is `vmc/lib/vmc/knowledge/` (19 files, 3,708 lines). It imports memory-graph, swarm-client, the document catalog, the DB pool, the API wrapper (auth, rate limit, budgets, route metrics that write `public.api_route_metrics`) and the secret reader. Ingest reads `config/departments.yaml`. Search cache, rate limiter, idempotency cache and concurrency limits live in process memory. | `vmc/lib/vmc/knowledge/*`; `vmc/lib/vmc/api/route-metrics.ts:38-62`; `ingest-core.ts:34,79-88` |
| B11 | The document catalog reads local repo copies (`VMC_PLX_MC_ROOT`, `VMC_PLX_PORTAL_ROOT`, `VMC_SWARM_ROOT`, `/home/ubuntu/...`) and SharePoint through Microsoft Graph. | `vmc/lib/vmc/document-sources.ts:54-87` |
| B12 | Tests: 14 TypeScript files (about 133 cases) and 22 Python files cover the brain. | `vmc/lib/vmc/__tests__/`; `tests/` |
| B13 | VMC runs as systemd unit `vmc-web.service` (`next start --port 3100`) on EC2. Caddy terminates TLS for `missioncontrol.tayloralton.com` and proxies to it. The Caddyfile is not in the repo. Deploys run `deploy-vmc.sh`: build, migrations, restart, health check, then the `deploy` smoke profile: a `projects` probe plus a schema audit that needs `public.projects*`, `public.todos` and `memory.items.tenant_id`. (`second_brain` and the other probes are in the `full` profile.) VMC's `/api/health` reports the deployed commit, which the compute workers use for their self-check. | `systemd/vmc-web.service:12-22`; `AGENTS.md:98-108`; `scripts/deploy-vmc.sh:16,172-177`; `vmc/app/api/vmc/internal/smoke/route.ts:60-113,147,172`; `vmc/app/api/health/route.ts:8-11` |
| B14 | **Department-scoped keys do not limit anything.** `VMC_SCOPED_API_KEYS` keys see all non-personal knowledge. The scope helpers exist but only tests call them. Every key request is bound to tenant `plx`. | `vmc/lib/vmc/knowledge/namespace-scope.ts:154-261`; `docs/knowledge-os/KEY_TIERS.md:78-84`; `api-handler.ts:286` |
| B15 | A search fallback is marked "remove after 2026-09-30". | `vmc/lib/vmc/knowledge/search-core.ts:370-375` |
| B16 | The deployed HTTP MCP endpoint is `https://missioncontrol.tayloralton.com/api/vmc/knowledge/mcp`. The frontier spec's P14 registers the brain in Cursor. plx-brain's `brain_self_check` also probes `GET /api/health` and needs every check to pass. | `docs/runbooks/brain-mcp.md:16,33`; plx_secondbrain `src/tools.ts:81-92` |
| B17 | plx_secondbrain today is the stdio MCP server plus an eval harness. The harness has golden fixtures and floors: precision@5 ≥ 0.79, recall@10 ≥ 0.75, hallucination ≤ 0.055, idempotency ≥ 0.995. The weekly workflow scores fixtures only. Its `--live` mode imports the swarm's `search-core.ts` in-process with `DATABASE_URL`; it never calls a service over HTTP. | plx_secondbrain `eval/second-brain/README.md`; `.github/workflows/second-brain-eval-weekly.yml:3-5`; `harness.ts:262-287` |
| B18 | The PLX_MC governance contract tells every session to post its record to `$VMC_BASE_URL/api/vmc/knowledge/session-artifact (e.g. https://missioncontrol.tayloralton.com)`. The generator copies that text into CLAUDE.md, AGENTS.md and the other runtime guides. | PLX_MC `config/governance-contract.yaml:260` |
| B19 | **The session-end hooks queue failed records to `artifacts/session-brain/`, and nothing replays them automatically.** A manual replay script exists in the swarm. Cloud containers lose the queue. The ingest script, local-inference, `brain_ingest` and `hygiene_harvest` do not queue at all. | PLX_MC `scripts/compliance-closeout.mjs:261-328`; swarm `scripts/cursor-hooks/replay-session-artifacts.py` |
| B20 | **Trading writes to the brain's schema.** The Friday `research-run?project=trading-v2` writes failure lessons into `command_center.memory` through swarm-prod's `put_memory` (namespace `swarm/lessons/research/trading-v2`), and reads them back through swarm-prod's `/memory/search/v2` and in-process (`search_memories`). Eleven other `research-run` crons write `swarm/lessons/research/<project>` the same way. Lessons are written only when a run fails. | `src/research/runner.py:367-412`; `vmc/lib/vmc/research-runner.ts:410-418` |
| B21 | The MCP route's write tools (`brain_ingest`, `brain_propose_relation`) write in-process, not through the REST write routes. `brain_run_lint` tells operators to call VMC's lint cron. | `vmc/lib/vmc/knowledge/mcp-http-tools.ts:38-50,214-218,463-486` |
| B22 | **Department-scoped keys are trading-write keys on VMC.** Any `VMC_SCOPED_API_KEYS` entry passes every `auth:"key"` route, including POST `trading-v2/paper/execute/service`, `paper/breaker/evaluate`, `paper/exit/service` and `promotion-gate`; only `wf_canary` keys are refused. The keys are compared as raw values. | `vmc/lib/vmc/api/key-scope.ts:77,179-200`; `api-handler.ts:527-558`; `vmc/app/api/vmc/trading-v2/paper/execute/service/route.ts:103-104` |
| B23 | **Schema `memory` has 12 tables and one view**: `items` (uuid; unique `(tenant_id, namespace_key, memory_key)`), `events` (serial `event_id`), `links` (serial `link_id`; dedup index), `knowledge_links` (serial `id`; dedup index), `attempt_packets` (uuid; unique `(tenant_id, task_fingerprint, dispatch_id)`), `quantized_embeddings` (key `(item_id, embedding_model, method, bits_per_dim)`), `quantized_index_state` (unique `(method, bits_per_dim)`), five `graph_*` tables (four with natural unique keys; `graph_quarantine` has only a uuid key), with foreign keys that are RESTRICT, CASCADE or SET NULL, and the view `items_effective`. `command_center` also has `pg_trgm`; without it graph retrieval falls back to `ILIKE`. The brain writes `graph_*` on every ingest and session-artifact write, because `MEMORY_GRAPH_INGEST_ENABLED=1` in production; both graph flags are off when unset. | `vmc/lib/vmc/db/migrations/021:53,66`, `022:118`, `029:38`, `047:76`, `052:102-164`; `config/aws-secrets-flags.yaml:729-740`; `memory-graph/ingest.ts:150-156`; `retrieve.ts:80-86,280-297`; `052:146-215` |
| B24 | **`dispatcher/alarm` answers 200 even when unhealthy.** With the database down it returns `healthy: false, backendReady: false`, still 200. | `vmc/app/api/vmc/trading-v2/dispatcher/alarm/route.ts:17-19`; `trading-v2-dispatcher-health-store.ts:12-22,733-750` |
| B25 | **VMC's database module opens pools for trading and economy.** `db.ts` reads `DATABASE_URL` (a 20-connection pool and a 30-connection listen pool), `TRADING_V2_DATABASE_URL`, `TRADING_V2_READONLY_DATABASE_URL` and `ECONOMY_DATABASE_URL`. `REQUIRED_SERVER_ENVS` lists `VMC_API_KEY`, `TRADING_V2_DATABASE_URL`, `CRON_SECRET` and `GITHUB_WEBHOOK_SECRET`. | `vmc/lib/vmc/db.ts:23-52`; `vmc/lib/vmc/api/api-handler.ts:221-226` |
| B26 | **Every caller sends its raw key in `X-API-Key`,** so the brain sees the raw `VMC_API_KEY` or department key on every request that carries one. Caddy's default access log redacts only `Authorization`, `Cookie` and proxy headers. `plx-postgres-staging` runs PostgreSQL 17.9. | `vmc/lib/vmc/api/key-scope.ts:155-163`; portal `docs/runbooks/WORKBENCH-READONLY-DB-ACCESS.md:78` |
| B27 | **`SWARM_API_KEY` alone can act on trading.** Swarm-prod accepts it for `POST /research/run` with any `project_slug` (including `trading-v2`), `POST /pipelines/run` for any registered pipeline (the registry loads trading's), and `POST /memory/delete` (with `project_slug` or the admin key). | `src/api/fastapi_app.py:1579-1592,1613-1626,848-878`; `src/pipelines/registry.py:140,170,217`; `src/api/memory_api.py:21-49` |
| B28 | **`links` and `knowledge_links` are updated in place** (`ON CONFLICT … DO UPDATE SET weight, metadata`) and have no `updated_at`; `attempt_packets` has none either. The embedding backfill does not touch `updated_at`, and `items_effective` ranks by it. Swarm-prod also writes `graph_*` rows through its `brain_propose_relation` agent tool (on in production) and `links` through `/memory/link`. | `vmc/lib/vmc/knowledge/relations-core.ts:140-146`; `knowledge-links-store.ts:100-105`; migrations `021:65-73`, `029:14-23`, `032:5-19`, `022:87-103`; swarm `src/memory/store.py:589-590`; `brain_graph_ops.py:60,708-850`; `fastapi_app.py:880` |

## 3. Facts — the rest of the swarm (checked 28 Sep 2026)

| # | Fact | Source |
|---|---|---|
| F1 | VMC has 436 route files: 379 under `/api/vmc` in 61 top-level areas, and 52 cron routes. The largest areas are trading-v2 (103), projects (51), knowledge (20), compute (16) and royale (14). | `vmc/app/api/**` |
| F2 | **No live broker trading.** The only order path sends Alpaca *paper* orders, and its flag is off by default. IBKR is read-only. | `vmc/lib/vmc/trading-v2/brokers/alpaca-adapter.ts:21,153,164`; `trading-v2-flags.ts:158-161`; `trading-v2-broker-adapter.ts:26-112` |
| F3 | The trading lab is large: about 97k lines of Python in `scripts/trading-research/`, about 78k lines of TypeScript across trading lib, routes, crons and UI, 111 Python and 55 TypeScript test files, 167 docs, and two terraform stacks. It has its own database (`trading`) and 70 `trading_*` migrations. 19 trading scripts import swarm `src/` modules (`src.pipelines.persist_run`, `src.secrets`, `src.tools.*`, `src.strict_local_chat`), and `src/pipelines/phase_a_trading_v2_autoresearch.py` is trading code. | `scripts/trading-research/`; `vmc/lib/vmc/trading-v2/`; `vmc/lib/vmc/db/migrate.ts:337,488`; `infra/terraform/{trading-v2-dispatcher-alarm,wf-stage2-canary}` |
| F4 | **Trading leans on shared VMC code and keys.** It uses the API wrapper 122 times, the DB pool 61 times, the compute-fabric jobs, cron bookkeeping, events and the todo store (its market-data alert is an in-app escalation todo). Its paper dispatchers, exit monitor and dispatcher-alarm Lambda call the VMC API at `missioncontrol.tayloralton.com` with `VMC_API_KEY`; a 2026-06 rotation of that key stopped paper trading for 2.3 days. Trading readiness requires `SWARM_API_KEY`; the market-data alert and `research-run?project=trading-v2` dispatch to swarm-prod; `research_fleet_manager.py` reads `SLACK_WEBHOOK_URL`. The compute fabric runs only trading jobs. | `scripts/trading-research/paper_dispatcher.py:82-83,1823`; `exit_monitor.py:23-24`; `infra/terraform/trading-v2-dispatcher-alarm/main.tf:126`; `config/tradingbox-crontab:113-119`; `vmc/lib/vmc/trading-v2/trading-v2-readiness.ts:40-41`; `market-data-freshness-alert.ts:8-15,161,347`; `config/vmc-web-crontab:88`; `research_fleet_manager.py:76`; `scripts/compute-fabric/job_specs.py` |
| F5 | Five places run swarm code. **VMC host** (EC2): the web app, watchdogs and its crontab. **swarm-prod** (EC2): `swarm serve` on :8900, the Hermes gateway on :8644, a public Cloudflare quick tunnel to :8900, the Lobster scheduler. **TRADINGBOX** (EC2): trading crons and a compute worker. **Spark A**: a compute worker. **Dell VTA**: the `dell-vta` compute worker and its Windows tasks. The workers reset to `agentic-swarm` `origin/main` every 15 minutes; the Dell's self-updater sets `origin` to `git@github.com:petralabx/agentic-swarm.git`. VMC reaches swarm-prod at `172.31.45.50:8900`. | `systemd/*.service`; `config/tradingbox-crontab`; `config/trading-workers.yaml:108-245`; `docs/architecture/multi-host-separation.md:94-98,292`; `scripts/compute-fabric/selfupdate-vta-worker.ps1:83` |
| F6 | Ten Lobster lanes run: seven enabled in `config/pipelines.yaml`, including `daily-brief` (06:30 ET weekdays) and `meeting-action-sync` (every 15 min), plus three enabled only in their class schedule (`kb-compile`, `kb-lint`, `institutional-distill`). `governance-repo-sync` was the eighth YAML-enabled lane until R1. | `config/pipelines.yaml:78-686`; `src/pipelines/registry.py:192-203` |
| F7 | **The VMC host crontab also runs jobs from other systems.** Portal: `daily-status-report.sh` and `auto-sync-sharepoint.sh` (paused in R1). OpenClaw: six monitoring jobs. It also carries shared lines that keep trading running: `weekly-db-backup.sh` (backs up `trading`), `refresh-secrets.sh`, the disk janitor, `aws-secrets-flags-watchdog` and `vmc_services_watchdog` (restarts `vmc-web`). | `config/vmc-web-crontab:22-52,121,127,134,171` |
| F8 | **Some pieces act on people or outside services:** email sent as `cos@petrasoap.com` from approved drafts, with no flag; mailbox moves and archives; SharePoint list writes every 4 hours from `project-sync`, with no flag; Teams meeting joins and call recording through ACS, with an Event Grid webhook; To Do, Planner and calendar writes; Telegram and Slack posts; Vast.ai GPU start and stop. | `vmc/lib/vmc/email/email-actions.ts:34-35,529-598`; `vmc/lib/vmc/projects/project-m365-sync.ts:351-366`; `vmc/app/api/vmc/teams/meetings/join/route.ts`; `vmc/lib/vmc/calendar.ts:235-286`; `vmc/app/api/vmc/gpu/[id]/route.ts` |
| F9 | Inbound doors to close: the Cloudflare quick tunnel (R1), the GitHub webhook, the ACS Event Grid webhook, the Hermes :8644 webhook, and the portal's "CEO bridge" keys. Caddy for `missioncontrol.tayloralton.com` stays for the trading lab. | `systemd/swarm-cloudflare-tunnel.service:14`; `vmc/app/api/webhooks/github`; portal `portal/src/app/api/external/swarm/v1/**` |
| F10 | All three swarm databases (`command_center`, `trading`, `economy`) sit on one RDS instance, `plx-postgres-staging`, which also holds the portal's development database and receives the FileMaker 30-minute sync. So retirement drops databases, not the instance. | `AGENTS.md:219-228`; portal `CLAUDE.md` (Deployment) |
| F11 | **Other repos depend on the swarm in a few places.** PLX_MC's Cursor cloud environment clones and runs `swarm serve`, and its MCP server has a `dispatch_to_swarm` tool (default off). The portal has a dormant `swarm-dispatch-mcp` with dispatch on by default, a `bin/swarm` wrapper, and the CEO bridge API that VMC reads. skills' `skillparity` blocks without a swarm checkout. local-inference's `local_inference_bridge_promotion_gate.sh` is the TRADINGBOX-to-gateway bridge gate (trading). No repo uses the swarm as a submodule or package, and no CI checks it out. | PLX_MC `.cursor/environment.json:3-8`, `.cursor/mcp.json:18-21`, `tools/plx-mc-mcp/index.ts:508-518`; portal `tools/swarm-dispatch-mcp/server.mjs:43-49`; skills `skills/skillparity/scripts/run.py:66,188-194`; local-inference `config/execution-primitives.local.yaml:33`, `scripts/local_inference_bridge_promotion_gate.sh` |
| F12 | PLX_MC tracks `petralabx/agentic-swarm` as active, compliance `hard`, default bucket `BKT-INFRA`. It also appears in the loop-ledgers registry (for trading's quality ledger), a routing pilot that `rollout.ts` imports at build time, and the fleet provisioning lists that protect the repo. | PLX_MC `config/tracked-repos-registry.json:61-82`; `config/loop-ledgers-registry.json:5-12`; `config/routing-pilots/agentic-swarm.json`; `src/lib/routing/rollout.ts:8`; `scripts/provision-fleet-branch-protection.sh:38`; `provision-fleet-compliance-hard.sh:36` |
| F13 | 15 Dependabot PRs are open on the swarm repo. | GitHub, 28 Sep 2026 |
| F14 | VMC's todo pages already redirect to the PLX_MC ledger. | `vmc/app/vmc/todos` (TASK-1703) |
| F15 | **OpenClaw and the secret loaders on the VMC host.** (a) `openclaw-secrets.service` and its 15-minute timer write `/run/openclaw/secrets.env` from AWS Secrets Manager; `vmc-web`, `swarm-serve`, `hermes-agent` and the watchdogs read it. (b) `refresh-secrets.sh` (every 30 minutes) writes `~/.secrets-env.systemd`, which `vmc-web.service` also reads and which carries trading flags. (c) Agent jobs in `/home/ubuntu/clawd`: session health, an audit monitor, "monitor agents", a morning Sentry-error scan, an evening documentation scan, a nightly cleanup, three Lobster workflows kept outside any repo (`agentic-swarm-sync`, `plx-roadmap-sync`, `plx-status-update`), and an M365 token keep-alive. | `systemd/vmc-web.service:18-19`; `docs/architecture/multi-host-separation.md:298-412`; `config/vmc-web-crontab:22-50`; `LESSONS.md:1118-1127` |
| F16 | The portal's `daily-status-report.sh` commits `docs/` with `--no-verify` and pushes to `staging`, then emails an executive summary. No commit from it has reached `staging` since 19 May 2026, so its push fails or never runs. | portal `scripts/daily-status-report.sh:90-107`; `staging` history of `docs/PROJECT-STATUS-SUMMARY.md` |
| F17 | The portal's `auto-sync-sharepoint.sh` never writes to SharePoint. It rebuilds `docs/sharepoint-updates.json` in the VMC host's portal copy, commits it locally without pushing, and logs "Manual SharePoint update required". PLX_MC syncs its own Milestone Register list through its own SharePoint integration and does not read that file. | portal `scripts/auto-sync-sharepoint.sh`; PLX_MC `docs/product/SHAREPOINT_INTEGRATION.md:30,90` |
| F18 | **Every merge to swarm `main` is a trading deploy.** `deploy-vmc` runs after the Test workflow on `main` with no path filter: reset, build, migrate, restart `vmc-web`, smoke. The workers reset to `main` within 15 minutes. `deploy-swarm` runs only while the repo variable `SWARM_DEPLOY_ENABLED` is `true`, and then restarts swarm-prod's units. | `.github/workflows/deploy-vmc.yml:3-8`; `.github/workflows/deploy-swarm.yml:6-40`; F5 |
| F19 | **On the VMC host and TRADINGBOX, `VMC_BASE_URL` means VMC itself.** The cron runner that fires every VMC cron, trading's included, reads it (default `http://127.0.0.1:3100`), and so does the disk janitor. It comes from the shared `prod/ec2-secrets`. | `apps/vmc-web/scripts/vmc-cron-runner.sh:141-160,226`; `scripts/host_disk_janitor.sh:47` |
| F23 | **Swarm dispatches write memory too.** Every completed swarm dispatch, including the market-data alert's `swarmDispatch(team:"ceo")`, writes `swarm/dispatch/<team>/<project or global>` plus `events` and `attempt_packets` rows into `command_center.memory`. Swarm-prod also writes task briefs to `tenant/<tenant>/briefs` (on by default) and, through the `memory_store` agent tool, `swarm/agent/<agent>`. VMC and swarm-prod share one database role. | `src/api/context.py:885,989,1030-1110`; `src/config.py:654`; `src/memory/task_brief.py:23,121-140`; `memory_ops.py:90-91` |
| F24 | **Trading's key-authenticated health route is `GET /api/vmc/trading-v2/dispatcher/alarm`** (read-only; the dispatcher-alarm Lambda calls it). `GET /api/vmc/trading-v2/readiness` is login-only, so a key gets 401. | `vmc/app/api/vmc/trading-v2/dispatcher/alarm/route.ts:17`; `readiness/route.ts:4`; `vmc/lib/vmc/api/api-handler.ts:204,505-511` |
| F21 | **The old repo slug seeds trading ids.** `run_alpha_tournament.py` derives its UUIDv5 namespace from `taylorvalton/agentic-swarm:trading-v2:alpha-tournament-id`; a changed string would mint new ids and stop `ON CONFLICT (id) DO NOTHING` from de-duplicating. | `scripts/trading-research/run_alpha_tournament.py:112-119` |
| F22 | Trading uses the Microsoft Graph app credentials (`mslist_poll_cron.py` on TRADINGBOX) and `RESEND_API_KEY` (the Dawn scheduler). | `scripts/trading-research/mslist_poll_cron.py:20,45-46`; `dawn_harvest_scheduler.ps1:95-100` |
| F20 | The swarm watchdog restarts `swarm-cloudflare-tunnel` after three failed checks, and `deploy-swarm.sh` restarted it on every deploy, until agentic-swarm#1629 (R1). | `scripts/swarm_services_watchdog.sh:30-33,106-125`; `scripts/deploy-swarm.sh:134-136` |

## 4. Facts — the COS Companion and the EventBridge pacer (checked 28 Sep 2026)

Paths are in `petralabx/plx-customer-portal` unless a repo is named.

| # | Fact | Source |
|---|---|---|
| C1 | **COS chat does not read VMC.** COS's knowledge policy is `namespace`, which reads the portal's own resolved-ticket store in Postgres. The VMC graph is read only by the admin Knowledge Hub (search and article open) and by agents whose policy is `global`. Fleet P10 keeps it so until R11. | `portal/src/lib/knowledge/service/read.ts:86-108`; `agent-read.ts:81-92`; `hub-ask.ts:29-45`; `portal/src/lib/agents/pilot-agents.ts:105-112` |
| C2 | The COS Companion is shipped on the web (companion window, Bench, bridge), plus a desktop shell (D1). Desktop D2–D5 are in backlog. Its only VMC call is one `companion_open` session record per open. It expects nothing from the swarm, Hermes or a runner. Its specs rule out a new runtime, local models and an agent OS. | `docs/projects/cos-companion/README.md` (staging, 28 Sep); `portal/src/lib/agents/cos-session-artifact.ts:11-90`; `DESKTOP-SPEC.md:41-54` |
| C3 | UAT reconciliation R0–R9 shipped 25–27 Sep. The Seal, `/uat`, the sidebar badge and COS chat share one ticket model. Status changes go through "one door", and every run writer, Hermes included, writes a run graph. | `docs/projects/cos-companion/README.md`; `UAT-TICKET-CONTRACT.md` |
| C4 | **The EventBridge pacer is the portal's staging clock.** It is Lambda `plx-bc-cron-ping` in AWS us-east-1. It triggers Business Central outbound (every 5 min) and inbound (4 times an hour), and the Awaiting You work-routing relay (every 5 min, hourly and daily, through a GitHub workflow). Since 28 Sep it also runs the UAT loops. Production uses Vercel crons. Nothing here touches VMC or the swarm. | `scripts/aws/bc-cron-ping/`; `scripts/aws/deploy-bc-cron-ping.ps1:110-159`; `docs/runbooks/BC-CRON-HTTP-PACER.md` |
| C5 | **The portal has one pattern for scheduled jobs** (Awaiting You FR-028). One core function is called by a cron route, a CLI, a GitHub Action and an admin action. Each run writes a row with its caller, a correlation id, the mode, and a lock that turns a second run into `SKIPPED_LOCKED`. | `specs/awaiting-you/spec.md:192`; `portal/src/lib/work-routing/runner.ts:1-24,66,157`; `schema.prisma:8289-8308` |
| C6 | **Several digests exist or are planned:** `/api/admin/digest` (production, weekdays 13:00 UTC, all STAFF+); the UAT stall digest and ops digest; Awaiting You T904, a planned department daily brief; and the swarm's Lobster `daily-brief` (06:30 ET weekdays). The COS panel's Tasks tab is an empty placeholder. | `portal/src/app/api/admin/digest/route.ts:8-16`; `specs/awaiting-you/tasks.md:113,164`; swarm `config/pipelines.yaml:78-99`; `agent-panel.tsx:1673-1677` |
| C7 | The Hermes bridge is built for UAT only: contract `uat-agent/v2`, canary by default, at most two runs at once, Windows scheduled tasks on the Dell VTA. The portal's UAT dispatch chooses an executor: Cursor Cloud first, Hermes as fallback. | `scripts/uat-agent/hermes-bridge/README.md:3-10,57-98,177-178`; `docs/projects/plx-agents-platform/COS-CLOSEOUT-HANDOFF.md:18-26` |
| C8 | A second agent worker already exists: `services/persona-qa-worker` runs the persona-QA agents after each deploy. Their cadence sits in `evalConfig.notes`. | `portal/src/lib/agents/persona-qa-agents.ts:1-8,441-448` |
| C9 | The agent kill switch today is `Agent.status` plus `TRIPLE_T_ENABLED`. The companion docs rule out a second kill switch. | `docs/projects/cos-companion/OS-GAP-VALIDATION.md:21-22,42-44` |

## 5. Decisions

| # | Decision | State |
|---|---|---|
| D1 | **Order:** measure, brain, other areas, then shut down what retires and rename the repo for trading. Nothing stops until its callers have moved and its logs show 14 quiet days. **Exception:** the R1 stops, which the operator allowed before R0 on 28 Sep 2026 because none of them reaches the portal or trading. | Confirmed 28 Sep 2026; R1 exception recorded in r5 |
| D2 | **The brain moves in two steps:** lift it as it is, then simplify. | Confirmed 28 Sep 2026 |
| D3 | **The lift changes nothing callers can see:** same paths, envelope, header and database. The brain accepts the current `VMC_API_KEY` value during the lift. Callers read `BRAIN_API_KEY` first and fall back to `VMC_API_KEY` only while they still call the old host (R7, amended in r9: each caller gets its brain key with its new base URL); once brain keys are issued, the brain stops accepting `VMC_API_KEY` (R11). VMC keeps `VMC_API_KEY` unchanged for the trading lab; this spec never rotates, revokes or replaces it. The brain never holds the value: it holds only its SHA-256 (`VMC_API_KEY_SHA256`) and compares hashes, because it never sends the key. If the trading owner ever rotates the key, the hash in `prod/plx-brain` is updated within the hour. | Confirmed 28 Sep 2026; key path stated in r5; fallback amended in r9, amendment confirmed 28 Sep 2026 |
| D4 | **Cutover is by path at Caddy,** for the 11 key routes. `/api/health` on the old host stays VMC's, because the compute workers read the deployed commit there (B13); the brain serves its own `/api/health` at `brain.plxcustomer.io`. The Caddy block stays for good, so any caller left on the old host still reaches the brain; from R11 it forwards only requests that carry a brain key. VMC's own knowledge pages and login routes retire at R10 (V1). | Confirmed 28 Sep 2026; permanent proxy and R10 retirement stated in r5 |
| D5 | **The brain's home is `plx_secondbrain/service/`, on its own small EC2 host, at `brain.plxcustomer.io`.** It is not on the VMC host, so its process, deploys, tailnet membership and restarts never share a machine with trading. On the VMC host this spec changes only Caddy (R6, R10, R11), crontab lines (R1, R9, V2, S1) and one client key file (R7), each guarded (D8). | Confirmed 28 Sep 2026 for the VMC host; **amended in r5** to its own host (round-1 findings FC-R20, CR-R15, CR-R16). Amendment confirmed 28 Sep 2026. |
| D6 | **The brain keeps `text-embedding-3-small`,** so stored vectors stay valid. After step 2 it calls the embedding provider itself with its own key. Brain jobs that need a chat model use the fleet proxy (fleet D5) with a brain key limited to cloud aliases, so they load neither `local-driver` nor the Dell's local models, which share the Dell with trading's `dell-vta` worker. Rerank and query rewrite stay off. | Confirmed 28 Sep 2026; fleet proxy and cloud-only key stated in r5–r6 |
| D7 | **Brain jobs follow the portal's job pattern** (C5): one core function, a cron route and a CLI, and a run table. The brain host's own timer runs them. The EventBridge pacer stays the portal's staging clock and schedules nothing in this spec. | Confirmed 28 Sep 2026 |
| D8 | **The trading lab is not touched.** It keeps running where it runs today: its code in this repo, its web app and API inside VMC, its database, TRADINGBOX, its compute workers, its crons, its secrets and keys (`VMC_API_KEY`, `SWARM_API_KEY`, `SLACK_WEBHOOK_URL`, `prod/ec2-secrets`), `VMC_BASE_URL`, and the `missioncontrol.tayloralton.com` address. No step stops, edits, reroutes or rotates anything the trading lab uses (Stage 3 maps it). Some touches cannot be avoided, and each is guarded: (1) a swarm merge redeploys VMC (execution contract); (2) Caddy edits on the VMC host (R6, R10, R11), each in a trading-safe window with a backup, `caddy validate`, a 2-minute trading check and a restore-and-reload rollback; (3) crontab line edits on the VMC host (R1, R9, V2, S1), each with a backup; (4) until R10 the brain uses a restricted role on `command_center` (the same reads and writes VMC makes today), and R10 copies schema `memory` out once, a read load on the shared instance; (5) the tailnet policy gains one tag and one rule (R5), saved first and tested; (6) two existing security groups each gain one ingress rule (R5), recorded with their undo; (7) one-off commands on the VMC host (hash computation, the paired replay and eval, step checks), run from a temporary directory removed after, outside trading windows, never writing a key to disk; (8) from R5 to R10, a search-only proxy unit on swarm-prod (R5), added beside `swarm serve` without restarting or editing it, and removed at R10; (9) `~/.plx-brain-client.env`, holding only a brain key, on the VMC host, TRADINGBOX, Spark A and the Dell (R7), removed by deleting the file. Standing rules: never edit a string that seeds a trading id (F21); never drop `command_center.memory`, and never revoke any privilege on it from the role VMC and swarm-prod share (F23); never stop swarm-prod or a trading writer to make a step easier. When everything else has left, the repo is pruned of non-trading code and renamed (for example `trading-lab`). Any later move is the trading owner's own spec. | Confirmed 28 Sep 2026; the guarded touches named in r5–r11; items 8 and 9 confirmed 28 Sep 2026 |
| D9 | **Every other VMC area retires by default.** An area folds into PLX_MC only if R0 shows human use in the last 30 days and the operator says why it is needed. | Confirmed 28 Sep 2026 |
| D10 | **Anything that acts on people or outside services stops first,** one at a time, each with a named owner's sign-off (F8). | Confirmed 28 Sep 2026 |
| D11 | **The Lobster `daily-brief` retires,** and COS's daily brief (fleet P11) replaces it. | Confirmed 28 Sep 2026 |
| D12 | **Nothing is deleted outright.** Database snapshots are kept for 90 days. The GitHub repo is not archived; it becomes the trading lab's repo (D8). The RDS instance stays, because it also holds the portal's development database (F10). | Confirmed 28 Sep 2026 |
| D13 | **The brain's own database lives on its own small RDS instance,** not on `plx-postgres-staging`. The R10 copy then only reads from the shared instance; the restore and the HNSW index build run elsewhere. | Proposed in r5 (round-1 finding CR-R17); confirmed 28 Sep 2026 |

## 6. Success criteria

| # | Criterion | Check |
|---|---|---|
| SC-1 | Every brain caller works through the brain service. | R5 paired replay; eval floors met over HTTP (B17) |
| SC-2 | No caller changes code on cutover day. | R6 |
| SC-3 | Before any surface stops, its logs show 14 quiet days, and anything that acts on people has a named owner's sign-off. R1 is the recorded exception (D1). | R0 report; V2 sign-offs |
| SC-4 | The admin Knowledge Hub returns graph results on staging. | R2 (shipped) |
| SC-5 | After stage 2, no brain request runs swarm code. | R8 acceptance |
| SC-6 | After shutdown, nothing retired still runs: no Lobster scheduler, no non-trading VMC area, no swarm service the trading lab does not use, no swarm clone in PLX_MC's cloud environment. No retired secret still works. The trading lab shows no new failure at any step. | S-phase checks; T2 at every step |
| SC-7 | Every repo change carries a live MC stamp for its own repo. | The `compliance` check on each PR |
| SC-8 | No step changes `VMC_BASE_URL`, `VMC_API_KEY`, `SWARM_API_KEY`, `SLACK_WEBHOOK_URL`, `RESEND_API_KEY`, the Microsoft Graph credentials, `prod/ec2-secrets`, `~/.secrets-env*` or `/run/openclaw/secrets.env`. | Each step's evidence file |

## 7. Execution contract

- Every phase that edits a repo needs its own MC TASK and checkout: search, create
  only on a real miss, `mc_checkout_task` with `repo`, `prBodyLine` in the PR body
  at open, last commit, then `mc_complete_task`, then freeze.
- One phase per PR. Draft PRs only. Agents never merge.
- **A swarm merge is a trading deploy (F18).** Merge a swarm PR only in a window the
  trading owner names, clear of the Dawn harvest, the Mon/Thu walk-forward campaign
  and market hours. Record the `deploy-vmc` run and its smoke result, then run T2.
- Operator phases (Caddy, systemd, DNS, RDS, AWS, Azure) record what was changed
  and how to undo it in the phase's evidence file. Evidence never contains a key
  value.
- **The brain's settings live apart from VMC's.** A setting whose value differs from
  VMC's gets a `BRAIN_` name: `BRAIN_BASE_URL` (callers), `BRAIN_DATABASE_URL`,
  `BRAIN_API_KEYS` (the service), `BRAIN_API_KEY` (a caller's key). Values the brain
  only reads (for example the `MEMORY_GRAPH_*` flags) keep their names but live only in the
  brain's own env file (`/etc/plx-brain/brain.env`, rendered from its own Secrets Manager
  secret `prod/plx-brain`). The frontier spec's `BRAIN_URL` is the same value as
  `BRAIN_BASE_URL` (SC-8).
- A "quiet" window means zero requests for the paths in question in Caddy's access
  logs and VMC's own logs, counted per day. If access logging is off, the clock
  starts when it is turned on.
- `agentic-swarm` stays tracked in PLX_MC, compliance `hard`, until T3 renames it.
- Dates and times shown to the operator are ET.

## 8. Phases

### Stage 0 — Measure, and stop what should not run

#### R0 — Usage audit (operator, read-only)

- **Repo edit:** none.
- On each host (VMC host, swarm-prod, TRADINGBOX, Spark A, the Dell VTA):
  - `systemctl list-units --type=service,timer` and `crontab -l` for every user; on
    the Dell, `Get-ScheduledTask`. Compare with the repo copies (`systemd/`,
    `config/*-crontab`, `config/trading-workers.yaml`) and list the differences.
- From Caddy's access logs and VMC's own logs (as far back as they go, at least 14
  days), with key values stripped:
  - Requests per day for each `/api/vmc/<area>` and each `/vmc/<page>`, including
    calls on `localhost:3100` that bypass Caddy.
  - For each, who called: session user (from VMC's logs), `X-Agent-Name`, or user agent.
- From Vercel's logs: calls to the portal's CEO bridge (`/api/external/swarm/v1/**`).
- From `command_center` (read-only): the last run and failure count of each cron
  job (`cron_executions`), and row-count changes per table over 7 days
  (`pg_stat_user_tables`). The same for `trading` and `economy`.
- From Azure: the Event Grid subscription for ACS recording, and which app
  registration the VMC Graph credentials belong to. Record whether the portal
  uses the same one.
- Read the three Lobster workflow files kept outside any repo
  (`/home/ubuntu/workflows/*.lobster`) and record what each writes. Flag anything
  that commits or pushes to the portal.
- For each OpenClaw agent job (F15 c), record what it reads, what it writes, and who
  reads its output.
- **Output:** one table per area with requests per day, last human use, last agent
  use and writes per day, plus a proposed verdict under D9.
- **Acceptance:** every area in F1, every job in B8 and F6, and every unit and task
  in F5 has a row. The operator confirms the verdicts.

#### R1 — Stop what should not run (swarm PR, then operator)

The operator allowed these stops before R0 on 28 Sep 2026 (D1), because nothing in
the portal, its `staging` branch or the trading lab changes. The repo side is
agentic-swarm#1629 (TASK-2039).
- **The swarm PR:**
  - `governance-repo-sync` is disabled in `config/pipelines.yaml`, its byte-identical
    VMC mirror, the regenerated runtime snapshot and its class schedule.
  - The `config/vmc-web-crontab` mirror marks the `lessons-rule-promote`,
    `daily-status-report.sh` and `auto-sync-sharepoint.sh` lines `PAUSED`.
  - The swarm watchdog stops watching the quick tunnel, and `deploy-swarm.sh` restarts
    it only while its unit is enabled (F20).
  - Both writer jobs write only this repo's files and their own `command_center`
    rows, which nothing in trading or the portal reads.
- **Why each stop is safe:**
  - **Quick tunnel** (swarm-prod). No code in any repo uses it; swarm callers use a
    private IP or loopback, and a quick tunnel's URL changes on every restart.
  - **`daily-status-report.sh`.** Its push has not reached `staging` since 19 May 2026
    (F16). Its daily executive email stops too.
  - **`auto-sync-sharepoint.sh`.** It never writes SharePoint and never pushes (F17).
- **Operator, after the merge (merged in a trading-safe window, per the execution
  contract):**
  1. VMC host: `crontab -l > ~/crontab.bak-<date>`, then `crontab -e` to delete only
     the three live lines. Never install the mirror with `crontab <file>`.
  2. swarm-prod, once the PR's watchdog and deploy changes are on the host: record the
     tunnel URL from `journalctl -u swarm-cloudflare-tunnel`, then
     `sudo systemctl disable --now swarm-cloudflare-tunnel`.
  3. Restart the Lobster scheduler so it drops `governance-repo-sync`.
- Not in R1: the Lobster workflows kept outside any repo (R0 reads them first), and
  the portal's dormant `tools/swarm-dispatch-mcp` (V4).
- **Acceptance:** the scheduler log's list of scheduled pipelines no longer names
  Governance Repo Sync; `crontab -l` has none of the three lines; 24 hours later
  `systemctl is-active swarm-cloudflare-tunnel` prints `inactive`, the recorded URL no
  longer answers, and no watchdog alert names the tunnel; T2 shows no new trading failure.
- **Rollback:** re-enable the unit, revert the swarm PR, or restore the lines from the backup.

### Stage 1 — Brain, step 1: lift it as it is

#### R2 — Fix the portal brain client (portal) — shipped

- Shipped 28 Sep 2026 as portal #1589 (TASK-2030); see B3. The client already uses the
  `agent/*` routes the lift keeps.

#### R3 — Record the brain's contract (plx_secondbrain, read-only plus tagged probe writes)

- Add an HTTP mode to the eval harness: `--live --base-url <url> --key-env <VAR>`
  sends every query over HTTP instead of importing `search-core.ts` (B17).
- Build one request set that covers every key route the callers use (B4):
  - Every query in the eval golden set, through `agent/search`.
  - `agent/node`, `agent/document`, `agent/subgraph` and `agent/trail` for ten known ids.
  - `agent/items` with each filter the callers send, `agent/status` and `/api/health`.
  - One `ingest`, one `relations` and one `session-artifact` write, and one call to
    each MCP write tool (`brain_ingest`, `brain_propose_relation`) through `mcp` (B21), each with a fresh
    `contract-probe-<run>-<n>` key and the tag `contract-probe`.
  - One POST to `agent/items` (405 today; B4), one call per route with a missing key
    (401), with a bad body (422), and with each key tier (`VMC_API_KEY`, a
    `VMC_SCOPED_API_KEYS` key).
- Record status code and response shape (key paths and types). For search, record
  the ordered top-10 ids. A `--read-only` flag skips the writes.
- A cleanup script deletes the probe rows from `memory.items`, `links`, `knowledge_links`,
  `events` and the `graph_*` mirror rows for those items, children first: graph facts
  (their sources cascade), then entities and episodes. The operator runs it with a
  one-off role `brain_probe_cleanup` (`USAGE` on schema `memory`, and `SELECT, DELETE`
  on those tables only, since a `WHERE` needs `SELECT`), dropped after R5.
- Store the request set, the recordings and the cleanup script in plx_secondbrain
  `eval/contract/`. No keys, no personal namespaces.
- Acceptance: one recording per route and key tier against the live VMC; the cleanup
  leaves zero `contract-probe` rows; the harness's fixture mode still passes.

#### R4 — Brain service (plx_secondbrain)

- Add `service/`: a small Next.js app next to the MCP server. It carries the 11 key
  routes and the code they import (B10), copied without behaviour changes, plus
  `config/departments.yaml`, and its own `/api/health`. It does not carry the 9 login routes or
  the VMC UI.
- It keeps the same paths (`/api/vmc/knowledge/...`), the same envelope and the same
  `X-API-Key` header. It accepts a key whose SHA-256 equals `VMC_API_KEY_SHA256` (D3)
  and any key in `BRAIN_API_KEYS`. Department keys are trading-write keys on VMC (B22),
  so the brain never holds them: it reads `BRAIN_SCOPED_KEY_SHA256`, a map from each
  `VMC_SCOPED_API_KEYS` entry's SHA-256 to its grant, and hashes the incoming key
  before the lookup. This is the one behaviour-preserving change to the copied code:
  the same keys pass with the same grants.
- `service/deploy/env.names` lists every name the code reads (`getSecret` and
  `process.env`), each marked `copy VMC's value`, `brain's own` or `never`. A test
  fails on a name the code reads that the list does not have, including names reached
  through `getSecret` aliases. `never` includes `VMC_API_KEY`, `VMC_SCOPED_API_KEYS`,
  `DATABASE_URL`, `TRADING_V2_DATABASE_URL`, `TRADING_V2_READONLY_DATABASE_URL`,
  `ECONOMY_DATABASE_URL`, `GITHUB_WEBHOOK_SECRET`, `CRON_SECRET` (the brain has
  `BRAIN_CRON_SECRET`), `RESEND_API_KEY`, `VMC_WF_CANARY_API_KEYS` and `WF_CANARY_*`. A
  second test fails if any `never` or `migrate only` name appears in a rendered
  `brain.env`. The list names `BRAIN_SWARM_SEARCH_TOKEN`, `BRAIN_AUDIT_DATABASE_URL`
  and `BRAIN_RESEND_API_KEY` as `brain's own`.
- The copied `db.ts` keeps only the pool on `BRAIN_DATABASE_URL` and the run-table pool.
  Its trading, economy and listen pools are removed (B25), and the brain's
  `REQUIRED_SERVER_ENVS` names only brain settings. These are the second
  behaviour-preserving change: no key route uses those pools.
- It reads schema `memory` only from `BRAIN_DATABASE_URL`, and its own run tables from
  `BRAIN_RUNS_DATABASE_URL` (R5). In step 1 `BRAIN_DATABASE_URL` is
  `command_center` through a new role limited to schema `memory`: `USAGE` on the
  schema, `SELECT, INSERT, UPDATE` on its tables and `USAGE, SELECT` on its sequences.
  Its pool is at most 5 connections with `application_name=plx-brain`. It runs
  no migrations; VMC's runner still owns the schema in step 1. It sets
  `VMC_ROUTE_METRICS_ENABLED=0`, because the role cannot write `public.api_route_metrics`.
- `BRAIN_WRITES_PAUSED=1` makes every write route and every MCP write tool return 503
  with a retry hint (R10).
- Every request logs its key tier (`VMC_API_KEY` value, a brain key, a scoped key),
  never the key itself, so R11 can count `VMC_API_KEY` use.
- For search it still calls the swarm's `/memory/search/v2` (B6), with rerank and
  query rewrite off. That is its only swarm dependency (B7). `SWARM_API_KEY` can act on
  trading (B27), so the brain never holds it or the memory admin key: it calls a
  search-only proxy on swarm-prod (R5) with its own token, `BRAIN_SWARM_SEARCH_TOKEN`.
  Sending that token instead of the swarm keys is the third behaviour-preserving
  change: the same search, the same results.
- Ship the proxy in `service/deploy/swarm-search-proxy/`, with tests. It admits only
  `GET` on the exact path `/memory/search/v2` (any other method or path, including
  dot-segment paths, gets 404). It compares the token in constant time with a SHA-256
  held in a root-only file. It overwrites `X-API-Key` with the swarm key, drops
  `Authorization` (the copied `swarmHeaders` sends the token in both, B27), sets
  `X-Memory-Admin-Key`, and never logs a header. Check each of the 11
  MCP tools for other swarm calls.
- The SessionArtifact v1 schema moves here and becomes the canonical copy. R7 updates
  the hooks that name the swarm file as its owner.
- Ship the systemd unit and the Caddy site for the brain host in `service/deploy/`.
- Copy the 14 TypeScript test files and keep them passing.
- Acceptance:
  - `npm test` and a production build pass in `service/`.
  - The R3 request set replays against the service with a fixture database in CI:
    same status codes and shapes, and 503 on every REST and MCP write with
    `BRAIN_WRITES_PAUSED=1`.
- Rollback: revert the commit. Nothing points at the service yet.

#### R5 — Run the brain service (operator, the brain host)

- Create the brain host (D5): a small EC2 instance with an elastic IP, in a new security
  group. Its instance profile is a new role whose only permission is
  `secretsmanager:GetSecretValue` on `prod/plx-brain-??????` and
  `prod/plx-brain-migrate-??????` (Secrets Manager adds a 6-character suffix to each
  ARN); never a role that reads `prod/ec2-secrets*`. IMDSv2 is required with a hop
  limit of 1, and the host's `nftables` table drops traffic to `169.254.169.254` and
  `fd00:ec2::254` from every user but root (`meta skuid != 0`), so only root, which
  renders the env files, can reach the metadata service. Acceptance: as the service
  user and as the `caddy` user, a token request to the metadata service fails. This is an infra change: high-risk bundle, bucket PRD. Network rules, each
  additive and recorded with its undo; no existing security group loses a rule:
  - the brain's group admits TCP 80 and 443 from the internet (TLS certificates and
    callers) and the service port from VMC's group (VMC's group is not edited);
  - the security group of `plx-postgres-staging` gains one ingress rule, TCP 5432 from
    the brain's group. Name that group in the evidence and confirm it does not also
    front `plx-postgres-uat`, the portal staging app's database; if it does, stop and
    ask the operator;
  - swarm-prod's group gains one ingress rule, TCP `<proxy port>` from the brain's group
    (removed at R10). On swarm-prod the operator first picks a free port with
    `ss -ltnp` (8901 is the sourcing webhook's default) and records it as
    `<proxy port>`. Then they install `plx-brain-search-proxy` from plx_secondbrain
    `service/deploy/swarm-search-proxy/` (R4), bound to swarm-prod's private IP on
    `<proxy port>`, forwarding to `127.0.0.1:8900`. The unit receives only the two swarm
    keys, through systemd `LoadCredential=` from a root-only file, never swarm-prod's
    whole env file (which holds every trading key); the token's SHA-256 is in a second
    root-only file. `swarm serve` is not restarted or edited. Acceptance: through the
    proxy, a search with the token returns 200; without it, 401; with the token, any
    other GET path, a dot-segment path and `POST /research/run`, `/pipelines/run` and
    `/memory/delete` return 404; the proxy's log holds no header;
  - the brain's RDS instance (D13), created at PostgreSQL major 17 or later (the source
    runs 17.9, B26), gets its own security group, admitting TCP 5432 from the brain's
    group only;
  - the brain's group allows outbound only TCP 443 and 80 (TLS, package mirrors), TCP
    5432 to the two RDS groups, TCP `<proxy port>` to swarm-prod's group, and Tailscale's UDP
    41641 and 3478. Its default allow-all egress rule is removed.
- **Tailnet fence.** Save the tailnet policy, add `tag:plx-brain` to `tagOwners` with one
  accept rule to the fleet proxy (`tag:fleet-proxy:4001`, fleet D5), add policy `tests` that trading's paths still
  pass (as fleet P5), then join with
  `tailscale up --advertise-tags=tag:plx-brain --accept-dns=false --accept-routes=false`.
  A root-owned `nftables` table of family `inet` allows outbound traffic on `tailscale0`
  only to `<fleet-proxy>:4001`. Probes from the host to the Dell's `:4000`, Spark B
  `:18090`, Spark A `:18082` and TRADINGBOX all fail (IPv4 and IPv6), and so do probes
  to TRADINGBOX's VPC address, the VMC host's `:3100` on its VPC address and
  `plx-postgres-uat:5432`.
- In the brain's RDS instance, database `brain`:
  create every extension `command_center` has (record its `pg_extension` list; at least
  `vector`, `pgcrypto` and `pg_trgm`, B23). Create the runtime role `brain_svc`
  (`LOGIN`, connection limit 10). plx_secondbrain's numbered migration runner connects
  as the instance's master role and creates the brain's run tables (D7) now, in schema
  `brain_ops`, never `memory`, so R10's restore can create `memory` cleanly. Schema
  `memory` moves in R10. The runner runs as a oneshot unit `plx-brain-migrate` that
  reads `/etc/plx-brain/migrate.env` (root only, mode 0600, holding
  `BRAIN_MIGRATE_DATABASE_URL`, rendered from its own secret `prod/plx-brain-migrate`,
  which holds the brain instance's master URL); the service unit never loads that
  file. `env.names` marks that name `migrate only`. Grant `brain_svc` `USAGE` on
  schema `brain_ops`, `SELECT, INSERT, UPDATE` on the runner's tables and
  `USAGE, SELECT` on its sequences, and `ALTER DEFAULT PRIVILEGES FOR ROLE <master>` the
  same in each schema the runner owns, so later tables are covered.
- On `command_center`, create the step-1 role. Save its grants as SQL in the evidence,
  with the undo (`REVOKE …; DROP ROLE brain_app`):
  `CREATE ROLE brain_app LOGIN CONNECTION LIMIT 10 PASSWORD …;
  GRANT USAGE ON SCHEMA memory TO brain_app;
  GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA memory TO brain_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA memory TO brain_app;`
  Then, in each database on the instance, record `has_database_privilege('brain_app', …,
  'CONNECT')` and `has_schema_privilege('brain_app', 'public', 'CREATE')`, and confirm
  it holds no table privilege outside `command_center.memory`. Do not change `PUBLIC`
  grants, which other roles rely on. `CONNECT` and `TEMP` through `PUBLIC` are recorded
  and accepted: they touch no data. If the role has `CREATE` on any schema, or any table
  privilege, outside `command_center.memory`, stop and ask the operator.
  `brain_probe_cleanup` (R3) and R10's `brain_audit_ro` get the same checks.
- Create the Secrets Manager secret `prod/plx-brain` and render
  `/etc/plx-brain/brain.env` from it (mode 0600, owned by the service user), following
  `service/deploy/env.names` (R4):
  - `BRAIN_DATABASE_URL` (the `brain_app` role on `command_center`) and
    `BRAIN_RUNS_DATABASE_URL` (`brain_svc` on `brain`, for the run tables);
  - `VMC_API_KEY_SHA256` and `BRAIN_SCOPED_KEY_SHA256`, hashes only, computed on the
    VMC host from VMC's values (D3, B22); `BRAIN_API_KEYS` (every brain key starts with
    `brn_`, from the first one); `BRAIN_CRON_SECRET`;
  - VMC's live values for every flag the code reads: the tenant variables,
    `VMC_SECOND_BRAIN_*`, `MEMORY_GRAPH_INGEST_ENABLED` and
    `MEMORY_GRAPH_RETRIEVAL_ENABLED` (without them graph search and the graph mirror
    turn off quietly, B23), `KNOWLEDGE_SEARCH_*`, `BRAIN_MCP_HTTP_ENABLED`,
    `VMC_KEY_TENANT_BINDING_ENABLED`, `VMC_API_BUDGETS_ENABLED`,
    `VMC_API_BULKHEADS_ENABLED`, and `MEMORY_RERANK_ENABLED` and
    `MEMORY_QUERY_REWRITE_ENABLED` (both off, D6);
  - `VMC_SHAREPOINT_HOSTNAME` and `VMC_DOCUMENTS_SITE_PATH`, and credentials for the
    brain's own Microsoft Graph app (read-only, `Sites.Selected`, granted the
    `VincePersonal` site), never trading's (F22);
  - `SWARM_API_URL` (the proxy, `http://<swarm-prod private IP>:<proxy port>`) and
    `BRAIN_SWARM_SEARCH_TOKEN`. Never `SWARM_API_KEY` or `SWARM_MEMORY_ADMIN_KEY` (B27);
    `env.names` marks both `never`.
  Step 1 embeds nothing (B6, B7), so the brain's embedding key arrives in R8.
  The unit reads only this file. The service user has no `~/.secrets-env*`, which
  `getSecret` would otherwise fall back to. Evidence: `service/deploy/env.names`'s test
  passes against the rendered file, and from the host
  `aws secretsmanager get-secret-value --secret-id prod/ec2-secrets` returns
  `AccessDenied`.
  Changing a value means: update the secret, re-render the file,
  `sudo systemctl restart plx-brain`, check `agent/status`.
- Clone the repo copies the document catalog needs (B11), read-only, and set the
  `VMC_*_ROOT` variables.
- Install `plx-brain.service` from `service/deploy/`, bound to the private address.
  No public TLS site yet (R6a adds it).
- **Paired replay:** from the VMC host, never the brain host, because the
  `VMC_API_KEY` tier needs the key's value (D3). Use a temporary copy of
  `eval/contract/`, removed after; read the keys from VMC's env at run time and never
  write them to disk or evidence. Send each R3 request to VMC (through
  `missioncontrol.tayloralton.com`) and to the service's private port within the same
  minute. Writes use fresh probe keys; run the cleanup after. The eval against VMC runs
  from the VMC host the same way.
- Acceptance: `/api/health` returns 200; paired replay gives the same status codes and
  shapes for every request, and the same top-10 search ids in at least 95% of
  queries; the eval harness in HTTP mode meets the floors (B17) and stays within 0.02
  of VMC's own HTTP scores; the tailnet probes fail as listed; T2 shows no new trading
  failure.
- Rollback: stop and disable the unit. Nothing points at it yet. Disable and remove the
  search proxy unit and its credential files on swarm-prod. Undo the tailnet change,
  the network rules and the role in reverse order.

#### R6 — Cut over by path (operator, Caddy on the VMC host)

- In a trading-safe window: back up the Caddyfile (`Caddyfile.bak-<date>`), then add,
  before the catch-all:
  ```
  @brain path /api/vmc/knowledge/agent/* /api/vmc/knowledge/ingest /api/vmc/knowledge/relations /api/vmc/knowledge/session-artifact /api/vmc/knowledge/mcp
  handle @brain {
      reverse_proxy <brain host private IP>:<port>
  }
  ```
  `/api/health` is not in the matcher (D4). Run `caddy validate --config <file>`, then
  `sudo systemctl reload caddy`.
- Within 2 minutes of the reload: `GET /health` returns 200, a keyed
  `GET /api/vmc/trading-v2/dispatcher/alarm` (F24) returns 200 with `backendReady: true`
  and `healthy` no worse than before the reload (B24), and one keyed brain search
  returns 200. If not, restore the backup and
  reload at once.
- VMC's own knowledge pages keep working until R10, because its login routes still
  read the same database.
- No caller changes anything on the day. Tell MCP users to reconnect: sessions held
  in VMC's memory end at the cutover.
- Watch for seven days: 5xx rate and p95 latency against VMC's last seven days (from
  Caddy's logs), a daily `--read-only` R3 replay through
  `missioncontrol.tayloralton.com` from an operator machine with a brain key (never
  the brain host, and no daily job on the VMC host), PLX_MC
  `mc_search_knowledge` status `ok`, and portal `selfCheck`.
- Acceptance: seven days at or better than the VMC baseline, the eval floors met, and
  T2 shows no new trading failure.
- Rollback: restore the Caddyfile backup and reload. Traffic returns to VMC at once.
  This works only before R10; after R10, roll back R10 first.
- The block stays for good (D4).

#### R6a — The brain's own name (operator, DNS and TLS)

- Add one record, `brain A <brain host's elastic IP>`, TTL 300, in the
  `plxcustomer.io` zone. Record which DNS provider holds the zone and the exact change.
- Before and after: `dig +short` for `staging`, `www`, `mc` and the zone apex give the
  same answers, and `dig CAA plxcustomer.io` allows the certificate authority Caddy uses.
- Then add the Caddy site for `brain.plxcustomer.io` on the brain host (TLS), with a
  `log` block whose `format filter` deletes `request>headers>X-Api-Key` and
  `request>headers>Authorization` (B26). `caddy validate`, reload.
- Acceptance: `curl -H "X-API-Key: …" https://brain.plxcustomer.io/api/vmc/knowledge/agent/status`
  and `https://brain.plxcustomer.io/api/health` return 200. The brain host's Caddy and
  service logs are copied to the operator's machine, and a grep there for the first 8
  characters of each key finds nothing (no key material is typed on the brain host).
- Rollback: remove the Caddy site; delete the record.

#### R7 — Move callers to the brain's own address (each caller repo)

- On the day, only the base URL changes. Callers read `BRAIN_BASE_URL`, then fall back
  to `https://brain.plxcustomer.io` written in code. They no longer read
  `VMC_BASE_URL` for the brain, because on the VMC host that means VMC itself (F19).
  Each caller picks its address and key as a pair. If `BRAIN_API_KEY` is set, it calls
  `BRAIN_BASE_URL` (default `https://brain.plxcustomer.io`) with that key. If not, it
  calls one named constant for the old host, `https://missioncontrol.tayloralton.com`,
  with `VMC_API_KEY`, as today. So the raw `VMC_API_KEY` never travels to the brain's
  own name (D3, B26), and a caller without a brain key keeps working until R11. The operator
  issues each caller environment its `BRAIN_API_KEY` in R7; R11 issues none again.
- Department keys are trading-write keys on VMC (B22). R0 and T1 list who holds one
  (MCP clients and automation, per PLX_MC's department-key SOP); R7 gives each holder a
  brain key, so no department key needs to reach the brain's own name.
- Hosts whose environment comes only from SC-8 files (the VMC host, TRADINGBOX, Spark A
  and the Dell) get `~/.plx-brain-client.env` holding `BRAIN_API_KEY` (mode 0600; on
  the Dell, an ACL for the owning user only; D8 item 9). The
  swarm hook and the MCP sync scripts read that file first. No SC-8 file changes. **Never change `VMC_BASE_URL` in `prod/ec2-secrets`,
  `~/.secrets-env*`, on the VMC host or on TRADINGBOX** (SC-8).
- One PR per repo:
  - **portal:** `vmc-client.ts`, `cos-session-artifact.ts`,
    `scripts/session-artifact-closeout.mjs`, `scripts/markitdown/ingest_to_brain.py`,
    `portal/.env.example:222`, `.cursor/rules/session-knowledge-artifact.mdc:11-12`,
    `.cursor/skills/session-brain/SKILL.md:47`.
  - **PLX_MC:** `src/lib/secrets.ts`, `scripts/compliance-closeout.mjs` and its test
    (`tests/compliance-closeout.test.ts:39`), `config/governance-contract.yaml:260`
    (then regenerate the guides), `.cursor/rules/session-knowledge-artifact.mdc:13-14`,
    `.cursor/skills/session-brain/SKILL.md:47`, `TOOLS.md:23`,
    `config/integrations.yaml:227-232`, `docs/FLEET-SECRETS-SOP.md:80`, and
    `vmcApiConfigured()` (`secrets.ts:187-189`) with `mc_self_check.brainAskConfigured`,
    which must count either `BRAIN_API_KEY` or `VMC_API_KEY` as configured, or an
    environment with only a brain key reports `not_configured`.
  - **plx_secondbrain:** `src/config.ts`, README.
  - **skills:** `skills/session-brain/SKILL.md:47`.
  - **local-inference:** `.orchestrator/sharepoint-doc-org-harness/harness/ledger/brain.py`,
    `.cursor/skills/session-brain/SKILL.md:47`.
  - **agentic-swarm** (one PR, merged in a trading-safe window):
    `scripts/cursor-hooks/session_artifact_lib.py`,
    `scripts/workstation-maintenance/runtime/hygiene_harvest.py:42`,
    `scripts/sync-plx-brain-mcp.sh:20` and `.ps1:42`,
    `scripts/cursor-mcp/brain-selfcheck-once.ps1:2`. `hygiene_email_digest.py` uses its
    base URL only for `/vmc/second-brain?q=…` review links, a page R10 retires: its
    links are dropped, not moved.
- Two callers are broken today, not moved: `ingest_to_brain.py` and local-inference's
  `brain.py` POST to `agent/items`, which answers 405 (B4). Each gets its own small fix
  PR that moves the POST to `/api/vmc/knowledge/ingest`.
- Operator: set `BRAIN_BASE_URL` and `BRAIN_API_KEY` together in the portal's and
  PLX_MC's Vercel settings and in
  every environment that runs a session-end hook (developer machines, Cursor cloud
  agents, Claude Code cloud environments, Codex); update the Cursor team MCP
  registration and each operator's MCP config (the sync scripts above write them).
- Acceptance: each PR's checks pass; Caddy's logs on the VMC host show brain calls
  falling toward zero while the brain host's logs show them arriving; in each caller
  file listed above, `git grep -n "missioncontrol.tayloralton.com\|VMC_BASE_URL"`
  returns only the one old-host constant; each caller has a unit test that with
  `BRAIN_API_KEY` set it calls `https://brain.plxcustomer.io` with that key, that
  without it it calls the old host with `VMC_API_KEY`, and that it never sends
  `VMC_API_KEY` to the brain's own name.
- Rollback: revert a caller's PR; the R6 block still serves the old host.

### Stage 2 — Brain, step 2: simplify

#### R8 — Search inside the brain service (plx_secondbrain)

- Port the swarm's memory search (B6) into the service, so search no longer calls
  the swarm. Rerank and query rewrite stay off (D6).
- Keep the same embedding model (`text-embedding-3-small`, 1536 dimensions), so
  stored vectors stay valid and nothing needs re-embedding (D6). The brain's embedding
  key, from the fleet's OpenAI organisation (fleet P1 and D11, never trading's), is
  added to `prod/plx-brain` now.
- Run the ported search and the swarm search side by side on the golden set, in HTTP
  mode, before switching.
- Acceptance: eval floors met, and within 0.02 of the R3 baseline. The R3 replay is
  still clean. The service makes no call to `SWARM_API_URL` while the flag is off.
- The flag, the search proxy and the swarm-prod ingress rule stay until R10.
- Rollback: a flag switches search back to the swarm call through the proxy. R10 removes the flag, because the swarm reads
  `command_center`.

#### R9 — Keep or retire each brain job (plx_secondbrain)

- For each B8 job, record one verdict from R0's usage numbers: port into the service's
  own schedule, or retire.
- Jobs the brain cannot work without must be ported, and one must be built: an
  embedding backfill for direct writes (B7). The lint report that `agent/status`
  reads must be ported.
- Jobs that only serve swarm features (dispatch summaries, swarm lessons) retire
  with the swarm.
- A job that calls a chat model goes through the fleet proxy with the brain key from
  fleet P2, limited to cloud aliases (D6); so R9 waits for fleet P1 and P2. Record any
  output change from the model switch. Ported jobs write their run rows to the `brain`
  database created in R5. The brain key reaches only cloud aliases on the fleet proxy's
  own host (fleet D5), so a ported job puts no load on the Dell.
- When lint is ported, change `brain_run_lint`'s message so it points at the brain's own
  lint, not VMC's cron (B21).
- When a ported job goes live, the operator comments out its old line on the VMC host
  (with a backup) or disables its Lobster lane, the same day.
- Acceptance: a verdict table covers all 15 jobs. Each ported job has a test and one
  clean scheduled run. `agent/status` shows a fresh lint report. No old line or lane
  still runs for a ported job. T2 shows no new trading failure.

#### R10 — The brain's own database (plx_secondbrain, operator)

- Prerequisites: R9 has retired or moved every brain job that writes `memory`. The
  session-artifact replay script and the `session_artifact_lib` it imports move from
  the swarm to plx_secondbrain (they must survive T3's prune) and are ready to replay
  records queued during the pause (B19), or the operator records that those records are
  lost. The replay runs on every machine that holds a queue, with R7's address-and-key
  pair, so a machine without a brain key never sends `VMC_API_KEY` to the brain's name.
- Every loopback caller of the 11 key routes on the VMC host (`127.0.0.1:3100` or
  `localhost:3100`, F19) that R0 found has moved to R7's address-and-key pair. Such a caller
  skips Caddy, so after the cutover its writes would land in `command_center`.
- The runner from R5 takes schema `memory`: seed its ledger with the 12 migrations that
  touch it (`004, 021, 022, 029, 030, 032, 042, 047, 048, 052, 053, 068`, B9), and split
  `048`: its `public.vmc_decisions` change stays with VMC. The runner fails the deploy
  on error. `vector` and `pgcrypto` already exist in `brain` (R5).
- Other writers of `command_center.memory` keep running and are never stopped for this
  step: swarm-prod's dispatch memories (F23) and the research lessons (B20). Their new
  rows stay in `command_center`; the brain no longer sees them.
- The cutover runs in a trading-safe window (execution contract), away from the
  FileMaker sync minutes. No swarm PR merges from step 4 to step 5, so no `deploy-vmc`
  migration run takes a lock during the dump. In this order:
  1. Pause brain writes: `BRAIN_WRITES_PAUSED=1` (REST and MCP; update the secret,
     re-render, restart `plx-brain`), and stop the brain host's job timers (R9), so no
     ported job writes after the snapshot.
  2. Retire VMC's knowledge, second-brain, memory and memory-graph login routes and
     pages (V1). In the VMC host's Caddyfile (backup first), add after the `@brain`
     block and before the catch-all:
     ```
     @retired {
         path /api/vmc/knowledge /api/vmc/knowledge/* /api/vmc/second-brain/* /api/vmc/memory /api/vmc/memory/* /api/vmc/memory-graph/* /vmc/knowledge* /vmc/second-brain* /vmc/memory*
         not path /api/vmc/knowledge/agent/* /api/vmc/knowledge/ingest /api/vmc/knowledge/relations /api/vmc/knowledge/session-artifact /api/vmc/knowledge/mcp
     }
     handle @retired {
         respond 410
     }
     ```
     `caddy validate`, reload, then check: a retired path, and each exact root path,
     returns 410; an `@brain` path returns 200 from the brain; `GET /health` returns 200
     and a keyed `GET /api/vmc/trading-v2/dispatcher/alarm` returns 200 with
     `backendReady: true` (B24). Update PLX_MC's weekly
     health SOP to read the brain's `agent/status` instead of the `second-brain` pages.
  3. Confirm no other brain writer runs (R9's lines and lanes are off). Run the
     lessons check (acceptance, below) and record its result ids.
  4. On the brain host, as `brain_app`, which already reads every `memory` table and
     sequence (the shared `plxadmin` login never reaches the brain host), in one
     session: `BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_export_snapshot(), now();`
     and keep it open. Record `now()` as the cutover time `T`. In that snapshot, record
     each `memory` table's row count, the
     maximum of its serial key (`event_id`, `link_id`, `id`) where it has one, and
     `max(updated_at)` where the table has one. Then
     `pg_dump -Fd -j 2 --snapshot=<id> -n memory -f <dir>` with a PostgreSQL 17 or
     later client (an older `pg_dump` refuses a 17.9 server); close the session. A
     "permission denied" means a `memory` table was added after R5: grant `brain_app`
     `SELECT` on it and start step 4 again.
  5. `pg_restore -O -x --exit-on-error -j 2 -d brain <dir>` as the brain instance's
     master role, so no `OWNER TO plxadmin` or `GRANT … brain_app` is replayed. Then
     grant `brain_svc` on schema `memory` what `brain_app` had (R5), plus the matching
     `ALTER DEFAULT PRIVILEGES`. Compare each table's count and maxima in `brain` with
     the snapshot's. Before unpausing, take a manual RDS snapshot of the brain instance,
     and copy `<dir>` off the host to an encrypted, access-restricted store (it holds
     personal namespaces) for D12's 90 days. Record the snapshot id, the store path and
     the dump's SHA-256 in the evidence.
  6. Point `BRAIN_DATABASE_URL` in `prod/plx-brain` at `brain` as `brain_svc`,
     re-render, restart `plx-brain`, check `agent/status`.
  7. Unpause and start the job timers again; run the replay script for records queued
     during the pause. Evidence: the run table shows no job run between steps 4 and 6.
- After the cutover:
  - Drop `brain_app` from `command_center` (its grants were saved as SQL in R5). Revoke
    nothing from the role VMC and swarm-prod share (D8, F23).
  - Create `brain_audit_ro` on `command_center`: `CONNECT`, `USAGE` on schema
    `memory`, `SELECT` on its tables, nothing else, with R5's checks. Its URL goes in
    `prod/plx-brain` as `BRAIN_AUDIT_DATABASE_URL`. The `plx-postgres-staging` ingress
    rule from the brain's group stays for it for 30 days only.
  - For 30 days, a daily query on the brain host, as `brain_audit_ro`, counts rows in
    `command_center.memory` inserted or updated after `T` whose namespace is not a
    shared writer's. The shared-writer list comes from R0 and T1's writer inventory and
    includes at least `swarm/dispatch/*`, `swarm/lessons/research/*`,
    `tenant/*/briefs` and `swarm/agent/*` (F23); T1 also lists table-level writers.
    New `items` rows alarm. So do new `links` and `knowledge_links` rows marked as
    brain relations (`metadata->>'classification' = 'inferred_link'`, stamped by
    `relations-core.ts:19,101-103`), and new `graph_*` rows whose `extractor` is not
    swarm-prod's `brain_propose_relation@v1` (`brain_graph_ops.py:60`). Other new rows in
    those tables are reported, not alarmed, because swarm-prod writes them too (B28). Any alarmed row is a lost brain write; the query
    emails the operator through the brain's own sender (`BRAIN_RESEND_API_KEY`, a new
    key, never trading's `RESEND_API_KEY`). It also reports the newest
    `swarm/dispatch/*` and `swarm/lessons/research/*` row times, so the shared writers
    are seen to keep writing.
  - After the 30 days: drop `brain_audit_ro`, delete `BRAIN_AUDIT_DATABASE_URL` from
    `prod/plx-brain` (re-render, restart), and remove the `plx-postgres-staging`
    ingress rule and the brain's 5432 egress to that group. The brain host then has no
    path to the shared instance.
  - Never drop `command_center.memory` (D8): the deploy smoke reads it (B13) and trading
    reads its lessons back (B20).
- Remove R8's swarm-search flag, then the search proxy unit on swarm-prod, the
  swarm-prod ingress rule and the brain's `<proxy port>` egress rule (R5).
- Backups: RDS automated backups on the brain's instance plus a brain-host dump timer.
  Never edit `weekly-db-backup.sh`, which is a `shared` VMC-host line.
- Acceptance: at step 5, every table's count and maxima match the snapshot. From the VMC host,
  the eval (HTTP mode) and the full R3 replay are clean; the cleanup runs in `brain`
  as the brain instance's master role. `brain_app` no longer exists. The next day's
  audit query shows `swarm/dispatch/*` rows still arriving. The lessons check passes: sent from the VMC
  host with `SWARM_API_KEY`, as trading's lessons loader sends it
  (`research-runner.ts:410-418`), swarm-prod's
  `/memory/search/v2?namespace=swarm/lessons/research/trading-v2&project_slug=trading-v2&mode=browse&limit=3`
  returns 200 with the ids recorded in step 3, or with newer lessons written since.
  Without `project_slug`, the scope guard answers 403 (`memory_api.py:14-49`). T2 shows
  no new trading failure.
- Rollback: after day 30, first re-add R5's `plx-postgres-staging` ingress and 5432
  egress rules. Pause brain writes and stop the job timers; recreate `brain_app` from
  the saved grant SQL with a new password, and put it in `prod/plx-brain`. Create a
  scratch database `brain_t0` on the brain instance with R5's extension list in the
  same schemas, then restore the kept step-4 dump into it (its SHA-256 must match the
  evidence; `-n memory` carries no `CREATE EXTENSION`). The copy-back script reads
  `brain` and `brain_t0` as the brain instance's master role and writes
  `command_center` as `brain_app`. It copies back every row in `brain` that is new or
  whose content differs from `brain_t0`, matched on each table's natural or dedup key
  (B28: in-place updates to `links`, `knowledge_links` and the embedding backfill leave
  no timestamp, so only a content diff finds them). A changed row is written only if
  the `command_center` row still equals its `brain_t0` version; otherwise swarm-prod
  changed it after `T`, and the script logs a conflict for the operator instead. One
  rule per table (B23), parents before children:
  - Rows in shared-writer namespaces are never copied, so trading's live rows are never
    overwritten.
  - `items`: insert with its uuid; on a natural-key conflict, update the row to the
    brain's content. `attempt_packets`: insert with its uuid, `ON CONFLICT DO NOTHING`
    (no key route writes it).
  - `graph_*`: upsert on each table's natural unique key (`052`), child rows mapping
    their entity and fact ids through those keys; `graph_quarantine` rows insert
    `ON CONFLICT (id) DO NOTHING`.
  - `quantized_embeddings`, `quantized_index_state`: upsert on their keys.
  - `events`: rows above the snapshot's maximum `event_id`, inserted without that key
    so `command_center`'s sequence numbers them (no `setval`); it has no dedup index, so
    the script records the brain ids it copied and a rerun skips them.
  - `links`, `knowledge_links`: new rows inserted without their serial key; changed
    rows updated in place on their dedup index.
  The copy-back is a script in plx_secondbrain, tested in CI on a fixture database
  before the cutover. Then point `BRAIN_DATABASE_URL` back at `command_center` (secret,
  re-render, restart); remove the `@retired` block; unpause. VMC's `DATABASE_URL` is
  never touched (SC-8).

#### R11 — Key scopes that work (plx_secondbrain)

- Wire the scope helpers into the key routes (B14), and pass tenant and namespace
  through search. The existing scope tests become live tests.
- Issue brain department keys where a caller should see only its area. Every brain
  key starts with `brn_`.
- Callers already hold brain keys (R7). Once the key-tier log (R4) shows no request
  with the `VMC_API_KEY` value, or with a VMC department key, for 14 days, the brain
  stops accepting both: `VMC_API_KEY_SHA256` and `BRAIN_SCOPED_KEY_SHA256` leave
  `prod/plx-brain`. VMC keeps its keys (D3).
- Then, in a trading-safe window, VMC's Caddy `@brain` block (R6) also requires
  `header X-Api-Key brn_*`, and answers 401 itself otherwise, so no stray VMC key is
  forwarded to the brain host. As in R6: back up the Caddyfile, `caddy validate`,
  reload; within 2 minutes `GET /health` returns 200 and a keyed
  `GET /api/vmc/trading-v2/dispatcher/alarm` returns 200 with `backendReady: true`
  (B24); if not, restore the backup and reload at once.
- Acceptance: a department key gets 403 or no results outside its scope, with a test
  per route. The unscoped brain key behaves as before. Sent from the VMC host to the
  brain's private port (never to the brain's public name), a request with the
  `VMC_API_KEY` value, or a VMC department key, gets 401 from the brain; through the
  old host it gets 401 from VMC's Caddy without reaching the brain host, while
  `GET https://missioncontrol.tayloralton.com/api/vmc/trading-v2/dispatcher/alarm` with
  that key still returns 200 (F24).

#### R12 — Remove the expired search fallback (plx_secondbrain)

- Remove the fallback marked for 2026-09-30 (B15), once R8's scores are at or above
  the baseline without it.
- Acceptance: eval floors met without the fallback.

### Stage 3 — Trading lab: map it, protect it, rename at the end

The trading lab stays where it runs (D8). This stage makes sure nothing else in this
spec touches it.

- **T1 — Map what trading uses (read-only, with R0).** One table, one row per item,
  labelled `trading`, `shared` or `retire`:
  - VMC routes, pages and crons it uses, including those not named `trading-*`
    (`candidate-evidence-auto-dispatch`, `compute-fabric-reclaim`,
    `research-run?project=trading-v2`), the cron runner, `/api/cron/enabled-check`,
    and VMC's `/api/health` (the workers' deployed-commit check, B13).
  - Every VMC crontab line. `shared` lines include `weekly-db-backup.sh`,
    `refresh-secrets.sh`, the disk janitor, `aws-secrets-flags-watchdog` and
    `vmc_services_watchdog` (F7).
  - Tables in `trading` and in `command_center` (compute jobs and workers, cron
    records, events, the todo store its alerts write), and every writer of
    `command_center.memory`, including the research lessons (B20).
  - The VMC code it imports (F4), and the Python import closure of
    `scripts/trading-research/` into swarm `src/` (F3).
  - Hosts and workers: TRADINGBOX, the compute worker on Spark A, the `dell-vta`
    worker and its Windows tasks (F5).
  - The gateway lane it calls: `local-driver` on Spark B with `LOCAL_LITELLM_MASTER_KEY`,
    from the Dawn harvest, TRADINGBOX's research pipeline and stage-rail escalation
    (fleet F27).
  - Keys and secret loaders: `VMC_API_KEY`, `SWARM_API_KEY`, `SLACK_WEBHOOK_URL`,
    `RESEND_API_KEY`, the Microsoft Graph credentials, `prod/ec2-secrets`,
    `/run/openclaw/secrets.env`, `~/.secrets-env.systemd` (F4, F15, F22).
  - Strings that seed trading ids, which are never edited (F21).
  - Calls to swarm-prod: the readiness check, the market-data alert's dispatch,
    `research-run?project=trading-v2` (F4).
  - The deploy path (F18), the deploy smoke profile (B13), login and identity.
  - local-inference's bridge promotion gate (F11) and PLX_MC's registry, loop-ledger,
    routing-pilot and provisioning entries for the repo (F12).
- **T2 — Protect it.** Before and after every later step, run this checklist and keep
  the output in the step's evidence:
  1. `GET https://missioncontrol.tayloralton.com/health` returns 200, and with
     `VMC_API_KEY`, `GET /api/vmc/trading-v2/dispatcher/alarm` returns 200 with
     `data.backendReady: true`. Record `data.healthy` and `data.findings`; neither is
     worse than before the step (B24, F24).
  2. For each cron T1 labels `trading`, `cron_executions` shows a run within 1.5 times
     its cadence and no new error.
  3. On TRADINGBOX, `~/logs/fleet-freshness-audit.log`, `~/logs/secret-key-parity.log`,
     `~/logs/paper-dispatcher*.log` and `~/logs/exit-monitor.log` show no new failure
     (paths as named in `config/tradingbox-crontab`).
  4. Paper dispatcher and exit monitor run counts match the same weekday a week earlier.
  5. `compute_workers.last_seen_at` is fresh for TRADINGBOX, Spark A and `dell-vta`.
  6. One `local-driver` completion with `LOCAL_LITELLM_MASTER_KEY` returns 200.
  A new failure stops the step and rolls it back. A follow-up check 7 days later
  compares the weekly jobs (walk-forward campaign Mon/Thu, race judge, Friday research
  run, Sunday recalibration and backup) with the 7 days before the step; a regression
  there reopens the step.
- **T3 — Rename at the end.** After S1–S6, and only once trading's tests pass and the
  import closure resolves without the pruned code, prune the non-trading code in normal
  PRs. Then rename, in this order:
  1. PLX_MC's registry gains a second entry for the new slug, with its routing
     manifest digest (the registry has no alias field).
  2. Rename on GitHub. The redirect covers the old slug, so workers keep pulling.
  3. One PR in the renamed repo (its checkout names `repo: <new slug>`) updates git
     remotes, API repo targets and MC stamps only: `x-mc-repo` in `.mcp.json` and `.cursor/mcp.json`,
     `selfupdate-vta-worker.ps1:83`, and any other remote or target. It never edits a
     string that seeds an id (F21).
  4. Repoint local-inference's bridge gate and PLX_MC's loop-ledger, routing-pilot and
     provisioning entries to the new name.
  5. After 30 days, drop the old slug from the registry. Never create a new repo under
     the old name, so the redirect holds.
  Dependabot stays on.
- **Owner:** the operator (vince@petrasoap.com) until a trading owner is named.
- **Acceptance for the stage:** T2 passes before and after every step of this spec.

### Stage 4 — Every other VMC area

#### V1 — Verdicts (operator)

- Apply D9 to the R0 table. Anything T1 labels `trading` or `shared` stays, whatever
  its verdict; only pages and outside callers retire. The proposed defaults:

| Area | Proposed verdict | Why |
|---|---|---|
| todos, todo-execution, queue, today, ledger, cursor | Retire the pages and routes. Keep the todo store, and keep a view of trading's escalation todos (or move the market-data alert first). | PLX_MC is the task system. VMC todos already redirect to the PLX_MC ledger (F14). |
| knowledge (login routes and pages), second-brain, memory, memory-graph | Retire at R10; a Caddy block answers `410` (R10 step 2) | The brain lives in its own service. `command_center.memory` itself stays (D8). |
| projects (51 routes) | Retire, or fold into PLX_MC projects if R0 shows use | Its `project-sync` writes SharePoint lists every 4 hours with no flag (F8). |
| meetings, teams, calendar, ACS webhook | Retire | Joins, recordings, To Do, Planner and calendar writes act on people (F8). |
| email, inbox (the `cos@` assistant) | Retire; Q4 decides whether a fleet agent takes it on later | It sends and moves real mail (F8). |
| chat, investigator, troubleshooter, telegram | Retire | COS chat in the portal and the agent fleet replace them. |
| research, autoresearch | Retire, except `research-run?project=trading-v2` (T1) | A fleet loop can take this on later if wanted. |
| compute, jobs | Stay (trading) | The compute fabric runs only trading jobs (F4). |
| gpu | Retire | Only `vmc/app/api/vmc/gpu/*` uses Vast.ai, and V2 stops it. |
| royale, marketplace, benchmarks, assets, agents, `economy` database | Retire | Swarm-only features. |
| workflows, workflow-dispatch, pipelines, cron-replay | Retire | They drive the swarm. |
| governance, policy, approvals, org, doc-health | Retire | PLX_MC owns governance. |
| health, admin, tenants, db-studio, documents, sharepoint, cheatsheet, factory | Retire, except what T1 labels `shared` (for example `health`) | Operator tools for VMC itself. Check `factory` (the 3D floor plan) in R0. |
| Lobster `daily-brief` | Retire (D11) | The fleet's CoS digest replaces it. |
| Lobster `meeting-action-sync`, `self-healing-triage`, email classifier, reliability sweep, OpenClaw guard | Retire | Swarm operations. |
| Secret loaders (F15 a, b) | Keep | VMC and the trading lab read both files. Never remove one while a service reads it. |
| OpenClaw agent jobs (F15 c) | Retire those that watch the swarm; move the Sentry and documentation scans into COS's brief (fleet P11) or a fleet loop if R0 shows you read them | They are a second agent runtime, the pattern the fleet replaces. |

- **Acceptance:** the operator signs the table.

#### V2 — Stop outside actions first (operator)

- For each F8 item with a retire verdict, stop it in one of these ways only:
  comment out its VMC crontab line (with a backup; D8); disable its Lobster lane or unit
  on swarm-prod; or merge a swarm PR that turns the action off in code, in a
  trading-safe window (a swarm merge is a trading deploy). Never edit a flag in
  `prod/ec2-secrets` (SC-8) and never disable a unit on the VMC host (D5). If an item
  has none of these, stop and ask the operator. Tell the people it acted for. Watch 7
  days for zero actions.
- Order: email send and mailbox moves; SharePoint `project-sync`; ACS joins and
  recording (and delete the Event Grid subscription); To Do, Planner and calendar
  writes; Telegram and Slack (never the trading lab's `SLACK_WEBHOOK_URL`); Vast.ai.
- **Acceptance:** 7 days with no outbound action of each kind, from logs; T2 passes.

#### V3 — Fold-ins (PLX_MC)

- Each area with a fold verdict gets its own PLX_MC spec. This spec only records the
  verdict.

#### V4 — Remove other repos' swarm dependencies (one PR per repo)

- **PLX_MC:** the `.cursor/environment.json` swarm clone and terminal; `SWARM_*` in
  `.cursor/mcp.json`; the `dispatch_to_swarm` tool; `bin/swarm`; the skills seeder's
  swarm path. Keep the registry, loop-ledger, routing-pilot and provisioning entries;
  T3 renames them (F12).
- **portal (optional, needs the operator's own yes):** the operator allowed no change
  to the portal or `staging` from this retirement beyond R2 and R7. This PR is dormant-code
  cleanup, not needed to retire the swarm. If approved: `tools/swarm-dispatch-mcp`; in
  `tools/plx-mc-mcp`, only the swarm tools and `swarm-client.mjs` (the MC lifecycle tools
  stay); `bin/swarm`; `scripts/sync-agents-md.py`'s swarm reads; and, after 14 quiet days
  in Vercel's logs, the CEO bridge API (`portal/src/app/api/external/swarm/v1/**`) and
  `PORTAL_BRIDGE_KEY_CEO`; and the "How work ships / swarm" section of the portal's
  `CLAUDE.md` (S7). If declined, that code and text stay as they are.
- **skills:** `skillparity` must not block without a swarm checkout; drop the
  `vmc-*` skills from the manifest.
- **local-inference:** keep the bridge promotion gate (trading, F11); T3 repoints it.
- **Acceptance:** `git grep -n "agentic-swarm\|SWARM_API\|:8900"` in each repo's code
  and config returns only history notes and the kept entries above.

### Stage 5 — Shut down what retires, then rename (operator)

Every step runs T2 before and after (D8).
- **S1 — Crons and Lobster.** After V2 and R9, comment out every VMC crontab line that
  T1 labels `retire` (with a backup). Before stopping the Lobster scheduler, confirm the
  VMC host's own `weekly-db-backup.sh` line is live and ran last Sunday, because Lobster
  also runs a backup lane that covers `trading`. Then stop Lobster. `trading` and
  `shared` lines stay.
- **S2 — swarm-prod.** Gate: R8, R9 and S1, and T1 shows no remaining trading call to
  swarm-prod. Today there are three (the readiness check, the market-data alert's
  dispatch, `research-run?project=trading-v2`); swarm-prod keeps running until the
  trading owner removes them. Then: keep `SWARM_DEPLOY_ENABLED` unset or `false`; stop
  and disable `swarm-services-watchdog.timer` first; then stop and disable
  `swarm-serve` and `hermes-agent`. `vmc-services-watchdog` stays. Keep the instance
  stopped, not terminated, for 30 days.
- **S3 — Prune VMC web.** `vmc-web.service` keeps running for the trading lab. Remove
  the retired areas' routes and pages in normal PRs, after 14 quiet days on each, each
  merged in a trading-safe window. A PR that removes code imported anywhere in
  `vmc/app/api/vmc/internal/smoke/route.ts` (both profiles, B13) changes the smoke route
  in the same PR, and its `npm run build` check must be green before merge, because
  `deploy-vmc.sh` builds in place. No PR drops a table the schema audit checks.
- **S4 — Databases.** Snapshot and drop `economy` after 90 days. `command_center` stays,
  because the trading lab uses its compute, cron, event and todo tables; the brain's
  data left it in R10. The RDS instance stays (D12).
- **S5 — Secrets.** Revoke or rotate only secrets that T1 labels `retire`:
  `SWARM_MEMORY_ADMIN_KEY` (after S2), `GITHUB_WEBHOOK_SECRET`, the ACS secrets,
  `HERMES_WEBHOOK_SECRET`, `TELEGRAM_*`, and `PORTAL_BRIDGE_KEY_CEO` if V4's portal PR
  is approved. Never `VMC_API_KEY`, `SWARM_API_KEY`, `SLACK_WEBHOOK_URL`,
  `RESEND_API_KEY` or the Microsoft Graph credentials, which trading uses (D8, F22).
- **S6 — The old address.** `missioncontrol.tayloralton.com` stays, because the trading
  lab uses it. The R6 block keeps sending brain paths to the brain host (from R11,
  only requests that carry a brain key).
- **S7 — Clean up.** Close the Dependabot PRs that touch only removed code. Update the
  PLX_MC and skills guides that describe the swarm as live through normal PRs. The
  portal's `CLAUDE.md` "How work ships / swarm" section changes only in V4's optional
  portal PR. Terminate swarm-prod after its 30 days,
  if S2 stopped it. Then T3 renames the repo.
- **Acceptance for the stage:** SC-6.

## 9. How this fits with the COS Companion, the EventBridge work and the fleet

- **COS chat is not affected by the brain move** (C1). Fleet P10 keeps COS on its
  own store until R11 is accepted, so no step in stages 1 and 2 can break it.
- **The COS Companion is touched in one place:** its `companion_open` session record
  (C2). R6 keeps it working on cutover day; R7 changes its base URL and key.
- **The admin Knowledge Hub works again** (B3, R2 shipped).
- **The EventBridge pacer is untouched.** It never calls VMC or the swarm (C4). It
  stays the portal's staging clock. Nothing in this spec schedules through it (D7).
- **Brain jobs adopt the portal's job pattern** (C5, D7).
- **The Lobster `daily-brief` retires** into the fleet's CoS brief (D11).
- **Where the fleet spec meets this one:**
  1. **CoS brief (fleet P11, D17)** replaces the Lobster `daily-brief`. It reads what
     already exists and does not duplicate `/api/admin/digest` or Awaiting You T904 (C6).
  2. **Hasitha UAT fixes (fleet P14, D18).** The runner takes over the Hermes executor
     role: it pulls UAT jobs from the portal, speaks `uat-agent/v2`, and pushes only its
     branch; the portal keeps the checkout, the PR and ticket status (C3, C7).
  3. **Runner repo (fleet P6).** It copies the bridge's hardened parts. The Dell VTA
     bridge's two Windows tasks retire after the runner takes over; the Dell's trading
     tasks stay.
  4. **Run records (fleet P4a, D19)** live in a new `AgentRun` table in the job-pattern
     shape (C5).
  5. **Kill switch (fleet D20).** The runner obeys `Agent.status` and `TRIPLE_T_ENABLED`
     through the portal (C9).
  6. **Persona-QA worker (fleet D22)** stays a second agent worker (C8).
  7. **The pacer's minutes (fleet P6).** Runner loops that touch the UAT database avoid
     the inbound Business Central minutes (C4).
  8. **The fleet proxy (fleet D5).** Brain jobs that need a chat model use it with a
     cloud-only key (D6), so they add no load to `local-driver` or to the Dell's local
     models.

## 10. Changes made in the frontier spec (r12), and what r13 must pick up

Frontier r12 (28 Sep 2026) applies these. Its round 9 review found 0 blockers.
- **P7** is withdrawn, and so is D6. The writers write only the swarm repo, which no
  frontier phase edits now. This spec's R1 turns both writers off (agentic-swarm#1629).
- **P8** drops its swarm half, and D10 is withdrawn. Three halves remain: PLX_MC,
  plx_secondbrain, portal.
- **P9, P10** remove the swarm from their repo lists.
- **P13** runs as it is, and records that the brain moves (R4, R6, R7).
- **P14** becomes a later yes that names `BRAIN_URL`, the brain's own address from
  R6a. It needs only that host answering `brain_self_check`, not all of R7.
- **PLX_MC PR #255** holds frontier P4 (its code branch) and P16 until it merges or
  closes. If it merges, frontier r13 re-derives the lease and merge-queue rules.
- **For frontier r13:** P14 must register the brain with a key from `BRAIN_API_KEYS`,
  never the `VMC_API_KEY` value (D3, R11). Its `BRAIN_URL` is this spec's
  `BRAIN_BASE_URL`. Frontier F26 says R7 removes the R6 routes; this spec keeps them for
  good (D4), and r13 should say so.
- **Scheduling:** a PR from this spec that edits the same files as a frontier phase
  never runs alongside it on the same repo. Known overlaps: R7 (PLX_MC governance
  contract and regenerated guides) and S7 (portal `CLAUDE.md`, PLX_MC guides), both
  against frontier P8 and P10.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Callers outside the repos (operator scripts, notebooks, phone shortcuts). | R0 counts callers from Caddy's and VMC's logs; 14 quiet days before any stop (D1); the R6 block stays for good. |
| The lifted brain behaves differently. | Paired replay and eval floors over HTTP (R5); instant Caddy rollback (R6). |
| A trading-capable key leaks from the internet-facing brain host. | The brain stores only hashes of `VMC_API_KEY` and the department keys (D3, B22), but raw keys still arrive in requests until R11 (B26): the brain never logs them (R4, R6a); R7 moves every caller, department-key holders included, to brain keys; and R11 makes VMC's Caddy forward only brain keys. The brain never holds a swarm key (B27): a search-only proxy on swarm-prod holds them. The instance role reads only `prod/plx-brain`, and the service user cannot reach the metadata service. The env file is 0600; outbound traffic is an allow-list; the tailnet reaches only the fleet proxy. Replays that need a key's value run from the VMC host (R5). |
| Session records lost while the brain's database moves (R10). | The hooks queue, and a manual replay script exists (B19). R10 moves it to plx_secondbrain and replays after the pause, or the operator accepts the loss for the pause window. |
| A step breaks the trading lab. | D8 and SC-8; T2 before and after every step; swarm merges only in a trading-safe window. |
| A brain setting overrides a VMC setting. | Separate names (`BRAIN_*`), a separate env file and secret, and a separate host (execution contract, D5). |
| Renaming the repo breaks a worker's pull or a compliance stamp. | T3's order: registry accepts both slugs, rename, then one PR for remotes, targets and stamps; never reuse the old name. |
| Rotating shared Graph credentials breaks the portal or trading. | This spec never rotates them (S5, SC-8); the brain gets its own Graph app (R5). |
| Dropping the wrong database. | Drop databases only, never the RDS instance, after 90-day snapshots (D12). |
| People lose a tool they still use (the `cos@` assistant, meeting recording, SharePoint project lists). | D10: owner sign-off and notice, one action at a time (V2). |
| Removing a secret loader breaks VMC or trading. | Both stay (F15, V1). |
| A Lobster workflow outside any repo writes to the portal. | R0 reads all three before anything else touches them. |
| Pruning VMC areas breaks trading deploys. | S3 changes the `deploy` smoke probe in the same PR that removes code it imports; no table the schema audit checks is dropped. |
| Revoking writes on `command_center.memory` breaks trading's research lessons or swarm dispatches (B20, F23). | R10 revokes nothing on the shared role; it drops only `brain_app` and counts stray brain writes. |
| The rename changes trading's ids (F21). | T3 edits git remotes, API targets and MC stamps only. |

## 12. Order

R1 is under way (its swarm PR is open). R2 has shipped. R0 comes next. R3 → R4 → R5
→ R6 → R6a → R7 is the lift. R5's tailnet fence waits for fleet P1, which creates
`tag:fleet-proxy`; R5 adds `tag:plx-brain` and its own accept rule. R8 also waits for fleet P1, which creates the fleet's OpenAI
organisation for the embedding key. R9 also waits for fleet P2 (the brain's fleet key). R8 → R9 → R10 → R11 → R12 is the simplify step, and it
starts after R6. T1 runs with R0; T2 applies to every later step; T3 runs last.
V1 → V4 run beside the brain work. S1–S7 wait on the gates named in each.

## 13. Questions and answers

- **Q1. The brain's hostname.** Answered 28 Sep 2026: `brain.plxcustomer.io`.
- **Q2. The trading repo.** Answered 28 Sep 2026: the trading lab must not be affected.
  It stays and keeps this repo, renamed at the end (D8, Stage 3). Owner: the operator
  until a trading owner is named.
- **Q3. OpenClaw.** Answered 28 Sep 2026: the jobs are the operator's. Keep the secret
  loaders; retire or move the agent jobs after R0 (V1).
- **Q4. The `cos@` email assistant.** Deferred to V1. R0 shows whether anyone still uses
  it; nothing needs deciding before then.
- **Q5. The portal jobs on the VMC host.** Answered 28 Sep 2026: both stop in R1. Neither
  can change the portal codebase (F16, F17), and PLX_MC does not use the SharePoint
  job's output.
- **Q6. The brain's host and database.** Answered 28 Sep 2026: its own EC2 host (D5)
  and its own RDS instance (D13).

## 14. Out of scope

- Any move of the trading lab (its owner's own spec).
- PLX_MC fold-ins (each its own spec).
- Changes to the COS Companion itself, including its open gaps.
- The agent fleet spec's own phases (section 9 lists where they meet).
