# Agent fleet spec — adversarial review log

Target: `agent-fleet-spec.md`, r5 (28 Sep 2026) → r6.
Method: the same as the frontier review. Each spec is checked by a fact-checker, who
tests every fact and cited line against the repos. A critic then reviews it blind,
with no access to the author's reasoning. Repo heads: portal `staging` at `d164a52`, PLX_MC `main` at
`daf3e82`, agentic-swarm `main` at `60e7e17`, plx_secondbrain `af0b3ea`,
local-inference `3ee33e9`, skills `9d5483d`. The author re-checked every blocker
against the code before editing.

## Round 1 — fact-check (FC) and blind critic (CR) on r5

Fact-check: 151 claims checked, 27 wrong or stale. Critic: 6 blockers, 12 majors,
6 minors. Overlapping findings are merged below; each row names every ID it covers.

### Blockers

| IDs | Finding | r6 fix |
|---|---|---|
| CR-F1, FC-F3, FC-F4 | The secret greps in P1 and P6 match text that must stay (`api_key: sk-local`, "task-assigned"). | P1 greps only added lines of the diff; P6 uses a key-shaped pattern. |
| CR-F2, FC-F1 | No run table fits: `WorkRoutingRun.runType` is a fixed enum, `correlationId` is unique, the lock is per run type. | New P4a: `AgentRun` table in its own migration PR; SC-7 now counts two migrations. |
| CR-F3, FC-F2 | Portal middleware returns 401 before `/api/runner/v1` and `/api/agents/mcp` run. | P4 and P12b add the paths to `PUBLIC_ROUTES`; acceptance proves a valid token gets 200 on the preview. F28 added. |
| CR-F4 | UAT dispatch to Hermes is push-based, and the portal owns the checkout and the PR. A runner on EC2 cannot be reached from Vercel. | D18 states the pull model. New P14a: portal UAT job pull. P14: the runner pushes its branch only. F29 added. |
| CR-F5 | Approval "in a COS door" would let Grok Bot, or any STAFF user, approve, delegate or pause. | D16 amended: ADMIN-only, portal panel or companion, session route, bound to run and version. P12b refuses those tools. |
| CR-F6 | The brief's inputs live in the portal, and P4 exposed none. The brief loop's "pause" was a write with no endpoint. | P4 adds `brief-inputs` and a fixed run-end pause rule; the brief only reports. |
| FC-F5 | A `DATABASE_URL` put in the shared `.env.local` would reach the live trading gateway at the watchdog's next restart. | D5 amended: a separate fleet proxy at `:4001` with its own env file, venv, database and watchdog. `:4000` is never edited or restarted. |

### Majors

| IDs | Finding | r6 fix |
|---|---|---|
| CR-F7 | The runner host could reach Spark B's `:18090` backend and TRADINGBOX over the tailnet. | P5: `tag:agent-runner` reaches only `:4001`; a security group with no inbound traffic; probes prove `:4000`, `:18090`, TRADINGBOX and the VMC host are unreachable. |
| CR-F8, FC-F7, FC-F11 | `local-driver` has more trading callers than Dawn; restarts and the DB-unavailable flag on `:4000` put them at risk. | The fleet proxy design removes every fleet touch of `:4000` (D5, D23). The execution contract checks `:4000`'s start time and config hash. |
| CR-F9, FC-F8 | An empty `models` list allows every model. | P2: every key has a non-empty list; `/v1/models` per key never shows `local-driver`; `fleet.yaml` has no `local-driver` alias. |
| CR-F10, FC-F14 | Trading holds xAI and OpenAI keys; SC-6 was false (portal chat holds vendor keys). | D11: fleet-only provider accounts. SC-6 rewritten for runner hosts and agent profiles. |
| CR-F11 | Seed runs would overwrite admin-made versions of COS and Hasitha. | P3 sets `DRAFT_ONLY` on both, with a seed-policy test. F30 added. |
| CR-F12 | `isAgentId` reads the placeholder list; removing it breaks `humanOnly`. The order missed P10 before P9. | P9 keeps `humanOnly`, the owner rule and TASK-629 gates with `startsWith("agent:")`. P9 now needs P8 and P10. |
| CR-F13, FC-F15, FC-F16, FC-F20 | P6 needed onboarding, P8, an approval path and the frontier meter. | New P6a (onboarding per REPO-ONBOARDING). P6 needs P2, P4, P5, P6a, P8, P10. The meter check is replaced by one grep per needle. |
| CR-F14, FC-F23 | The runner cannot read `TRIPLE_T_ENABLED`; a disabled agent's running job kept going; approvals held the only slot. | P4 returns 503 when Triple-T is off; runs poll status every 60 s and are killed; approvals expire after 24 h and do not hold the lock. SC-4 widened. |
| CR-F15 | The lock keyed on correlation id; `maxUsdPerRun` had no mechanism; failures retried every tick. | Lock per agent and loop; per-run spend check via `/key/info`, turn and time caps; one attempt per MC task. |
| CR-F16 | Agent shell ran with every key, token and principal on the host. | New D24: per-run OS user and worktree, a GitHub App token for the loop's repos only, and the runner's own MC principal. Waits for the operator's yes. |
| CR-F17 | `local-fast` and `local-primary` share a backend, so a swap looks the same. | P7 swaps between a local and a cloud alias and checks `model_group`. |
| CR-F18 | A `global` brain read would expose all non-personal brain content to every STAFF user and to xAI through the door. | P10's brain read waits for retirement R11 and passes the caller's scope. |
| FC-F6 | The Dell also runs the `dell-vta` trading worker; TRADINGBOX and stage-rail also call `local-driver`. | F27 extended. P1 compares `dell-vta` lease throughput before and after. New risk row. |
| FC-F9 | `systemctl --user` as the wrong user gives a false "inactive". | P5 runs it as the host's `ssh_user`, and also checks `trading-workers.yaml`. |
| FC-F10 | "Retire the bridge's Windows tasks" could hit trading tasks on the Dell. | P14 names the two bridge tasks only. |
| FC-F12 | `AgentAuditLog.actorUserId` is a required user. | P4a seeds a service user (`AGENT_RUNNER_SYSTEM_USER_ID`). F6 updated. |
| FC-F13, CR-F20 | "Every database in `db-targets.json`" includes production. | Migrations go to `_apply_migrations_to` (staging, UAT). |

