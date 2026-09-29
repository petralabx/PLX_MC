---
title: Agent fleet — implementation spec
revision: r13 (28 Sep 2026: operator decisions after the review. D5 amended: the fleet proxy moves to its own EC2 host, `fleet-proxy`, with its own Postgres; nothing of the fleet runs on the Dell, and local aliases become an optional phase, P1b, that calls the Dell's model server over the tailnet under the A/B load test. D25 (confirmed): an agent eval gate on activation (P15a, P15), because the portal's Persona QA tests UI, not agents. D26 (confirmed): bounded parallel runs, with a per-loop `maxConcurrent` and a larger runner host. r12: round-7 review applied: 16 findings; the critic found no blocker, and the author raised one (r11's machine-wide Python could take over trading's bare `python` calls). The fleet uses a private Python in `C:\fleet` by full path; `C:\fleet` has its own permissions; the stop rule and trading guard avoid CIM; runner holds are enforced inside the dispatch functions for every path; a released runner run goes to Cursor; the claim checks the agent's switches and never overwrites another checkout; SSH to the runner comes only from the operator. r11: round-6 review applied: 19 findings; the critic found no blocker, and the author raised one (r10's load test itself loaded the Dell while trading's worker ran). The load test runs only while `dell-vta` holds no lease, with one thread per probe process; the fleet lives in `C:\fleet` with a machine-wide Python and changes no permission on trading's files; the claim looks up and reuses a stored checkout before minting and sets the executor ids; a callback that can no longer land ends the run; the parent fsck-checks bundles in a throwaway repo and diffs without rename detection. D18's routing wording amended. r10: round-5 review applied: 22 findings; the critic found no blocker, and the author raised one (r9's load test would always fail). The Dell load test times a CPU workload at the worker's slot count; the fleet proxy runs as its own Windows account; no `local-coder`; a runner UAT job is held for a claim route, rerouted to Cursor on the same attempt after 30 minutes, and minted before one transaction; every failed runner run releases its UAT run; the parent computes the changed files itself. r9: round-4 review applied: 16 findings, 2 of them blockers; 15 held against the code. The Dell load gate becomes an alternating A/B test at the fleet's limits; the runner host has no trading role and its run users cannot reach instance metadata or the VPC; UAT jobs reach the runner only when an ADMIN authorised the ticket, under a new `agent_runner` provider and flag, and the run is created at pull; the parent moves commits by bundle and pushes from a pinned work tree; the stale sweep runs in the paced reconcile route; the fleet gets a portal MC principal and its own Postgres. r8: round-3 review applied: 19 findings, 1 of them a blocker. UAT uses the portal's existing agent authorisation and a `fix/agent-runner-` branch; the parent pushes from its own clone after a governance check; local aliases get rate limits; the Dell load gate compares lease durations. r7: round-2 review applied: 25 findings, 6 of them blockers. Loops pause, not agents; the MC checkout is minted when an approved UAT job is pulled; the runner host is fenced by its own firewall; approvals are buttons, not model tools; door keys cannot reach the portal's external API; the fleet proxy runs from its own clone with its own lock. r6: round-1 review applied: 51 findings, 11 of them blockers. The fleet gets its own proxy instance, so no fleet phase edits or restarts the trading gateway; agent runs get their own table; the runner pulls UAT jobs and never opens PRs; approvals are ADMIN-only in the portal; the runner host is a dedicated EC2 fenced off from trading. D23 confirmed. r5: D23. r4: COS as chief of staff; MC agents module retires. Record: agent-fleet-review-log.md)
status: draft; D1–D26 confirmed (D5 as amended in r13, D16 as amended in r6, D18 as amended in r11, and D24, confirmed 28 Sep 2026); D25 and D26 added in r13 and confirmed 28 Sep 2026; reviewed seven times, then closed by the operator on 28 Sep 2026; P13 confirms Grok Bot
accountable human: vince@petrasoap.com
repos: petralabx/plx-customer-portal, petralabx/local-inference, petralabx/PLX_MC, new petralabx/agent-runner
---

# Agent fleet — implementation spec

## 1. Goal

Register every agent once, in the portal. Run each agent's loops on an always-on
machine. Let each agent use any model: a cloud provider or a model we host. Keep
the record of all agent work in PLX_MC. Leave the trading lab exactly as it runs
today (D23).

**COS is the chief of staff for the whole stack.** It is one agent,
`chief-of-staff` in the portal registry, reached through several doors: the COS
panel in the portal, the COS Companion window and desktop app, and Grok Bot.
It briefs the operator, answers questions across the stack, hands work to other
agents, asks for approvals, and can pause an agent that misbehaves.

This is not `docs/jev-fleet-implementation-spec.md`, which lives in the Cursor
project store. The frontier spec calls that older draft "the fleet spec". This
file is the agent fleet spec.

This spec replaces the swarm's agent roles. It does not retire the swarm; the
swarm retirement spec does that.

## 2. Facts (checked 28 Sep 2026)

