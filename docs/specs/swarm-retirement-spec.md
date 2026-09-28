---
title: Swarm retirement — implementation spec
revision: r4 (28 Sep 2026: decisions confirmed; the trading lab stays untouched and keeps the repo; Q1–Q5 answered)
status: decisions confirmed 28 Sep 2026; not reviewed
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
- The agent fleet spec replaces the swarm's agent roles. It does not depend on the swarm. Section 9 lists what this spec changed there (fleet r4).
- The COS Companion and the EventBridge pacer are mostly untouched. Section 9 explains where they meet this spec.
- The frontier spec is now r12. Section 10 lists what changed there.

## 2. Facts — the brain (checked 28 Sep 2026)

Paths below are in `petralabx/agentic-swarm` unless a repo is named.
`vmc/` means `apps/vmc-web/src/`.

| # | Fact | Source |
|---|---|---|
| B1 | Eight callers outside the swarm use the brain. **portal:** the knowledge client (admin Knowledge Hub search and article open), the COS Companion's session record, the IDE session-end hook, the Markdown ingest script. **PLX_MC:** Ask the Brain, `/api/cursor/knowledge/search` and the `mc_search_knowledge` MCP tool, plus the session-end hook. **plx_secondbrain:** the plx-brain MCP server (9 tools). **local-inference:** the SharePoint organizer harness. Inside the swarm, two scripts also post to it. | portal `portal/src/lib/knowledge/service/vmc-client.ts`, `portal/src/lib/agents/cos-session-artifact.ts`, `scripts/session-artifact-closeout.mjs`, `scripts/markitdown/ingest_to_brain.py`; PLX_MC `src/lib/brain-ask/client.ts`, `src/lib/mcp/read-actions.ts:154-219`, `scripts/compliance-closeout.mjs`; plx_secondbrain `src/tools.ts:8-18`; local-inference `.orchestrator/sharepoint-doc-org-harness/harness/ledger/brain.py`; swarm `scripts/cursor-hooks/session_artifact_lib.py`, `scripts/workstation-maintenance/runtime/hygiene_harvest.py` |
| B2 | Every caller sends `X-API-Key` with `VMC_API_KEY`. Most read `VMC_BASE_URL` and fall back to `https://missioncontrol.tayloralton.com` written in the code. plx_secondbrain falls back to `http://localhost:3100`. The two session-end hooks run on every developer and agent machine. | B1 files; PLX_MC `src/lib/secrets.ts:184-195`; plx_secondbrain `src/config.ts:14` |
| B3 | **The portal's brain reads already fail in production.** Its search calls `/api/vmc/knowledge/search`, which accepts only a browser login. Its article open calls `/api/vmc/knowledge/items/{id}`, which does not exist. A live probe on 28 Sep 2026 returned 401 "Authentication required" and 404. The client fails open, and its health check counts 401 as reachable. So the admin Knowledge Hub gets nothing from the graph, and nothing looks wrong. COS chat is not affected: it reads the portal's own resolved-ticket store in Postgres (C1). | `vmc-client.ts:143-178`; `read.ts:86-108`; `hub-ask.ts:29-45`; `vmc/app/api/vmc/knowledge/search/route.ts:5`; `vmc/lib/vmc/api/api-handler.ts:505-513` |
| B4 | The brain has 20 route files. 11 use key auth and serve every outside caller: `agent/{search,items,node,document,subgraph,trail,status}`, `ingest`, `relations`, `session-artifact`, `mcp`. 9 use browser-login auth and serve only the VMC web UI. The four `/api/vmc/second-brain/*` routes are also login-only; a PLX_MC weekly health checklist opens two of them in a browser. | `vmc/app/api/vmc/knowledge/**`; `vmc/app/api/vmc/second-brain/**`; PLX_MC `docs/PLX-BRAIN-WEEKLY-HEALTH-SOP.md:23-25` |
| B5 | Responses use one envelope: `{ data, meta }` on success, `{ error: { code, message } }` on failure. The `mcp` route speaks MCP JSON-RPC instead. | `vmc/lib/vmc/api/api-handler.ts:366-380` |
| B6 | Search does not run in VMC. The memory and document lanes call the swarm's Python API, `GET /memory/search/v2`. The swarm embeds the query through an OpenAI-compatible `/embeddings` call (default `text-embedding-3-small`) and ranks the results. The graph lanes run SQL inside VMC. | `vmc/lib/vmc/knowledge/search-core.ts:236-249,569-604`; swarm `src/api/fastapi_app.py:658-696`; `src/memory/embeddings.py` |
| B7 | Of the 11 key routes, only search needs the swarm. The rest read or write Postgres directly, or read the document catalog. Direct writes (`ingest`, `session-artifact`) leave `embedding` empty; swarm jobs fill it in later. | `vmc/lib/vmc/knowledge/ingest-core.ts`; `session-artifact/route.ts:51-103`; swarm `src/memory/matrix.py:277` |
| B8 | 12 scheduled jobs feed the brain: `second-brain-ingest`, `internal-rag-ingest`, `second-brain-dispatch-ingest`, `second-brain-compile`, `wiki-compile`, `second-brain-lint`, `kb-decisions-sync`, `rollup-distill`, `lessons-auto-extract`, `memory-summarize`, `sharepoint-sync`, and a read-only watchdog. VMC's crontab calls `/api/cron/<name>`, and most of those call swarm Python jobs. `knowledge-extract` has a route but no crontab line. | `config/vmc-web-crontab:77-173`; `src/pipelines/*.py` |
| B9 | The brain's data is schema `memory` in VMC's main database (`command_center`, `DATABASE_URL`). That database also holds projects, todos and the login tables. Trading uses a separate database. Tables: `memory.items` (pgvector 1536 with an HNSW index, full-text GIN index), `links`, `knowledge_links`, five `graph_*` tables, and two quantized-embedding tables. | `vmc/lib/vmc/db.ts:7-52`; migrations `021, 022, 029, 042, 047, 048, 052, 053, 068` in `vmc/lib/vmc/db/migrations/` |
| B10 | The brain code is `vmc/lib/vmc/knowledge/` (19 files, 3,625 lines). It imports memory-graph, swarm-client, the document catalog, the DB pool, the API wrapper (auth, rate limit, budgets) and the secret reader. Search cache, rate limiter, idempotency cache and concurrency limits live in process memory. | `vmc/lib/vmc/knowledge/*` |
| B11 | The document catalog reads local repo copies (`VMC_PLX_MC_ROOT`, `VMC_PLX_PORTAL_ROOT`, `VMC_SWARM_ROOT`, `/home/ubuntu/...`) and SharePoint through Microsoft Graph. | `vmc/lib/vmc/document-sources.ts:54-87` |
| B12 | Tests: 14 TypeScript files (about 133 cases) and 22 Python files cover the brain. | `vmc/lib/vmc/__tests__/`; `tests/` |
| B13 | VMC runs as systemd unit `vmc-web.service` (`next start --port 3100`) on EC2. Caddy terminates TLS for `missioncontrol.tayloralton.com` and proxies to it. The Caddyfile is not in the repo. Deploys run `deploy-vmc.sh`: build, migrations, restart, health check. | `systemd/vmc-web.service:12-22`; `AGENTS.md:98-108`; `scripts/deploy-vmc.sh:16,172-177` |
| B14 | **Department-scoped keys do not limit anything.** `VMC_SCOPED_API_KEYS` keys see all non-personal knowledge. The scope helpers exist but only tests call them. Every key request is bound to tenant `plx`. | `vmc/lib/vmc/knowledge/namespace-scope.ts:154-261`; `docs/knowledge-os/KEY_TIERS.md:78-84` |
| B15 | A search fallback is marked "remove after 2026-09-30". | `vmc/lib/vmc/knowledge/search-core.ts:370-375` |
| B16 | The deployed HTTP MCP endpoint is `https://missioncontrol.tayloralton.com/api/vmc/knowledge/mcp`. The frontier spec's P14 registers it in Cursor. | `docs/runbooks/brain-mcp.md:16,33` |
| B17 | plx_secondbrain today is the stdio MCP server plus an eval harness. The harness has golden fixtures and floors: precision@5 ≥ 0.79, recall@10 ≥ 0.75, hallucination ≤ 0.055, idempotency ≥ 0.995. A weekly workflow runs it. | plx_secondbrain `eval/second-brain/README.md`; `.github/workflows/second-brain-eval-weekly.yml` |
| B18 | The PLX_MC governance contract tells every session to post its record to `$VMC_BASE_URL/api/vmc/knowledge/session-artifact (e.g. https://missioncontrol.tayloralton.com)`. The generator copies that text into CLAUDE.md, AGENTS.md and the other runtime guides. | PLX_MC `config/governance-contract.yaml:260` |