### Minors

| IDs | Finding | r6 fix |
|---|---|---|
| FC-F17, FC-F18 | Shifted schema lines and wrong cites for the proxy and aliases. | Updated in F1, F2, F5, F6, F10, F14, F19, F22. |
| FC-F19 | `$LITELLM_MASTER_KEY` exists only inside the proxy process. | The fleet uses `FLEET_LITELLM_MASTER_KEY`; F27 names trading's `LOCAL_LITELLM_MASTER_KEY`. |
| FC-F21 | `gateway` is already a valid `primaryProvider`. | P3 treats it as a known value; F3 updated. |
| FC-F22 | `ApiKey.createdById` already records the creator. | P12a adds `scopes` only; D21 names `createdById`. |
| FC-F24 | BC outbound has no fixed minute. | F23 and P6 name the inbound minutes only. |
| FC-F25 | The Jev spec is not in any repo. | Named as living in the Cursor project store. |
| FC-F26, CR-F24 | Local aliases have no price, so the budget test and other live steps named no cost. | Budget test on a cloud alias; costs named in P2 and P7. |
| FC-F27 | "EC2" could mean an existing host. | "A new, dedicated EC2 instance." |
| CR-F19 | COS needs different models for the brief and chat. | Optional per-loop `model`. |
| CR-F21 | Frontier and retirement text on Hermes disagreed with D18. | Section 11 records the frontier note; retirement r5 section 9 aligned. |
| CR-F22 | Brain jobs use `local-driver`. | Retirement r5 D6 and R9: brain jobs use a fleet key without `local-driver`. |
| CR-F23 | The bridge tasks were not named, and P11 changed the companion. | Tasks named (F7, P14); the companion view moved to Add-on B. |
| CR-F24 | P10's rollback edited an append-only version; "answers match" was not checkable; D23 still said proposed. | Rollback creates a new version; P13 compares tool calls and facts; D23 confirmed. |

## Round 2 — blind critic on r6

A new critic diffed r6 against r5 and judged the whole of r6: 6 blockers, 13 majors,
6 minors. The author re-checked each blocker against the code (all confirmed) before
writing r7.