| # | Fact | Source |
|---|---|---|
| F1 | The portal already has the registry: `Agent` (slug, status, active version) and `AgentVersion` (persona, responsibilities, modelConfig, mcpAllowList, skills, loops, memory, eval). The admin UI is `/admin/agents`. | `portal/prisma/schema.prisma:7316-7391` |
| F2 | `Agent.status` is `DRAFT`, `ENABLED`, `DISABLED` or `ARCHIVED`. `DISABLED` can act as the kill switch. | `schema.prisma:7316-7321` |
| F3 | `modelConfig` already has per-agent `primaryProvider` and `primaryModel`. `primaryProvider` is any non-empty string. Every seeded agent sets `primaryProvider: "anthropic"` and `primaryModel: null`. | `portal/src/lib/agents/capabilities.ts:19-24`; `pilot-agents.ts:97,190`; `sourcing-agent.ts:54`; `persona-qa-agents.ts:518` |
| F4 | Nothing reads those two fields at run time. Portal chat calls `requireAgentLlm()` with no agent argument. `getTripleTLlm()` picks one provider for the whole process from env (`TRIPLE_T_LLM_PROVIDER` = anthropic, openai or auto). Its OpenAI path takes any compatible base URL. | `app/api/agents/[agentId]/chat/route.ts:106`; `app/api/agents/_lib/guard.ts:198`; `lib/triple-t/engine/llm.ts:31-82,271-294` |
| F5 | `loops` holds only `{ id, name, description }`, and the Zod schema drops any other key. It has no schedule, runtime, repo scope or budget. `modelConfig` and `loops` are JSON columns, so new optional fields need a Zod change, not a DB migration. | `capabilities.ts:35-39,68,161-169`; `schema.prisma:7367,7375` |
| F6 | `AgentAuditLog.action` is a plain string, so new actions need no migration. Its `actorUserId` is a required foreign key to `User`, so a row the runner writes needs a service user. The portal already has one pattern for that: `PLX_WORK_ROUTING_SYSTEM_USER_ID`. | `schema.prisma:7481-7482`; `lib/agents/audit.ts:17-28`; `lib/work-routing/work-items.ts:151` |
| F7 | The Hermes bridge runs the Nous Research `hermes` CLI with a named profile. It is built for UAT only: contract `uat-agent/v2`, canary by default, at most two runs at once. Live mode needs a TASK id and an MC checkout id. It branches `fix/hermes-<hash>` from `origin/staging`. It runs on the Dell VTA (Windows, SQLite WAL at `C:\ProgramData\PLX\HermesBridge`) with the Windows tasks `PLX-Hermes-UAT-Bridge` and `PLX-Hermes-UAT-Bridge-Watchdog`. | `scripts/uat-agent/hermes-bridge/job-runner.mjs:171-202,221,383-392`; its `README.md:3-10,57-98,177-178` |
| F8 | Hermes Agent works with any OpenAI-compatible endpoint (`provider: custom`, `base_url`). Its docs name vLLM, llama.cpp, Ollama and LiteLLM Proxy. | hermes-agent `website/docs/integrations/providers.md` (fetched 28 Sep 2026) |
| F9 | The LiteLLM proxy serves only local aliases: `local-primary`, `local-fast`, `local-coder`, `local-driver`. It uses a master key and has no database, so it has no per-agent keys or budgets. Its config also holds backend keys (`api_key: sk-local`, `api_key: local-inference`) and `allow_requests_on_db_unavailable`. It sends traces to self-hosted Langfuse. | `local-inference/litellm/config.yaml:6-24,43-46` |
| F10 | The proxy runs on the Dell VTA as `.venv/Scripts/litellm.exe`, started by `scripts/start_proxy.sh`, which sources the shared `.env.local`. It binds `0.0.0.0:4000`, so it answers on the tailnet (`100.103.33.54:4000`). The `LocalInferenceProxyWatchdog` task runs every 5 minutes; when a health check on `127.0.0.1` fails, it restarts the proxy from those same files. The watchdog holds the lock `/tmp/.litellm_watchdog.lock.d` while it works. Vercel functions are not on the tailnet, so portal chat cannot reach a local model today. | `local-inference/scripts/start_proxy.sh:12,20-28`; `scripts/ensure_proxy.sh:7-8,16-18,34,39`; `install-boot-durability.cmd:8`; `.cursor/rules/dgx-spark-fleet.mdc:16` |
| F11 | Two local aliases are marked "uncensored" or "abliterated" in config comments (`local-coder`, `local-driver`). | `litellm/config.yaml` comments |
| F12 | The Triple-T coding router picks Cursor Cloud model slugs. Cursor owns that list, so it cannot use a model we host. | `lib/triple-t/model-router/catalog.ts:47-51` |
| F13 | PLX_MC tracks portal, local-inference and others in its registry. A new repo becomes tracked only through onboarding: a registry entry with a routing manifest and `status: active`, then `scripts/scaffold-tracked-repo.sh`. The checkout allowlist is built from active entries at build time, so PLX_MC must deploy before the first checkout. | `PLX_MC/config/tracked-repos-registry.json`; `docs/runbooks/REPO-ONBOARDING.md`; `src/lib/mcp/checkout-repo.ts:10-19` |
| F14 | Two DGX Sparks are on the tailnet. Spark A `spark-7d3d` serves `local-coder` (`:18082`). Spark B `spark-b4ec` serves `local-driver` (`:18090`) and can also run a vLLM lane on `:18091` that takes 45% of memory. Each has about 128 GB of unified memory, shared by CPU and GPU. Sparks are arm64. | `litellm/config.yaml:12-24`; `docs/runbooks/spark-b-qwen36-nvfp4-bakeoff.md:19-22,56` |
| F15 | MC has no write surface for a free-form report. `mc_report_progress` needs a checked-out task. The precedent is `POST /api/cursor/session-telemetry`, which appends one `agent.session_telemetry` event through `appendEvent`, with a dedup key. | `PLX_MC/src/lib/mcp/create-http-server.ts:264-276`; `src/app/api/cursor/session-telemetry/route.ts:1-40` |
| F16 | **MC has its own agents module:** a fixed list of four placeholder agents (Vibes, Atlas, Sentry, Scribe), a per-agent `auto` or `approve` mode, and derived presence and feed. Only a human assigns work; there is no agent pull loop. MC tasks already store an `assignee`, which can be a person or an agent. The `mc_create_task` tool takes no assignee, but its HTTP twin `POST /api/cursor/tasks` already accepts one from any MCP principal and `actionCreateTask` passes it on. `isAgentId()` recognises an agent by looking it up in that fixed list, and `humanOnly` rules depend on it. | `PLX_MC/docs/modules/agents/README.md:5-45`; `src/lib/mc-data/types.ts:54-60,190-260`; `src/lib/mc-data/policy.ts:19`; `src/lib/mcp/create-http-server.ts:231-245`; `src/app/api/cursor/tasks/route.ts:14`; `src/lib/mcp/actions.ts:215-223` |
| F17 | **COS today** is the portal's front door to every consumer-facing agent. It answers, looks up the user's own tickets, and hands off to Hasitha. Its tools are page navigation (8 paths), ticket lookup, handoff and knowledge reads from its own namespace. Tools are switched on per version through `skills` and `loops` ids. The COS panel's Tasks tab is an empty placeholder: "The Chief of Staff will track work here." COS is open to every STAFF user. | portal `docs/modules/agents/README.md:11-21`; `lib/agents/cos-frontend-tools.ts:84-179`; `capabilities.ts:175-185`; `agent-panel.tsx:1673-1677` |
| F18 | The COS Companion is a window onto the same COS: "not a second COS, not a second auth system". The operator's call (19 Aug 2026) is "1 for now but building towards 2": a fuller agent platform later, behind the same registry and adapter. The companion posts one session record per open, and nothing else outside the portal. | `docs/projects/cos-companion/README.md`; `DESKTOP-SPEC.md:19-21`; `.discovery/cos-companion/DISCOVERY.md:439-460` |
| F19 | The portal's agent routes (`/api/agents/*`) accept only a browser login (`requireAuth()`). The portal has admin-issued, hashed, revocable API keys (`app_api_key`) for `/api/external/*`. A key records who created it (`createdById`) but has no scopes. | `app/api/agents/_lib/guard.ts:24,67`; `lib/auth/api-keys.ts:1-40`; `schema.prisma:964-979` |
| F20 | **Grok Bot** is the Grok coding agent that operators run in Cursor and GitHub. It connects to Mission Control through MCP as principal `sp_mcp_grok`. It sees the repo and Mission Control only. | portal `AGENTS.md:50`; `docs/projects/business-central-erp-modernization/COLLAB-STEWARD-PLAN.md:80-84`; PLX_MC `config/integrations.yaml:172` |
| F21 | **The portal's UAT dispatch chooses an executor:** Cursor Cloud first, with Hermes as the fallback. Since 25–27 Sep, UAT ticket status changes go through "one door", and every run writer, Hermes included, writes a run graph. | `docs/projects/plx-agents-platform/COS-CLOSEOUT-HANDOFF.md:18-26`; `docs/projects/cos-companion/README.md` (R8) |
| F22 | **The portal has one pattern for scheduled jobs:** one core function called by a cron route, a CLI, a GitHub Action and an admin action. Each run writes a row with caller, correlation id, mode and a lock (a second run becomes `SKIPPED_LOCKED`). Its table, `WorkRoutingRun`, does not fit agent runs: `runType` is a fixed enum, `correlationId` is unique, the lock is per run type, and `RunnerCaller` has no `runner` value. | `specs/awaiting-you/spec.md:192`; `portal/src/lib/work-routing/runner.ts:1-24,66,157,244-259`; `schema.prisma:8174-8180,8289-8308` |
| F23 | **The EventBridge pacer** (Lambda `plx-bc-cron-ping`) is the portal's staging clock. Business Central outbound runs at `rate(5 minutes)` with no fixed minute. Inbound runs at minutes 6, 21, 36 and 51 UTC, which are reserved because of database load. | `scripts/aws/deploy-bc-cron-ping.ps1:110-159`; `docs/runbooks/BC-CRON-HTTP-PACER.md:25-42` |
| F24 | **Digests already exist or are planned:** `/api/admin/digest` (production, weekdays, all STAFF+); the UAT stall and ops digests; Awaiting You T904, a planned department daily brief; and the swarm's Lobster `daily-brief`, which retires with the swarm. | `app/api/admin/digest/route.ts:8-16`; `specs/awaiting-you/tasks.md:164`; swarm `config/pipelines.yaml:78-99` |
| F25 | A second agent worker already exists: `services/persona-qa-worker` runs the persona-QA agents after each deploy. Their cadence sits in `evalConfig.notes`. | `portal/src/lib/agents/persona-qa-agents.ts:1-8,441-448` |
| F26 | The agent kill switch today is `Agent.status` plus `TRIPLE_T_ENABLED`. `TRIPLE_T_ENABLED` is a Vercel variable (`isTripleTEnabled()`); a host outside Vercel cannot read it. The companion docs rule out a second kill switch. | `docs/projects/cos-companion/OS-GAP-VALIDATION.md:21-22,42-44`; `app/api/agents/_lib/guard.ts:85` |
| F27 | **The trading lab uses the gateway, both Sparks and the Dell.** (a) Its Dawn harvest, TRADINGBOX's research pipeline (every 30 minutes) and stage-rail escalation all call the gateway's `local-driver` alias with the master key (`LOCAL_LITELLM_MASTER_KEY`). Spark B serves that alias. (b) Spark A runs the trading compute worker `vmc-dgx-compute-worker` as a per-user unit of `vinnysachet`. (c) The Dell VTA runs the trading compute worker `dell-vta`, the primary walk-forward shard pool; its config says to leave headroom for LiteLLM. (d) Trading reads its own xAI, OpenAI, Anthropic and Google keys from `prod/ec2-secrets`. (e) The brain's knowledge jobs also run on `local-driver`. | swarm `scripts/trading-research/dawn_harvest_scheduler.ps1:97,127,132`; `run_dawn_with_xai.py:82-85`; `research_pipeline.py:919`; `stage_rail_loop.py:540-552`; `src/strict_local_chat.py:17,64-67`; `config/trading-workers.yaml:56-58,108-146,148-167,190-245`; `aws_secrets.py:6,42`; `research_pipeline.py:54` (Google); `batch_ingest_whisper_api.py:33-34,78`; `config/models.yaml:119-127` |
| F28 | **Portal middleware blocks new API routes.** Any `/api/*` request without a session gets a 401 before its route runs, unless the path is in `PUBLIC_ROUTES`. | `portal/src/middleware.ts:34-73,183,211-213` |
| F29 | **UAT dispatch to Hermes is push-based.** The portal POSTs a `hermes-bridge/v1` job that carries the portal's `mcCheckoutId` and `autoCreatePr: false`; the portal's PR outbox opens the PR. The portal adapter is not yet a live client for the new contract: phase H2 must add lookup, strict binding and uncertainty handling first. | `scripts/uat-agent/hermes-bridge/README.md:57-83` |
| F31 | **Portal API keys have no scopes today.** `authorizeExternalRequest()` accepts any active `app_api_key` on every `/api/external/*` route (parts, products, Sage customers). | `portal/src/lib/auth/api-keys.ts:66-80` |
| F32 | **An MC checkout lives 8 hours.** The portal's pre-push hook fails a push whose stamp has expired and has no open PR. | PLX_MC `src/lib/compliance/service.ts:57`; portal `scripts/lib/mc-pre-push-handshake.mjs:376` |
| F33 | **MC's service principals are a reviewed list in code.** A key for a principal outside the list never authenticates, so a new principal needs a PLX_MC change. | PLX_MC `src/lib/permissions/types.ts:125-136` |
| F34 | The portal already receives UAT executor results at `POST /api/internal/uat-agent/callback`. The job runner's lock has a TTL (`RUN_LOCK_TTL_MS`, 10 minutes). | `portal/src/app/api/internal/uat-agent/callback/route.ts:25`; `portal/src/lib/work-routing/runner.ts:157` |
| F35 | **UAT branches must use a known prefix.** The executor callback and the PR outbox accept only `cursor/`, `uat/`, `fix/` and `feat/` branches. | `portal/src/lib/uat-agent/executors/constants.ts:21-26`; `branch-scope.ts:97`; `create-pr.ts:169` |
| F36 | **The portal already has an ADMIN approval for UAT agent work.** `POST /api/admin/feedback/[id]/approve-agent` works only on a `PENDING` ticket. It moves the ticket to `IN_PROGRESS`, sets `Feedback.agentAuthorizedAt` and `agentAuthorizedById`, and moves the `UatAgentRun` from `AWAITING_AUTHORIZATION` to `QUEUED_FOR_AGENT` with the same `authorizedById`. Retries (attempts 2 and 3) carry the ticket's authoriser. A STAFF+ submitter's ticket is eligible on its own (`staff_plus_auto`): it queues with no ADMIN press and `agentAuthorizedById` stays empty. `UatAgentRun` statuses run `AWAITING_AUTHORIZATION` → `QUEUED_FOR_AGENT` → `AGENT_RUNNING` → `BRANCH_PUSHED` → …; the side exits are `FAILED_RETRYABLE`, `FAILED_TERMINAL` and `CANCELLED`. | `portal/src/app/api/admin/feedback/[id]/approve-agent/route.ts`; `portal/src/lib/uat-agent/intake/authorize-agent.ts:154,184`; `domain/authorization.ts:57-61`; `workflow/production-services.ts:450-461,843-847` |
| F37 | Trading's gateway sends traces with `callbacks: ["langfuse_otel"]` to `LANGFUSE_OTEL_HOST`, which its start script defaults to `http://127.0.0.1:3100`; unset, LiteLLM would send traces to Langfuse Cloud. The admin route that creates API keys sets no scopes. The existing agent-audit helper is fail-open and writes outside any transaction. | `local-inference/litellm/config.yaml:30-36`; `scripts/start_proxy.sh:14-18`; `portal/src/app/api/admin/api-keys/route.ts:60-72`; `portal/src/lib/agents/audit.ts:9-10,45-58` |
| F38 | **UAT executor routing and the callback today.** `UAT_AGENT_EXECUTOR_PROVIDER` unset on staging means Cursor Cloud; `hermes` pins Hermes, and a Hermes failure moves the job to Cursor. The callback's provider enum is `cursor_cloud`, `hermes`, `mission_control`, `manual`, and it refuses a provider that differs from the run's `executorProvider`. The callback binds `runId`, `feedbackId` and `attempt` (at most 3). A delivery id that already succeeded gets 409 `replayed_delivery`. `applyExecutorCallback` accepts `QUEUED_FOR_AGENT` and `AGENT_RUNNING`, and a late `FINISHED` on `BRANCH_PUSHED` (no change); any other status gives `executor_callback_wrong_status`, which the route returns as 502 and releases the delivery id. When the run's `executorAgentId` and `executorRunId` are empty, the callback compares the payload's ids with themselves. The stale sweep expires only `hermes-*` runs, and the Cursor poll only `bc-*` runs. | `portal/src/lib/uat-agent/executors/env.ts:17-30`; `contracts/callbacks.ts:51-52`; `contracts/versions.ts:10`; `workflow/production-services.ts:860-879`; `reconciliation/read-side-sweeps.ts:69`; `cursor-cloud-finish-poll.ts:37` |
| F39 | **Vercel crons run on Production only; portal staging is a Preview alias.** On staging, `/api/internal/uat-agent/reconcile` is called every 5 minutes by the EventBridge schedule `plx-uat-reconcile-ping` (added 28 Sep 2026). | `docs/runbooks/BC-CRON-HTTP-PACER.md:9-11,34`; `scripts/aws/deploy-bc-cron-ping.ps1:167` |
| F40 | **The portal's pre-push hook runs the verify script from the pushing work tree** (`$(git rev-parse --show-toplevel)`), skips in a bare clone, and treats only `cursor/` and `cloud-agent/` as agent branches. Any other branch pushed without `CURSOR_AGENT` counts as a human push (`HUMAN_BYPASS`). With `CURSOR_AGENT=1` and no stamp it fails `MISSING_STAMP`. Git refuses a local fetch from a repository another user owns (dubious ownership); a fetch from a bundle file is not refused. | portal `.githooks/pre-push:7-19`; `scripts/lib/mc-pre-push-handshake.mjs:44,336,356`; `scripts/uat-agent/hermes-bridge/job-runner.mjs:406,433-435` |
| F41 | **The only Postgres on record on the Dell is trading's** WSL2 server at `127.0.0.1:5432` (database `trading`). | swarm `docs/runbooks/norgate-futures-ingest.md:51-53`; `docs/runbooks/trading-lab-loop-launch.md:51-52` |
| F42 | **A UAT "attempt" is a user-retest round, not an executor try.** A new attempt starts at `RECEIVED` only after `RETEST_FAILED`. An executor retry keeps the same `UatAgentRun` row (`FAILED_RETRYABLE` → `QUEUED_FOR_AGENT`), and `CANCELLED` is terminal (a closed ticket). The portal mints the MC checkout when a run is queued, before it freezes the dispatch payload, and reconcile relays every `QUEUED_FOR_AGENT` run that has no live dispatch. The Hermes worktree failover marks the run and pins Cursor for its retry. | `domain/attempt-policy.ts:21-50`; `domain/run-state.ts:57-92`; `workflow/production-services.ts:465-470,747-752,485-486`; `enqueue-queued-executor-dispatch.ts:117-131` |
| F43 | **The Dell's two local aliases share one backend:** `local-primary` and `local-fast` both call `127.0.0.1:8000`. Trading's scheduled lanes use `local-driver` only (F27); `local-primary` and `local-fast` are the swarm's interactive aliases. The `dell-vta` worker runs `COMPUTE_WORKER_MAX_SLOTS=4` shard threads. | local-inference `litellm/config.yaml:2-11`; swarm `config/models.yaml:43-51,64-68`; `config/trading-workers.yaml:226-240` |
| F44 | **Every MC checkout call mints a new `dsp_`.** The portal's checkout client always POSTs `/checkout`, and MC inserts a new dispatch on each call; reuse happens only when the caller reads a stored `mcCheckoutId` first. | portal `mission-control/checkout-client.ts:291-303,340-351`; PLX_MC `src/lib/compliance/service.ts:197-202`; portal `workflow/production-services.ts:747-752` |
| F45 | **On the Dell, trading lives in `vince`'s profile.** Trading's local-inference checkout is `C:\Users\vince\local-inference`, the swarm checkout is under `C:\Users\vince\Documents\GitHub`, and Python is a per-user install under `C:\Users\vince\AppData\Local\Programs\Python\Python312`. Trading's scheduled scripts call a bare `python`, so whichever `python` comes first on the PATH runs trading. Trading also keeps state in `C:\ProgramData\AgenticSwarm`. Scheduled-task and CIM calls can hang for minutes to hours on this host. A standard account cannot read another user's profile by default. | local-inference `.orchestrator/sharepoint-doc-org-harness/docs/ops.md:263`; swarm `config/trading-workers.yaml:194,204-205`; `config/operator-hosts.yaml:246`; `scripts/trading-research/dawn_harvest_scheduler.ps1:44`; `scripts/compute-fabric/vta-worker-process.ps1:7-10`; `selfupdate-vta-worker.ps1:127,204-212` |
| F46 | **The Dell's vLLM backend already listens on every interface** (`--host 0.0.0.0 --port 8000`), and local-inference's health check names `http://100.103.33.54:8000/v1`. That check runs on the Dell itself, and vLLM is a Docker Desktop port behind Windows Firewall, so reachability from another node is not yet proven; P1b checks it first. | local-inference `scripts/start_dell_vllm_qwen3_32b_awq.sh:21`; `scripts/start_dell_vllm_qwen3_32b_awq_durable.sh:34`; `scripts/health_check_local_inference.ps1:5` |
| F47 | **The portal's admin "evaluation" module is Persona QA, and it does not evaluate agents.** `/admin/agents/persona-qa` lists runs of a scripted Playwright explorer that tests staging UI routes after each deploy (`PersonaQaRun` keyed by staging SHA, with findings, tapes and evidence). It makes no model calls and has no score, grader, rubric or golden-set table. A new enqueue cancels every running or queued run, so it runs one at a time. | portal `app/admin/agents/persona-qa/page.tsx:31`; `prisma/schema.prisma:7525-7650`; `services/persona-qa-worker/src/missions.mjs:65-170`; `app/api/internal/persona-qa/enqueue-service.ts:188,220`; `.github/workflows/persona-qa-post-deploy.yml` |
| F48 | **`AgentVersion.evalConfig` declares rubrics and KPIs, but nothing checks them.** The schema is `{ rubrics[], kpis[], notes }` ("declarative: no new scoring code"). Its only runtime reader shows the persona-QA supervisor's cadence. Activating a version moves the pointer and writes an audit row; it checks no eval. The agent detail page has no Eval section. | portal `lib/agents/capabilities.ts:48-56`; `app/admin/agents/persona-qa/_lib/supervisor-ledger.ts:165,259-271`; `app/api/admin/agents/[agentId]/activate/route.ts:31-41`; `app/admin/agents/[agentId]/agent-detail.tsx:87-90,654` |
| F30 | A seed spec with the default activation policy activates its code definition on every `db-seed-staging` run, which replaces a version an admin activated. The persona-QA seeds use `activationPolicy: "DRAFT_ONLY"` to avoid that; the COS and Hasitha seeds do not. | `portal/src/lib/agents/persona-qa-agents.ts:809`; `__tests__/seed-version-policy.test.ts:33-123` |