## 3. Facts — the rest of the swarm (checked 28 Sep 2026)

| # | Fact | Source |
|---|---|---|
| F1 | VMC has 436 route files: 379 under `/api/vmc` in about 45 areas, and 52 cron routes. The largest areas are trading-v2 (103), projects (51), knowledge (20), compute (16) and royale (14). | `vmc/app/api/**` |
| F2 | **No live broker trading.** The only order path sends Alpaca *paper* orders, and its flag is off by default. IBKR is read-only. | `vmc/lib/vmc/trading-v2/brokers/alpaca-adapter.ts:21,153,164`; `trading-v2-flags.ts:158-161`; `trading-v2-broker-adapter.ts:26-112` |
| F3 | The trading lab is large: about 97k lines of Python in `scripts/trading-research/`, about 78k lines of TypeScript across trading lib, routes, crons and UI, 111 Python and 55 TypeScript test files, 167 docs, and two terraform stacks. It has its own database (`trading`) and 70 `trading_*` migrations. | `scripts/trading-research/`; `vmc/lib/vmc/trading-v2/`; `vmc/lib/vmc/db/migrate.ts:337,488`; `infra/terraform/{trading-v2-dispatcher-alarm,wf-stage2-canary}` |
| F4 | Trading leans on shared VMC code (the API wrapper 122 times, the DB pool 61 times, the compute-fabric jobs, cron bookkeeping, events and the todo store). Its paper dispatchers call the VMC API at `missioncontrol.tayloralton.com`. The compute fabric runs only trading jobs. | `scripts/trading-research/paper_dispatcher.py:82`; `exit_monitor.py:23`; `scripts/compute-fabric/job_specs.py` |
| F5 | Four hosts run swarm code. **VMC host** (EC2): the web app, watchdogs and its crontab. **swarm-prod** (EC2): `swarm serve` on :8900, the Hermes gateway on :8644, a public Cloudflare quick tunnel to :8900, the Lobster scheduler. **TRADINGBOX** (EC2): trading crons and a compute worker. **DGX Spark**: a compute worker. The workers, and Windows tasks on the Dell VTA, reset to `agentic-swarm` `origin/main` every 15 minutes. | `systemd/*.service`; `config/tradingbox-crontab`; `docs/architecture/multi-host-separation.md:94-98`; `scripts/compute-fabric/*.ps1` |
| F6 | Eight Lobster pipelines are enabled, including `daily-brief` (06:30 ET weekdays), `meeting-action-sync` (every 15 min), and `governance-repo-sync`, which commits and pushes to git nightly. | `config/pipelines.yaml:78-686`; `src/pipelines/governance_repo_sync.py:194-199` |
| F7 | **The VMC host crontab also runs jobs from other systems.** Portal: `daily-status-report.sh` commits with `--no-verify` and pushes to portal `staging` daily, then sends an executive email; `auto-sync-sharepoint.sh` syncs a roadmap register. OpenClaw: six monitoring jobs. | `config/vmc-web-crontab:22-50`; portal `scripts/daily-status-report.sh:90-107` |
| F8 | **Some pieces act on people or outside services:** email sent as `cos@petrasoap.com` from approved drafts, with no flag; mailbox moves and archives; SharePoint list writes every 4 hours from `project-sync`, with no flag; Teams meeting joins and call recording through ACS, with an Event Grid webhook; To Do, Planner and calendar writes; Telegram and Slack posts; Vast.ai GPU start and stop. | `vmc/lib/vmc/email/email-actions.ts:34-35,529-598`; `vmc/lib/vmc/projects/project-m365-sync.ts:351-366`; `vmc/app/api/vmc/teams/meetings/join/route.ts`; `vmc/lib/vmc/calendar.ts:235-286`; `vmc/app/api/vmc/gpu/[id]/route.ts` |
| F9 | Inbound doors to close: the Cloudflare quick tunnel, the GitHub webhook, the ACS Event Grid webhook, the Hermes :8644 webhook, the portal's "CEO bridge" keys, and Caddy for `missioncontrol.tayloralton.com`. | `systemd/swarm-cloudflare-tunnel.service:14`; `vmc/app/api/webhooks/github`; portal `portal/src/app/api/external/swarm/v1/**` |
| F10 | All three swarm databases (`command_center`, `trading`, `economy`) sit on one RDS instance, `plx-postgres-staging`, which also holds the portal's development database. So retirement drops databases, not the instance. | `AGENTS.md:219-228`; portal `CLAUDE.md` (Deployment) |
| F11 | **Other repos depend on the swarm in a few places.** PLX_MC's Cursor cloud environment clones and runs `swarm serve`, and its MCP server has a `dispatch_to_swarm` tool (default off). The portal has a dormant `swarm-dispatch-mcp` with dispatch on by default, a `bin/swarm` wrapper, and the CEO bridge API that VMC reads. skills' `skillparity` blocks without a swarm checkout. local-inference uses a swarm script as a health gate. No repo uses the swarm as a submodule or package, and no CI checks it out. | PLX_MC `.cursor/environment.json:3-8`, `.cursor/mcp.json:18-21`, `tools/plx-mc-mcp/index.ts:508-518`; portal `tools/swarm-dispatch-mcp/server.mjs:43-49`; skills `skills/skillparity/scripts/run.py:66,188-194`; local-inference `config/execution-primitives.local.yaml:33` |
| F12 | PLX_MC tracks `petralabx/agentic-swarm` as active, compliance `hard`, default bucket `BKT-INFRA`. It also appears in the loop-ledgers registry, a routing pilot, and the fleet provisioning lists. | PLX_MC `config/tracked-repos-registry.json:61-82`; `config/loop-ledgers-registry.json:5-12`; `config/routing-pilots/agentic-swarm.json` |
| F13 | 15 Dependabot PRs are open on the swarm repo. | GitHub, 28 Sep 2026 |
| F14 | VMC's todo pages already redirect to the PLX_MC ledger. | `vmc/app/vmc/todos` (TASK-1703) |
| F15 | **OpenClaw on the VMC host is two things.** (a) The secrets loader: `openclaw-secrets.service` and its 15-minute timer write `/run/openclaw/secrets.env` from AWS Secrets Manager, and `vmc-web`, `swarm-serve`, `hermes-agent` and the watchdogs read that file. (b) Agent jobs in `/home/ubuntu/clawd`: session health (every 15 min), an audit monitor, "monitor agents" (every 10 min), a morning Sentry-error scan, an evening documentation scan, a nightly cleanup, and three Lobster workflows kept outside any repo (`agentic-swarm-sync`, `plx-roadmap-sync`, `plx-status-update`), plus an M365 token keep-alive. | swarm `systemd/vmc-web.service:18`; `docs/architecture/multi-host-separation.md:298-412`; `config/vmc-web-crontab:22-50` |
| F16 | The portal's `daily-status-report.sh` commits `docs/` with `--no-verify` and pushes to `staging`, then emails an executive summary. No commit from it has reached `staging` since 19 May 2026, so its push fails or never runs. | portal `scripts/daily-status-report.sh:90-107`; `staging` history of `docs/PROJECT-STATUS-SUMMARY.md` |
| F17 | The portal's `auto-sync-sharepoint.sh` never writes to SharePoint. It rebuilds `docs/sharepoint-updates.json` in the VMC host's portal copy, commits it locally without pushing, and logs "Manual SharePoint update required". PLX_MC syncs its own Milestone Register list through its own SharePoint integration and does not read that file. | portal `scripts/auto-sync-sharepoint.sh`; PLX_MC `docs/product/SHAREPOINT_INTEGRATION.md:30,90` |