| ID | Sev | Finding | r7 fix |
|---|---|---|---|
| R2F-1 | blocker | Any active API key opens `/api/external/*`, so a COS door key would too (F31). | P12a backfills scope `external` and requires it; the door needs a creator; a test proves a door key gets 401 there. |
| R2F-2 | blocker | A copied watchdog shares trading's lock and probes `127.0.0.1`, so it would block the trading watchdog. | P1: own lock, own log, probe on `:4001`; no shared path. F10 corrected. |
| R2F-3 | blocker | The 90% gate allowed a 10% trading drop, measured only while idle; its fallback put vendor keys on the runner. | Leases must stay within their 14-day range after P1, P2 and P11; the fallback is a separate small EC2 with cloud aliases only. |
| R2F-4 | blocker | Fencing a tag means rewriting the tailnet's `*` rules that carry trading's paths. | P5 fences on the host with a root-owned `nftables` set; the policy changes only if needed, saved first, with trading-path tests and a restore. |
| R2F-5 | blocker | The checkout (8 h) was minted before a 24 h approval wait (F32). | P14a mints it when an approved job is pulled; P14 caps a run at 120 minutes. |
| R2F-6 | blocker | Three failed briefs would disable COS everywhere. | The run-end rule pauses the loop (`AgentLoopState`), never the agent. |
| R2F-7 | major | The trading guard missed files, the task and the second process; `git pull` in trading's checkout would stage config changes. | The guard follows the port-4000 owner and hashes every trading file and task; the fleet runs from its own clone. |
| R2F-8 | major | Sourcing only `.env.fleet` drops Langfuse. | Fleet Langfuse keys and host in `.env.fleet`; P1 checks a trace. |
| R2F-9 | major | A project in trading's OpenAI org or xAI team shares its rate limits. | D11: separate organisations or teams. |
| R2F-10 | major | The runner could set its own approval state; approval could be a model tool; the audit write was fail-open. | The portal sets the state from the registry; approval columns in `AgentRun`; buttons, not tools; one transaction. |
| R2F-11 | major | The lock had no TTL. | Heartbeat every 60 s; stale after 10 minutes. |
| R2F-12 | major | No trigger for pulled UAT jobs; `task-assigned` with repos had no stamp path. | `uat-job` trigger; repos only on `uat-job` loops in phase 1. |
| R2F-13 | major | Grok Bot could delegate by setting an `agent:` assignee in MC. | P8: only people and the portal may; `sp_mcp_grok` gets 403. |
| R2F-14 | major | P14a duplicated the UAT callback; its rollback target runs canary only; one job could go to two executors. | Reuse the callback; one executor per job; roll back to Cursor Cloud. |
| R2F-15 | major | The principal needs a PLX_MC change; `contents:write` can push any ref; the token reached the run. | P6a PR adds the principal; a ruleset limits the App to `agent-runner/*`; only the parent process holds the token. |
| R2F-16 | major | Prisma has no down migrations. | P4a rollback keeps the tables. |
| R2F-17 | major | The brain had no fleet key and no path to the proxy. | P2 mints a brain key; retirement R9 waits for P1 and P2. |
| R2F-18 | major | The four placeholder ids would pass as people. | P9 clears them first; count 0. |
| R2F-19 | major | LiteLLM's database mode on Windows was unproven; the version and host were unnamed. | P2 pins the version, names the host and proves it on a spare port. |
| R2F-20 | minor | Copied local aliases carry `api_key: sk-local`; a curl on the Dell proves nothing about the network. | Backend key from env; probe from another node. |
| R2F-21 | minor | F10's watchdog cadence and F13's path were wrong. | Corrected. |
| R2F-22 | minor | D10 cited a removed load check; no phase built the brief view. | D10 fixed; P10 builds the view. |
| R2F-23 | minor | The swarm refusal was case-sensitive and would go stale after the rename. | Case-insensitive, plus the new name. |
| R2F-24 | minor | Probes skipped Spark A and Dell ports; HTTPS-only egress blocks apt. | Probes added; HTTP to the Ubuntu mirrors allowed. |
| R2F-25 | minor | A 60 s poll cannot kill within 60 s; P1, P6a and P10 started before the operator's yes. | 20 s poll; those phases wait for the yes. |

## Round 3 — blind critic on r7

A new critic diffed r7 against r6 and judged the whole of r7: 1 blocker, 14 majors,
4 minors. The author re-checked the blocker and the design-changing majors against the
code (all confirmed) before writing r8.

