---
title: Agent fleet — implementation spec
revision: r5 (28 Sep 2026: D23 keeps the trading lab untouched: the runner stays off both Sparks, the gateway's existing aliases and master key do not change, and no agent key may use `local-driver`. r4, 28 Sep 2026: COS becomes the chief of staff for the stack, one agent with many doors; Mission Control's agents module retires; the retirement spec's seven proposals folded in; phases renumbered P0–P14)
status: draft; D1–D22 confirmed; D23 proposed from the operator's trading condition; P5 confirms the runner host; P13 confirms Grok Bot
accountable human: vince@petrasoap.com
repos: petralabx/plx-customer-portal, petralabx/local-inference, petralabx/PLX_MC, new petralabx/agent-runner
---

# Agent fleet — implementation spec

## 1. Goal

Register every agent once, in the portal. Run each agent's loops on an always-on
machine. Let each agent use any model: a cloud provider or a model we host. Keep
the record of all agent work in PLX_MC.

**COS is the chief of staff for the whole stack.** It is one agent,
`chief-of-staff` in the portal registry, reached through several doors: the COS
panel in the portal, the COS Companion window and desktop app, and Grok Bot.
It briefs the operator, answers questions across the stack, hands work to other
agents, asks for approvals, and can pause an agent that misbehaves.

This is not `docs/jev-fleet-implementation-spec.md`. The frontier spec calls that
older draft "the fleet spec". This file is the agent fleet spec.

This spec replaces the swarm's agent roles. It does not retire the swarm; the
swarm retirement spec does that.

## 2. Facts (checked 28 Sep 2026)

| # | Fact | Source |
|---|---|---|
| F1 | The portal already has the registry: `Agent` (slug, status, active version) and `AgentVersion` (persona, responsibilities, modelConfig, mcpAllowList, skills, loops, memory, eval). The admin UI is `/admin/agents`. | `portal/prisma/schema.prisma:7311-7386` |
| F2 | `Agent.status` is `DRAFT`, `ENABLED`, `DISABLED` or `ARCHIVED`. `DISABLED` can act as the kill switch. | `schema.prisma:7311-7316` |
| F3 | `modelConfig` already has per-agent `primaryProvider` and `primaryModel`. Every seeded agent sets `primaryProvider: "anthropic"` and `primaryModel: null`. | `portal/src/lib/agents/capabilities.ts:19-24`; `pilot-agents.ts:97,190`; `sourcing-agent.ts:54`; `persona-qa-agents.ts:518` |
| F4 | Nothing reads those two fields at run time. Portal chat calls `requireAgentLlm()` with no agent argument. `getTripleTLlm()` picks one provider for the whole process from env (`TRIPLE_T_LLM_PROVIDER` = anthropic, openai or auto). Its OpenAI path takes any compatible base URL. | `app/api/agents/[agentId]/chat/route.ts:106`; `app/api/agents/_lib/guard.ts:198`; `lib/triple-t/engine/llm.ts:31-82,271-294` |
| F5 | `loops` holds only `{ id, name, description }`, and the Zod schema drops any other key. It has no schedule, runtime, repo scope or budget. `modelConfig` and `loops` are JSON columns, so new optional fields need a Zod change, not a DB migration. | `capabilities.ts:35-39,65-67,161-169`; `schema.prisma:7362,7370` |
| F6 | `AgentAuditLog.action` is a plain string. New actions (run start, run end, approval) need no migration. | `schema.prisma:7477`; `lib/agents/audit.ts:17-28` |
| F7 | The Hermes bridge runs the Nous Research `hermes` CLI with a named profile. It is built for UAT only: contract `uat-agent/v2`, canary by default, at most two runs at once. Live mode needs a TASK id and an MC checkout id. It branches `fix/hermes-<hash>` from `origin/staging`. It runs on the Dell VTA (Windows, SQLite WAL at `C:\ProgramData\PLX\HermesBridge`) with Windows scheduled tasks. | `scripts/uat-agent/hermes-bridge/job-runner.mjs:171-202,221,383-392`; its `README.md:3-10,57-98,177-178` |
| F8 | Hermes Agent works with any OpenAI-compatible endpoint (`provider: custom`, `base_url`). Its docs name vLLM, llama.cpp, Ollama and LiteLLM Proxy. | hermes-agent `website/docs/integrations/providers.md` (fetched 28 Sep 2026) |
| F9 | The LiteLLM proxy serves only local aliases: `local-primary`, `local-fast`, `local-coder`, `local-driver`. It uses a master key and has no database, so it has no per-agent keys or budgets. It sends traces to self-hosted Langfuse. | `local-inference/litellm/config.yaml` |
| F10 | The proxy runs on the Dell VTA and listens on the tailnet (`100.103.33.54:4000`). Vercel functions are not on the tailnet. So portal chat cannot reach a local model today. | `local-inference/.cursor/rules/dgx-spark-fleet.mdc:24-26` |
| F11 | Two local aliases are marked "uncensored" or "abliterated" in config comments (`local-coder`, `local-driver`). | `litellm/config.yaml` comments |
| F12 | The Triple-T coding router picks Cursor Cloud model slugs. Cursor owns that list, so it cannot use a model we host. | `lib/triple-t/model-router/catalog.ts:47-51` |
| F13 | PLX_MC tracks portal, local-inference and others in its registry. A new runner repo is not tracked yet. | `PLX_MC/config/tracked-repos-registry.json` |
| F14 | Two DGX Sparks are on the tailnet. Spark A `spark-7d3d` serves `local-coder` (`:18082`). Spark B `spark-b4ec` serves `local-driver` (`:18090`) and can also run a vLLM lane on `:18091` that takes 45% of memory. Each has about 128 GB of unified memory, shared by CPU and GPU. Sparks are arm64. A Spark also runs a trading compute worker from the swarm. | `dgx-spark-fleet.mdc:22-26`; `docs/runbooks/spark-b-qwen36-nvfp4-bakeoff.md:19-22,56`; swarm `systemd/vmc-dgx-compute-worker.service` |
| F15 | MC has no write surface for a free-form report. `mc_report_progress` needs a checked-out task. The precedent is `POST /api/cursor/session-telemetry`, which appends one `agent.session_telemetry` event through `appendEvent`, with a dedup key. | `PLX_MC/src/lib/mcp/create-http-server.ts:264-276`; `src/app/api/cursor/session-telemetry/route.ts:1-40` |
| F16 | **MC has its own agents module:** a fixed list of four placeholder agents (Vibes, Atlas, Sentry, Scribe), a per-agent `auto` or `approve` mode, and derived presence and feed. Only a human assigns work; there is no agent pull loop. MC tasks already store an `assignee`, which can be a person or an agent. `mc_create_task` does not accept an assignee. | `PLX_MC/docs/modules/agents/README.md:5-45`; `src/lib/mc-data/types.ts:54-60,190-260`; `src/lib/mcp/create-http-server.ts:231-245` |
| F17 | **COS today** is the portal's front door to every consumer-facing agent. It answers, looks up the user's own tickets, and hands off to Hasitha. Its tools are page navigation (8 paths), ticket lookup, handoff and knowledge reads from its own namespace. Tools are switched on per version through `skills` and `loops` ids. The COS panel's Tasks tab is an empty placeholder: "The Chief of Staff will track work here." | portal `docs/modules/agents/README.md:11-21`; `lib/agents/cos-frontend-tools.ts:84-179`; `capabilities.ts:175-185`; `agent-panel.tsx:1673-1677` |
| F18 | The COS Companion is a window onto the same COS: "not a second COS, not a second auth system". The operator's call (19 Aug 2026) is "1 for now but building towards 2": a fuller agent platform later, behind the same registry and adapter. The companion posts one session record per open, and nothing else outside the portal. | `docs/projects/cos-companion/README.md`; `DESKTOP-SPEC.md:19-21`; `.discovery/cos-companion/DISCOVERY.md:439-460` |
| F19 | The portal's agent routes (`/api/agents/*`) accept only a browser login (`requireAuth()`). The portal has admin-issued, hashed, revocable API keys (`app_api_key`) for `/api/external/*`, but a key has no owner it acts for and no scopes. | `app/api/agents/_lib/guard.ts:24,67`; `lib/auth/api-keys.ts:1-40`; `schema.prisma:964-977` |
| F20 | **Grok Bot** is the Grok coding agent that operators run in Cursor and GitHub. It connects to Mission Control through MCP as principal `sp_mcp_grok`. It sees the repo and Mission Control only. | portal `AGENTS.md:50`; `docs/projects/business-central-erp-modernization/COLLAB-STEWARD-PLAN.md:80-84`; PLX_MC `config/integrations.yaml:172` |
| F21 | **The portal's UAT dispatch chooses an executor:** Cursor Cloud first, with Hermes as the fallback. Since 25–27 Sep, UAT ticket status changes go through "one door", and every run writer, Hermes included, writes a run graph. | `docs/projects/plx-agents-platform/COS-CLOSEOUT-HANDOFF.md:18-26`; `docs/projects/cos-companion/README.md` (R8) |
| F22 | **The portal has one pattern for scheduled jobs:** one core function called by a cron route, a CLI, a GitHub Action and an admin action. Each run writes a row with caller, correlation id, mode and a lock (a second run becomes `SKIPPED_LOCKED`). | `specs/awaiting-you/spec.md:192`; `portal/src/lib/work-routing/runner.ts:1-24,66,157`; `schema.prisma:8285-8304` |
| F23 | **The EventBridge pacer** (Lambda `plx-bc-cron-ping`) is the portal's staging clock. Business Central outbound runs every 5 minutes, and inbound at minutes 6, 21, 36 and 51. Those minutes are reserved because of database load. | `scripts/aws/deploy-bc-cron-ping.ps1:110-159`; `docs/runbooks/BC-CRON-HTTP-PACER.md:25-42` |
| F24 | **Digests already exist or are planned:** `/api/admin/digest` (production, weekdays, all STAFF+); the UAT stall and ops digests; Awaiting You T904, a planned department daily brief; and the swarm's Lobster `daily-brief`, which retires with the swarm. | `app/api/admin/digest/route.ts:8-16`; `specs/awaiting-you/tasks.md:164`; swarm `config/pipelines.yaml:78-99` |
| F25 | A second agent worker already exists: `services/persona-qa-worker` runs the persona-QA agents after each deploy. Their cadence sits in `evalConfig.notes`. | `portal/src/lib/agents/persona-qa-agents.ts:1-8,441-448` |
| F26 | The agent kill switch today is `Agent.status` plus `TRIPLE_T_ENABLED`. The companion docs rule out a second kill switch. | `docs/projects/cos-companion/OS-GAP-VALIDATION.md:21-22,42-44` |
| F27 | **The trading lab uses the gateway and both Sparks.** Its Dawn harvest calls the gateway at `100.103.33.54:4000` with the master key and the `local-driver` alias, which Spark B serves on `:18090`. Spark A runs the trading compute worker (`vmc-dgx-compute-worker`: model training, inference, feature engineering). | swarm `scripts/trading-research/dawn_harvest_scheduler.ps1:97,127,132`; `scripts/trading-research/run_dawn_with_xai.py:82-85`; `config/trading-workers.yaml:108-146,148-167`; `config/execution-primitives.yaml:167-172` |

## 3. Decisions

| # | Decision | State |
|---|---|---|
| D1 | The portal registry (`Agent`/`AgentVersion`) is the only agent registry. No second registry. | Confirmed 28 Sep 2026 |
| D2 | The runner lives in its own small repo. It grows from the Hermes bridge. | Confirmed 28 Sep 2026 |
| D3 | First two loops: the CoS daily brief and Hasitha UAT batch fixes. | Confirmed 28 Sep 2026 |
| D4 | Each agent can use any model provider or a model we host. No lock-in to one vendor. | Confirmed 28 Sep 2026 |
| D5 | **One model gateway: the local-inference LiteLLM proxy on the Dell VTA.** An agent names a gateway alias (for example `cloud-claude-sonnet`, `cloud-gpt`, `local-primary`). An agent never names a vendor SDK. Vendor API keys live only on the gateway host. | Confirmed 28 Sep 2026 |
| D6 | **Runner harness: Hermes Agent.** It talks to any OpenAI-compatible endpoint (F8). Each agent gets one Hermes profile that points at the gateway with that agent's alias and key. | Confirmed 28 Sep 2026 |
| D7 | **Models we host run from the runner only, in phase 1.** Portal chat keeps its current cloud path (F4, F10). | Confirmed 28 Sep 2026 |
| D8 | **A model change is a new `AgentVersion`, then activate.** The audit log records it. | Confirmed 28 Sep 2026 |
| D9 | **Guardrails come from permissions, not from the model.** Repo scope, MC checkout, draft PRs only, and no merge rights apply to every agent. | Confirmed 28 Sep 2026 |
| D10 | **Runner host: not the Dell VTA.** A DGX Spark if it runs no trading work (D23) and passes the P5 check; otherwise a new EC2 instance on the tailnet. | Confirmed 28 Sep 2026; D23 narrows it |
| D11 | **All cloud providers on the gateway,** with per-agent limits on which providers each agent may use. | Confirmed 28 Sep 2026 |
| D12 | **Agent reports are recorded in MC** as `agent.report` events (P8). | Confirmed 28 Sep 2026 |
| D13 | **COS is the chief of staff for the stack: one agent, many doors.** The portal panel, the companion window, the desktop app and Grok Bot all reach the same `chief-of-staff` registry entry, with one persona, one set of threads, one audit log and one kill switch. No door copies COS's persona into another model's prompt. | Confirmed 28 Sep 2026 |
| D14 | **COS knows, delegates, asks and stops.** It reads MC, the fleet and the brain. It hands work to an agent by creating an MC task with that agent as assignee. It asks the operator to approve runs that need approval. It may pause an agent (`Agent.status` to `DISABLED`); only a human may turn one back on. It never holds another agent's repo access or keys. | Confirmed 28 Sep 2026 |
| D15 | **MC's agents module retires** (F16): the four placeholder agents, the per-agent mode and the derived presence. MC keeps tasks, checkouts, the compliance gate and agent reports. A task's assignee may name an agent slug. | Confirmed 28 Sep 2026 |
| D16 | **Approval lives in the registry and flows through COS.** Each runner loop has `autonomy`: `approve` (the default) or `auto`. An `approve` run waits until the operator approves it in a COS door. The approval is an `AgentAuditLog` row. | Confirmed 28 Sep 2026 |
| D17 | **COS's brief replaces the swarm's Lobster `daily-brief`.** It reads what exists (open MC tasks, agent reports, UAT ops digest, Awaiting You items) instead of recomputing. It does not duplicate `/api/admin/digest` or Awaiting You T904 (F24). | Confirmed 28 Sep 2026 |
| D18 | **The runner takes over the Hermes executor role in UAT dispatch.** Cursor Cloud stays first. The runner speaks `uat-agent/v2` and changes ticket status only through the one door and the run graph (F21). The Dell VTA bridge keeps running until the runner has taken over; then its Windows tasks retire. | Confirmed 28 Sep 2026 |
| D19 | **Runner runs use the portal's job pattern** (F22): run rows with caller `runner`, correlation id, mode and lock. | Confirmed 28 Sep 2026 |
| D20 | **No new kill switch.** The runner and every COS door obey `Agent.status` and `TRIPLE_T_ENABLED` (F26). A door has an on/off flag as an integration, not as a way to stop COS. | Confirmed 28 Sep 2026 |
| D21 | **COS's outside doors use per-person keys.** A key acts for the person who created it, carries scopes, expires within 90 days and can be revoked. COS answers through a door with that person's permissions. | Confirmed 28 Sep 2026 |
| D22 | **One agent worker.** `persona-qa-worker` stays per-deploy for now and folds into the runner later. No third worker. | Confirmed 28 Sep 2026 |
| D23 | **The trading lab is not affected** (F27). The runner never runs on a host that runs trading work, so today it runs on EC2, not a Spark. The gateway only gains aliases and keys: no phase renames, removes or changes an existing alias, the master key or its env name. No agent key lists `local-driver`; that lane stays the trading lab's. Every gateway restart is checked with a `local-driver` call on the master key. | Proposed 28 Sep 2026 from the operator's condition "I don't want the trading repo to be at all negatively impacted by this build". Confirm or override. |

### Model choice for the pilots

| Agent | Loop | Model alias | Why |
|---|---|---|---|
| `chief-of-staff` | Daily brief | `local-primary` | Read-only, daily, low risk. It proves the self-hosted path at zero cloud cost. |
| `hasitha-fernando` | UAT batch fixes | a strong cloud coding alias (for example `cloud-claude-sonnet` or `cloud-gpt`) | It writes code and opens PRs. Tool-calling quality matters more than cost. |

COS chat in the portal and through its doors keeps the portal's current cloud path (D7).

## 4. Success criteria

| # | Criterion | Check |
|---|---|---|
| SC-1 | Changing an agent's model takes one new `AgentVersion` and an activate. No code deploy and no env change. | P7 |
| SC-2 | One agent runs on a hosted model and one on a cloud model, both through the gateway. | P11, P14 |
| SC-3 | Every runner action that touches a repo carries a live MC stamp whose `actor.repo` matches that repo. | P14; the `compliance` check |
| SC-4 | Setting an agent to `DISABLED` stops its next run within one scheduler tick. | P6 |
| SC-5 | Spend is visible and capped per agent. | P2; P6 telemetry |
| SC-6 | Vendor keys exist only on the gateway host. | P2, P6 |
| SC-7 | One DB migration in this spec: P12's two key columns, shipped alone. No other `prisma/migrations/` change. | `git diff --stat` per PR |
| SC-8 | The runner does not run on the Dell VTA, and it does not slow the local models past the P5 threshold. | P5 |
| SC-9 | **COS is one agent.** A question asked through Grok Bot shows up in the asker's COS threads in the portal, and the audit log records the door. | P13 |
| SC-10 | **MC has no agent list of its own.** No placeholder agents remain, and a task can name an agent as assignee. | P9 |
| SC-11 | **An `approve` loop does nothing until the operator approves it** in a COS door, and the approval is in the audit log. | P10, P14 |
| SC-12 | COS can pause an agent and cannot turn one on. | P10 tests |
| SC-13 | **The trading lab sees no change** (D23). After every gateway restart, `local-driver` answers on the master key. No agent key lists `local-driver`. The runner shares no host with trading work. | P1, P2, P5 |

## 5. Execution contract

- Every phase that edits a repo needs its own MC TASK and checkout: search, create
  only on a real miss, `mc_checkout_task` with `repo`, `prBodyLine` in the PR body
  at open, last commit, then `mc_complete_task`, then freeze.
- One phase per PR. Draft PRs only. Agents never merge.
- Portal phases run `cd portal && npm run typecheck && npm run lint && npm run test`.
  A phase that adds a route also runs `npm run build && npm run audit:hygiene`.
- PLX_MC phases run `./scripts/preflight.sh --mode pre-push`.
- A portal DB migration ships in its own PR and is applied to every database in
  `scripts/db-targets.json`.
- Any live model call in an acceptance step names its expected cost.
- Dates and times shown to the operator are ET.

## 6. Phases

### P0 — Record the lesson (portal, docs)

- Add to `tasks/lessons.md`: "Before proposing new agent infrastructure, check the
  portal `/admin/agents` registry and `docs/modules/agents/README.md`."
- Acceptance: `grep -n "admin/agents" tasks/lessons.md` prints the line.
- Rollback: revert the commit.

### P1 — Cloud aliases on the gateway (local-inference)

- Add cloud aliases to `litellm/config.yaml` next to the `local-*` aliases, for
  every D11 provider: `anthropic/…`, `openai/…`, `gemini/…`, `xai/…`, `mistral/…`,
  `deepseek/…`, `openrouter/…`. Each alias reads its key from env
  (`os.environ/<PROVIDER>_API_KEY`). Keys go in the gitignored `.env.local`.
- Give each provider at least a strong alias and a fast alias. Pick exact model ids
  at execution time from each provider's model list.
- Before a key goes in, the operator sets that provider's data-use options (for
  example, opt out of training where the provider offers it).