## 4. Facts — the COS Companion and the EventBridge pacer (checked 28 Sep 2026)

Paths are in `petralabx/plx-customer-portal` unless a repo is named.

| # | Fact | Source |
|---|---|---|
| C1 | **COS chat does not read VMC.** COS's knowledge policy is `namespace`, which reads the portal's own resolved-ticket store in Postgres. The VMC graph is read only by the admin Knowledge Hub (search and article open) and by agents whose policy is `global`. | `portal/src/lib/knowledge/service/read.ts:86-108`; `agent-read.ts:81-92`; `hub-ask.ts:29-45`; `portal/src/lib/agents/pilot-agents.ts:105-112` |
| C2 | The COS Companion is shipped on the web (companion window, Bench, bridge), plus a desktop shell (D1). Desktop D2–D5 are in backlog. Its only VMC call is one `companion_open` session record per open. It expects nothing from the swarm, Hermes or a runner. Its specs rule out a new runtime, local models and an agent OS. | `docs/projects/cos-companion/README.md` (staging, 28 Sep); `portal/src/lib/agents/cos-session-artifact.ts:11-90`; `DESKTOP-SPEC.md:41-54` |
| C3 | UAT reconciliation R0–R9 shipped 25–27 Sep. The Seal, `/uat`, the sidebar badge and COS chat share one ticket model. Status changes go through "one door", and every run writer, Hermes included, writes a run graph. | `docs/projects/cos-companion/README.md`; `UAT-TICKET-CONTRACT.md` |
| C4 | **The EventBridge pacer is the portal's staging clock.** It is Lambda `plx-bc-cron-ping` in AWS us-east-1. It triggers Business Central outbound (every 5 min) and inbound (4 times an hour), and the Awaiting You work-routing relay (hourly and daily, through a GitHub workflow). Since 28 Sep it also runs the UAT loops (#1578 and #1579 merged; #1580 open adds its tests). Production uses Vercel crons. Nothing here touches VMC or the swarm. | `scripts/aws/bc-cron-ping/`; `scripts/aws/deploy-bc-cron-ping.ps1:110-159`; `docs/runbooks/BC-CRON-HTTP-PACER.md`; PRs #1578–#1580 |
| C5 | **The portal has one pattern for scheduled jobs** (Awaiting You FR-028). One core function is called by a cron route, a CLI, a GitHub Action and an admin action. Each run writes a row with its caller, a correlation id, the mode, and a lock that turns a second run into `SKIPPED_LOCKED`. | `specs/awaiting-you/spec.md:192`; `portal/src/lib/work-routing/runner.ts:1-24,66,157`; `schema.prisma:8285-8304` |
| C6 | **Several digests exist or are planned:** `/api/admin/digest` (production, weekdays 13:00 UTC, all STAFF+); the UAT stall digest and ops digest; Awaiting You T904, a planned department daily brief; and the swarm's Lobster `daily-brief` (06:30 ET weekdays). The COS panel's Tasks tab is an empty placeholder. | `portal/src/app/api/admin/digest/route.ts:8-16`; `specs/awaiting-you/tasks.md:113,164`; swarm `config/pipelines.yaml:78-99`; `agent-panel.tsx:1673-1677` |
| C7 | The Hermes bridge is built for UAT only: contract `uat-agent/v2`, canary by default, at most two runs at once, Windows scheduled tasks on the Dell VTA. The portal's UAT dispatch chooses an executor: Cursor Cloud first, Hermes as fallback. | `scripts/uat-agent/hermes-bridge/README.md:3-10,57-98,177-178`; `docs/projects/plx-agents-platform/COS-CLOSEOUT-HANDOFF.md:18-26` |
| C8 | A second agent worker already exists: `services/persona-qa-worker` runs the persona-QA agents after each deploy. Their cadence sits in `evalConfig.notes`. | `portal/src/lib/agents/persona-qa-agents.ts:1-8,441-448` |
| C9 | The agent kill switch today is `Agent.status` plus `TRIPLE_T_ENABLED`. The companion docs rule out a second kill switch. | `docs/projects/cos-companion/OS-GAP-VALIDATION.md:21-22,42-44` |