| ID | Sev | Finding | r8 fix |
|---|---|---|---|
| R3F-1 | blocker | The callback and the PR outbox accept only `cursor/ uat/ fix/ feat/` branches, so `agent-runner/` would be rejected. | Branch `fix/agent-runner-<run id>` (F35). |
| R3F-2 | major | Trading also uses Anthropic keys. | D11: a separate org for every provider, Anthropic named; F27 updated. |
| R3F-3 | major | Local aliases cost $0, so a budget never stops a runaway loop on the Dell. | Local-alias keys get `max_parallel_requests: 1` and rpm/tpm limits; a burst test. |
| R3F-4 | major | "At or above the lowest day" proves nothing for weekly, demand-driven work. | Median lease duration per job type within 10%, and same-weekday counts in range. |
| R3F-5 | major | No stop method; the repo's restart script and a name match hit trading's proxy. | Stop only the port-4001 owner; name kills and `restart_litellm_proxy.ps1` forbidden. |
| R3F-6 | major | Trading uses `langfuse_otel` with `LANGFUSE_OTEL_HOST`; the spec's `LANGFUSE_HOST` would send traces to the cloud. | Same callback and host default as trading (F37). |
| R3F-7 | major | The portal already has an ADMIN UAT approval; a second one was unlinked. | That authorisation is the `uat-job` approval (F36); `AgentRun.uatFeedbackId` added in P4a. |
| R3F-8 | major | `POST /api/cursor/tasks` already accepts an assignee from any principal. | The rule lives in `actionCreateTask`; both paths tested; F16 corrected. |
| R3F-9 | major | The parent would run agent-controlled checks and hooks; a shared repo lets the run edit `.git/config`. | Checks run as the run's user in its own clone; the parent re-checks governance and pushes from its own clone with a pinned hook. |
| R3F-10 | major | A ruleset cannot allow one App on one pattern without blocking others. | No ruleset; the parent's branch rule is enforced in code, audited daily; negative checks for other pushers. |
| R3F-11 | major | Keys created after P12a would have no scope. | The admin route writes `["external"]`; tested. |
| R3F-12 | major | Nothing swept stale rows; the kill switch failed open during an outage; stale runs could still call back. | Checks on every call plus a cron sweep; three missed polls kill the run; non-`RUNNING` runs are refused. |
| R3F-13 | major | The portal had no budget figure; the failure count never reset. | Budget branch dropped (a budget refusal is a failure); failures count since `clearedAt`. |
| R3F-14 | major | IPv6 tailnet addresses, MagicDNS and `tagOwners` were missed. | `inet` table, `--accept-dns=false`, IPv6 probes, the policy save/test/restore always runs. |
| R3F-15 | major | The existing audit helper is fail-open and outside any transaction. | A new fail-closed, transaction-aware writer; conditional update while `AWAITING_APPROVAL`. |
| R3F-16 | minor | P14a's prerequisites were incomplete. | P14a needs P4, P6 and P6a. |
| R3F-17 | minor | The brain key allowed local aliases. | Cloud aliases only; tested. |
| R3F-18 | minor | The guard missed the Dell's trading tasks. | `AgenticSwarm-VTA-*` exports hashed. |
| R3F-19 | minor | No rule for an unpulled runner job. | Cancelled after 30 minutes and moved to Cursor; the late pull is refused. |

## Round 4 — blind critic on r8, then a fact-check

A new critic diffed r8 against r7 and judged the whole of r8: 2 blockers, 9 majors,
5 minors. The author re-checked both blockers against the code. A separate
fact-checker then tested the other 14 findings: 9 confirmed, 4 partly confirmed, and
1 wrong (R4F-16, whose risk was still real). r9 applies all 16.

| ID | Sev | Finding | Verdict | r9 fix |
|---|---|---|---|---|
| R4F-1 | blocker | The Dell load gate compared a new day with 2 samples of the same weekday, so it would fail most weeks whatever the fleet did, and a fail stops the fleet. | Confirmed (statistics; `trading-workers.yaml:226-240` shows weekly plan swings) | P1 runs an alternating A/B test: a fixed CPU and backend probe, 5 pairs with the fleet driven at its limits and idle; fail on a one-sided slowdown over 10%. The WF `--dry-run` only prints a plan, so the probe is synthetic and touches no trading data. SC-13 and the risk row follow. |
| R4F-2 | blocker | The fence covered only `tailscale0`; run users could reach IMDS and VPC peers, and the house EC2 role reads `prod/ec2-secrets`. | Confirmed (P5 text; `trading-workers.yaml:90-93`) | No instance profile or SSM-core only; IMDSv2 with hop limit 1; the `inet` table drops `169.254.0.0/16`, `fd00:ec2::/32` and the VPC CIDR for group `fleet-run`; acceptance runs as a run user. |
| R4F-3 | major | F36 was wrong; STAFF+ tickets queue with no ADMIN press; `uat-job` runs deadlocked between P4, P10 and P14a. | Confirmed | F36 rewritten. The runner gets only tickets with `agentAuthorizedById` set; the pull creates the run `RUNNING` in one transaction with the checkout and a fail-closed audit row. |
| R4F-4 | major | The hook runs the script from the pushing tree, skips in a bare clone, and a `fix/` push without `CURSOR_AGENT` counts as human. | Confirmed | The parent pushes `<sha>:refs/heads/fix/agent-runner-<id>` from a pinned non-bare tree with `core.hooksPath`, `CURSOR_AGENT=1`, `MC_REPO` and the pulled receipt; no receipt fails `MISSING_STAMP` (F40). |
| R4F-5 | major | Git refuses a local fetch across users; `safe.directory` would trust a run-owned repo. | Confirmed (tested on git 2.43.0 with the fix) | Bundle files both ways: the run clones from a parent bundle with no remote; the parent verifies and fetches the run's bundle with `transfer.fsckObjects`. |
| R4F-6 | major | Vercel crons do not run on staging, so nothing swept stale rows or cancelled unpulled jobs. | Confirmed (`plx-uat-reconcile-ping` calls reconcile on staging) | Both run inside the paced reconcile route; tested with the runner stopped (F39). |
| R4F-7 | major | Callback, push and `RUN_END` order unstated; a stale run left its `UatAgentRun` stuck; retries refused. | Partly (the RUNNING-only rule was the spec's, not the code's) | Heartbeat continues until the callback is accepted, then `RUN_END`; 409 `replayed_delivery` counts as accepted; the sweep moves the bound `UatAgentRun` to `FAILED_RETRYABLE`. |
| R4F-8 | major | No provider value or routing rule for the runner; `hermes` paths would catch it. | Confirmed | New `agent_runner` provider (additive to `uat-agent/v2`) and flag `UAT_AGENT_RUNNER_ENABLED`; routing rule stated; F38 added. |
| R4F-9 | major | A ticket has up to 3 attempts; binding the ticket was ambiguous. | Confirmed | `AgentRun.uatRunId`, unique. |
| R4F-10 | major | No portal principal exists and no MCP action updates a task. | Partly (one principal is the swarm, not a coding runtime) | P8 adds `sp_mcp_portal` with its own key used only for delegation; the assignee rule is on create and on the session `PATCH`. |
| R4F-11 | major | Stopping the fleet proxy by port leaves its watchdog task to restart it. | Partly (cadence was only in a comment) | The execution contract disables `LocalInferenceFleetProxy` before any stop; the task's cadence is stated. |
| R4F-12 | minor | SC-13, D24 wording, the risk row and the stop rule contradicted the phases. | Confirmed | Aligned; D24 wording says "own fresh clone" (meaning unchanged). |
| R4F-13 | minor | SSH checks need `sshTests`; TRADINGBOX → `tag:dgx:22` was untested. | Partly (a `tests` entry is valid but not enough) | Both added; the source is TRADINGBOX's owning admin. |
| R4F-14 | minor | Trading also reads a Google key. | Confirmed | F27(d) and D11 name Google. |
| R4F-15 | minor | Per-key limits do not cap the total on the Dell. | Confirmed | Each local deployment sets `max_parallel_requests` and `rpm`; the version's full-deployment behaviour is recorded; a cross-key burst test. |
| R4F-16 | minor | The fleet's Postgres was unnamed. | Wrong as stated (no Langfuse Postgres on record), but the only Dell Postgres on record is trading's | A dedicated cluster on its own port; never trading's `127.0.0.1:5432` (F41). |