## 3. Decisions

| # | Decision | State |
|---|---|---|
| D1 | The portal registry (`Agent`/`AgentVersion`) is the only agent registry. No second registry. | Confirmed 28 Sep 2026 |
| D2 | The runner lives in its own small repo. It grows from the Hermes bridge. | Confirmed 28 Sep 2026 |
| D3 | First two loops: the CoS daily brief and Hasitha UAT batch fixes. | Confirmed 28 Sep 2026 |
| D4 | Each agent can use any model provider or a model we host. No lock-in to one vendor. | Confirmed 28 Sep 2026 |
| D5 | **One model gateway for agents: a fleet instance of the local-inference LiteLLM proxy on its own small EC2 host, `fleet-proxy`, at `:4001` on the tailnet.** It runs from its own install with its own config (`litellm/fleet.yaml`), systemd unit, env file rendered from its own secret `prod/fleet-proxy`, and its own Postgres. It is not the runner host (SC-6), not the Dell, and not a trading host. It defines no `local-driver` or `local-coder` alias. An agent names a fleet alias (for example `cloud-claude-sonnet`, `cloud-gpt`, `local-primary`), never a vendor SDK. Fleet vendor keys live only on `fleet-proxy`. Local aliases (P1b) reach the Dell's model server over the tailnet (F46); nothing of the fleet runs on the Dell. The existing proxy at `:4000` stays exactly as it is. | Confirmed 28 Sep 2026 as "one gateway"; amended in r6 to a separate fleet instance on the Dell (round-1 finding CR-F8); **amended in r13 to its own EC2 host**, because every late blocker on the Dell came from running the fleet next to trading. Amendment confirmed by the operator 28 Sep 2026. |
| D6 | **Runner harness: Hermes Agent.** It talks to any OpenAI-compatible endpoint (F8). Each agent gets one Hermes profile that points at the fleet proxy with that agent's alias and key. | Confirmed 28 Sep 2026 |
| D7 | **Models we host run from the runner only, in phase 1.** Portal chat keeps its current cloud path (F4, F10). | Confirmed 28 Sep 2026 |
| D8 | **A model change is a new `AgentVersion`, then activate.** The audit log records it. | Confirmed 28 Sep 2026 |
| D9 | **Guardrails come from permissions, not from the model.** Repo scope, MC checkout, draft PRs only, and no merge rights apply to every agent. D24 says how the runner enforces them. | Confirmed 28 Sep 2026 |
| D10 | **Runner host: not the Dell VTA.** A DGX Spark only if it runs no trading work (D23); otherwise a new, dedicated EC2 instance on the tailnet. On 28 Sep 2026 both Sparks run trading work, so the runner goes on the dedicated EC2. | Confirmed 28 Sep 2026; D23 narrows it |
| D11 | **All cloud providers on the fleet proxy,** with per-agent limits on which providers each agent may use. The fleet uses its own provider accounts and keys, never a key from `prod/ec2-secrets`. For every provider, and always for those trading uses (Anthropic, OpenAI, xAI, Google), the fleet's account is a separate organisation or team, not a project inside trading's, so it shares no rate limit, spend cap or data-use setting with trading (F27). | Confirmed 28 Sep 2026; key-source rule added in r6 |
| D12 | **Agent reports are recorded in MC** as `agent.report` events (P8). | Confirmed 28 Sep 2026 |
| D13 | **COS is the chief of staff for the stack: one agent, many doors.** The portal panel, the companion window, the desktop app and Grok Bot all reach the same `chief-of-staff` registry entry, with one persona, one set of threads, one audit log and one kill switch. No door copies COS's persona into another model's prompt. | Confirmed 28 Sep 2026 |
| D14 | **COS knows, delegates, asks and stops.** It reads MC, the fleet and the brain. It hands work to an agent by creating an MC task with that agent as assignee. It asks the operator to approve runs that need approval. It may pause an agent (`Agent.status` to `DISABLED`); only a human may turn one back on. It never holds another agent's repo access or keys. | Confirmed 28 Sep 2026 |
| D15 | **MC's agents module retires** (F16): the four placeholder agents, the per-agent mode and the derived presence. MC keeps tasks, checkouts, the compliance gate and agent reports. A task's assignee may name an agent slug. | Confirmed 28 Sep 2026 |
| D16 | **Approval lives in the registry and flows through COS.** Each runner loop has `autonomy`: `approve` (the default) or `auto`. The portal, not the runner, decides that a run needs approval, from the registry. An `approve` run waits until an ADMIN presses Approve in the portal COS panel or the companion, through a session-authenticated route. Approve and Decline are buttons, never model tools. The approval binds the run id and the version id, and it is written with its `AgentAuditLog` row in one transaction by a fail-closed writer. For a `uat-job` loop, the approval is the portal's existing ADMIN agent authorisation of the ticket (F36), not a second one. Outside doors (Grok Bot, Add-on B) cannot approve, decline, delegate or pause. | Confirmed 28 Sep 2026; **amended in r6** to ADMIN-only, portal and companion only (round-1 finding CR-F5). Amendment confirmed 28 Sep 2026. |
| D17 | **COS's brief replaces the swarm's Lobster `daily-brief`.** It reads what exists (open MC tasks, agent reports, UAT ops digest, Awaiting You items) instead of recomputing. It does not duplicate `/api/admin/digest` or Awaiting You T904 (F24). | Confirmed 28 Sep 2026 |
| D18 | **The runner takes over the Hermes executor role in UAT dispatch.** Cursor Cloud stays the default executor: only a ticket an ADMIN authorised goes to the runner, only while the routing flag is on, and it moves to Cursor if the runner does not claim it in 30 minutes (P14a). The runner pulls UAT jobs from the portal (it is not reachable from Vercel), speaks `uat-agent/v2`, and pushes only its branch. A job goes to exactly one executor. The portal mints the MC checkout when the runner pulls an authorised job (F32), and keeps PR creation, completion and ticket status, as the bridge contract already requires (F29). Results come back through the existing callback (F34). The Dell VTA bridge keeps running until the runner has taken over; then its two Windows tasks retire. | Confirmed 28 Sep 2026; pull model stated in r6; routing wording amended in r11, amendment confirmed 28 Sep 2026 |
| D19 | **Runner runs use the portal's job pattern** (F22): caller `runner`, correlation id, mode and a lock, in a new `AgentRun` table (P4a), because `WorkRoutingRun` does not fit. | Confirmed 28 Sep 2026; table named in r6 |
| D20 | **No new kill switch.** The runner and every COS door obey `Agent.status` and `TRIPLE_T_ENABLED` (F26). The portal enforces both in P4, because the runner cannot read a Vercel variable. A door has an on/off flag as an integration, not as a way to stop COS. | Confirmed 28 Sep 2026 |
| D21 | **COS's outside doors use per-person keys.** A key acts for the person who created it (`createdById`), carries scopes, expires within 90 days and can be revoked. COS answers through a door with that person's permissions. | Confirmed 28 Sep 2026 |
| D22 | **One agent worker.** `persona-qa-worker` stays per-deploy for now and folds into the runner later. No third worker. | Confirmed 28 Sep 2026 |
| D23 | **The trading lab is not affected** (F27). No fleet phase edits, restarts, reroutes or adds load to the trading gateway at `:4000`, its env file, its watchdog, the `local-driver` lane, the Sparks, the `dell-vta` worker, TRADINGBOX or `prod/ec2-secrets`. The fleet proxy (D5) defines no `local-driver` alias. The runner never runs on a host that runs trading work, and its tailnet access reaches only the fleet proxy. | Confirmed 28 Sep 2026 |
| D24 | **The runner enforces D9 by construction.** Each run executes as its own OS user in its own fresh clone, with only a fleet key minted for that run (r13; P6). GitHub access is a GitHub App installation token limited to the loop's `repos` with contents write, and never `petralabx/agentic-swarm`. Only the runner's parent process holds the token; the agent's OS user never sees it. The parent fetches the run's commit into a clone it owns, re-checks the governance files, and pushes only `fix/agent-runner-<run id>` (F35), with the pre-push hook run from a pinned `staging` copy, never from the run's commit. GitHub cannot limit an App to one branch pattern without blocking other pushers, so the parent's rule is enforced in code and tested, and a daily audit of the App's pushes alerts on any other ref. The runner has its own MC principal, `sp_mcp_agent_runner`, added to PLX_MC's principal list by a PR (F33). The runner never opens, merges or approves a PR. | Proposed in r6 (round-1 finding CR-F16); confirmed 28 Sep 2026 |
| D25 | **An agent version passes an eval before it goes live.** Each runner agent's `evalConfig` names an eval suite, a pass threshold and whether the gate is required. A new version runs the suite on the runner in eval mode (no writes, no push, no checkout), is scored by deterministic checks and a judge model from another provider family, and is compared with the active version. `activate` refuses a required version that scores below its threshold or below the active version, unless an ADMIN overrides with a reason, written with its audit row by the fail-closed writer. Persona QA stays the portal's UI smoke test and also checks what a runner PR deployed (P14). | Proposed in r13, from the operator's question about the admin evaluation module (F47, F48). Confirmed 28 Sep 2026. |
| D26 | **Runs are parallel from phase 1, within limits.** Each loop has `maxConcurrent` (1 to 4, default 1), counted by the portal. The runner host runs up to `RUNNER_MAX_CONCURRENT_RUNS` runs at once, each as its own OS user, in its own clone and its own systemd unit with CPU, memory and task limits. The host starts at 1 for the canary and ramps to 2, then 4, each step after a clean week. | Proposed in r13, from the operator's question about parallelism. Confirmed 28 Sep 2026. |