## 5. Decisions

| # | Decision | State |
|---|---|---|
| D1 | **Order:** measure, brain, other areas, then shut down what retires and rename the repo for trading. Nothing stops until its callers have moved and its logs show 14 quiet days. | Confirmed 28 Sep 2026 |
| D2 | **The brain moves in two steps:** lift it as it is, then simplify. | Confirmed 28 Sep 2026 |
| D3 | **The lift changes nothing callers can see:** same paths, envelope, header, key values and database. | Confirmed 28 Sep 2026 |
| D4 | **Cutover is by path at Caddy,** for the 11 key routes only. VMC's own knowledge pages keep working until VMC stops. | Confirmed 28 Sep 2026 |
| D5 | **The brain's home is `plx_secondbrain/service/`,** on the current VMC EC2 host, at `brain.plxcustomer.io` (Q1). The host stays. VMC keeps running there for the trading lab (D8). | Confirmed 28 Sep 2026 |
| D6 | **The brain keeps `text-embedding-3-small`,** so stored vectors stay valid. After step 2 it calls the embedding provider itself. Brain jobs that need a chat model use the fleet gateway, which means the brain host joins the tailnet. | Confirmed 28 Sep 2026 |
| D7 | **Brain jobs follow the portal's job pattern** (C5): one core function, a cron route and a CLI, and a run table. The brain host's own timer runs them. The EventBridge pacer stays the portal's staging clock and schedules nothing in this spec. | Confirmed 28 Sep 2026 |
| D8 | **The trading lab is not touched.** It keeps running where it runs today: its code in this repo, its web app and API inside VMC, its database, TRADINGBOX, its compute workers, its crons, its secrets and the `missioncontrol.tayloralton.com` address. No step in this spec stops, edits, reroutes or rotates anything the trading lab uses (Stage 3 maps it). When everything else has left, the repo is pruned of non-trading code and renamed (for example `trading-lab`), so trading keeps its history, secrets, workflows and deploys. Any later move is the trading owner's own spec. | Confirmed 28 Sep 2026 (amended the same day from a `git filter-repo` move, after the operator ruled out any impact on trading) |
| D9 | **Every other VMC area retires by default.** An area folds into PLX_MC only if R0 shows human use in the last 30 days and the operator says why it is needed. | Confirmed 28 Sep 2026 |
| D10 | **Anything that acts on people or outside services stops first,** one at a time, each with a named owner's sign-off (F8). | Confirmed 28 Sep 2026 |
| D11 | **The Lobster `daily-brief` retires,** and COS's daily brief (fleet P11) replaces it. | Confirmed 28 Sep 2026 |
| D12 | **Nothing is deleted outright.** Database snapshots are kept for 90 days. The GitHub repo is not archived; it becomes the trading lab's repo (D8). The RDS instance stays, because it also holds the portal's development database (F10). | Confirmed 28 Sep 2026 |

## 6. Success criteria

| # | Criterion | Check |
|---|---|---|
| SC-1 | Every brain caller works through the brain service. | R3 contract replay clean; eval floors met (B17) |
| SC-2 | No caller changes code on cutover day. | R6 |
| SC-3 | Before any surface stops, its logs show 14 quiet days, and anything that acts on people has a named owner's sign-off. | R0 report; V2 sign-offs |
| SC-4 | The admin Knowledge Hub returns graph results. | R2 acceptance |
| SC-5 | After stage 2, no brain request runs swarm code. | R8 acceptance |
| SC-6 | After shutdown, nothing retired still runs: no Lobster scheduler, no non-trading VMC area, no swarm service the trading lab does not use, no swarm clone in PLX_MC's cloud environment. No retired secret still works. The trading lab shows no new failure at any step. | S-phase checks; T2 health comparison |
| SC-7 | Every repo change carries a live MC stamp for its own repo. | The `compliance` check on each PR |

## 7. Execution contract

- Every phase that edits a repo needs its own MC TASK and checkout: search, create
  only on a real miss, `mc_checkout_task` with `repo`, `prBodyLine` in the PR body
  at open, last commit, then `mc_complete_task`, then freeze.
- One phase per PR. Draft PRs only. Agents never merge.
- Operator phases (Caddy, systemd, DNS, RDS, AWS, Azure) record what was changed
  and how to undo it in the phase's evidence file.
- A "quiet" window means zero requests in the access logs for the paths in question,
  counted per day.
- `agentic-swarm` stays tracked in PLX_MC, compliance `hard`, until S7. Changes to it
  before then still need a stamp.
- Dates and times shown to the operator are ET.

## 8. Phases

### Stage 0 — Measure, and stop what should not run

#### R0 — Usage audit (operator, read-only)