Also in r9: P14's required checks add `workbench-api`, which the portal made required
on 28 Sep 2026.

## Round 5 — blind critic on r9

A new critic diffed r9 against r8 and judged the whole of r9: 0 blockers, 9 majors,
13 minors. The author checked the design-changing findings against the code (attempt
policy, run states, mint timing, sweeps, the shared `:8000` backend): all held. The
author raised R5F-6 to a blocker, because r9's own load test would fail every time and
a failed test stops the fleet (the same reasoning as R4F-1). r10 applies all 22.

| ID | Sev | Finding | r10 fix |
|---|---|---|---|
| R5F-1 | major | An "attempt" is a retest round; cancelling to reroute used one up, and a retry reuses the row. | Reroute keeps the run `QUEUED_FOR_AGENT` and compare-and-sets the provider to Cursor with a "runner already tried" mark; `uatRunId` is indexed, not unique (F42). |
| R5F-2 | major | The portal mints and relays every queued run, so it would push-dispatch runner jobs. | `agent_runner` runs are held for a claim: the queue-time mint, relay and re-dispatch skip them; tested. |
| R5F-3 | major | An MC mint is HTTP and cannot join a database transaction. | Mint first (idempotent), then one transaction with a compare-and-set. |
| R5F-4 | major | Only a stale run released its UAT run; kills and failures stranded it. | Every non-success end releases the bound `UatAgentRun` in the same transaction; the kill order during a push is stated. |
| R5F-5 | major | The parent checked only governance files and trusted the run's file list. | A parent work tree at `<sha>`, ancestry, parent-computed changed files, path and symlink rules as the bridge; parent-built evidence. |
| R5F-6 | blocker (raised) | The probe timed the same `:8000` server the driver loads, so it always failed; the CPU half used one thread against a 4-slot worker. | The probe is a numpy workload in as many processes as the worker's slots; trading never calls `:8000` (F43), so the model-server timing is dropped. |
| R5F-7 | major | The fleet proxy task ran as the logged-on user, next to trading's files and token. | A dedicated `svc-fleet` account, denied trading's checkout, env files and worker profile; tested. |
| R5F-8 | major | A `local-coder` trial would load Spark A, which D23 forbids. | No `local-coder` in phase 1; the risk row says it needs its own spec. |
| R5F-9 | major | Reverting P14a with runs in flight strands them. | Flag off, drain queued and running `agent_runner` runs, then revert. |
| R5F-10 | minor | The IMDS check passed trivially under IMDSv2; the EC2 checks needed credentials the host lacks. | The token `PUT` must time out for run users and work for root; EC2 checks from the operator's machine; `--instance-id` added. |
| R5F-11 | minor | A bundle of a bare SHA is refused; a bundle clone keeps a remote. | A temporary ref, `clone -b`, then `remote remove`. |
| R5F-12 | minor | Stale detection with the runner dead takes up to 15 minutes. | Acceptance says 15 minutes from the last heartbeat. |
| R5F-13 | minor | A GET that writes breaks "reading never writes"; a retried pull was refused. | `GET` lists only; `POST …/claim` with an idempotency key. |
| R5F-14 | minor | The new enum value would be a valid global pin. | `agent_runner` refused as a pin and in the dispatch resolver. |
| R5F-15 | minor | The flag was called a kill switch (D20 says no new one). | Called a routing flag. |
| R5F-16 | minor | SC-13 claimed more than P5 fences; SSM-core reads parameters. | SC-13 says run users; no profile is the default. |
| R5F-17 | minor | Both local aliases share one backend. | Each gets half the backend ceiling. |
| R5F-18 | minor | Disabling a task does not stop a running watchdog; P1's rollback order. | Disable, `Stop-ScheduledTask`, wait for the lock to clear, then stop by port. |
| R5F-19 | minor | P6a tested a P8 rule it does not wait for. | The test lives in P8. |
| R5F-20 | minor | The run user cannot call MC or `brief-inputs`. | The parent fetches the inputs and posts the report. |
| R5F-21 | minor | The driver's node was unnamed. | The operator's workstation; never a trading host. |
| R5F-22 | minor | Four citations were wrong. | Corrected. |