### Model choice for the pilots

| Agent | Loop | Model alias | Why |
|---|---|---|---|
| `chief-of-staff` | Daily brief | a cloud fast alias, then `local-primary` if P1b passes (P7) | Read-only, daily, low risk. On a local alias it runs at zero cloud cost. |
| `hasitha-fernando` | UAT batch fixes | a strong cloud coding alias (for example `cloud-claude-sonnet` or `cloud-gpt`) | It writes code. Tool-calling quality matters more than cost. |

COS chat in the portal and through its doors keeps the portal's current cloud path (D7).
A loop may name its own model (P3), so COS's brief can use a fleet alias while COS chat
stays on the cloud path.

## 4. Success criteria

| # | Criterion | Check |
|---|---|---|
| SC-1 | Changing an agent's model, within the aliases the agent's key allows, takes one new `AgentVersion`, a passing eval when the agent's gate is required (D25), and an activate. No code deploy and no env change. | P7, P15 |
| SC-2 | One agent runs on a cloud model through the fleet proxy (P11, P14). If P1b passes, one runs on a hosted model too (P7). | P11, P14; P1b, P7 |
| SC-3 | Every PR the fleet produces carries a live MC stamp whose `actor.repo` matches its repo. The portal's checkout provides it for UAT work (D18). | P14; the `compliance` check |
| SC-4 | Setting an agent to `DISABLED`, or `TRIPLE_T_ENABLED` to false, stops its next run within one scheduler tick and kills a running one within 60 seconds (the runner polls every 20 seconds). | P4, P6 |
| SC-5 | Spend is visible and capped per agent and per run. | P2, P6 |
| SC-6 | Runner hosts and agent profiles hold no vendor key. Fleet vendor keys exist only on `fleet-proxy`: in `prod/fleet-proxy` and the env file rendered from it. | P1, P6 |
| SC-7 | Three DB migrations in this spec, each in its own PR: P4a (`AgentRun`), P12a (API key scopes) and P15a (eval tables). No other `prisma/migrations/` change. | `git diff --stat` per PR |
| SC-8 | The runner does not run on the Dell VTA or on any host that runs trading work. | P5 |
| SC-9 | **COS is one agent.** A question asked through Grok Bot shows up in the asker's COS threads in the portal, and the audit log records the door. | P13 |
| SC-10 | **MC has no agent list of its own.** No placeholder agents remain, a task can name an agent as assignee, and `humanOnly` rules still reject an agent. | P9 |
| SC-11 | **An `approve` loop does nothing until an ADMIN presses Approve** in the portal or companion, and the approval is in the audit log. No model tool and no outside door can approve. | P10, P12b, P14 |
| SC-12 | COS can pause an agent and cannot turn one on. | P10 tests |
| SC-13 | **The trading lab sees no change** (D23). The process that owns port 4000 keeps its start time, and the trading guard's file hashes do not change, across every fleet phase. The fleet proxy has no `local-driver` alias. The runner host cannot reach `:4000`, the Sparks or TRADINGBOX, and its run users cannot reach the instance metadata service or the VPC. No fleet process runs on the Dell; if P1b adds the local aliases, its Dell load test passes. | P1, P1b, P5 |
| SC-14 | **Evals gate activation** (D25). A required agent version that scores below its threshold, or below the active version, cannot be activated without an audited ADMIN override. | P15 |
| SC-15 | **Runs are parallel and isolated** (D26). Two runs of different loops, or two claims of one `uat-job` loop with `maxConcurrent: 2`, run at the same time; killing or starving one does not affect the other; a loop never exceeds its `maxConcurrent`. | P4, P6 |

## 5. Execution contract

- Every phase that edits a repo needs its own MC TASK and checkout: search, create
  only on a real miss, `mc_checkout_task` with `repo`, `prBodyLine` in the PR body
  at open, last commit, then `mc_complete_task`, then freeze.
- One phase per PR. Draft PRs only. Agents never merge.
- Portal phases run `cd portal && npm run typecheck && npm run lint && npm run test`.
  A phase that adds a route also runs `npm run build && npm run audit:hygiene`.
- PLX_MC phases run `./scripts/preflight.sh --mode pre-push`.
- A portal DB migration ships in its own PR and is applied to each database listed in
  `_apply_migrations_to` in `scripts/db-targets.json` (staging and UAT today).
  Production follows the normal promotion path.
- Any live model call in an acceptance step names its expected cost.
- Dates and times shown to the operator are ET.
- **Trading guard (D23):** two steps run a command on the Dell: P1b and P14's
  retirement of the two Hermes bridge tasks. Each records, before
  and after, the start time of the process that owns port 4000
  (the PID from `netstat -ano` for `:4000`, then `tasklist /V /FI "PID eq <pid>"`)
  and the SHA-256 of trading's `litellm/config.yaml`, `.env.local`, `.env.langfuse`,
  `scripts/start_proxy.sh`, `scripts/ensure_proxy.sh` and the task definitions of
  `LocalInferenceProxy*` and `AgenticSwarm-VTA-*` (exported with
  `schtasks /Query /XML`, with a timeout), plus, run as `vince`, the output of
  `where python` and `py -0p`, using `netstat`, `tasklist` and `schtasks` with
  timeouts (CIM calls can hang on the Dell, F45). A change fails the phase. No fleet
  process runs on the Dell; P1b's probe runs only for its test and is removed after, and
  no phase runs `git pull` in trading's checkout.
- **Fleet proxy stop rule:** the fleet proxy stops only with
  `sudo systemctl stop litellm-fleet` on `fleet-proxy`. Nothing else stops it.

## 6. Phases

### P0 — Record the lesson (portal, docs)

- Add to `tasks/lessons.md`: "Before proposing new agent infrastructure, check the
  portal `/admin/agents` registry and `docs/modules/agents/README.md`."
- Acceptance: `grep -n "admin/agents" tasks/lessons.md` prints the line.
- Rollback: revert the commit.

### P1 — Fleet proxy host with cloud aliases (local-inference PR, then operator)