- **Repo edit:** none.
- On each host (VMC host, swarm-prod, TRADINGBOX, the DGX Spark worker):
  - `systemctl list-units --type=service,timer` and `crontab -l` for every user.
    Compare with the repo copies (`systemd/`, `config/*-crontab`) and list the
    differences.
- From Caddy's access logs (as far back as they go, at least 14 days):
  - Requests per day for each `/api/vmc/<area>` and each `/vmc/<page>`.
  - For each, who called: session user, `X-Agent-Name`, or user agent.
- From `command_center` (read-only): the last run and failure count of each cron
  job (`cron_executions`), and row-count changes per table over 7 days
  (`pg_stat_user_tables`). The same for `trading` and `economy`.
- From Azure: the Event Grid subscription for ACS recording, and which app
  registration the VMC Graph credentials belong to. Record whether the portal
  uses the same one (risk: rotating it would break the portal).
- Read the three Lobster workflow files kept outside any repo
  (`/home/ubuntu/workflows/*.lobster`) and record what each writes. Flag anything
  that commits or pushes to the portal.
- For each OpenClaw agent job (F15 b), record what it reads, what it writes, and who
  reads its output.
- **Output:** one table per area with requests per day, last human use, last agent
  use and writes per day, plus a proposed verdict under D9: move, fold into
  PLX_MC, or retire.
- **Acceptance:** every area in F1, every job in B8 and F6, and every unit in F5
  has a row. The operator confirms the verdicts.

#### R1 — Stop what should not run (operator, and one swarm config PR)

The operator decided on 28 Sep 2026 that these may stop before R0, provided nothing
in the portal or its `staging` branch changes. The evidence for each item:
- **The Cloudflare quick tunnel** on swarm-prod (F9). No code in any repo uses it;
  every swarm reference is `127.0.0.1:8900`, and a quick tunnel's URL changes on every
  restart. Operator: record the current URL from `journalctl -u swarm-cloudflare-tunnel`,
  then `sudo systemctl disable --now swarm-cloudflare-tunnel`.
- **`governance-repo-sync` and `lessons-rule-promote`.** They write only the swarm
  repo. A swarm PR sets `enabled: false` for `governance-repo-sync` in
  `config/pipelines.yaml` and removes the `lessons-rule-promote` line from
  `config/vmc-web-crontab`; the operator deploys swarm-prod and removes the live
  crontab line. This replaces the frontier spec's P7.
- **The portal's `daily-status-report.sh`.** Its push has not reached `staging` since
  19 May 2026 (F16), so stopping it cannot change the portal codebase. Its daily
  executive email stops too. Operator: remove its crontab line.
- **The portal's `auto-sync-sharepoint.sh`.** It never writes SharePoint and never
  pushes (F17). Operator: remove its crontab line.
- Not in R1: the Lobster workflows kept outside any repo (R0 reads them first), and
  the portal's dormant `tools/swarm-dispatch-mcp` (V4, a portal PR).
- **Acceptance:** the recorded tunnel URL no longer answers; no Lobster commit lands
  on swarm `main` after the next 01:30 ET run; the two crontab lines are gone
  (`crontab -l`); portal `staging` shows no commit from these jobs.
- **Rollback:** re-enable the unit, revert the swarm PR, or restore the crontab line.

### Stage 1 — Brain, step 1: lift it as it is

#### R2 — Fix the portal brain client (portal)

- Point `vmc-client.ts` at the key routes that PLX_MC already uses:
  `agent/search`, `agent/node/{id}?include=content`, and `agent/document/{id}` for
  `document:` ids. Read results from `data.results` (B5).
- `selfCheck()` probes `agent/search` and treats only 2xx as healthy.
- This fixes B3 now, for the admin Knowledge Hub. It does not wait for the move.
- A task card for this fix is already queued ("Fix portal Knowledge Hub graph search and article open").
- Acceptance: mocked-fetch unit tests for hits, article, 401 and 404. With the real
  key, one search for a known term returns at least one hit. Portal checks exit 0.
- Rollback: revert the commit.

#### R3 — Record the brain's contract (read-only, plus tagged probe writes)

- Build one request set that covers every key route the callers use (B4):
  - Every query in the eval golden set, through `agent/search`.
  - `agent/node`, `agent/document`, `agent/subgraph` and `agent/trail` for ten known ids.
  - `agent/items` with each filter the callers send, and `agent/status`.
  - One `ingest`, one `relations` and one `session-artifact` write. Each write uses
    a `contract-probe-<n>` key and the tag `contract-probe`.
  - One call to each route with a missing key (401) and with a bad body (422).
- Record status code, response shape (key paths and types) and, for search, the
  ordered top-10 ids.
- Run the eval harness in live mode against the current database. Record the scores
  as the baseline.
- Store the request set and the recordings in plx_secondbrain `eval/contract/`.
  No keys, no personal namespaces.
- Acceptance: the recordings exist for every route in B4's key list.

#### R4 — Brain service (plx_secondbrain)

- Add `service/`: a small Next.js app next to the MCP server. It carries the 11 key
  routes and the code they import (B10), copied without behaviour changes. It does
  not carry the 9 login routes or the VMC UI.
- It keeps the same paths (`/api/vmc/knowledge/...`), the same envelope, the same
  `X-API-Key` header and the same key values.
- It uses the same database (B9) through a new role that can only read and write
  schema `memory` (SELECT, INSERT, UPDATE). It runs no migrations; VMC's runner
  still owns the schema in step 1.
- For search it still calls the swarm's `/memory/search/v2` (B6). That is its only
  swarm dependency (B7). Check each of the 11 MCP tools for other swarm calls.
- The SessionArtifact v1 schema moves here and becomes the canonical copy. The
  portal and PLX_MC hooks name the swarm file as its owner today; R7 updates them.
- Copy the 14 TypeScript test files and keep them passing.
- Acceptance:
  - `npm test` and a production build pass in `service/`.
  - Replaying R3 against the service on a spare port gives the same status codes and
    shapes for every request. For search, the top-10 ids match in at least 95% of
    queries.
  - The eval harness in live mode meets the floors (B17) and stays within 0.02 of
    the R3 baseline on each score.
- Rollback: revert the commit. Nothing points at the service yet.

#### R5 — Run the brain service (operator)

- Install it on the VMC EC2 host as `plx-brain.service` on its own port, next to
  `vmc-web.service`. Secrets come from the host's secret file, as VMC's do (B13).