## Round 6 — blind critic on r10

A new critic diffed r10 against r9 and judged the whole of r10: 0 blockers, 8 majors,
11 minors. It tested the git findings (rename detection, bundle fsck) on git 2.43. The
author checked the checkout and callback findings against the code (MC mints a new
`dsp_` on every call; the callback compares empty ids with themselves): both held. The
author raised R6F-8 to a blocker: r10's load test ran heavy CPU work on the Dell while
trading's worker could be running, which D23 forbids. r11 applies all 19.

| ID | Sev | Finding | r11 fix |
|---|---|---|---|
| R6F-1 | major | Rename detection hid a file moved out of a forbidden path. | `--no-renames -z`; a rename test. |
| R6F-2 | major | `transfer.fsckObjects` does not check a bundle's objects on git 2.43. | Fetch into a throwaway bare repo, `git fsck --strict`, then fetch into the parent's clone. |
| R6F-3 | major | Every MC checkout call mints a new `dsp_`, so retried or losing claims left orphan checkouts. | Claim order: stored result, held check, reuse a stored fresh checkout, mint and store, then the transaction (F44). |
| R6F-4 | major | The claim set no executor ids or "tried" mark, so a failed run looped back to the runner and a late callback from an earlier claim was accepted. | The transaction sets `executorAgentId`, `executorRunId` and the mark; `uatRunId` unique again (one runner claim per UAT run). |
| R6F-5 | major | A callback that can no longer land (ticket closed, swept) retried forever and blocked the runner. | At most 5 retries; `wrong_status` ends the run `FAILED`; the status route stops a run whose UAT run moved on. |
| R6F-6 | major | `svc-fleet` could not run files or Python inside `vince`'s profile. | `C:\fleet`, a machine-wide Python; the venv, Prisma and spare-port test done as `svc-fleet` (F45). |
| R6F-7 | major | The deny step edited ACLs on trading's files, which D23 forbids, and added nothing. | Dropped; the default profile isolation is tested, and `icacls` output joins the trading guard. |
| R6F-8 | blocker (raised) | The probe itself loaded the Dell for about 10 minutes while trading's worker ran. | The test runs only while `dell-vta` holds no lease; one thread per probe process; a pair stops if a lease starts. |
| R6F-9 | minor | Held runs could fill the relay's five slots. | Excluded in the query's `where`. |
| R6F-10 | minor | The 30-minute clock had no start; the reroute's behaviour with the flag off. | `heldAt`; reroute at once when the flag is off. |
| R6F-11 | minor | Refusing `agent_runner` in the resolver would rewrite stored runs; the envelope enum; the runner token's scope. | Refused only as an env pin; added to the envelope enum; the token only for `agent_runner` runs. |
| R6F-12 | minor | `Stop-ScheduledTask` skips the lock trap, so the wait never ended; the lock path. | Wait up to 70 seconds, then remove a stale lock at a stated path; P1's on-fail step uses the stop rule. |
| R6F-13 | minor | P14a uses P10's writer but did not wait for P10. | Added to section 8. |
| R6F-14 | minor | D18 said "Cursor first" while P14a routes authorised tickets to the runner first. | D18 wording amended to "Cursor stays the default", with the conditions; the operator confirmed it on 28 Sep 2026. |
| R6F-15 | minor | "Reads no trading data" contradicted the lease list. | The operator reads the lease list, read-only. |
| R6F-16 | minor | No stated way to manage the host; replies dropped. | Tailscale SSH from `autogroup:admin`, `ct state established,related` first; SSM-core optional. |
| R6F-17 | minor | Windows Firewall blocks the new listener. | One inbound rule for 4001 on the Tailscale interface, removed in rollback. |
| R6F-18 | minor | Three citations. | Corrected; F38 adds the late `FINISHED` case. |
| R6F-19 | minor | No check that cloud-alias keys keep their limits. | A cloud-alias `rpm_limit` test. |