- **Infra (operator).** Create a new, dedicated EC2 instance `fleet-proxy` (Ubuntu LTS,
  2 vCPU, 8 GB RAM, 50 GB disk). It is not the runner host (SC-6), not TRADINGBOX, the
  VMC host, swarm-prod or the brain host. High-risk infra bundle, bucket PRD.
  - Security group: no inbound. Outbound only TCP 443 (model providers, Secrets
    Manager, S3), TCP 80 (package mirrors) and Tailscale's UDP 41641 and 3478.
  - Instance profile: a new role whose only permissions are
    `secretsmanager:GetSecretValue` on `prod/fleet-proxy-??????` and `s3:PutObject` on
    the fleet backup prefix (P1's backup timer). IMDSv2 with a hop limit of 1, and the
    host's `nftables` table drops `169.254.169.254` and `fd00:ec2::254` for every user
    but root.
  - Tailnet: save the policy; add `tag:fleet-proxy` to `tagOwners`; accept the
    operator's identity to `tag:fleet-proxy:4001` and SSH (`action: check`). The rules
    from `tag:agent-runner` (fleet P5) and `tag:plx-brain` (retirement R5) are added by
    the phase that creates each tag, so no rule names a tag that does not exist yet. Add
    `tests` that TRADINGBOX → `:4000`, the Dell → Spark B `:18090` and
    TRADINGBOX → `tag:dgx:22` still pass; that `tag:fleet-proxy` is denied `:4000`, the
    Sparks and TRADINGBOX; and that TRADINGBOX, the VMC host and swarm-prod are denied
    `tag:fleet-proxy:4001` and SSH to it. Join
    with `tailscale up --ssh --advertise-tags=tag:fleet-proxy --accept-dns=false --accept-routes=false`.
    Record the host's tailnet address as `<fleet-proxy>`.
- **Code (local-inference PR, new files only):**
  - `litellm/fleet.yaml`: cloud aliases for every D11 provider (`anthropic/…`,
    `openai/…`, `gemini/…`, `xai/…`, `mistral/…`, `deepseek/…`, `openrouter/…`), each
    with at least a strong and a fast alias, keys read from env
    (`os.environ/<PROVIDER>_API_KEY`). No local alias yet (P1b adds them), and never
    `local-driver` or `local-coder` (D23). No trace callback: the fleet never sends
    traces to trading's Langfuse on the Dell. Request and spend logs live in the fleet's
    own Postgres.
  - `deploy/fleet-proxy/`: a systemd unit `litellm-fleet.service` (user
    `litellm-fleet`, a pinned LiteLLM version in `/opt/litellm-fleet`, bound to
    `<fleet-proxy>:4001` only, `Restart=always`, `EnvironmentFile=/etc/litellm-fleet/fleet.env`);
    `render-env.sh`, which renders that file (root only, mode 0600) from
    `prod/fleet-proxy`; a daily `pg_dump` timer to the S3 backup prefix, run as root
    (only root reaches the metadata service); and a README. The unit runs
    `prisma generate` as `litellm-fleet`, with its cache in `/var/lib/litellm-fleet`.
- **Operator:**
  - creates the fleet's provider accounts (separate organisations or teams, D11), sets
    their data-use options (for example, opt out of training), and stores the keys,
    `FLEET_LITELLM_MASTER_KEY` and `DATABASE_URL` in `prod/fleet-proxy`;
  - installs PostgreSQL on `fleet-proxy`, listening on localhost only, with one database
    `litellm_fleet`; `allow_requests_on_db_unavailable` stays off (fail closed);
  - renders the env file and enables the unit.
- Acceptance:
  - `git diff --name-only origin/main...HEAD` lists only new files and `.gitignore`.
  - `git diff -U0 origin/main...HEAD -- litellm/ | grep '^+.*api_key:' | grep -v 'os.environ/'`
    prints nothing.
  - From the operator's tailnet identity,
    `curl -sS -H "Authorization: Bearer $FLEET_LITELLM_MASTER_KEY" http://<fleet-proxy>:4001/v1/models`
    lists every cloud alias and no `local-` alias.
  - One short chat completion per alias returns HTTP 200, and each appears in
    `GET /spend/logs`. Expected cost: under $0.25 total.
  - On `fleet-proxy`: `aws secretsmanager get-secret-value --secret-id prod/ec2-secrets`
    returns `AccessDenied`; as `litellm-fleet`, an IMDSv2 token request times out;
    probes to the Dell's `:4000` and `:8000`, the Sparks and TRADINGBOX fail.
  - `sudo systemctl kill litellm-fleet` is followed by a restart within 30 seconds.
  - The tailnet policy `tests` pass. No command ran on the Dell.
- Rollback: `sudo systemctl disable --now litellm-fleet`; restore the saved tailnet
  policy; terminate the instance; revert. `:4000` never changed.

### P1b — Local aliases through the fleet proxy (local-inference PR, then operator; after P1 and P2; optional)

- First, read-only: from `fleet-proxy`, after adding the tailnet rule below,
  `curl -m5 http://100.103.33.54:8000/v1/models` must answer. If it does not, P1b
  stops and local aliases stay out: opening the Dell's firewall would need its own
  D23 exception.

- Add `local-primary` and `local-fast` to `fleet.yaml`, both calling the Dell backend
  at `http://100.103.33.54:8000/v1` over the tailnet (F46), with the backend key
  `FLEET_LOCAL_BACKEND_KEY` in `prod/fleet-proxy`. Each sets `max_parallel_requests`
  and `rpm` in its `litellm_params`; both call the same backend (F43), so each gets half
  of the ceiling the operator sets. Record how the pinned LiteLLM version treats a full
  deployment (1.89.4 makes requests wait; 1.103.0 answers 429 at once).
- Tailnet: one more accept rule, `tag:fleet-proxy` to `100.103.33.54:8000`, saved
  first, with the P1 `tests` re-run. Nothing on the Dell changes.
- **Dell load test (A/B).** This measures whether fleet traffic slows the Dell while
  trading's own work runs as normal. It is the only fleet step that runs a command on
  the Dell, under the trading guard.
  - The operator unpacks a portable Python with numpy into `C:\fleet-probe` (for
    example the NuGet package plus `pip install --target`), with no installer and no
    PATH change, and deletes the folder after the test.
  - The probe (`scripts/fleet_load_probe.py`, added in this phase) times a fixed numpy
    workload (matrix and rolling-window math, like a backtest) in as many processes as
    the worker's slot count (`COMPUTE_WORKER_MAX_SLOTS`, 4 today), each pinned to one
    thread (`OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS` = 1), about
    60 seconds. It reads neither trading's data nor its files.
  - It runs only while `dell-vta` holds no lease. It reads the worker's leases every 5
    seconds, read-only; if a lease starts, it kills its own processes and the driver
    within 5 seconds and that pair is run again later.
  - The driver (`scripts/fleet_load_drive.py`) runs on the operator's workstation, never
    on the Dell, a Spark, TRADINGBOX or the VMC host, and
    sends traffic to both local aliases through `fleet-proxy` at their deployment
    limits, with 2,000-token prompts and 512-token answers. Expected cost: $0.
  - Run 5 pairs in one ET window, alternating driver off and on. The test fails if
    the median probe time with the driver on is more than 10% above its median with
    the driver off. Faster is not a fail.
  - Repeat after any change to a local alias's limits, using enough P2 keys to reach
    each deployment's `max_parallel_requests`.
- Update the keys (`POST /key/update`) of agents allowed a local alias: add the local
  aliases, set `max_parallel_requests` to the sum of the agent's loops'
  `maxConcurrent`, and set `rpm_limit` and `tpm_limit`. Repeat whenever a new version
  changes `maxConcurrent` or the aliases.
- Acceptance: the load test passes; the trading guard holds; one short completion on
  each local alias returns 200; `C:\fleet-probe` is gone.
- On a fail, or as rollback: remove the local aliases from `fleet.yaml`, restart
  `litellm-fleet`, and remove the tailnet rule. Cloud aliases keep working.

### P2 — Per-agent keys and budgets (fleet proxy)

- The fleet proxy already has its database (P1). Mint one virtual key per agent with
  `POST /key/generate`: a non-empty `models` list of fleet aliases, `max_budget`,
  `budget_duration`, and `metadata.agent_slug`. A key that lists a local alias (after
  P1b) also gets `max_parallel_requests` equal to the sum of its loops'
  `maxConcurrent` (D26), an `rpm_limit` and a `tpm_limit`, because local aliases cost $0
  and a budget never stops them.
- Mint one eval key per agent with a P15 suite (`metadata.purpose: eval`), listing the
  agent's model aliases and its `judgeModel`, with its own budget.
- Mint one more key for the brain (retirement spec R9), with cloud aliases only
  (retirement D6).
- Acceptance:
  - A key scoped to alias A gets a 401 or 403 on alias B.
  - A key scoped to a cloud alias with `max_budget: 0.01` is refused after it passes
    the budget. Expected cost: under $0.05.
  - `GET /key/info` shows spend for each key. A key scoped to a cloud alias with an
    `rpm_limit` of 2 gets 429 on its third request in a minute. Expected cost: under
    $0.01.
  - Every key has a non-empty `models` list; `GET /v1/models` with each key does not
    list `local-driver`, and with the brain key lists no `local-` alias.
  - After P1b: a burst across three keys never has more requests running on a local
    deployment than its `max_parallel_requests`, and P1b's load test passes again with
    the P2 keys.
- Rollback: delete the minted keys (`POST /key/delete`). Agents lose fleet access; the
  proxy keeps running.

### P3 — Registry contract (portal, code only)

- `modelConfigSchema`: treat `primaryProvider: "gateway"` as a known value (F3). Then
  `primaryModel` is a fleet alias. Add optional `fallbackModels: string[]`.
- New `loopSchema` (extends `namedCapabilitySchema`, all new fields optional):
  - `runtime`: `"runner"`
  - `trigger`: `"schedule"`, `"manual"`, `"task-assigned"` or `"uat-job"`
  - `schedule`: 5-field cron, read in America/New_York
  - `autonomy`: `"approve"` (default) or `"auto"` (D16)
  - `repos`: list of `owner/name`; empty means read-only. In phase 1 only a `uat-job`
    loop may name a repo, because only that path has a stamp and a PR (P14a).
    `petralabx/agentic-swarm`, and the name the retirement spec's T3 gives it, are
    refused, compared case-insensitively (D24)
  - `maxUsdPerRun`: positive number
  - `maxMinutesPerRun`: positive integer, default 30
  - `model`: optional fleet alias for this loop; defaults to `primaryModel`
  - `mcBucket`: bucket id for the loop's TASKs
  - `maxConcurrent`: integer 1 to 4, default 1 (D26)
- `evalConfigSchema` gains optional `suite` (an eval suite id), `threshold` (minimum
  pass rate, 0 to 1), `required` (default false), `judgeModel` (a fleet alias) and
  `maxUsdPerEval` (D25). Existing `rubrics`, `kpis` and `notes` stay.
- A loop without `runtime` stays an allow-list token, as COS's loops are today (F17).
- Set `activationPolicy: "DRAFT_ONLY"` on the `chief-of-staff` and `hasitha-fernando`
  seed specs (F30).
- Admin UI shows the new fields.
- Acceptance:
  - Unit tests: old seeds parse; a bad cron fails; a `repos` entry that is not
    `owner/name` fails; `Petralabx/Agentic-Swarm` in `repos` fails; `repos` on a
    non-`uat-job` loop fails; a loop without `autonomy` reads as `approve`;
    `maxConcurrent: 5` fails; an eval config with `required: true` and no `suite`
    fails.
  - A seed-policy test: a seed run keeps an admin-activated `activeVersionId` for
    both agents.
  - Portal checks exit 0. `git diff --stat origin/staging...HEAD -- portal/prisma`
    prints nothing.
- Rollback: revert the commit.

### P4a — Agent run tables (portal, migration, its own PR)

- New model `AgentRun`: `id`, `agentId`, `versionId`, `loopId`, `caller`
  (`runner`), `correlationId` (unique), `mode`, `status` (`QUEUED`,
  `AWAITING_APPROVAL`, `RUNNING`, `SUCCEEDED`, `FAILED`, `DECLINED`, `EXPIRED`,
  `SKIPPED_LOCKED`, `KILLED`), `usd`, `heartbeatAt`, `startedAt`, `endedAt`,
  `failureReason`, `approvedById`, `approvedAt`, `approvedVersionId`, `declinedById`,
  `declinedAt`, `uatRunId` (the `UatAgentRun` a `uat-job` run serves: nullable and
  unique, because the runner gets at most one claim per `UatAgentRun`; a retry after a
  runner failure goes to Cursor, P14a), and an index on `(agentId, loopId, status)`.
- New model `AgentLoopState`: `agentId`, `loopId` (unique together), `paused`,
  `pausedAt`, `pausedReason`, `clearedById`, `clearedAt`.
- Seed an inactive service user for runner audit rows. Its id goes in
  `AGENT_RUNNER_SYSTEM_USER_ID`, like `PLX_WORK_ROUTING_SYSTEM_USER_ID` (F6).
- Acceptance: the migration applies to staging and UAT (execution contract); portal
  checks and `npm run build` exit 0; the diff touches only the schema, the new
  migration folder and the seed.
- Rollback: revert the code and keep the tables. Prisma has no down migrations, and a
  drop would be a fourth migration.

### P4 — Runner API (portal, new routes)

- Add `/api/runner/v1` to `PUBLIC_ROUTES` (F28). The routes do their own auth: one
  runner service token through the shared route wrapper. Zod on every body. Standard
  `{ data }` / `{ error }` envelope.
- `GET /api/runner/v1/agents`: each `ENABLED` agent's active version with its
  `runner` loops, model alias, repo scope and autonomy, leaving out paused loops.
  When `isTripleTEnabled()` is false it returns 503 (D20).
- `POST /api/runner/v1/runs`: start and finish a run. The portal, not the runner,
  sets the first status from the registry: `AWAITING_APPROVAL` for an `approve` loop,
  `RUNNING` otherwise. A `uat-job` run is not started here: P14a creates it at pull,
  already `RUNNING`, because the ticket's ADMIN authorisation is its approval (D16). It writes the `RUN_START` / `RUN_END` audit pair as the service
  user. A start is refused with `SKIPPED_LOCKED` when the loop already has
  `maxConcurrent` runs `RUNNING` (D26). In one transaction the portal runs
  `INSERT … ON CONFLICT DO NOTHING` for the loop's `AgentLoopState` row, then
  `SELECT … FOR UPDATE` on it, then counts, so two starts at the limit never both
  succeed. An approval that moves a run from `AWAITING_APPROVAL` to `RUNNING`, and a P14a
  claim, count the same way; an approval at the limit leaves the run waiting.
- `POST /api/runner/v1/runs/{id}/heartbeat`: the runner calls it every 60 seconds. A
  `RUNNING` row with no heartbeat for 10 minutes (as `RUN_LOCK_TTL_MS`, F34) becomes
  `FAILED` with reason `stale`, which frees the lock. Every runner route checks for
  stale rows first. The sweep also runs inside the paced
  `/api/internal/uat-agent/reconcile` (F39), so it works on staging with the runner
  down; P4 adds no Vercel cron. Whenever an `AgentRun` with a `uatRunId` ends in any
  state but `SUCCEEDED` (stale, `FAILED`, `KILLED` or `EXPIRED`), the same transaction
  moves that `UatAgentRun` from `AGENT_RUNNING` to `FAILED_RETRYABLE` with an event,
  compare-and-sets its provider from `agent_runner` to `cursor_cloud`, and sets the
  "runner already tried" mark, unless the callback has already moved it. The
  callback's `ERROR` path does the same. A retry then goes to Cursor, and a late
  callback from the released run fails the provider check (F38), because today's sweeps cover only
  `hermes-*` and `bc-*` runs (F38). The status route and the heartbeat
  refuse a run that is not `RUNNING`. The UAT callback keeps its own checks (F38).
- **Order at the end of a `uat-job` run:** the runner keeps the heartbeat going while
  the parent pushes and while it sends the callback, until the portal accepts the
  callback. It sends `RUN_END` only after that. It treats 409 `replayed_delivery` on a
  retry as accepted. It retries the callback at most 5 times with backoff. A 502 whose
  `message` starts with `executor_callback_wrong_status` (the `error` field says only
  `apply_failed`) means the `UatAgentRun` has moved on (the ticket closed, or it was
  swept, F38): the runner stops retrying. After a wrong-status answer or 5 failures, it
  sends `RUN_END` as `FAILED`, so one run at a time never gets stuck. The runner's
  token is accepted only for a claimed run that is `AGENT_RUNNING`. A kill stops the agent's process at once; if the parent is already
  pushing, it finishes the push and sends the callback (success or failure) first.
  Otherwise it does not push, and the run ends `KILLED`.
- `GET /api/runner/v1/runs/{id}/status`: whether the run may continue (agent still
  `ENABLED`, loop not paused, Triple-T on, approval still valid, and for a `uat-job`
  run, its `UatAgentRun` still `AGENT_RUNNING`, or already moved on by this run's own
  accepted callback, so a run can finish and send `RUN_END` after its callback). The runner polls it
  every 20 seconds.
- `GET /api/runner/v1/approvals?runId=`: the approval state. An approval request
  expires after 24 hours (`EXPIRED`). A run waiting for approval does not hold the lock.
- `GET /api/runner/v1/brief-inputs`: read-only inputs for the COS brief (UAT ops
  digest, Awaiting You items, run failures and spend in the last 24 hours).
- **Run-end rule:** after a run ends, if the loop has failed three runs in a row since
  its last `clearedAt`, the route pauses that loop (`AgentLoopState`) with an audit row
  as the service user. A budget refusal from the fleet proxy ends a run as a failure,
  so it counts here. It never changes `Agent.status`, so COS chat and other
  loops keep working. Only an ADMIN clears the pause (P10). COS's brief reports it.
- Acceptance:
  - No token gives 401 from the route itself, on the preview (the middleware lets it
    through); a valid token gives 200.
  - A `DISABLED` agent is absent from the list; a paused loop is absent; with
    `TRIPLE_T_ENABLED=false` the list gives 503.
  - With `maxConcurrent: 1`, a second start for the same agent and loop returns
    `SKIPPED_LOCKED`; with `maxConcurrent: 2`, ten concurrent starts leave exactly two
    `RUNNING`; a row with no
    heartbeat for 10 minutes becomes `FAILED` and the next start succeeds.
  - Three failed runs in a row pause the loop, and the agent stays `ENABLED`; after an
    ADMIN clears it, the count starts again.
  - A stale run's heartbeat and status are refused, and its bound `UatAgentRun` is
    `FAILED_RETRYABLE`.
  - With the runner stopped, a `RUNNING` row goes stale through the reconcile route
    alone.
  - `npm run test && npm run build && npm run audit:hygiene` exit 0.
- Rollback: revert the commit. Remove the token secret.

### P5 — Runner host (operator, infra)

- **Step 1, read-only.** For each Spark, record whether it runs trading work: run
  `systemctl --user is-active vmc-dgx-compute-worker` as the host's `ssh_user` in
  the swarm's `config/trading-workers.yaml`, and check whether any entry there with
  `disabled: false` names the Spark, and whether the gateway's `local-driver` alias
  points at it (F27). A Spark that does any of these is out: run nothing on it and do
  not load-test it. On 28 Sep 2026 both Sparks are out.
- **Step 2, infra change.** Create a new, dedicated EC2 instance (Ubuntu LTS, 8 vCPU,
  64 GB RAM, 300 GB disk: about 2 vCPU and 12 GB per concurrent run for up to four runs,
  plus the parent and the OS, D26). It is not TRADINGBOX and not the swarm or VMC host. Its
  security group allows no inbound traffic and outbound HTTPS, plus HTTP to the Ubuntu
  package mirrors; no security group that TRADINGBOX or the VMC host uses admits it.
  It gets no instance profile by default, so the operator manages it over Tailscale
  SSH from the operator's own tailnet identity (step 3 adds that rule, and step 4
  accepts `ct state established,related` first so replies pass). Not
  `autogroup:admin`: TRADINGBOX, the VMC host and swarm-prod are admin-owned devices
  and would be admitted too. If the operator prefers
  Session Manager, a profile with only `AmazonSSMManagedInstanceCore` is allowed and
  recorded; never the EC2-SECRETS
  role, and never any role that can read Secrets Manager or send SSM commands. IMDSv2
  is required with a hop limit of 1 (`aws ec2 modify-instance-metadata-options
  --instance-id <id> --http-tokens required --http-put-response-hop-limit 1`), and
  user-data holds no secret.
  This is an infra change: high-risk bundle, bucket PRD, the operator creates it.