- Give it the repo copies and SharePoint credentials the document catalog needs (B11).
- Acceptance: its health check returns 200, and R3 replays cleanly against the
  running service.
- Rollback: stop and disable the unit.

#### R6 — Cut over by path (operator, Caddy)

- In Caddy, send these paths to the brain service and leave the rest with VMC:
  `/api/vmc/knowledge/agent/*`, `/api/vmc/knowledge/ingest`,
  `/api/vmc/knowledge/relations`, `/api/vmc/knowledge/session-artifact`,
  `/api/vmc/knowledge/mcp`.
- VMC's own knowledge pages keep working until VMC stops, because its login routes
  still read the same database.
- No caller changes anything on the day.
- Watch for seven days: 5xx rate and p95 latency against VMC's last seven days, the
  weekly eval run, PLX_MC `mc_search_knowledge` status `ok`, and portal `selfCheck`.
- Acceptance: seven days at or better than the VMC baseline, and the eval floors met.
- Rollback: remove the Caddy routes and reload. Traffic returns to VMC at once.

#### R7 — Give the brain its own address (each caller repo)

- Serve the brain service on its own hostname (Q1) as well as through the R6 paths.
- Change the fallback URL written in code to the new host, one PR per repo:
  - portal: `vmc-client.ts`, `cos-session-artifact.ts`,
    `scripts/session-artifact-closeout.mjs`, `scripts/markitdown/ingest_to_brain.py`
  - PLX_MC: `src/lib/secrets.ts`, `scripts/compliance-closeout.mjs`, and
    `config/governance-contract.yaml:260`, then regenerate the guides
  - plx_secondbrain: `src/config.ts`, README
  - local-inference: `harness/ledger/brain.py`
- Update the Vercel and host settings that set `VMC_BASE_URL`. Keep the variable
  name in step 1, so machines that set it keep working.
- Acceptance: Caddy logs show brain calls moving to the new host. Once the old
  paths get no calls for 14 days, remove the R6 routes.
- Rollback: revert the fallback URL. R6 still serves the old host.

### Stage 2 — Brain, step 2: simplify

#### R8 — Search inside the brain service (plx_secondbrain)

- Port the swarm's memory search (B6) into the service, so search no longer calls
  the swarm.
- Keep the same embedding model (`text-embedding-3-small`, 1536 dimensions), so
  stored vectors stay valid and nothing needs re-embedding (D8).
- Run the ported search and the swarm search side by side on the golden set before
  switching.
- Acceptance: eval floors met, and within 0.02 of the R3 baseline. Contract replay
  still clean. The service makes no call to `SWARM_API_URL`.
- Rollback: a flag switches search back to the swarm call.

#### R9 — Keep or retire each brain job (plx_secondbrain)

- For each B8 job, record one verdict from R1's usage numbers and its on/off flag:
  port into the service's own schedule, or retire.
- Jobs the brain cannot work without must be ported. That includes the embedding
  backfill for direct writes (B7) and the lint report that `agent/status` reads.
- Jobs that only serve swarm features (dispatch summaries, swarm lessons) retire
  with the swarm.
- A job that calls a model goes through the fleet gateway.
- Acceptance: a verdict table covers all 12 jobs. Each ported job has a test and
  one clean scheduled run. `agent/status` shows a fresh lint report.

#### R10 — The brain's own database (plx_secondbrain, operator)

- Create database `brain` with `vector` and `pgcrypto`. Copy schema `memory` from
  `command_center` in a quiet window with writes paused. The session-end hooks queue
  records to disk while the brain refuses writes, and replay them later.
- Move the memory migrations into plx_secondbrain's own numbered runner. The runner
  fails the deploy on error.
- Acceptance: row counts match per table. Eval and contract replay clean. The
  service's database role has no access to `command_center`.
- Rollback: point `DATABASE_URL` back to `command_center`. Writes made in between
  are copied back by memory key before the switch.

#### R11 — Key scopes that work (plx_secondbrain)

- Wire the scope helpers into the key routes (B14), and pass tenant and namespace
  through search. The existing scope tests become live tests.
- Then issue department keys where a caller should see only its area.
- Acceptance: a department key gets 403 or no results outside its scope, with a test
  per route. The unscoped key behaves as before.

#### R12 — Remove the expired search fallback (plx_secondbrain)

- Remove the fallback marked for 2026-09-30 (B15), once R8's scores are at or above
  the baseline without it.
- Acceptance: eval floors met without the fallback.

### Stage 3 — Trading lab: map it, protect it, rename at the end

The trading lab stays where it runs (D8). This stage makes sure nothing else in this
spec touches it.

- **T1 — Map what trading uses (read-only, with R0).** Its VMC routes, pages and
  crons; its tables in `trading` and in `command_center` (compute jobs and workers,
  cron records, events, the todo store its alerts write); the VMC code it imports
  (F4); its hosts and workers (TRADINGBOX, the compute worker on Spark A, Dell VTA tasks);
  the gateway lane it calls (`local-driver` on Spark B, with the gateway master key;
  agent fleet spec F27 and D23);
  its secrets; any call it makes to swarm-prod; and the `missioncontrol.tayloralton.com`
  address its paper dispatchers call.
- **T2 — Protect it.** Every later step checks the T1 map first. Before and after each
  step, compare trading's own health signals: TRADINGBOX health, paper dispatcher
  runs, Dawn harvest runs, compute worker freshness, the stage-rail monitors and the market-data alerts.
  A new failure stops the step and rolls it back.
- **T3 — Rename at the end.** After S1–S6, prune the non-trading code from the repo
  in normal PRs, then rename it (for example `trading-lab`). GitHub redirects old
  remotes, so workers keep pulling. Update the PLX_MC tracked-repos entry to the new
  name. Dependabot stays on.
- **Owner:** the operator (vince@petrasoap.com) until a trading owner is named.
- **Acceptance for the stage:** the T2 comparison shows no new trading failure across
  every step of this spec.

### Stage 4 — Every other VMC area

#### V1 — Verdicts (operator)

- Apply D9 to the R0 table. Any code or table the trading lab uses (T1) stays, whatever its verdict; only its pages and outside callers retire. The proposed defaults:

