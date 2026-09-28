# Swarm retirement spec — adversarial review log

Target: `swarm-retirement-spec.md`, r4 (28 Sep 2026) → r5.
Method: the same as the frontier review. Each spec is checked by a fact-checker, who
tests every fact and cited line against the repos. A critic then reviews it blind,
with no access to the author's reasoning. Repo heads: agentic-swarm `main` at `60e7e17`, portal
`staging` at `d164a52`, PLX_MC `main` at `daf3e82`, plx_secondbrain `af0b3ea`,
local-inference `3ee33e9`, skills `9d5483d`. The author re-checked every blocker
against the code before editing.

## Round 1 — fact-check (FC) and blind critic (CR) on r4

Fact-check: 186 claims checked, 30 wrong or stale. Critic: 5 blockers, 15 majors,
8 minors. Overlapping findings are merged below; each row names every ID it covers.

### Blockers

| IDs | Finding | r5 fix |
|---|---|---|
| CR-R1, FC-R4 | R7 would change `VMC_BASE_URL`, which on the VMC host and TRADINGBOX means VMC itself; every trading cron would go to the brain. | Brain callers read `BRAIN_BASE_URL` first. SC-8 and R7 forbid changing `VMC_BASE_URL` anywhere shared. F19 added. |
| CR-R2 | The brain would read VMC's shared secret file, so its restricted role was never used, and R10's `DATABASE_URL` switch would move VMC and trading. | `BRAIN_DATABASE_URL` from its own env file and secret (`/etc/plx-brain/brain.env`, `prod/plx-brain`); R10 and its rollback edit only that file. |
| CR-R3, FC-R2 | S5 would replace `VMC_API_KEY`, which trading's paper dispatcher, exit monitor and alarm Lambda use (a 2026-06 rotation stopped paper trading for 2.3 days). | D3 and D8: never rotated. The brain accepts it during the lift, callers move to `BRAIN_API_KEYS` (R7), and only the brain stops accepting it (R11). |
| CR-R4, FC-R1 | The watchdog and `deploy-swarm.sh` restart the tunnel after `disable`. | agentic-swarm#1629 removes the tunnel from the watchdog and guards the deploy restart. F20 added. |
| CR-R5 | After R10's copy, VMC login routes, B8 crons, leftover callers and R8's flag could still write `command_center.memory`. | R9 turns old lines off as each port goes live; R10 revokes writes on the old schema, answers VMC's knowledge routes with `410`, and removes R8's flag; the R6 block stays for good (D4). |
| FC-R3 | `SWARM_API_KEY` and `SLACK_WEBHOOK_URL` were listed for revocation, but trading uses both. | Removed from S5; named in D8, T1 and SC-8. S2 lists trading's three calls to swarm-prod. |
| FC-R5 | V4 would delete PLX_MC entries that `rollout.ts` imports at build time, and entries that protect trading's repo. | V4 keeps them; T3 renames them. |

### Majors