- **Step 3, tailnet policy.** A new tag needs a `tagOwners` entry, so the policy always
  changes. Save the current policy, add `tag:agent-runner` to `tagOwners` and one accept
  rule from it to `tag:fleet-proxy:4001` (P1 must be done), plus an `acls` rule for port 22 and an `ssh` rule from
  the operator's user identity to `tag:agent-runner` (`action: check`, a non-root
  `users` list), and add policy `tests` that TRADINGBOX → `:4000`, the
  Dell → Spark B `:18090` and TRADINGBOX → `tag:dgx:22` are still accepted. Add
  `sshTests` that TRADINGBOX's owning admin (TRADINGBOX has no tag) still reaches
  `tag:dgx` as `vinnysachet` and `vinnysachet2`, and that TRADINGBOX, the VMC host and
  swarm-prod are denied SSH to `tag:agent-runner`. Run the trading guard.
  Rollback: restore the saved policy.
- **Step 4, host fence.** Join with
  `tailscale up --ssh --advertise-tags=tag:agent-runner --accept-dns=false --accept-routes=false`,
  so DNS and apt keep using the VPC resolver. A root-owned `nftables` table of family
  `inet` (IPv4 and IPv6) first accepts `ct state established,related`, then allows new
  outbound traffic on `tailscale0` only to `<fleet-proxy>:4001` and drops the rest,
  including every `fd7a:` tailnet address.
  Every run user (D24) has the primary group `fleet-run`. For that group
  (`meta skgid`), the same table also drops `169.254.0.0/16` (the instance metadata
  service), `fd00:ec2::/32` and the VPC CIDR (record it). Run users resolve names only
  through the local stub `127.0.0.53`; `systemd-resolved` forwards the query as its own
  user. Agents run as unprivileged users, so they cannot change the table.
- Acceptance, all from the runner host:
  - `curl -m5 http://<fleet-proxy>:4001/v1/models` with a fleet key succeeds.
  - These all fail, on both the IPv4 and the `fd7a:` IPv6 tailnet address where one
    exists: the Dell's `:4000`, `:8000`, `:3100` and `:8787`; Spark A `:18082`; Spark B
    `:18090`; TRADINGBOX and the VMC host (also on their private VPC addresses).
  - As a `fleet-run` user, the IMDSv2 token request
    (`curl -m5 -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60"`)
    times out (curl exit 28), and so does a probe to one private VPC address; as root,
    the same token request succeeds. Name lookup through `127.0.0.53` still works.
  - From the operator's machine, `aws ec2 describe-instances --instance-ids <id>` shows
    no profile (or the recorded SSM-core one) and `HttpTokens: required` with
    `HttpPutResponseHopLimit: 1`.
  - `apt-get update` succeeds.
- **Evidence:** one report with each Spark's trading role, the instance id, the
  `nftables` rules, the tailnet policy diff with its tests, and the probe results
  (SC-8, SC-13).

### P6a — Onboard the runner repo (PLX_MC PR, then operator)

- A PLX_MC PR adds `sp_mcp_agent_runner` to the reviewed principal list (F33), with a
  test that it authenticates. (P8 tests that `sp_mcp_grok` cannot set an `agent:`
  assignee.)
- An org admin creates `petralabx/agent-runner`. Onboard it per
  `docs/runbooks/REPO-ONBOARDING.md`: a registry entry in `pending_adoption`, the
  routing manifest, `scripts/scaffold-tracked-repo.sh` (its workflows are high tier, so
  the bucket needs a PRD), branch protection and secrets, then `status: active`.
  Deploy PLX_MC so the checkout allowlist includes the repo (F13).
- The operator creates the principal's key and a GitHub App installed only on
  `petralabx/plx-customer-portal` with contents write, and a daily audit that lists the
  App's pushes and alerts on any ref other than `fix/agent-runner-*` (D24). No new
  ruleset is added, so no other pusher is affected.
- Acceptance: `mc_checkout_task` with `repo: petralabx/agent-runner` returns a stamp
  whose `actor.repo` is `petralabx/agent-runner`; a Cursor push to `cursor/*`, a human
  push and a PR-outbox PR still work; the audit flags a test push to another ref;
  preflight exits 0.
- Rollback: set the registry entry inactive, revert the principal PR, uninstall the App.

### P6 — Runner repo (new `petralabx/agent-runner`)

- Start it lean: one short root guide that carries the locked sentence ("Last
  commit, then mc_complete_task, then freeze.") and the seven handshake needles.
- Copy the bridge's hardened parts (job store, bounded commands, worktrees, leases,
  profile checks, governance snapshot) with a provenance note. Make its Windows paths configurable.
  Leave the Dell VTA bridge as it is (D18).