Also in r11: section 8 says the retirement spec's R8 waits for P1.

## Round 7 — blind critic on r11

A new critic diffed r11 against r10 and judged the whole of r11: 0 blockers, 5 majors,
11 minors. It tested the git findings on git 2.43. The author checked the dispatch call
sites and trading's Python use: both held. The author raised R7F-4 to a blocker:
trading's scheduled scripts call a bare `python`, so r11's machine-wide Python could
change the interpreter trading runs. r12 applies all 16.

| ID | Sev | Finding | r12 fix |
|---|---|---|---|
| R7F-1 | major | Three single-run paths (the workflow, `resumeAuthorization`, Start agent) still minted and froze a dispatch row for a held run. | The hold check sits inside `enqueueAndRelayExecutorDispatch` and `dispatchExecutorOutboxRecord`; the hold is written with the move to `QUEUED_FOR_AGENT`. |
| R7F-2 | major | After a runner failure the provider stayed `agent_runner`, so a retry went back to the runner and a late callback still matched. | Release and the callback's `ERROR` path compare-and-set the provider to Cursor and set the tried mark. |
| R7F-3 | major | `autogroup:admin` admits TRADINGBOX, the VMC host and swarm-prod; `tailscale up` lacked `--ssh`. | SSH only from the operator's identity with `action: check`; `--ssh`; `sshTests` deny the three hosts. |
| R7F-4 | blocker (raised) | A machine-wide Python can take over trading's bare `python` calls or upgrade trading's interpreter. | A private NuGet or embeddable Python in `C:\fleet\python`, a different minor version, called by full path; `where python` and `py -0p` join the trading guard. |
| R7F-5 | major | CIM calls hang on the Dell; 70 seconds is shorter than the watchdog's start loop. | `schtasks` and `netstat` with timeouts; no listener on 4001 for 5 minutes after the stop. |
| R7F-6 | minor | The wrong-status text is in `message`, not `error`; no rule after 5 failures. | Match the message prefix; `RUN_END FAILED` after 5; the runner token only for a claimed `AGENT_RUNNING` run. |
| R7F-7 | minor | A losing claim could overwrite Cursor's checkout; an 8-hour stamp could expire mid-run. | A conditional mint write; reuse only with `maxMinutesPerRun` plus 60 minutes left. |
| R7F-8 | minor | No storage for the hold; a Prisma `not` drops NULL providers. | `triageSummary.runnerHold`; an explicit `OR` with NULL. |
| R7F-9 | minor | D18 was open while the header said confirmed. | D18 was confirmed on 28 Sep 2026 (recorded before this revision). |
| R7F-10 | minor | The lease list was always empty; "stops at once" had no mechanism; the P2 rerun could not reach the ceiling; no cost. | The probe polls leases and aborts itself; the rerun uses enough keys; a cost is stated. |
| R7F-11 | minor | F45's Python path citation. | `operator-hosts.yaml:246`. |
| R7F-12 | minor | A new folder under `C:\` lets every account modify it; ProgramData was unchecked. | Inheritance off; `icacls` and probes, including `C:\ProgramData\AgenticSwarm`. |
| R7F-13 | minor | A program firewall rule does not match a venv's `python.exe`. | A port rule. |
| R7F-14 | minor | P1 and P2 rollbacks were incomplete. | Every item listed. |
| R7F-15 | minor | The status route stopped a run after its own callback; the claim ignored the switches. | A run may finish after its accepted callback; claim step 0 checks the switches. |
| R7F-16 | minor | A thin bundle cannot be fetched into an empty repo; fsck of all history would fail on legacy objects. | A throwaway repo with the parent as an alternate, then a local fetch with `transfer.fsckObjects`, which checks only new objects. |

## After the review: r13 (operator decisions, one critic pass)

After the review closed, the operator made three decisions on 28 Sep 2026:
- **D5 amended:** the fleet proxy moves to its own EC2 host, `fleet-proxy`, with its own
  Postgres. Nothing of the fleet runs on the Dell. Local aliases become an optional
  phase, P1b, that calls the Dell's model server over the tailnet under the A/B load
  test. Every late blocker in rounds 4 to 7 came from running the fleet on the Dell.
- **D25 added:** an agent eval gate on activation (P15a, P15). The portal's admin
  evaluation module is Persona QA, which tests UI and never scores agents (F47, F48).
- **D26 added:** bounded parallel runs (per-loop `maxConcurrent`, a counting limit, per-run
  systemd limits, a larger runner host).

One blind critic then reviewed only the r13 changes: 0 blockers, 12 majors, 5 minors.
All 17 are applied.

| ID | Sev | Finding | r13 fix |
|---|---|---|---|
| R13-1 | major | The guard's rewording left P14's Dell task retirement unguarded. | Both Dell steps (P1b, P14) are named under the guard; P14 disables tasks by exact name. |
| R13-2 | major | Reaching the Dell's `:8000` from another node is not proven (Docker Desktop, Windows Firewall). | P1b first runs a read-only `curl` from `fleet-proxy`; if it fails, P1b stops. |
| R13-3 | major | P1 named tags created later by P5 and R5. | Each phase adds its own tag's rule; retirement R5's fence waits for fleet P1. |
| R13-4 | major | P11 still required $0 cloud spend while P1b is optional. | A spend cap on the cloud alias; SC-2's hosted half depends on P1b. |
| R13-5 | major | Keys minted before P1b lacked local aliases; limits tracked the host, not the loop. | P1b updates keys; `max_parallel_requests` is the sum of the loops' `maxConcurrent`. |
| R13-6 | major | Approvals and claims skipped the count; a refused claim could block the job; `FOR UPDATE` on a missing row. | Count on approval and claim; refuse before minting; no row for a refused claim; insert-then-lock. |
| R13-7 | major | Parallel runs shared one key's spend. | One key per run, deleted at the end. |
| R13-8 | major | The portal build needs about 12 GB; 8 GB per run and a 32 GB host were too small. | 64 GB host, `MemoryMax=12G`; runs never build (CI does); Node heap and test workers capped. |
| R13-9 | major | Parallel runs shared the mirror, push tree and hook config. | A per-repo lock; a push work tree per run; `git -c core.hooksPath`. |
| R13-10 | major | Nothing gave the runner the candidate version; no eval key; no kill or sweep for evals. | The claim returns both versions; P2 mints eval keys; evals heartbeat and poll. |
| R13-11 | major | Closed tickets are already fixed on `staging`; brief inputs were not stored. | Cases carry `baseSha`; P11 stores its inputs; P15 waits for 10 P11 runs. |
| R13-12 | major | A candidate could skip the gate with `required: false`; a stale baseline; SUPER_ADMIN only. | The gate reads the active version's flag; the baseline must still be active; SUPER_ADMIN named. |
| R13-13 | minor | Hasitha's eval could take a slot for hours and cost more than stated. | Cached baselines, per-case caps, a spare slot only; the acceptance runs on COS. |
| R13-14 | minor | The driver's host was unnamed again; P1b edits files but was "operator". | Never the Dell, a Spark, TRADINGBOX or the VMC host; P1b is a PR plus operator. |
| R13-15 | minor | The operator identity also covers trading's untagged hosts. | Tests deny TRADINGBOX, the VMC host and swarm-prod. |
| R13-16 | minor | The backup needs root's metadata access; Prisma's cache owner. | Backup as root; `prisma generate` as the service user. |
| R13-17 | minor | Migration count wording, eval "no portal write", a citation, the risk row. | Corrected. |

## Convergence

| Round | Reviewer | Blockers | Majors | Minors |
|---|---|---|---|---|
| 1 | fact-check + blind critic on r5 | 11 | 23 | 17 |
| 2 | blind critic on r6 | 6 | 13 | 6 |
| 3 | blind critic on r7 | 1 | 14 | 4 |
| 4 | blind critic on r8, then a fact-check | 2 | 9 | 5 |
| 5 | blind critic on r9 | 1 (raised) | 8 | 13 |
| 6 | blind critic on r10 | 1 (raised) | 7 | 11 |
| 7 | blind critic on r11 | 1 (raised) | 4 | 11 |

The frontier review stopped after three rounds in a row with no blocker. This spec has
not reached that yet. Since round 5 the critics have found no blocker of their own;
each blocker was raised by the author, and each came from the author's previous fix. The operator closed the review after round 7 on 28 Sep 2026: the specs
ship as reviewed drafts, and each build phase's own PR review catches the remaining
operating detail.

## Decisions the review changed

- **D23** confirmed by the operator on 28 Sep 2026.
- **D5** amended (separate fleet proxy), **D16** amended (ADMIN-only approvals), **D24**
  added (runner isolation). The operator confirmed all three on 28 Sep 2026.
- **D18** reworded in r11: Cursor Cloud stays the default executor; only an
  ADMIN-authorised ticket goes to the runner, only while the routing flag is on, and it
  moves to Cursor if unclaimed for 30 minutes. The operator confirmed it on 28 Sep 2026.
- **D24** reworded in r9 ("its own fresh clone") and r13 ("a key minted for that run");
  meaning unchanged, isolation tighter.
- **D5** amended again in r13 (its own EC2 host), and **D25** and **D26** added. The
  operator confirmed all three on 28 Sep 2026.