| IDs | Finding | r5 fix |
|---|---|---|
| CR-R6 | Every swarm merge redeploys VMC and resets the workers. | Execution contract: a swarm merge is a trading deploy, merged in a trading-safe window with T2 after. F18 added. |
| CR-R7, FC-R18 | T1 missed the Python import closure, shared crontab lines, the second secret loader, the deploy smoke profile, auth. | T1 rewritten as a labelled table covering all of them. F3, F7, F15 updated. |
| CR-R8, FC-R14 | The harness's live mode never calls a service; the weekly run is fixtures only. | R3 adds an HTTP mode; every eval check runs over HTTP; R6 replays R3 daily instead. |
| CR-R9 | A days-old recording drifts; R4's live check needs the production DB. | R5 runs a paired replay (VMC and service in the same minute); probe writes use fresh keys and a cleanup script. |
| CR-R10 | The hooks queue but never replay; the service had no write-refusing mode. | R4 adds `BRAIN_WRITES_PAUSED=1`; R10 requires a replay script or a recorded acceptance of the loss. B19 added. |
| CR-R11 | Fleet P10 would make COS chat depend on the brain during the move. | Fleet r6 P10 waits for R11; section 9 says so. |
| CR-R12 | No step created `brain.plxcustomer.io`. | New R6a (DNS, with before-and-after `dig`). |
| CR-R13 | Caddy edits change trading's front door. | R6: backup, `caddy validate`, `handle @brain` before the catch-all, reload, trading and health probes within 2 minutes, instant restore. |
| CR-R14 | T2 had no commands, baseline or threshold. | T2 is a seven-item checklist with a 7-day before-and-after window for weekly jobs. |
| CR-R15, FC-R9 | The VMC host would join the tailnet; brain jobs would use `local-driver`. | D5 amended: the brain gets its own host. D6 and R9: fleet proxy, brain key without `local-driver`, rerank and rewrite off. |
| CR-R16, FC-R20 | The service would run on trading's host with no limits. | D5 amended (own host; the fallback names the limits); D8 names the three guarded touches. |
| CR-R17 | The copy and HNSW build would run on the shared RDS instance. | New D13: its own RDS instance (fallback named). Waits for the operator's yes. |
| CR-R18 | S2's gate missed R9 and S1; "the watchdogs" was unclear; trading calls swarm-prod. | S2: gate on R8, R9, S1 and T1; swarm watchdog first; VMC watchdog stays; the three trading calls listed. |
| CR-R19 | The rename breaks `x-mc-repo`, the registry and the Dell's self-updater. | T3: an ordered rename; never reuse the old name. F5 names the self-updater. |
| CR-R20, FC-R11 | R7's caller list missed 16 files, the Cursor team MCP and operators' configs. | R7 lists them per repo, including one swarm PR. |
| FC-R6 | V4 would remove local-inference's bridge gate, which is trading's. | Kept; T3 repoints it. F11 updated. |
| FC-R7 | Lobster runs three more lanes (`kb-compile`, `kb-lint`, `institutional-distill`). | F6 and B8 updated (15 jobs); R9 covers all. |
| FC-R8 | No scheduled job embeds direct writes. | B7 corrected; R9 builds an embedding backfill. |
| FC-R10 | Migrations and tables were missing; `048` also alters `public.vmc_decisions`. | B9 updated; R10 seeds the ledger and splits `048`. |
| FC-R12 | `brain_self_check` also probes `/api/health`. | R4 serves it; R6 routes it. B16 updated. |
| FC-R13 | Two callers POST to `agent/items`, which is GET-only (405). | R3 records it; R7 moves both to `ingest`. |
| FC-R15 | R2 has shipped. | B3 in past tense; R2 marked shipped; SC-4 on staging. |
| FC-R16 | `pipelines.yaml` has a byte-identical mirror. | R1 names it (agentic-swarm#1629). |
| FC-R17 | R1's acceptance proved nothing; "write only the swarm repo" was incomplete. | R1: the scheduler log, `crontab -l`, the tunnel after 24 h; wording names their own `command_center` rows. |
| FC-R19 | Trading's market-data alert is an escalation todo. | V1 keeps a view of it, or moves the alert first. |

### Minors

| IDs | Finding | r5 fix |
|---|---|---|
| CR-R21 | R1 stopped before 14 quiet days; R1 and R2 status was stale. | D1 records the operator's exception; section 12 records status. |
| CR-R22 | R0 missed the Dell, logged key values, and missed `localhost` callers. | R0 adds the Dell, VMC's own logs, stripped keys and the logging-off rule. |
| CR-R23, FC-R29 | The role needs schema and sequence grants; route metrics and `departments.yaml`. | R4: grants, `VMC_ROUTE_METRICS_ENABLED=0`, ships `departments.yaml`. |
| CR-R24 | "Same key values" missed scoped keys, tenant variables and flags. | R3 records each key tier; R5 lists the variable names. |
| CR-R25 | A new runner would rerun applied migrations. | R10 seeds its ledger. |
| CR-R26, FC-R25, FC-R26 | Wrong references (D8 for D6, R1 for R0, fleet r4); V4's grep could not pass. | Fixed; V4's grep names the kept entries. |
| CR-R27 | R0 could not see CEO-bridge callers; `tools/plx-mc-mcp` also holds MC tools. | R0 reads Vercel's logs; V4 removes only the swarm tools. |
| CR-R28 | Installing the mirror would overwrite live-only lines; MCP sessions end at cutover. | R1 uses `crontab -e` with a backup; R6 tells MCP users to reconnect. |
| FC-R21 | VMC reaches swarm-prod at a private IP, not loopback. | R1 and F5 wording. |
| FC-R22, FC-R23, FC-R24, FC-R27, FC-R30 | Counts and paths (11 tools, 3,708 lines, 61 areas, relay cadence, harness path). | Updated. |
| FC-R28 | `gpu` is not trading's; only its Vast.ai routes use it. | V1: retire. |

## Round 2 — blind critic on r5

A new critic diffed r5 against r4 and judged the whole of r5: 2 blockers, 16 majors,
7 minors. The author re-checked each blocker against the code (both confirmed) before
writing r6.

| ID | Sev | Finding | r6 fix |
|---|---|---|---|
| R2R-1 | blocker | Trading's Friday research run writes and reads its lessons in `command_center.memory`; R10's REVOKE would break it. | B20 added. R10 skips the REVOKE while a trading writer exists and counts stray rows daily; T1 lists every writer. |
| R2R-2 | blocker | The old slug seeds trading's UUIDv5 ids; "update every hard-coded slug" would change them. | F21 added. T3 edits remotes, API targets and stamps only; D8 forbids editing id seeds. |
| R2R-3 | major | MCP writes bypassed the pause; writers kept writing during the dump; counts missed updates. | The pause covers MCP tools; R10 has an exact order; counts plus `max(updated_at)`. |
| R2R-4 | major | The rollback missed tables, updates and grants. | Grants saved first; every table copied back by primary key; grants re-applied. |
| R2R-5 | major | Ported jobs needed tables before R10 created the database. | R5 creates the instance, the `brain` database, the runner and the run tables. |
| R2R-6 | major | Step-1 search needs two swarm keys the env list left out. | Read-only copies named in R5; deleted at R8. |
| R2R-7 | major | The network wording read as editing VMC's security group; RDS, swarm-prod, tailnet and role SQL were missing. | R5 lists each additive rule with its undo and the exact role SQL. |
| R2R-8 | major | The "backup job" is a shared VMC-host line. | RDS backups and a brain-host timer; `weekly-db-backup.sh` never edited. |
| R2R-9 | major | Editing `brain.env` directly would be reverted by the next render. | Change the secret, re-render, restart, check. |
| R2R-10 | major | VMC's `/api/health` carries the workers' deployed commit. | D4: it stays VMC's; R6's matcher leaves it out. B13 updated. |
| R2R-11 | major | B13 described the wrong smoke profile. | B13 corrected; S3 changes the probe in the same PR; no audited table is dropped. |
| R2R-12 | major | Falling back to `VMC_BASE_URL` on the VMC host hits VMC; no key variable; hook environments missing. | `BRAIN_BASE_URL` then the new host; `BRAIN_API_KEY` falls back to `VMC_API_KEY`; every hook environment listed. |
| R2R-13 | major | R7 changed keys and routes, not only the base URL; V4 changed the portal. | R7 changes only the base URL on the day; the two 405 callers get separate fixes; V4's portal PR is optional and needs its own yes. |
| R2R-14 | major | A key without `local-driver` could still load the Dell's local models, next to `dell-vta`. | D6: the brain's key is cloud-only. |
| R2R-15 | major | Trading uses the Graph credentials. | F22; S5 and SC-8 never rotate them. |
| R2R-16 | major | T2 was not runnable; item 7 turned every step into a 7-day gate. | Each item names its command or log; item 7 is a follow-up check. |
| R2R-17 | major | A fixed copy of `VMC_API_KEY` outlives a rotation; R11 had no logging to count its use. | R4 logs the key tier; D3 updates the copy within the hour of a rotation; R11 names a trading route. |
| R2R-18 | major | Editing `x-mc-repo` before the rename would stamp PRs with a slug GitHub does not report. | T3: registry both slugs, rename, then one PR. |
| R2R-19 | minor | The `410` block had no text and could catch brain paths; the weekly SOP opens those pages. | R10 step 2: a matcher that excludes brain paths, R6's checks, and an SOP update. |
| R2R-20 | minor | DNS and TLS order, `mc` and CAA checks, R6's rollback after R10, reload windows. | R6a and R6 updated. |
| R2R-21 | minor | `BRAIN_URL` vs `BRAIN_BASE_URL`; frontier F26 vs D4; the env-name rule. | Named as one value; F26 added for r13; the rule reworded. |
| R2R-22 | minor | R7's grep matched non-callers. | It greps brain paths only. |
| R2R-23 | minor | A replay script exists; "004–068" read as 65 migrations. | Script reused (B19); the 12 ids listed. |
| R2R-24 | minor | Stopping Lobster stops a backup lane; D8 and T1 lists were short. | S1 checks the VMC backup line first; D8 and T1 completed. |
| R2R-25 | minor | The cleanup needed DELETE and missed tables. | A one-off cleanup role and the full table list. |

## Round 3 — blind critic on r6

A new critic diffed r6 against r5 and judged the whole of r6: 2 blockers, 13 majors,
5 minors. The author re-checked both blockers and the new facts against the code (all
confirmed) before writing r7. Two round-2 fixes (R2R-16, R2R-17) had named a
login-only trading route; r7 corrects them.

| ID | Sev | Finding | r7 fix |
|---|---|---|---|
| R3R-1 | blocker | `trading-v2/readiness` is login-only, so T2, R6 and R11 could never pass with a key. | Use the key-authenticated, read-only `trading-v2/dispatcher/alarm` (F24). |
| R3R-2 | blocker | `pg_restore` cannot read `pg_dump`'s plain output; `brain` lacked `vector` and `pgcrypto`. | R5 creates both extensions; R10 dumps in directory format as the master role. |
| R3R-3 | major | Swarm dispatches and eleven research crons also write `command_center.memory`; the REVOKE could only hit `brain_app`. | No REVOKE on the shared role; drop `brain_app`; the stray-write query excludes both namespaces and counts updates and link rows. F23 added. |
| R3R-4 | major | Counting live tables after the dump cannot match while writers run. | Counts and the dump come from one exported snapshot; writers are never stopped. |
| R3R-5 | major | Copy-back by key overwrote new rows in serial-keyed tables; grants could not be re-applied once the role was dropped. | Serial rows copied without ids above the snapshot's max, then `setval`; `items` upserted on its natural key; grants saved as SQL. |
| R3R-6 | major | "The Friday run still writes its lessons" proved nothing (lessons are written only on failure). | Check the shared role's `INSERT` privilege and a lessons browse through swarm-prod. |
| R3R-7 | major | The brain host joined the tailnet unfenced. | `tag:plx-brain`, policy tests, an `inet` `nftables` fence, probes. |
| R3R-8 | major | No internet ingress, no elastic IP, and the RDS group might front the portal's UAT database. | Rules and EIP listed; the group is named and checked against `plx-postgres-uat`; the brain's instance gets its own group. |
| R3R-9 | major | `LOGIN` spans the shared instance; the copied pool opens 20 connections. | `CONNECTION LIMIT`, per-database privilege checks, a 5-connection pool with its own name. |
| R3R-10 | major | The internet-facing host would hold `VMC_API_KEY` and trading's Graph credentials. | It holds only the key's SHA-256; its own Graph app and the fleet's OpenAI organisation. |
| R3R-11 | major | The brain key could reach local aliases; D6's decline path deadlocked R9. | Fleet P2's brain key is cloud-only; R9 repeats the Dell gate; D6 names the decline path. |
| R3R-12 | major | R7's grep proved nothing (callers hard-code only the host). | Grep the bare host and `VMC_BASE_URL` in each caller file, plus a unit test per caller. |
| R3R-13 | major | The `410` block was prose, and Caddy runs `handle` before `respond`. | Exact `@retired` matcher inside `handle`, with checks for 410, brain 200 and trading 200. |
| R3R-14 | major | S7 edited the portal's `CLAUDE.md`. | Moved into V4's optional portal PR. |
| R3R-15 | major | The smoke route imports both profiles' code; an in-place build can fail. | S3 covers every import and requires a green build. |
| R3R-16 | minor | Stale lines (fleet revision, D5, D8, section 11). | Updated. |
| R3R-17 | minor | R8 deleted what its rollback needed. | Keys and the ingress rule leave at R10. |
| R3R-18 | minor | Tool names and the in-process lessons read. | Corrected (B20, B21, R3). |
| R3R-19 | minor | The registry has no alias field. | A second entry with its manifest digest; the PR's checkout names the new slug. |
| R3R-20 | minor | `brain_run_lint` points at VMC's cron; the replay script would be pruned. | R9 changes the message; R10 moves the script. |

## Round 4 — blind critic on r7, then a fact-check

A new critic diffed r7 against r6 and judged the whole of r7: 1 blocker, 9 majors,
7 minors. The author re-checked the blocker against the code. A separate fact-checker
then tested the other 16: 11 confirmed, 5 partly confirmed, none wrong. Two majors
were raised to blockers: R4R-3 puts keys that can post paper trades on an
internet-facing host, and R4R-5 means the restore cannot succeed as written. r8
applies all 17.

| ID | Sev | Finding | Verdict | r8 fix |
|---|---|---|---|---|
| R4R-1 | blocker | The lessons check had no `project_slug`, so the scope guard answers 403; it could never pass. | Confirmed (`memory_api.py:14-49`; `research-runner.ts:410-418`) | Sent from the VMC host as the loader sends it, with `project_slug=trading-v2&limit=3`; ids recorded at step 3 and compared. |
| R4R-2 | major | Replays with the `VMC_API_KEY` tier would put the key's value on the brain host (D3). | Partly (R6's replay and R5's eval named no host) | R5's paired replay and eval run from the VMC host from a temporary copy; R6's daily replay is read-only and never on the brain host. |
| R4R-3 | blocker (raised) | Department keys pass every VMC key route, including paper trading writes, and sat in plain text on the brain host; so did the swarm keys. | Confirmed (`key-scope.ts:77,179-200`; `api-handler.ts:527-558`) | `BRAIN_SCOPED_KEY_SHA256` (hash to grant); the brain hashes before lookup; the swarm keys leave when R8 passes; B22 added; risk row added. |
| R4R-4 | major | The rollback missed `graph_*`, `attempt_packets` and `quantized_embeddings`. | Confirmed (graph ingest is on in production) | One rule per table, parents first; a copy-back script tested in CI before the cutover; B23 lists the tables and keys. |
| R4R-5 | blocker (raised) | `pg_restore` without `-O -x` fails on missing roles; no runtime role existed in `brain`. | Confirmed | `-O -x --exit-on-error`; `brain_svc` created in R5 with default privileges; the runner uses the master via `BRAIN_MIGRATE_DATABASE_URL`. |
| R4R-6 | major | Step 4's master role is the shared `plxadmin`, whose rotation once stopped TRADINGBOX for 21 hours. | Partly (`plxadmin` is `rds_superuser`, not a true superuser) | The dump runs as `brain_app`, which already reads every table and sequence; `plxadmin` never reaches the brain host. |
| R4R-7 | major | The env list missed flags the code reads; the graph flags are off when unset. | Confirmed (also `VMC_SECOND_BRAIN_*` is read by `agent/status`) | `service/deploy/env.names` with a test; R5 copies VMC's live flag values; `never` names listed; no `~/.secrets-env` fallback. |
| R4R-8 | major | The brain's outbound traffic was open and untested on VPC addresses. | Confirmed | An egress allow-list; probes to TRADINGBOX's VPC address, VMC `:3100` and `plx-postgres-uat`. |
| R4R-9 | major | No rule for what `PUBLIC` grants allow `brain_app` elsewhere. | Confirmed | `CONNECT` and `TEMP` recorded and accepted; any `CREATE` or table privilege outside `command_center.memory` stops the step. |
| R4R-10 | major | V2's "turn off its flag" edits `prod/ec2-secrets` (SC-8) and disabling VMC units breaks D5. | Confirmed | V2 uses only VMC crontab lines, swarm-prod lanes or units, or a swarm PR; otherwise stop and ask. D5 and D8 list V2. |
| R4R-11 | minor | `dispatcher/alarm` returns 200 even when unhealthy. | Confirmed | T2, R6 and R10 check `backendReady` and compare `healthy` and findings (B24). |
| R4R-12 | minor | `/x/*` does not match `/x` in Caddy; two root routes stayed live. | Confirmed | Both exact paths added to `@retired`. |
| R4R-13 | minor | `plxadmin` owns the tables, so the `INSERT` check always passed. | Confirmed (inferred) | Replaced by the audit query's newest-row times for the shared writers. |
| R4R-14 | minor | The read-only role was never created; loopback callers skip Caddy. | Confirmed | `brain_audit_ro` created, and the ingress rule stays for it; loopback callers move before R10. |
| R4R-15 | minor | The daily replay wrote probes after the cleanup role was gone. | Confirmed | A `--read-only` replay; R10's full replay cleans up in `brain`. |
| R4R-16 | minor | "Outside market hours" was weaker than the trading-safe window. | Partly (swarm serve runs no memory DDL at startup) | The trading-safe window, and no swarm merge during the dump. |
| R4R-17 | minor | Stale fleet revision names; D8's touch list; R5's fleet dependency; the rollback password; serial key names; `ON CONFLICT`; the replay's scope. | Confirmed (b partly) | Each corrected in place. |

## Round 5 — blind critic on r8

A new critic diffed r8 against r7 and judged the whole of r8: 0 blockers, 7 majors,
10 minors. The author checked the credential findings against the code (`db.ts`,
`REQUIRED_SERVER_ENVS`, task briefs): all held. The author raised R5R-4 and R5R-6 to
blockers, because each could put a trading credential on the internet-facing brain
host, which D8 forbids (the same reasoning as fleet R4F-2). r9 applies all 16.

| ID | Sev | Finding | r9 fix |
|---|---|---|---|
| R5R-1 | major | Ported brain jobs on the brain host's timer could write after the snapshot. | Step 1 stops the job timers; step 7 restarts them; evidence shows no run between steps 4 and 6. |
| R5R-2 | major | Swarm-prod also writes task briefs and agent memory, so the audit would alarm daily. | The audit's shared-writer list comes from R0 and T1 and includes briefs and agent memory; F23 corrected. |
| R5R-3 | major | The rollback's `setval` needs `UPDATE`; `events` has no dedup index; no selector; it could overwrite trading's rows. | No `setval`; a cutover time `T`; shared-writer namespaces never copied; newer-wins upserts; `events` ids recorded for reruns. |
| R5R-4 | blocker (raised) | No instance role or IMDS rule for the brain host; an estate role reads `prod/ec2-secrets`. | A new role limited to `prod/plx-brain`; IMDSv2 hop limit 1; the service user cannot reach IMDS; an `AccessDenied` check. |
| R5R-5 | major | Raw keys reach the brain in requests; R7's fallback sent `VMC_API_KEY` to the brain's own name; logs could keep keys. | Brain keys issued with the new base URL; the fallback only on the old host (D3 amended); a Caddy log filter and a log grep; B26 added; risk row corrected. |
| R5R-6 | blocker (raised) | The copied `db.ts` and `REQUIRED_SERVER_ENVS` ask for trading's database URLs. | Those names are `never`; the trading, economy and listen pools are removed; a test on the rendered env file; B25 added. |
| R5R-7 | major | The cleanup role could not run its `WHERE` without `SELECT`; graph delete order. | `SELECT, DELETE`; facts first, then entities and episodes. |
| R5R-8 | minor | An older `pg_dump` refuses the 17.9 server. | A 17+ client; the brain RDS at 17+. |
| R5R-9 | minor | The migrate URL sat in the service's env file. | A root-only `migrate.env` and a oneshot unit. |
| R5R-10 | minor | `pg_trgm` was missing in `brain`. | Create every extension `command_center` has. |
| R5R-11 | minor | `graph_quarantine` has no natural key; foreign keys are mixed. | B23 and the rollback say so; quarantine rows insert by id. |
| R5R-12 | minor | The audit kept a path to the shared instance for good; 8900 egress never removed. | The audit runs 30 days, then its role and path go; 8900 egress removed at R10. |
| R5R-13 | minor | The audit's email had no sender. | `BRAIN_RESEND_API_KEY`, never trading's. |
| R5R-14 | minor | New one-off VMC-host commands were not in the guarded list. | D8 item (7); the daily replay moves to an operator machine with a brain key. |
| R5R-15 | minor | Step 1 never embeds; the run-table schema was unnamed. | The embedding key moves to R8 (R8 waits for fleet P1); run tables in `brain_ops`. |
| R5R-16 | minor | Stale fleet revision names; a wrong citation. | Revision numbers dropped; B24 cites `:733-750`. |

## Round 6 — blind critic on r9

A new critic diffed r9 against r8 and judged the whole of r9: 1 blocker, 5 majors,
6 minors. The author re-checked the blocker against swarm-prod's code
(`_verify_api_key` alone gates `/research/run`, `/pipelines/run` and `/memory/delete`):
it held. r10 applies all 12.

| ID | Sev | Finding | r10 fix |
|---|---|---|---|
| R6R-1 | blocker | `SWARM_API_KEY` alone can start trading research runs, run pipelines and delete memory, and the brain host held it from R5 to R8. | The brain never holds a swarm key: a search-only proxy on swarm-prod (`:8901`) admits only `GET /memory/search/v2` with a brain token and adds the keys itself (B27; D8 item 8). |
| R6R-2 | major | r9's fallback could not run: the default URL is the brain, SC-8 hosts cannot get a brain key, the grep forbade the old-host constant, R11 issued keys twice. | Address and key picked as a pair; one old-host constant allowed; `~/.plx-brain-client.env` for SC-8 hosts; R11 issues none. |
| R6R-3 | major | Department keys still travelled raw to the brain, and nothing retired their hashes; the permanent D4 block forwards stray VMC keys. | R0/T1 list holders, R7 gives them brain keys; R11 retires both hashes on the 14-day rule and makes VMC's Caddy forward only `brn_` keys. |
| R6R-4 | major | Only the service user was kept from the metadata service; `caddy` could still reach it. | `meta skuid != 0` drops it for every non-root user; tested as `caddy`. |
| R6R-5 | major | `brain_svc` lacked `USAGE` on `brain_ops`; the cleanup role lacked it on `memory`. | Both granted. |
| R6R-6 | major | In-place updates to `links` and `knowledge_links` and the embedding backfill leave no timestamp, so the rollback lost them. | The rollback restores the dump into `brain_t0` and copies back every new or changed row by content; the `updated_at` test is dropped (B28). |
| R6R-7 | minor | `attempt_packets` has no `updated_at`. | `ON CONFLICT DO NOTHING`. |
| R6R-8 | minor | Swarm-prod writes `graph_*` and `links` too, so the audit would alarm falsely. | Only `items` alarm; the other tables are reported; T1 lists table-level writers. |
| R6R-9 | minor | Secrets Manager ARNs have a suffix; the migrate URL had no source. | `-??????` in the policy; a `prod/plx-brain-migrate` secret; a `migrate only` mark. |
| R6R-10 | minor | Grepping key prefixes on the brain host puts key material there. | Logs copied off and grepped on the operator's machine. |
| R6R-11 | minor | After day 30 the rollback lacked its network path. | The rollback re-adds R5's rules first. |
| R6R-12 | minor | Counts cannot match after the unpause. | Checked at step 5. |

## Round 7 — blind critic on r10

A new critic diffed r10 against r9 and judged the whole of r10: 0 blockers, 4 majors,
9 minors. The author raised R7R-3 to a blocker: R11 added a Caddy edit on the VMC host,
trading's front door, without the trading-safe window, check and rollback that R6 and
R10 carry. r11 applies all 13.

| ID | Sev | Finding | r11 fix |
|---|---|---|---|
| R7R-1 | major | Relation writes create no `items` row, so the audit missed stray relation writes. | `links`/`knowledge_links` rows marked `inferred_link`, and `graph_*` rows not from swarm-prod's extractor, alarm too. |
| R7R-2 | major | The rollback needed the dump but nothing kept it; `brain_t0` lacked extensions; the read role was unstated. | A manual RDS snapshot and an encrypted off-host copy of the dump for 90 days, with SHA-256; `brain_t0` gets R5's extensions; the master reads, `brain_app` writes. |
| R7R-3 | blocker (raised) | R11's Caddy edit had no trading-safe window, check or rollback, and D5/D8 did not list it. | R6's guard applied; D5 and D8(2) list R11. |
| R7R-4 | major | The proxy was under-specified: not shipped or tested, loaded every trading key, added rather than replaced headers, listened everywhere, missing from rollback. | Shipped and tested in R4; exact `GET` path; constant-time token check against a hash; headers overwritten and dropped; only the two keys via `LoadCredential=`; private IP; in R5's rollback. |
| R7R-5 | minor | Port 8901 is the sourcing webhook's default. | A free port from `ss -ltnp`, recorded as `<proxy port>`. |
| R7R-6 | minor | R11's `VMC_API_KEY` probe named no address. | Sent from the VMC host to the brain's private port. |
| R7R-7 | minor | After R11, callers without a brain key stop working; `brn_` was required only from R11. | D4, S6 and R7 say "until R11"; every brain key starts `brn_` from R5. |
| R7R-8 | minor | The rollback could overwrite rows swarm-prod changed after `T`. | Three-way compare; conflicts logged for the operator. |
| R7R-9 | minor | `hygiene_email_digest.py` builds links to a retired page. | Its links are dropped, not moved. |
| R7R-10 | minor | PLX_MC counts only `VMC_API_KEY` as configured. | `vmcApiConfigured()` and the self-check count either key; `integrations.yaml:227-232`. |
| R7R-11 | minor | The client key file was not a guarded touch; 0600 means nothing on Windows. | D8 item 9; a user-only ACL on the Dell. |
| R7R-12 | minor | The `never` test missed `migrate only` names and three new names; the audit URL stayed. | Test extended; names listed; the audit URL deleted at day 30. |
| R7R-13 | minor | The replay ignored R7's pairing and imports a swarm library. | The replay uses R7's pair; `session_artifact_lib` moves with it. |

## Convergence

| Round | Reviewer | Blockers | Majors | Minors |
|---|---|---|---|---|
| 1 | fact-check + blind critic on r4 | 10 | 30 | 18 |
| 2 | blind critic on r5 | 2 | 16 | 7 |
| 3 | blind critic on r6 | 2 | 13 | 5 |
| 4 | blind critic on r7, then a fact-check | 3 | 7 | 7 |
| 5 | blind critic on r8 | 2 (raised) | 5 | 9 |
| 6 | blind critic on r9 | 1 | 5 | 6 |
| 7 | blind critic on r10 | 1 (raised) | 3 | 9 |

The frontier review stopped after three rounds in a row with no blocker. This spec has
not reached that yet. Since round 5 the critics have found one blocker of their own
(R6R-1); every other blocker was raised by the author from a major, most of them in the
previous round's fix. The operator closed the review after round 7 on 28 Sep 2026:
the specs ship as reviewed drafts, and each build phase's own PR review catches the
remaining operating detail.

## Decisions the review changed

- **D5** amended (the brain on its own host) and **D13** added (its own RDS instance).
  The operator confirmed both on 28 Sep 2026.
- **D1, D3, D4, D6, D8** reworded to record facts the review surfaced; their intent is
  unchanged. In r8, **D5 and D8** also list V2's VMC crontab edits, and D8 lists the
  tailnet and security-group touches R5 already made. No new kind of touch was added.
  In r9, D8 adds item (7), one-off VMC-host commands, and **D3's fallback** is amended:
  a caller falls back to `VMC_API_KEY` only while it still calls the old host, and gets
  its brain key with its new base URL. The operator confirmed this on 28 Sep 2026. r10
  refines how (address and key picked as a pair; D8 item 8, the swarm-prod search
  proxy, added); the intent the operator confirmed is unchanged. In r11, D5 and D8 list
  R11's guarded Caddy edit and D8 item 9 (the client key file). The operator confirmed D8 items 8 (the
  swarm-prod search proxy) and 9 (the client key file) on 28 Sep 2026.