- Acceptance:
  - `curl -sS -H "Authorization: Bearer $LITELLM_MASTER_KEY" http://100.103.33.54:4000/v1/models`
    lists every new alias.
  - One short chat completion per alias returns HTTP 200. Expected cost: under $0.25 total.
  - `git grep -nE "sk-|api_key: [^o]" litellm/` prints nothing.
  - `git diff origin/main...HEAD -- litellm/config.yaml` adds lines only: no existing
    alias, backend or key setting changes (D23).
- Restart guard (D23), for this phase and its rollback: restart the proxy only when
  no Dawn run is in progress (the operator checks the Dawn scheduler log). Within
  2 minutes of the restart, one `local-driver` chat completion with the master key
  returns HTTP 200. If it does not, roll back at once.
- Rollback: revert the config and restart the proxy.

### P2 — Per-agent keys and budgets (local-inference)

- Give the proxy a Postgres database (`DATABASE_URL`) so virtual keys work (F9).
  Check first whether the Langfuse Postgres on the Dell can host a separate database.
- Prove it on a scratch proxy first (D23): the same image and config plus
  `DATABASE_URL`, on a second port, with the live proxy untouched. Run the
  acceptance below there. Then stop the scratch database and confirm the master
  key still gets HTTP 200 on `local-driver`. Only then restart the live proxy,
  under P1's restart guard.