- Add:
  - A scheduler tick (every minute). It reads P4, runs due loops, sends a heartbeat
    every 60 seconds and polls the run's status route every 20 seconds during a run;
    a stop answer, or three polls in a row that get no answer, kills the run (SC-4).
    If P4 does not answer, no run starts.
  - Parallel runs (D26): the runner runs up to `RUNNER_MAX_CONCURRENT_RUNS` at once:
    1 for the canary, 2 after P11's first clean week, 4 after P14's first clean week.
    Each tick starts at most (limit minus running) due runs, oldest first. Each run is
    a transient systemd unit in `fleet-runs.slice` with `CPUQuota=200%`,
    `MemoryMax=12G` and `TasksMax=512`, as its own OS user in its own clone, with its
    own heartbeat, status poll and kill. A run whose clone passes 20 GB is killed.
    Runs execute the portal's typecheck, lint and tests, never `npm run build` (CI's
    `lint-typecheck-build` covers the build), with
    `NODE_OPTIONS=--max-old-space-size=6144` and test workers capped at 2.
  - `task-assigned` loops: pick up open MC tasks whose assignee is this agent (P8).
    One attempt per task; a failed task waits for a human to re-queue it.
  - `approve` loops: ask for approval through P4 and wait without holding the lock (D16).
  - Isolation (D24): each run as its own OS user in its own clone, holding only its
    own agent key. The run's user runs the portal checks. Git refuses a local fetch
    across users (F40), and `safe.directory` would make the parent trust a repo the run
    controls, so both directions use bundle files:
    - Seed: the parent points a temporary ref `refs/heads/seed-<run id>` at the pinned
      `staging` SHA in its own mirror and runs `git bundle create` on that ref (a bundle
      of a bare SHA is refused as empty). The run's user runs
      `git clone -b seed-<run id> <bundle>` and then `git remote remove origin`, so its
      config never holds a token or a remote.
    - Collect: the run's user writes `git bundle create` of its branch. The parent runs
      `git bundle verify` in its own clone, fetches the bundle into a throwaway bare
      repository that shares the parent's objects as an alternate (so a thin bundle
      resolves), and then fetches from that repository into the parent's clone with
      `-c transfer.fsckObjects=true`. A local fetch checks every new object, which a
      direct bundle fetch does not on git 2.43, and it checks only the run's new
      objects, not all of `staging`'s history.
    - Check: the parent adds a work tree of its own at `<sha>`, requires the seed SHA to
      be an ancestor of `<sha>`, and computes the changed files itself from
      `git diff --name-only --no-renames -z <seed> <sha>`, so a file renamed out of a
      forbidden path shows both paths. It applies the job's allowed and forbidden
      paths and the regular-file, no-symlink rules, as the bridge does
      (`job-runner.mjs:436-472`), and re-checks the governance files with
      `governanceSnapshot` and `assertGovernanceUnchanged` (`:303-327`) in that work
      tree. The callback carries these parent-computed changed files and evidence; the
      parent never copies a test plan or file list the run reported.
    - Parallel runs share the parent's mirror, so the parent holds a per-repo lock
      around every fetch, `worktree add` and push, and gives each run its own push work
      tree (the MC receipt lives in each work tree's git dir).
    - Push: from that run's own non-bare work tree checked out at the pinned `staging`
      SHA, with `git -c core.hooksPath=<that tree>/.githooks`, the parent runs
      `git push origin <sha>:refs/heads/fix/agent-runner-<run id>` with
      `CURSOR_AGENT=1`, `MC_REPO` set, and the receipt for the checkout the portal
      minted at pull (`compliance-checkout.mjs --write-receipt`). The hook then runs
      the pinned script, never the run's (F40).
    The run's user never sees the GitHub App token. MC calls go out as
    `sp_mcp_agent_runner`.
  - Per-run Hermes profile generated from the registry: fleet `base_url`, the
    loop's alias, and the run's own key (below). Pin the Hermes version.
  - Caps: `maxMinutesPerRun`, a Hermes turn limit, and a spend cap. Parallel runs of one
    agent must not share a spend figure, so the parent mints a key for each run
    (`POST /key/generate` with the agent key's aliases and limits, `max_budget` =
    `maxUsdPerRun`) and deletes it when the run ends. The proxy refuses the run's calls
    past its budget, and the runner reads that key's `/key/info` every 60 seconds for
    `AgentRun.usd` and telemetry (SC-5).
  - One `POST /api/cursor/session-telemetry` per run, so MC counts runner spend.
  - For loops that touch the UAT database, avoid inbound pacer minutes 6, 21, 36 and
    51 UTC (F23).
- Acceptance:
  - Unit tests pass (`node --test`).
  - The root guide contains the locked sentence and each of the seven needles
    (one `grep -c` per needle, each at least 1).
  - Canary with a test agent on a cloud fast alias: one run, one `AgentRun` row, one
    audit pair, one telemetry event.
  - With the limit at 2: two runs of different loops run at the same time; killing
    one leaves the other running; a run that passes `MemoryMax` is killed by systemd
    and the other run finishes.
  - Set the agent `DISABLED` during a run: the run is killed within 60 seconds and
    no run starts on the next tick. Kill the runner mid-run: the row becomes `FAILED`
    (stale) within 15 minutes of its last heartbeat (10 minutes stale, plus up to 5
    minutes until the next reconcile ping).
  - An `approve` loop waits until an ADMIN approves it (P10).
  - `git grep -nE '(^|[^a-z])sk-[A-Za-z0-9_-]{16,}|_API_KEY=[^$[:space:]]'` prints nothing.
  - With no receipt, the parent's push fails `MISSING_STAMP`. A run whose commit edits
    `scripts/compliance-pr-verify.mjs`, adds a symlink, touches or renames out of a
    forbidden path, holds an object `git fsck --strict` rejects, or does not descend
    from the seed is refused before the push.
- Rollback: stop the service on the runner host.

### P7 — Model swap test (no code)

- On a test agent whose key allows two aliases (a cloud fast alias and, once P1b has
  passed, `local-fast`), create a new version that changes only `primaryModel` from one
  to the other. Activate it. After P1b, the same step moves `chief-of-staff` (P11) to
  `local-primary`.
- Acceptance: the next run's entry in the fleet proxy's `GET /spend/logs` shows the new
  `model_group`. No deploy, no env change (SC-1). Expected cost: under $0.05.

### P8 — MC: agent reports and agent assignees (PLX_MC)

- `POST /api/cursor/agent-report`, built like `session-telemetry` (F15): one
  `agent.report` event with `agentSlug`, `loopId`, `runId`, `title`, `markdown`
  (at most 32 KB). Dedup key `report:<agentSlug>:<runId>`.
- `mc_create_task` accepts an optional `assignee`. `mc_search_tasks` can filter by
  assignee, so a runner can find the tasks assigned to its agents.
- Add `sp_mcp_portal` to the reviewed principal list (F33) and mint one key for it. The
  portal uses that key only for COS's delegate tool (P10); its existing MC key does not
  change. Today's six principals are coding runtimes and the swarm, so none of them may
  set an agent assignee.
- Only a signed-in person or `sp_mcp_portal` may set an `agent:` assignee. No MCP action
  updates a task today, so an assignee is set at creation: the rule lives in
  `actionCreateTask` and covers both the MCP tool and `POST /api/cursor/tasks` (F16). A
  person reassigns through the session route `PATCH /api/tasks/[id]`, which gets the
  same rule. Any other MCP principal, `sp_mcp_grok` included, gets 403, so Grok Bot
  cannot delegate through MC (D16).
- Acceptance:
  - A report appears in `GET /api/events?kind=agent.report`; a repeat `runId` adds
    nothing; no auth gives 401; over 32 KB gives 400.
  - A task created with `assignee: "agent:hasitha-fernando"` is found by an
    assignee search.
  - `sp_mcp_grok` setting an `agent:` assignee gets 403 through the MCP tool and through
    `POST /api/cursor/tasks`; `sp_mcp_portal` gets 200.
  - `./scripts/preflight.sh --mode pre-push` exits 0.
- Rollback: revert the commit.

### P9 — Retire MC's agents module (PLX_MC)

- First, reassign or clear every task whose assignee or accountable owner is `vibes`,
  `atlas`, `sentry` or `scribe`. Once the list is gone, those ids would count as people.
- Remove the four placeholder agents, the per-agent mode, the derived presence and
  feed, and the "Assign open task to {agent}" command (F16, D15).
- Keep the rules that depend on telling agents from people: `isAgentId(id)` becomes
  `id?.startsWith("agent:")`; `humanOnly`, the accountable-owner rule and the
  TASK-629 approval gates stay, each with a test.
- A task's assignee is plain text. An `agent:<slug>` assignee shows as the agent's
  name, linked to `/admin/agents`.
- Update `docs/modules/agents/README.md` in PLX_MC to say the portal registry owns
  agents.
- Acceptance: no task names `vibes`, `atlas`, `sentry` or `scribe` as assignee or
  owner (count 0); no reference to the four placeholder agents in `src/`; the task
  board still shows and edits assignees; an `agent:` id cannot be the accountable
  owner; preflight exits 0 (SC-10).
- Rollback: revert the commit.

### P10 — COS tools for the stack (portal)

- New COS tools, each switched on by a `skills` id on the COS version (F17):
  - **Read MC:** open tasks, PR compliance status, recent `agent.report` events.
  - **Read the fleet:** agents, recent runs, failures and spend.
  - **Read the brain:** keep COS's current knowledge policy until the retirement
    spec's R11 (key scopes) is accepted. Then switch to `global`, passing the
    caller's scope, so a STAFF user or an outside door sees only what that person
    may see.
  - **Delegate:** search MC first, then create a task with an agent assignee (P8).
  - **Approvals:** COS can list pending `approve` runs; it cannot approve. The COS panel
    and the companion show Approve and Decline buttons that call
    `POST /api/agents/chief-of-staff/approvals/{runId}` (session auth, ADMIN role).
    The route updates the run only while it is still `AWAITING_APPROVAL`, and writes
    the decision and its audit row in one transaction through a new fail-closed,
    transaction-aware audit writer (the existing helper is fail-open, F37), bound to
    the run id and version id (D16). `uat-job` runs use the ticket's ADMIN
    authorisation instead (F36); they never appear here.
  - **Paused loops:** the panel lists loops the run-end rule paused (P4); an ADMIN
    clears one with a button, audited the same way.
  - **Brief view:** the Tasks tab shows the latest COS brief (P11).
  - **Pause:** set an agent to `DISABLED` with an audit row. A pause from chat needs
    a user who may change agent status. No COS tool can set `ENABLED` (D14).
- Acceptance:
  - A COS version without a tool's skill id cannot call that tool.
  - Delegation creates exactly one MC task, and none when a matching open task exists.
  - An ADMIN approval unblocks the run; a decline cancels it; both are audited in the
    same transaction. A STAFF user gets 403. No COS tool can approve, decline or clear
    a pause (SC-11).
  - A test proves no COS tool can enable an agent (SC-12).
  - Portal checks, build and hygiene exit 0.
- Rollback: create a COS version without the new skill ids and activate it, then
  revert the code.

### P11 — Pilot 1: COS daily brief

- Agent `chief-of-staff`, new version with one `runner` loop, `autonomy: auto`
  (it only reads and reports), `model:` a cloud fast alias until P1b passes, then
  `local-primary` through P7's swap, `repos: []`.
- Schedule: weekdays, 07:47 ET.
- Inputs: open MC tasks and agent reports (MC), and the P4 `brief-inputs` route (D17).
  The run's user holds only its agent key, so the runner's parent fetches these
  inputs and puts them in the prompt.
- Output: one `agent.report` in MC (P8), posted by the parent as
  `sp_mcp_agent_runner`, shown in the COS panel's Tasks tab (P10).
- Acceptance: five weekday runs in a row, each with an `AgentRun` row and a report in
  MC. Cloud spend for this loop stays under $1 a week on the cloud alias, and $0 after
  P7 moves it to `local-primary`. Each run stores its brief inputs with its `AgentRun`
  (they become P15's eval cases).

### P12 — COS door for other tools (portal)

- **P12a — key scopes (migration, its own PR).** `app_api_key` gains `scopes` (text
  array). The migration backfills `external` on every existing key, and
  `authorizeExternalRequest()` then requires that scope (F31), so a COS door key can
  never reach `/api/external/*`. The admin route that creates keys writes
  `["external"]` from then on (F37). The owner is the existing `createdById` (D21).
  Applied per the execution contract (SC-7).
- **P12b — the door.**
  - A person creates their own key in the portal, with scope
    `agents:chat:chief-of-staff`, an expiry of at most 90 days, shown once,
    revocable (D21).
  - Add `/api/agents/mcp` to `PUBLIC_ROUTES` (F28). `POST /api/agents/mcp` is a
    Streamable HTTP MCP endpoint with two tools: `cos_chat { message, threadId? }`
    and `cos_brief`. The door accepts only keys with a non-null `createdById` and the
    door scope. `cos_chat` runs the same pipeline as
    `/api/agents/chief-of-staff/chat`, as the key's creator, with their permissions
    and threads. Through this door, the approve, decline, delegate and pause tools
    are refused (D16).
  - Every call writes the door (`mcp`) and the client name (for example `grok`) to
    the audit log.
  - Flag `COS_MCP_DOOR_ENABLED`, default off. The external-integration declaration
    (owner, scope, auth source, default state, flag, health check, fallback, data
    boundary) goes in the PR body.
- Acceptance:
  - No key gives 401 from the route; a key without the scope gives 403; a revoked or
    expired key gives 401; a valid key gives 200 on the preview.
  - A `cos_chat` call continues a thread that the key's creator then sees in the portal.
  - A test proves the door cannot approve, decline, delegate or pause.
  - A door key gets 401 on every `/api/external/*` route; an existing external key
    and one created by the admin route after the migration both still work.
  - Audit rows name the door.
  - Portal checks, build and hygiene exit 0.
- Rollback: turn the flag off, then revert. Revoke the keys.

### P13 — Grok Bot canary (operator)

- Add the P12 door to one operator's Grok Bot as a remote MCP server, with that
  operator's own key.
- Ask three questions and request the brief. Check that the threads and audit rows
  appear in the portal (SC-9).
- If Grok Bot cannot send a custom header to a remote MCP server, stop and record
  what it supports. The operator then picks the next step.
- Acceptance: for each question, the door and the portal make the same tool calls and
  cite the same facts; threads and audit rows are present.

### P14a — UAT job pull (portal)

- Finish the bridge's H2 work for a pull-based executor (F29):
  - Add the provider value `agent_runner` to the callback enum and
    `UatAgentExecutorProvider`, an additive change to `uat-agent/v2` (F38). The
    runner never reuses `hermes`, so the Hermes-only failover and sweep never touch it.
  - Routing rule: with the new routing flag `UAT_AGENT_RUNNER_ENABLED=1` (off by
    default; the kill switch stays `TRIPLE_T_ENABLED` and `Agent.status`, D20), a run
    whose ticket has `Feedback.agentAuthorizedById` set, meaning an ADMIN pressed
    approve-agent, and that is not marked "runner already tried", gets
    `executorProvider = agent_runner`. Every other run, including every
    `staff_plus_auto` ticket, goes to Cursor Cloud as today. `agent_runner` is refused
    as a value of `UAT_AGENT_EXECUTOR_PROVIDER`, so no global pin can send tickets to
    the runner without an ADMIN. A run already stored as `agent_runner` keeps that
    value, and `agent_runner` is added to the invocation envelope's provider enum
    (`contracts/invocation.ts:16-21`), so the claim's envelope says `agent_runner`.
  - An `agent_runner` run is held for pull. The portal writes the provider and the hold
    in the same step that moves the run to `QUEUED_FOR_AGENT`. The hold check sits
    inside `enqueueAndRelayExecutorDispatch` and `dispatchExecutorOutboxRecord`, which
    return `held`, so every path skips the queue-time mint and writes no dispatch row:
    reconcile's relay, the workflow's prepare step, `resumeAuthorization` (the ADMIN
    authorise flow) and the Start agent route, which answers "held for runner" (F42).
    The relay's query also leaves held runs out
    (`OR: [{ executorProvider: null }, { executorProvider: { not: "agent_runner" } }]`),
    so they never take its five slots. Its envelope is built when it is claimed.
  - Storage needs no migration (SC-7): the hold time, the "runner already tried" mark
    and the mint's origin live in `triageSummary.runnerHold`, as the Hermes failover
    keeps `hermesFailover`.
  - `GET /api/runner/v1/uat-jobs` only lists `QUEUED_FOR_AGENT` runs held for
    `agent_runner`; it writes nothing. The ticket's ADMIN authorisation is the
    `uat-job` loop's approval (D16).
  - `POST /api/runner/v1/uat-jobs/{runId}/claim`, with an idempotency key, claims one.
    Every MC checkout call mints a new `dsp_` (F44), so the claim runs in this order:
    0. Refuse if the agent is not `ENABLED`, its loop is paused, or Triple-T is off
       (SC-4).
    1. If the idempotency key has a stored result, return that binding.
    2. If the run is no longer held for `agent_runner`, or the loop already has
       `maxConcurrent` runs `RUNNING` (P4), refuse without minting. A refused claim
       writes no `AgentRun`.
    3. If the run's `mcCheckoutId` was minted by an earlier claim of this run and has at
       least `maxMinutesPerRun` plus 60 minutes left, reuse it. Otherwise mint one and
       write it with a conditional update (only while the run is still held and has no
       fresher runner mint), so a claim that lost a race never overwrites the checkout
       Cursor's envelope froze.
    4. In one database transaction: move the `UatAgentRun` from `QUEUED_FOR_AGENT` to
       `AGENT_RUNNING` only if its provider is still `agent_runner` (compare-and-set)
       and the loop's count, taken under P4's lock, is still below `maxConcurrent`;
       set `executorAgentId` to the agent's slug, `executorRunId` to the new
       `AgentRun.id` and the "runner already tried" mark; create the `AgentRun` as
       `RUNNING` with `uatRunId`; store the idempotency result; and write the binding's
       audit row with the fail-closed writer (P10).
    Because `executorAgentId` and `executorRunId` are set, a late callback from an
    earlier claim no longer matches (F38). The 8-hour stamp starts at the mint.
  - A run held for the runner and not claimed within 30 minutes of `heldAt` (at once
    when the routing flag is off) stays
    `QUEUED_FOR_AGENT`: the portal compare-and-sets its provider to `cursor_cloud`,
    marks it "runner already tried" and writes an event, as the Hermes failover does
    (F42). Nothing is cancelled, and no UAT attempt is used up. The paced reconcile
    route does this (F39), so it works with the runner down. A late claim fails the
    compare-and-set, so one run never goes to two executors. A later retry of a run
    the runner tried goes to Cursor.
  - The runner reports through the existing `POST /api/internal/uat-agent/callback`
    (F34), with runner auth added and provider `agent_runner`. The runner's token is
    accepted only for a run whose `executorProvider` is `agent_runner`. The runner's
    branch is `fix/agent-runner-<run id>`,
    which the callback and the outbox already accept (F35). No new result route.
  - Idempotency keys, strict binding and uncertainty handling follow the bridge README;
    a timeout is never proof that a job was not accepted.
- The portal keeps the PR outbox (draft PR with the stamp), completion and ticket status.
- Acceptance: a canary job goes authorise → pull (run and checkout created) → callback
  → draft PR by the portal outbox, with one run graph; a repeated claim or callback with
  the same key changes nothing; reconcile never mints or dispatches for a held
  `agent_runner` run, and held runs never delay a Cursor relay; authorise creates no
  mint and no dispatch row until the claim; a claim refused at step 2 mints nothing,
  and a claim that loses the compare-and-set after minting never overwrites another
  checkout; after a runner failure and Start agent, the retry goes to Cursor and a late
  callback from the released run is refused;
  an unclaimed run moves to Cursor after 30 minutes on the same
  attempt and the late claim is refused, also with the runner stopped; a
  `staff_plus_auto` ticket goes to Cursor with the flag on;
  `UAT_AGENT_EXECUTOR_PROVIDER=agent_runner` is refused; portal checks, build and
  hygiene exit 0.
- Rollback: set `UAT_AGENT_RUNNER_ENABLED=0`. Wait until no `agent_runner` run is
  `QUEUED_FOR_AGENT` (the 30-minute reroute moves them to Cursor) or `AGENT_RUNNING`
  (their runs end, or P4's rule releases them). Only then revert, because after the
  revert the callback refuses provider `agent_runner`. The dispatcher then sends every
  job to Cursor Cloud. The Dell bridge
  runs in canary mode only, so it is not the fallback.

### P14 — Pilot 2: Hasitha UAT batch fixes (runner as the Hermes executor)

- Agent `hasitha-fernando`, new version with one `runner` loop, `trigger: uat-job`,
  `autonomy: approve`, a cloud coding alias, `repos: ["petralabx/plx-customer-portal"]`,
  `maxUsdPerRun` set by the operator, and `maxMinutesPerRun` of at most 120, well inside
  the checkout's 8 hours. `maxConcurrent: 1` for the first week, then 2 (D26).
- Each run: an ADMIN authorises the ticket for agent work (F36); the runner claims the
  job and the portal mints the checkout (P14a); the run's user branches from `staging`,
  fixes and runs the portal checks; the parent pushes `fix/agent-runner-<run id>` (D24)
  and calls the callback. The portal opens the
  draft PR with the stamp and completes the task (D18). The runner posts a short
  `agent.report` that links the PR.
- After two clean weeks, under the trading guard, disable only the Dell tasks
  `PLX-Hermes-UAT-Bridge` and `PLX-Hermes-UAT-Bridge-Watchdog` (F7), by exact name, with
  `schtasks /Change /TN <name> /DISABLE` and a timeout. Keep the Hermes install; trading tasks on the
  Dell are not touched (D23).
- Acceptance: one batch gives one draft PR. `compliance`, `lint-typecheck-build`,
  `Validate ledgers` and `workbench-api` are green. After CIP merges it and staging
  deploys, the Persona QA post-deploy run for that SHA has no new verified
  high-severity finding (F47). Spend stays under the cap. The UAT run graph
  shows the runner as executor (SC-2, SC-3, SC-5, SC-11).

### P15a — Agent eval tables (portal, migration, its own PR)

- New models: `AgentEvalCase` (`suite`, `name`, `input` JSON, `checks` JSON: the
  deterministic assertions plus an optional rubric for the judge); `AgentEvalRun`
  (`agentId`, `agentVersionId`, `baselineVersionId`, `suite`, `status`, `passRate`,
  `baselinePassRate`, `usd`, `startedAt`, `endedAt`, `claimedBy`); and
  `AgentEvalResult` (`runId`, `caseId`, `passed`, `score`, `judgeModel`, `notes`,
  `transcriptRef`). Index `AgentEvalRun` on `(agentVersionId, suite, status)`.
- Acceptance and rollback as P4a (its own PR; applied to staging and UAT; keep the
  tables on rollback).

### P15 — Agent eval gate (portal and runner, after P4, P6 and P15a)

- **Enqueue:** an ADMIN button on the agent detail page, and `VERSION_CREATE` for an
  agent whose `evalConfig.required` is true, create an `AgentEvalRun` for the new
  version against the active one on the version's `suite`.
- **Run:** the runner claims eval runs through `POST /api/runner/v1/evals/claim` and
  posts results to `POST /api/runner/v1/evals/{id}/results` (runner token, Zod, standard
  envelope). The claim returns snapshots of both versions (persona, loop, model), so the
  runner never depends on the active-version-only routes. An eval run takes a run slot
  only when one is spare, so it never delays a scheduled or UAT run. It heartbeats and
  polls a status route like any run (SC-4), and P4's stale sweep covers it. It runs each
  case as the candidate version, and reuses a cached result for the active version when
  that version and case are unchanged, in eval mode: the run's user gets the agent's eval
  key (P2), and the parent never claims a UAT job, mints a checkout, pushes or writes to
  MC; its only portal write is the results post. Cases run one after another, each
  capped at `maxMinutesPerRun`. Scoring applies the case's deterministic checks first,
  then the rubric through `judgeModel`, a fleet alias from another provider family
  than the agent's model. A run stops when it passes `maxUsdPerEval`.
- **Gate:** `activate` (`app/api/admin/agents/[agentId]/activate/route.ts`, SUPER_ADMIN
  only) applies the gate when the ACTIVE version's `evalConfig.required` is true, so a
  candidate cannot skip it by setting `required: false`. It refuses unless the
  candidate's latest finished eval has a `passRate` at or above `threshold` and at or
  above its baseline's, and, inside the pointer transaction, that eval's
  `baselineVersionId` is still the active version. A SUPER_ADMIN can override with a
  reason; the override and its audit row are written together by the fail-closed
  writer (P10).
- **UI:** an Eval section on the agent detail page shows each version's runs, pass
  rates against the baseline, per-case results and cost. Persona QA stays as it is
  (F47).
- **Suites for the pilots:** `chief-of-staff` gets 10 cases from the brief inputs P11
  stored, each checking that the brief names every open blocker and invents none (so
  P15's suite waits for 10 P11 runs). `hasitha-fernando` gets 5 closed UAT tickets whose
  fixes are known: each case's `input` carries `baseSha` (the parent of the fix commit)
  and the expected files, the run's clone is seeded at `baseSha`, and the case checks
  that the proposed diff touches those files and that the portal checks pass on it (no
  push). Both set `required: true`.
- Acceptance:
  - An eval of a deliberately worse version (a wrong model alias) scores below the
    active version, and `activate` refuses it; an ADMIN override with a reason
    activates it, with one audit row.
  - An eval run makes no MC write, no portal write and no push (the runner's audit and
    the MC event log show none).
  - A run stops at `maxUsdPerEval`. The acceptance runs on the `chief-of-staff` suite.
    Expected cost: under $2.
  - Portal checks, build and hygiene exit 0; runner unit tests pass.
- Rollback: revert the gate in `activate` first (activation then works as before),
  then the rest.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Hosted models call tools less reliably. | Pilot 1 is read-only. Pilot 2 uses a cloud model. |
| The fleet proxy is a single point of failure. | Opt-in `fallbackModels` per agent. Without one, the run fails visibly and posts an `agent.report`. |
| Uncensored local models on agents with write access (F11). | D9, and no write scope for an agent on those aliases in phase 1. The fleet proxy defines no `local-driver`. |
| COS becomes a bottleneck or single point of failure. | Agents run on their own schedules and triggers. COS supervises; it does not relay every call. |
| COS gains power it should not have, or an outside model acts through it. | D14; D16 (ADMIN-only approvals, in the portal); P12b refuses approve, delegate and pause through the door; each tool is switched on per version. |
| COS's answers leave the portal through Grok Bot to another model vendor. | D21 per-person keys and permissions; the door is off by default; brain reads wait for key scopes (P10); the data boundary is declared in P12b. |
| Retiring MC's agents module removes an approval gate. | Nothing real uses it (four placeholders, no pull loop). `humanOnly` and the TASK-629 gates stay (P9). The registry's `autonomy` (P3) and ADMIN approvals (P10) land first. |
| Local-model calls take capacity from the `dell-vta` trading worker (F27). | No fleet process runs on the Dell (D5). Local aliases are optional (P1b), capped per deployment and per key, and pass the A/B load test first; on a fail they come out and cloud aliases keep working. |
| Agent calls to `local-coder` would run on Spark A, next to the trading worker. | Phase 1 has no `local-coder` alias (D23). Adding one later needs its own spec and a D23 exception. |
| An agent on the runner host reaches something it should not. | D24 per-run users; the token stays in the parent process; P5's root-owned host firewall; no vendor key on the host (SC-6). |
| Fencing the fleet's hosts changes the tailnet policy that trading's paths use. | P1, P1b and P5 each save the policy first, add only their own tag and accept rules, and re-run `tests` and `sshTests` that prove trading's paths still pass. |
| A failing loop takes COS offline. | The run-end rule pauses the loop, never the agent (P4). |
| A seed run silently replaces an admin-made version. | P3 sets `DRAFT_ONLY` on both pilot agents (F30). |
| Hermes CLI changes between versions. | Pin the version in P6. |

## 8. Order

P0, P1, P3, P5, P6a and P8 can start at once. P2 needs P1. P4a needs
P3. P4 needs P4a. P1b needs P1 and P2 and runs whenever the operator chooses. P6 needs P2, P4,
P5, P6a, P8 and P10. P15a needs P4a; P15 needs P4, P6, P15a and 10 stored P11 runs. P7 needs P6 and P15. P9 needs P8 and
P10. P10 needs P3, P4 and P8; its brain read also waits for the retirement spec's R11.
P11 needs P6 and P10. P12a comes before P12b; P12b needs P10. P13 needs P12b. P14a needs
P4, P6, P6a and P10. P14 needs P14a and P11 green for one week. The retirement spec's R8 waits for P1
(the embedding key's organisation), and its R9 for P1 and P2 (the brain's key).

## 9. Open questions

None. The operator confirmed D5 as amended in r13, and D25 and D26, on 28 Sep 2026.

## 10. Later add-ons (not in phase 1)

### Add-on A — Jev for routing agent tasks (consideration only)

- **What Jev is:** TypeSafe's decision model. It answers a typed question with
  calibrated probabilities in about 70–500 ms. It cannot write text or code, so it
  never does an agent's work. It only chooses.
- **Where it would sit:** inside COS's delegation step (P10), for requests nobody has
  labelled. Rules that are fixed (UAT executor choice, Awaiting You rules,
  schedules) stay in code.
- **Decisions it could make:**
  - Which agent owns an unlabelled item.
  - Which fleet alias a run uses: local first, or escalate to cloud.
  - Whether a change needs a human before it acts.
- **Not Jev Router.** Jev Router picks only among OpenRouter models. It cannot send
  work to the fleet's hosted models (D4, D5).
- **Before a trial starts:**
  - Both pilots are live (P11, P14), and unlabelled work arrives for more than one agent.
  - The operator re-reads the rejection in `docs/jev-fleet-implementation-spec.md`
    (Cursor project store) and records a decision. The frontier spec's "Jev products
    stay out" line is broader than its SC-5 list.
  - The external-integration declaration is complete. Jev is hosted only, so every
    routing call sends item text to TypeSafe.
- **Trial shape (shadow mode):** COS asks Jev for each real item and logs Jev's pick
  next to its own, plus the cost. Nothing acts on Jev's pick. After about two weeks,
  the operator decides.

### Add-on B — More COS doors and views

- Teams, and new desktop notification kinds (the desktop contract knows only
  `needs-retest` today). Each is a door onto the same COS (D13), with the same
  limits as P12b.
- The companion's view of the latest brief.

## 11. Out of scope

- Swarm retirement (its own spec).
- Routing of agent tasks by a model (Add-on A).
- Portal chat on hosted models (D7).
- Changes to the COS Companion's own backlog (desktop D2–D5, open gaps).
- Any change to the trading gateway at `:4000`, its env file or its watchdog (D23).
- Changes to the frontier spec. Its fact that Hermes is local-only describes the Dell
  bridge; the runner is a new host and no frontier phase depends on it.