| Area | Proposed verdict | Why |
|---|---|---|
| todos, todo-execution, queue, today, ledger, cursor | Retire the pages and routes; keep the todo store trading's alerts write (T1) | PLX_MC is the task system. VMC todos already redirect to the PLX_MC ledger (F14). |
| projects (51 routes) | Retire, or fold into PLX_MC projects if R0 shows use | Its `project-sync` writes SharePoint lists every 4 hours with no flag (F8). |
| meetings, teams, calendar, ACS webhook | Retire | Joins, recordings, To Do, Planner and calendar writes act on people (F8). |
| email, inbox (the `cos@` assistant) | Retire; Q4 decides whether a fleet agent takes it on later | It sends and moves real mail (F8). |
| chat, investigator, troubleshooter, telegram | Retire | COS chat in the portal and the agent fleet replace them. |
| research, autoresearch | Retire | A fleet loop can take this on later if wanted. |
| compute, jobs, gpu | Stay (trading) | The compute fabric runs only trading jobs (F4). |
| royale, marketplace, benchmarks, assets, agents, `economy` database | Retire | Swarm-only features. |
| workflows, workflow-dispatch, pipelines, cron-replay | Retire | They drive the swarm. |
| governance, policy, approvals, org, doc-health | Retire | PLX_MC owns governance. |
| health, admin, tenants, db-studio, documents, sharepoint, cheatsheet, factory | Retire | Operator tools for VMC itself. Check `factory` (the 3D floor plan) in R0. |
| Lobster `daily-brief` | Retire (D11) | The fleet's CoS digest replaces it. |
| Lobster `meeting-action-sync`, `self-healing-triage`, email classifier, reliability sweep, OpenClaw guard | Retire | Swarm operations. |
| OpenClaw secrets loader (F15 a) | Keep | VMC, and later the brain service, read `/run/openclaw/secrets.env`. Rename it later; never remove it while a service reads it. |
| OpenClaw agent jobs (F15 b) | Retire those that watch the swarm; move the Sentry and documentation scans into COS's brief (fleet P11) or a fleet loop if R0 shows you read them | They are a second agent runtime, the pattern the fleet replaces. |

- **Acceptance:** the operator signs the table.

#### V2 — Stop outside actions first (operator)

- For each F8 item with a retire verdict: turn off its flag, or stop its unit or
  cron line. Tell the people it acted for. Watch 7 days for zero actions.
- Order: email send and mailbox moves; SharePoint `project-sync`; ACS joins and
  recording (and delete the Event Grid subscription); To Do, Planner and calendar
  writes; Telegram and Slack; Vast.ai.
- **Acceptance:** 7 days with no outbound action of each kind, from logs.

#### V3 — Fold-ins (PLX_MC)

- Each area with a fold verdict gets its own PLX_MC spec. This spec only records the
  verdict.

#### V4 — Remove other repos' swarm dependencies (one PR per repo)

- **PLX_MC:** the `.cursor/environment.json` swarm clone and terminal; `SWARM_*` in
  `.cursor/mcp.json`; the `dispatch_to_swarm` tool; `bin/swarm`; the skills seeder's
  swarm path; the loop-ledgers entry and the routing pilot; the swarm entries in the
  fleet provisioning lists.
- **portal:** `tools/swarm-dispatch-mcp`, the vendored swarm client in
  `tools/plx-mc-mcp`, `bin/swarm`, `scripts/sync-agents-md.py`'s swarm reads, and
  the CEO bridge API (`portal/src/app/api/external/swarm/v1/**`). Revoke
  `PORTAL_BRIDGE_KEY_CEO`.
- **skills:** `skillparity` must not block without a swarm checkout; drop the
  `vmc-*` skills from the manifest.
- **local-inference:** replace the swarm health-gate script path.
- **Acceptance:** `git grep -n "agentic-swarm\|SWARM_API\|:8900"` in each repo's code
  and config returns only history notes.

### Stage 5 — Shut down what retires, then rename (operator)

Every step checks the T1 map and runs the T2 comparison (D8).
- **S1 — Crons and Lobster.** Remove every non-trading VMC crontab line and stop the
  Lobster scheduler, after V2 and after R9 has moved the brain jobs. Trading's crons
  stay.
- **S2 — swarm-prod.** Stop `swarm-serve`, `hermes-agent` and the watchdogs. Gate: R8
  (search no longer calls the swarm), and T1 shows the trading lab makes no call to
  swarm-prod. If it does, swarm-prod keeps running until the trading owner removes
  the call. Keep the instance stopped, not terminated, for 30 days.
- **S3 — Prune VMC web.** `vmc-web.service` keeps running for the trading lab. Remove
  the retired areas' routes and pages in normal PRs, after 14 quiet days on each.
- **S4 — Databases.** Snapshot and drop `economy` after 90 days. `command_center` stays,
  because the trading lab uses its compute, cron and event tables; the brain's data
  left it in R10. The RDS instance stays (D12).
- **S5 — Secrets.** Revoke or rotate only secrets that T1 shows the trading lab does not
  use: `SWARM_API_KEY` and `SWARM_MEMORY_ADMIN_KEY` (after S2), `GITHUB_WEBHOOK_SECRET`,
  the ACS secrets, `HERMES_WEBHOOK_SECRET`, `TELEGRAM_*`, `SLACK_WEBHOOK_URL`,
  `PORTAL_BRIDGE_KEY_CEO`. Rotate the Graph credentials only after R0 confirms the
  portal does not share them. `VMC_API_KEY` stays until R11 replaces it.
- **S6 — The old address.** `missioncontrol.tayloralton.com` stays, because the trading
  lab uses it. Only the brain's routes leave it (R7), and the retired areas' routes
  (S3).