- Mint one virtual key per agent with `POST /key/generate`: allowed `models`
  (never `local-driver`, D23),
  `max_budget`, `budget_duration`, and `metadata.agent_slug`.
- Keep `allow_requests_on_db_unavailable` only if the operator accepts that keys
  go unchecked while the database is down. Otherwise remove it (fail closed),
  but only if the scratch test showed that the master key still works with the
  database down. If it did not, keep the flag: the trading lab must not lose the
  gateway when the key database is down.
- Acceptance:
  - A key scoped to alias A gets a 401 or 403 on alias B.
  - A key with `max_budget: 0.01` is refused after it passes the budget.
  - `GET /key/info` shows spend for each agent key.
  - No agent key's `models` includes `local-driver`.
  - After the live restart, `local-driver` answers on the master key (P1's restart guard).
- Rollback: unset `DATABASE_URL`, go back to the master key only, under P1's restart guard.

### P3 — Registry contract (portal, code only)

- `modelConfigSchema`: allow `primaryProvider: "gateway"`. Then `primaryModel` is a
  gateway alias. Add optional `fallbackModels: string[]`.
- New `loopSchema` (extends `namedCapabilitySchema`, all new fields optional):
  - `runtime`: `"runner"`
  - `trigger`: `"schedule"`, `"manual"` or `"task-assigned"`
  - `schedule`: 5-field cron, read in America/New_York
  - `autonomy`: `"approve"` (default) or `"auto"` (D16)
  - `repos`: list of `owner/name`; empty means read-only
  - `maxUsdPerRun`: positive number
  - `mcBucket`: bucket id for the loop's TASKs
- A loop without `runtime` stays an allow-list token, as COS's loops are today (F17).
- Admin UI shows the new fields.
- Acceptance:
  - Unit tests: old seeds parse; a bad cron fails; a `repos` entry that is not
    `owner/name` fails; a loop without `autonomy` reads as `approve`.
  - Portal checks exit 0. `git diff --stat origin/staging...HEAD -- portal/prisma`
    prints nothing.
- Rollback: revert the commit.

### P4 — Runner API (portal, new route)

- `GET /api/runner/v1/agents`: each `ENABLED` agent's active version with its
  `runner` loops, model alias, repo scope and autonomy.
- `POST /api/runner/v1/runs`: start and finish a run. It writes a run row in the
  job-pattern shape (D19: caller `runner`, correlation id, mode, lock) and the
  `RUN_START` / `RUN_END` audit pair.
- `GET /api/runner/v1/approvals?runId=`: whether an `approve` run has been approved.
- Auth: one runner service token through the shared route wrapper. Zod on every
  body. Standard `{ data }` / `{ error }` envelope.
- Acceptance:
  - No token gives 401. A `DISABLED` agent is absent from the list.
  - A second `POST` for a running correlation id returns `SKIPPED_LOCKED`.
  - `npm run test && npm run build && npm run audit:hygiene` exit 0.
- Rollback: revert the commit. Remove the token secret.

### P5 — Runner host check (operator, read-only)

- **Repo edit:** none. **Cost:** $0 (local models only).
- First, for each Spark, record whether it runs trading work: `systemctl --user
  is-active vmc-dgx-compute-worker`, and whether the gateway's `local-driver` alias
  points at it (F27). A Spark that does either is out (D23): run nothing else on it,
  and do not load-test it. On 28 Sep 2026 both Sparks are out, so the expected
  result is EC2.
- On each Spark that is still in, with its model server in its normal state:
  1. Record `uname -m`, `free -g` and `df -h ~`.
  2. Baseline model speed: the same prompt five times through the alias that Spark
     serves, `max_tokens: 256`. Record the median completion tokens per second.
  3. In a scratch folder, clone portal `staging` and run
     `cd portal && npm ci && npm run typecheck && npm run lint && npm run test && npm run build`.
     Sample `free -g` every 5 seconds.
  4. Repeat step 2 while step 3's build runs.
  5. Delete the scratch folder.
- **Pass (per Spark):** every portal check exits 0 on arm64; available memory stays
  at 24 GB or more; model speed during the build is at least 90% of baseline; free
  disk is 150 GB or more.
- **Pick:** the passing Spark with more memory left. If none is in or none passes, a new EC2
  instance (Ubuntu LTS, 4 vCPU, 16 GB RAM, 150 GB disk) on the tailnet. Creating it
  is an infra change: high-risk bundle, bucket PRD, operator creates it.
- **Evidence:** one report with each Spark's trading role, the numbers for any Spark
  tested, and the chosen host (SC-8, SC-13).

### P6 — Runner repo (new `petralabx/agent-runner`)

- Register the repo in PLX_MC's tracked repos first, so its PRs fall under the
  compliance gate.
- Start it lean: one short root guide that carries the locked sentence ("Last
  commit, then mc_complete_task, then freeze.") and the seven handshake needles.
- Copy the bridge's hardened parts (job store, bounded commands, worktrees, leases,
  profile checks) with a provenance note. Make its Windows paths configurable.
  Leave the Dell VTA bridge as it is (D18).
- Add:
  - A scheduler tick (every minute). It reads P4, runs due loops, and re-reads
    `Agent.status` and `TRIPLE_T_ENABLED` before each run (D20, SC-4). One run at a
    time in phase 1.
  - `task-assigned` loops: pick up open MC tasks whose assignee is this agent (P8).
  - `approve` loops: ask for approval through P4 and wait (D16).
  - Per-agent Hermes profile generated from the registry: gateway `base_url`, alias,
    and the agent's P2 key from the host secret store. Pin the Hermes version.
  - The MC handshake per run that touches a repo, as principal `sp_mcp_hermes`.
  - One `POST /api/cursor/session-telemetry` per run, so MC counts runner spend.
  - A stop when `maxUsdPerRun` is reached.
  - Skip the pacer's Business Central minutes (F23) for loops that touch the UAT database.
- Acceptance:
  - Unit tests pass (`node --test`).
  - The frontier meter shows `needles_missing: []` for the runner repo.
  - Canary with a test agent on `local-fast`: one run, one run row, one audit pair,
    one telemetry event.
  - Set the agent `DISABLED`: no run on the next tick.
  - An `approve` loop waits until it is approved.
  - `git grep -nE "sk-|_API_KEY="` prints nothing.
- Rollback: stop the service on the P5 host.

### P7 — Model swap test (no code)

- On a test agent, create a new version that changes only `primaryModel`. Activate it.
- Acceptance: the next run's Langfuse trace shows the new model. No deploy, no env
  change (SC-1).

### P8 — MC: agent reports and agent assignees (PLX_MC)

- `POST /api/cursor/agent-report`, built like `session-telemetry` (F15): one
  `agent.report` event with `agentSlug`, `loopId`, `runId`, `title`, `markdown`
  (at most 32 KB). Dedup key `report:<agentSlug>:<runId>`.
- `mc_create_task` accepts an optional `assignee`. `mc_search_tasks` can filter by
  assignee, so a runner can find the tasks assigned to its agents.
- Acceptance:
  - A report appears in `GET /api/events?kind=agent.report`; a repeat `runId` adds
    nothing; no auth gives 401; over 32 KB gives 400.
  - A task created with `assignee: "agent:hasitha-fernando"` is found by an
    assignee search.
  - `./scripts/preflight.sh --mode pre-push` exits 0.
- Rollback: revert the commit.

### P9 — Retire MC's agents module (PLX_MC)

- Remove the four placeholder agents, the per-agent mode and its approval gate,
  the derived presence and feed, and the "Assign open task to {agent}" command
  (F16, D15).
- A task's assignee is plain text. An `agent:<slug>` assignee shows as the agent's
  name, linked to `/admin/agents`.
- Update `docs/modules/agents/README.md` in PLX_MC to say the portal registry owns
  agents.
- Acceptance: no reference to the four placeholder agents in `src/`; the task board
  still shows and edits assignees; preflight exits 0 (SC-10).
- Rollback: revert the commit.

### P10 — COS tools for the stack (portal)

- New COS tools, each switched on by a `skills` id on the COS version (F17):
  - **Read MC:** open tasks, PR compliance status, recent `agent.report` events.
  - **Read the fleet:** agents, recent runs, failures and spend.
  - **Read the brain:** switch COS's knowledge policy to `global` after the portal
    Knowledge Hub fix lands (retirement spec R2).
  - **Delegate:** search MC first, then create a task with an agent assignee (P8).
  - **Ask for approval:** show pending `approve` runs; the operator approves or
    declines in the COS panel or companion, with the same confirm pattern COS
    already uses for navigation. The decision is an audit row (D16).
  - **Pause:** set an agent to `DISABLED` with an audit row. COS's brief loop may
    pause an agent that has passed its budget or failed three runs in a row. A
    pause from chat needs a user who may change agent status. No COS tool can set
    `ENABLED` (D14).
- Acceptance:
  - A COS version without a tool's skill id cannot call that tool.
  - Delegation creates exactly one MC task, and none when a matching open task exists.
  - An approval unblocks the run; a decline cancels it; both are audited (SC-11).
  - A test proves no COS tool can enable an agent (SC-12).
  - Portal checks, build and hygiene exit 0.
- Rollback: remove the skill ids from COS's active version, then revert.

### P11 — Pilot 1: COS daily brief

- Agent `chief-of-staff`, new version with one `runner` loop, `autonomy: auto`
  (it only reads and reports).
- Schedule: weekdays, 07:47 ET. Model: `local-primary`. `repos: []`.
- Inputs: open MC tasks, agent reports and failures, UAT ops digest, Awaiting You
  items (D17).
- Output: one `agent.report` in MC (P8). The COS panel's Tasks tab and the
  companion show the latest brief.
- Acceptance: five weekday runs in a row, each with a run row and a report in MC.
  Cloud spend for this loop is $0 (SC-2).

### P12 — COS door for other tools (portal)

- **P12a — key columns (migration, its own PR).** `app_api_key` gains `ownerUserId`
  (the person the key acts for) and `scopes` (text array). Applied to every
  database in `scripts/db-targets.json` (SC-7).
- **P12b — the door.**
  - A person creates their own key in the portal, with scope
    `agents:chat:chief-of-staff`, an expiry of at most 90 days, shown once,
    revocable (D21).
  - `POST /api/agents/mcp`: a Streamable HTTP MCP endpoint with two tools:
    `cos_chat { message, threadId? }` and `cos_brief`. `cos_chat` runs the same
    pipeline as `/api/agents/chief-of-staff/chat`, as the key's owner, with their
    permissions and threads.
  - Every call writes the door (`mcp`) and the client name (for example `grok`) to
    the audit log.
  - Flag `COS_MCP_DOOR_ENABLED`, default off. The external-integration declaration
    (owner, scope, auth source, default state, flag, health check, fallback, data
    boundary) goes in the PR body.
- Acceptance:
  - No key gives 401; a key without the scope gives 403; a revoked or expired key
    gives 401.
  - A `cos_chat` call continues a thread that the owner then sees in the portal.
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
- Acceptance: the three answers match what COS gives in the portal for the same
  questions; threads and audit rows are present.

### P14 — Pilot 2: Hasitha UAT batch fixes (runner as the Hermes executor)

- Agent `hasitha-fernando`, new version with one `runner` loop, `autonomy: approve`.
- The runner takes the Hermes executor role in UAT dispatch (D18). It speaks
  `uat-agent/v2` and writes status only through the one door and the run graph.
- Model: the cloud coding alias. `repos: ["petralabx/plx-customer-portal"]`.
  `maxUsdPerRun` set by the operator.
- Each run: approval through COS, MC handshake, branch from `staging`, fix, portal
  checks, draft PR with the `prBodyLine`, `mc_complete_task`, freeze, and a short
  `agent.report` that links the PR.
- After two clean weeks, retire the Dell VTA bridge's Windows tasks.
- Acceptance: one batch gives one draft PR. `compliance`, `lint-typecheck-build`
  and `Validate ledgers` are green. Spend stays under the cap. The UAT run graph
  shows the runner as executor (SC-2, SC-3, SC-5, SC-11).

## 7. Risks

| Risk | Mitigation |
|---|---|
| Hosted models call tools less reliably. | Pilot 1 is read-only. Pilot 2 uses a cloud model. |
| The gateway is a single point of failure. | Opt-in `fallbackModels` per agent. Without one, the run fails visibly and posts an `agent.report`. |
| Uncensored local models on agents with write access (F11). | D9, and no write scope for an agent on those aliases in phase 1. |
| COS becomes a bottleneck or single point of failure. | Agents run on their own schedules and triggers. COS supervises; it does not relay every call. |
| COS gains power it should not have. | D14: COS never holds another agent's repo access or keys; it cannot enable an agent; each tool is switched on per version. |
| COS's answers leave the portal through Grok Bot to another model vendor. | D21 per-person keys and permissions; the door is off by default; the data boundary is declared in P12b. |
| Retiring MC's agents module removes an approval gate. | Nothing real uses it (four placeholders, no pull loop). The registry's `autonomy` (P3) and COS approvals (P10) land first. |
| LiteLLM virtual keys need a database (F9). | P6 does not start before P2. |
| A runner on a Spark competes with the local model for memory (F14). | P5 thresholds, one run at a time, move to EC2 if model speed drops. |
| Fleet work slows or breaks the trading lab (F27). | D23: the runner stays off trading hosts; the gateway only gains lines; every restart is checked on `local-driver`; no agent key lists `local-driver`. |
| Agent calls to `local-coder` run on Spark A, next to the trading worker. | Pilot agents use `local-primary` or a cloud alias (Model choice). If an agent later needs `local-coder`, record the trading worker's job times for a week before and after; if they grow, move that agent to a cloud alias (one `AgentVersion`, SC-1). |
| Hermes CLI changes between versions. | Pin the version in P6. |

## 8. Order

P0, P1, P3, P5 and P8 can start at once. P2 needs P1. P4 needs P3. P6 needs P2, P4
and P5. P7 needs P6. P9 needs P8. P10 needs P3, P4 and P8. P11 needs P6 and P10.
P12a comes before P12b; P12b needs P10. P13 needs P12b. P14 needs P11 green for one
week.

## 9. Open questions

D23 is proposed and waits for the operator's yes. P5 confirms the runner host (EC2 on 28 Sep 2026). P13 confirms how Grok Bot connects.

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
  - Which gateway alias a run uses: local first, or escalate to cloud.
  - Whether a change needs a human before it acts.
- **Not Jev Router.** Jev Router picks only among OpenRouter models. It cannot send
  work to the gateway's hosted models (D4, D5).
- **Before a trial starts:**
  - Both pilots are live (P11, P14), and unlabelled work arrives for more than one agent.
  - The operator re-reads the rejection in `docs/jev-fleet-implementation-spec.md`
    and records a decision. The frontier spec's "Jev products stay out" line is broader
    than its SC-5 list.
  - The external-integration declaration is complete. Jev is hosted only, so every
    routing call sends item text to TypeSafe.
- **Trial shape (shadow mode):** COS asks Jev for each real item and logs Jev's pick
  next to its own, plus the cost. Nothing acts on Jev's pick. After about two weeks,
  the operator decides.

### Add-on B — More COS doors

- Teams, and new desktop notification kinds (the desktop contract knows only
  `needs-retest` today). Each is a door onto the same COS (D13).

## 11. Out of scope

- Swarm retirement (its own spec).
- Routing of agent tasks by a model (Add-on A).
- Portal chat on hosted models (D7).
- Changes to the COS Companion's own backlog (desktop D2–D5, open gaps).
- Changes to the frontier spec (the retirement spec lists them).