- **S7 — Clean up and rename.** Close the Dependabot PRs that touch only removed code.
  Update the docs that describe the swarm as live (portal `CLAUDE.md` "How work ships /
  swarm", PLX_MC and skills guides) through normal PRs. Then T3 renames the repo.
  Terminate swarm-prod after its 30 days, if S2 stopped it.
- **Acceptance for the stage:** SC-6.

## 9. How this fits with the COS Companion and the EventBridge work

### What the retirement means for them

- **COS chat is not affected by the brain move** (C1). It reads the portal's own
  store.
- **The COS Companion is touched in one place:** its `companion_open` session record
  (C2). R6 keeps it working on cutover day; R7 changes its fallback URL.
- **The admin Knowledge Hub is broken today** (B3). R2 fixes it before the move.
- **The EventBridge pacer is untouched.** It never calls VMC or the swarm (C4). It
  stays the portal's staging clock. Nothing in this spec schedules through it (D7).
- **Brain jobs adopt the portal's job pattern** (C5, D7). After this, every
  scheduled job in the company is one core function with a cron route, a CLI and a
  run table, whichever host runs it.
- **The Lobster `daily-brief` retires** into the fleet's CoS digest (D11).

### Changes made in the agent fleet spec (r4)

These came from C2–C9. The operator approved them on 28 Sep 2026, and fleet r4
carries them. Fleet r4 also makes COS the chief of staff for the stack, one agent
with many doors including Grok Bot (fleet D13–D14, D16), and retires MC's agents
module (fleet D15).

1. **CoS brief (fleet P11, D17).** Make it the operator's brief in MC, the one that
   replaces the Lobster `daily-brief`. It reads what already exists (open MC tasks,
   the UAT ops digest, Awaiting You items) instead of recomputing. It does not
   duplicate `/api/admin/digest` (the staff email) or Awaiting You T904 (the planned
   department brief) (C6). Later, the COS panel's empty Tasks tab can show it.
2. **Hasitha UAT fixes (fleet P14, D18).** The runner joins the portal's UAT dispatch as
   one more executor, next to Cursor Cloud and Hermes. It speaks `uat-agent/v2`,
   and it changes ticket status only through the one door and the run graph (C3,
   C7). It never goes around the UAT system.
3. **Runner repo (fleet P6, D18).** Copy the bridge's hardened parts (job store, bounded
   commands, worktrees, leases) into the runner. Leave the Dell VTA bridge as it
   is. Retire its Windows tasks only after the runner takes over the Hermes role.
4. **Run records (fleet P4, D19).** Use the job pattern's run-row shape (C5): caller
   `runner`, correlation id, mode and lock. Store them with the portal's other run
   tables instead of only in the audit log.
5. **Kill switch (fleet D20).** The runner obeys `Agent.status` and `TRIPLE_T_ENABLED`. It adds no
   switch of its own (C9).
6. **Persona-QA worker (fleet D22).** Record it as a second agent worker (C8). Either fold it into
   the runner later or leave it running per deploy; do not build a third.
7. **The pacer's minutes (fleet P6).** Runner loops that touch the UAT database avoid the minutes
   the pacer reserves for Business Central (C4).

## 10. Changes made in the frontier spec (r12)

Frontier r12 (28 Sep 2026) applies these. Its round 9 review found 0 blockers.
- **P7** is withdrawn, and so is D6. The writers write only the swarm repo, which no
  frontier phase edits now. This spec's R1 plans to turn both writers off.
- **P8** drops its swarm half, and D10 is withdrawn. Three halves remain: PLX_MC,
  plx_secondbrain, portal.
- **P9, P10** remove the swarm from their repo lists.
- **P13** runs as it is, and records that the brain moves (R4, R6, R7).
- **P14** becomes a later yes that names `BRAIN_URL`, the brain's own address from
  R7. It needs only that host answering `brain_self_check`, not all of R7. A
  department key still does not limit access until R11 (B14).
- **PLX_MC PR #255** holds frontier P4 (its code branch) and P16 until it merges or
  closes. If it merges, frontier r13 re-derives the lease and merge-queue rules.
- **Scheduling:** a PR from this spec that edits the same files as a frontier phase
  never runs alongside it on the same repo. Known overlaps: R7 (PLX_MC governance
  contract and regenerated guides) and S7 (portal `CLAUDE.md`, PLX_MC guides), both
  against frontier P8 and P10.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Callers outside the repos (operator scripts, notebooks, phone shortcuts). | R0 counts callers from access logs; 14 quiet days before any stop (D1). |
| The lifted brain behaves differently. | Contract replay and eval floors (R4); instant Caddy rollback (R6). |
| Session records lost while the brain's database moves (R10). | The hooks queue to disk and replay. The companion's record fails open; that loss is accepted. |
| A step breaks the trading lab. | D8: nothing trading uses is stopped, edited or rerouted; T2 compares trading health before and after every step. |
| Renaming the repo breaks a worker's pull. | GitHub redirects renamed remotes; T3 renames last and T2 watches the workers. |
| Rotating shared Graph credentials breaks the portal. | R0 checks the app registration first (S5). |
| Dropping the wrong database. | Drop databases only, never the RDS instance, after 90-day snapshots (D12). |
| People lose a tool they still use (the `cos@` assistant, meeting recording, SharePoint project lists). | D10: owner sign-off and notice, one action at a time (V2). |
| Removing OpenClaw's secrets loader breaks VMC and the brain. | It stays (F15, V1). Only OpenClaw's agent jobs are candidates to retire. |
| A Lobster workflow outside any repo writes to the portal. | R0 reads all three before anything else touches them. |

## 12. Order

R0 comes first. R1 and R2 can start as soon as R0's rows for them exist.
R3 → R4 → R5 → R6 → R7 is the lift. R8 → R9 → R10 → R11 → R12 is the simplify
step, and it starts after R6. T1 runs with R0; T2 applies to every later step; T3
runs last. V1 → V4 run beside the brain work. S1–S7 wait on the gates named in each.

## 13. Questions and answers

- **Q1. The brain's hostname.** Answered 28 Sep 2026: `brain.plxcustomer.io`.
- **Q2. The trading repo.** Answered 28 Sep 2026: the trading lab must not be affected.
  It stays and keeps this repo, renamed at the end (D8, Stage 3). Owner: the operator
  until a trading owner is named.
- **Q3. OpenClaw.** Answered 28 Sep 2026: the jobs are the operator's. Keep the secrets
  loader; retire or move the agent jobs after R0 (V1).
- **Q4. The `cos@` email assistant.** Deferred to V1. R0 shows whether anyone still uses
  it; nothing needs deciding before then.
- **Q5. The portal jobs on the VMC host.** Answered 28 Sep 2026: both stop in R1. Neither
  can change the portal codebase (F16, F17), and PLX_MC does not use the SharePoint
  job's output.

## 14. Out of scope

- Any move of the trading lab (its owner's own spec).
- PLX_MC fold-ins (each its own spec).
- Changes to the COS Companion itself, including its open gaps.
- The agent fleet spec's own phases (section 9 lists what changed there).
