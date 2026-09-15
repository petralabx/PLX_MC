---
project: stage-rail-recovery
created: 2026-09-15T07:36:00Z
status: approved
approved_by: Vince Alton
approved_at: 2026-09-15T07:44:00Z
model_plan:
  planner: claude-fable-5-1
  builder: claude-opus-5
  mechanical: claude-haiku-4-5-20251001
  critic: codex-cli 0.153.4 (OpenAI Codex, read-only exec review; different family from builder)
budget:
  max_parallel_phases: 2
  max_attempts_per_phase: 2
  time_budget_min: 0
---

> Repository copy of the approved execution contract (approved 2026-09-15 07:44 UTC). The operator working copy lives in the gitignored `.orchestrator/stage-rail-recovery/` directory of the execution worktree; restricted operational evidence stays in Hub TASK-1588. Local Windows paths in acceptance commands refer to the operator workstation evidence directory, not to this repository.

# Stage Rail recovery — receiving-agent execution contract

Hub coordination: TASK-1588 (recovery packet) and TASK-1541 (sign page), checkout `MC-Checkout: dsp_mu2czw9ydq6waq` for coordination only. Each engineering phase checks out its own existing Hub task with `repo: petralabx/agentic-swarm` and uses that stamp in its PR body. Restricted project PRJ-STAGE-RAIL-TRADING-LAB-S; evidence stays in the restricted Hub and the local evidence directory `C:\Users\vince\.codex\stage-rail-reliability-20260914\` (VTA working copies, not a system of record).

Frozen contract: TASK-1540 comment mcp-mtum1hnj (CF-v1, AM-v1, FM-v1, R13). This spec never relaxes a threshold, cadence, universe, or gate. Recovery stays HOLD / NO-GO until the frozen matrix passes and Vince records acceptance.

## Mission

Restore Trading Lab Stage Rail as a reliable, observable operating system with truthful evidence. The receiving agent completes the frozen mandatory capabilities M1–M9 by repairing proven defects with the smallest complete change per slice, producing read-only live evidence, and preparing exact operational packets for every action that needs a separate Vince signature. No trading activity is manufactured; no protected rule, cap, weight, or threshold is changed by code.

Evidence baseline: ledger v1 of 2026-09-15 07:22–07:35 UTC (`ledger/2026-09-15T0722Z-evidence-ledger.md`), identity epoch E3 = main 56ead914 on both hosts (VMC BUILD CRMVtblFOOn7fL6S8xRBX).

## Success Criteria

- [ ] SC1 Every hourly B/B+/C/D due dispatch persists a reason-coded terminal `trading_pipeline_runs` row within 10 minutes, including refusals (stale lifecycle, missing lifecycle, stale market data, held entries). Live-observed over 24 consecutive natural hours after deploy, no manufactured runs.
- [ ] SC2 The daily lifecycle-promote job and the 15-minute Stage Rail loop driver persist a durable outcome (success or reason-coded failure); neither performs a promotion or protected-state change as part of this project.
- [ ] SC3 A read-only coverage audit tool reports, for all 28 pairs, expected closed-bar denominator, actual rows, missing intervals, exclusions, and OHLCV quality for 90-day and 730-day windows, with the calendar reconciled to official sessions (including Good Friday) and a pinned daily-finality contract. Its live output is recorded in TASK-1588 with observation time and epoch.
- [ ] SC4 Both paper books persist a reason-coded due-cycle outcome for every monthly and daily due event; Polygon 429/5xx failures are bounded, logged without secrets, and never crash the run; the review job no longer crashes. The missed August/September cycles have a signed remediation packet (no forced rebalance by this project).
- [ ] SC5 The WF campaign route persists its per-fire decision (enabled/skipped/enqueued with reasons); the M5 blocker is diagnosed with evidence and either repaired (code defect) or handed to Vince as an exact decision packet.
- [ ] SC6 M3, M6, M7, M8 evidence packets exist with owner, observation time, epoch, and explicit unknowns; orphan-watchdog ticks leave a durable outcome; the external observer chain (Lambda → CloudWatch → SNS → inbox) has receipt evidence or an explicit gap.
- [ ] SC7 Restoration artifacts are re-pinned and rehearsed for the frozen release candidate (isolated boot/import/test proofs), with S3 retention stated.
- [ ] SC8 A P1 48-hour window packet and an extraction-predicate ledger exist for Vince signature; no clock is started by this project.
- [ ] SC9 Every merged PR carried focused failing-then-passing tests, canonical pre-commit and pre-push gates, a `## Rollback Plan`, the correct Hub stamp, and a post-merge deploy verification with new epoch pins recorded in TASK-1588.

## Scope

- In: dispatcher refusal durability; lifecycle-promote and loop-driver outcome durability; market-data coverage audit tooling and calendar reconciliation; paper-book due-cycle durability and 429 handling; WF campaign decision durability and diagnosis; evidence packets for M3/M6/M7/M8; restore re-pin; P1 window and extraction packets; ledger refreshes after every epoch change.
- Non-goals: entry-hold release; breaker reset; forced dispatch, seeded positions, or induced trips; ingest/backfill/rebalance execution; any change to `TRADING_V2_DISPATCHER_MAX_RULE_AGE_DAYS`, freshness ceilings, caps, weights, rules, or origin markers; rule promotion or `promoted_at` refresh; updater pause; legacy :3101 retirement; automatic `--apply` reconciliation; acceptance-clock start; edits to the TASK-1689 monitoring branch, timers, env, or receipts; provider purchase or key rotation; optional optimizer/B+ gate work.

## Live blocker driving phase order

At 03:05 UTC on September 15 all four dispatcher lanes began refusing every hourly run with `STALE LIFECYCLE` (max `promoted_at` 2026-06-17T02:40:14Z, 90-day threshold) and exit before creating a run row. Zero durable rows exist since 02:12Z. The daily lifecycle-promote job has failed since at least August 1 on a provenance check constraint, so `promoted_at` never refreshed. The entry hold made this harmless for trading but it violates M2 (no durable outcome) and M9 (silent drop). P2 and P3 come first for that reason.

## Phases

### P1 — Evidence spine and coordination
- deliverables: ledger v1 (done 07:35Z), `ledger.json` + validator, Hub acknowledgment on TASK-1588, probe scripts with unique names in the evidence directory, epoch table. Refreshed after every merge (E4, E5, …).
- depends_on: []
- owns: [".orchestrator/stage-rail-recovery/**"]
- forbidden: ["scripts/**", "apps/**", "src/**", "config/**", "systemd/**", "tests/**"]
- acceptance: `python C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/validate_ledger.py C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/ledger.json --max-age-hours 24`
- role: mechanical
- competitive: false

### P2 — Durable dispatcher refusal outcomes (M2, defect D1)
- deliverables: `paper_dispatcher.py` creates the run row before the lifecycle freshness gate and, on `RuleLifecycleStaleError` (stale or missing lifecycle), persists a terminal row `status='error'`, `error='stale_lifecycle: …'`, `summary.no_work_reason='stale_lifecycle'`, `summary.lifecycle={promoted_at, age_days, threshold_days}` through the existing owner-fenced `_fail_run`/`_complete_run` path; exit code 2 unchanged; threshold unchanged; same treatment for the missing-lifecycle refusal. Regression test that fails on current main (no row) and passes after; PostgreSQL journey in `tests/journeys/stage_rail/`; runbook and module README paragraph; PR with `## Rollback Plan` (revert the commit; refusal returns to log-only).
- depends_on: [P1]
- owns: ["scripts/trading-research/paper_dispatcher.py", "tests/test_paper_dispatcher_freshness.py", "tests/journeys/stage_rail/test_dispatcher_stale_lifecycle.py", "docs/runbooks/dispatcher-run-lifecycle.md", "docs/modules/trading-v2/README.md"]
- forbidden: ["scripts/trading-research/stream_registry.py", "scripts/trading-research/entry_admission.py", "scripts/trading-research/exit_monitor.py", "scripts/trading-research/aggregate_risk.py", "scripts/trading-research/dispatcher_monitor.py", "scripts/trading-research/dispatcher_lifecycle.py", "apps/**", "config/**", "systemd/**", "src/**"]
- acceptance: `bash -lc 'export ANTHROPIC_API_KEY=test-key; python -m pytest tests/test_paper_dispatcher_freshness.py tests/journeys/stage_rail/test_dispatcher_stale_lifecycle.py tests/journeys/stage_rail/test_dispatcher_lifecycle.py tests/journeys/stage_rail/test_dispatcher_transactions.py -q --override-ini=addopts= && ./scripts/wterm-preflight.sh --mode pre-commit'`
- role: builder
- competitive: false

### P3 — Lifecycle-promote durability and staleness decision packet (M2/M9, defect D4, condition C1)
- deliverables: `rule_lifecycle_manager.py` persists a `trading_pipeline_runs` row (pipeline `rule-lifecycle-promote`) with reason-coded outcome, including `source_fingerprint_missing` when a passer lacks provenance (the check constraint stays; no empty-fingerprint promotion path is added); the `run_lock()` pre-step call is corrected to the current signature in report-only form or explicitly disabled with a durable reason; the job performs no promotion in this project (dry-run parity test proves no `promoted_at` write). Decision packet on the stale lifecycle recording Vince's option A (keep dispatch refused until a governed re-promotion; no threshold change) and documenting option B (signed one-time re-attestation of the existing 28 rows, a protected-state change) and option C (threshold change; contrary to the frozen contract) as reference only, with exact commands, preconditions, rollback, expiry for the governed path.
- depends_on: [P2]
- owns: ["scripts/trading-research/rule_lifecycle_manager.py", "tests/test_rule_lifecycle_from_regate.py", "tests/journeys/stage_rail/test_lifecycle_promote_outcome.py", "docs/runbooks/dispatcher-run-lifecycle.md", "docs/modules/trading-v2/README.md", ".orchestrator/stage-rail-recovery/P3/**"]
- forbidden: ["scripts/trading-research/paper_dispatcher.py", "apps/vmc-web/src/lib/vmc/db/migrations/**", "scripts/trading-research/lock_stale_rules.py", "config/**", "systemd/**"]
- acceptance: `bash -lc 'export ANTHROPIC_API_KEY=test-key; python -m pytest tests/test_rule_lifecycle_from_regate.py tests/journeys/stage_rail/test_lifecycle_promote_outcome.py -q --override-ini=addopts= && ./scripts/wterm-preflight.sh --mode pre-commit'`
- role: builder
- competitive: false

### P4 — M1 coverage audit tool, calendar reconciliation, finality contract
- deliverables: `scripts/trading-research/market_data_coverage_audit.py` (read-only transaction; expected closed-bar grid from `market_calendar` sessions: crypto 24/7, FX Sun 17:00–Fri 17:00 ET with DST, SPY regular sessions with holidays and early closes; 90-day and 730-day windows; missing intervals, exclusions, duplicates, OHLCV coherence, late-arrival convergence; JSON output); `market_calendar.py` and the TypeScript mirror `market-data-freshness.ts` gain Good Friday and stay in sync (parity test); daily-finality contract pinned in `docs/modules/trading-v2/README.md` (crypto/FX daily keyed 00:00Z, SPY daily keyed 04:00Z, finality after first eligible next-day ingest + 35m). Bounded provider evidence for the XRP 2026-09-09 hole and GBP gaps, approved by Vince on 2026-09-15: at most 10 read-only GETs through the TRADINGBOX loader credential via SSM, request IDs recorded, no bars written. First live run recorded in TASK-1588.
- depends_on: [P1]
- owns: ["scripts/trading-research/market_data_coverage_audit.py", "scripts/trading-research/market_calendar.py", "apps/vmc-web/src/lib/vmc/trading-v2/market-data-freshness.ts", "apps/vmc-web/src/lib/vmc/__tests__/trading-v2-market-data-freshness-contracts.test.ts", "tests/test_market_calendar.py", "tests/test_market_data_coverage_audit.py", "tests/journeys/stage_rail/test_watermark_freshness.py", "docs/modules/trading-v2/README.md", "docs/runbooks/stage-rail-journey-pack.md", "apps/vmc-web/src/lib/vmc/projects/project-seeds.ts"]
- forbidden: ["scripts/trading-research/polygon_ingest.py", "scripts/trading-research/paper_dispatcher.py", "scripts/trading-research/exit_monitor.py", "scripts/trading-research/entry_admission.py", "config/**", "systemd/**"]
- acceptance: `bash -lc 'export ANTHROPIC_API_KEY=test-key; python -m pytest tests/test_market_calendar.py tests/test_market_data_coverage_audit.py tests/journeys/stage_rail/test_watermark_freshness.py -q --override-ini=addopts= && (cd apps/vmc-web && node --import tsx --test src/lib/vmc/__tests__/trading-v2-market-data-freshness-contracts.test.ts) && ./scripts/wterm-preflight.sh --mode pre-commit'`
- role: builder
- competitive: false

### P5 — Paper-book due-cycle durability and 429 handling (M4, defects D2, D3)
- deliverables: `momentum_paper_book.py`, `tsmom_paper_book.py`, `paper_book_nav_mark.py` share a bounded Polygon fetch helper (at most 3 attempts, Retry-After honored, 120-second budget, no URL or key in logs; mirrors `polygon_ingest.py` semantics); every monthly and daily due run persists an append-only ledger row `metadata.kind='due_cycle_outcome'` with outcome `persisted | idempotent_skip | halted | admission_held | provider_error | error` and reason (never containing the `rebalance_month` key, so idempotency is untouched); `momentum_book_review.py` filters rebalance rows before reading `rebalance_month`. Remediation packet for the missed 2026-08 and 2026-09 cycles (options, exact commands, preconditions under the entry hold, rollback) — no rebalance executed.
- depends_on: [P1]
- owns: ["scripts/trading-research/momentum_paper_book.py", "scripts/trading-research/tsmom_paper_book.py", "scripts/trading-research/paper_book_nav_mark.py", "scripts/trading-research/paper_book_provider.py", "scripts/trading-research/momentum_book_review.py", "tests/test_momentum_paper_book.py", "tests/test_paper_book_nav_mark.py", "tests/test_paper_book_rebalance_month.py", "tests/test_paper_book_provider.py", "tests/journeys/stage_rail/test_book_due_cycle_outcome.py", "docs/runbooks/trading-v2-momentum-etf-paper-book.md", "docs/modules/trading-v2/README.md", ".orchestrator/stage-rail-recovery/P5/**"]
- forbidden: ["scripts/trading-research/paper_book_drawdown_guard.py", "scripts/trading-research/entry_admission.py", "scripts/trading-research/paper_dispatcher.py", "config/**", "systemd/**", "apps/**"]
- acceptance: `bash -lc 'export ANTHROPIC_API_KEY=test-key; python -m pytest tests/test_momentum_paper_book.py tests/test_paper_book_nav_mark.py tests/test_paper_book_rebalance_month.py tests/test_paper_book_provider.py tests/journeys/stage_rail/test_book_due_cycle_outcome.py tests/journeys/stage_rail/test_entry_admission.py -q --override-ini=addopts= && ./scripts/wterm-preflight.sh --mode pre-commit'`
- role: builder
- competitive: false

### P6 — Loop-driver and resolver outcome durability (M8/M9, defect D5)
- deliverables: `stage_rail_loop.py` writes its attempts file to a writable operator path (existing `STAGE_RAIL_REPORT_DIR` convention) and fails visibly with a durable reason-coded outcome when it cannot; `research_signal_scheduler.py` resolver tracebacks are classified and persisted as reason-coded outcomes; tests reproduce the PermissionError path on a read-only fixture directory.
- depends_on: [P1]
- owns: ["scripts/trading-research/stage_rail_loop.py", "scripts/trading-research/research_signal_scheduler.py", "tests/test_stage_rail_loop.py", "tests/test_research_signal_scheduler.py", "docs/runbooks/trading-lab-loop-launch.md", "docs/modules/trading-v2/README.md"]
- forbidden: ["scripts/trading-research/paper_dispatcher.py", "scripts/trading-research/rule_candidate_compiler.py", "config/**", "systemd/**", "apps/**"]
- acceptance: `bash -lc 'export ANTHROPIC_API_KEY=test-key; python -m pytest tests/test_stage_rail_loop.py tests/test_research_signal_scheduler.py -q --override-ini=addopts= && ./scripts/wterm-preflight.sh --mode pre-commit'`
- role: builder
- competitive: false

### P7 — WF campaign decision durability and M5 diagnosis
- deliverables: the cron route `trading-v2-wf-campaign` persists each fire's decision (`enabled`, `skipped` reasons, `enqueued`, plan fingerprints) to a durable table or `cron_executions` row; a diagnosis packet states why no WF job has been created since 2026-07-23 (flag, staleness bucket, worker admission, or code defect) with exact evidence; the scheduler timezone is documented as 03:15 UTC Mon/Thu (TZ prefix is not honored by cron) and the frozen deadline is measured from that actual fire; a code defect is repaired in this phase only when proven by a failing test; anything needing a flag or worker change goes to Vince as a packet.
- depends_on: [P1]
- owns: ["apps/vmc-web/src/app/api/cron/trading-v2-wf-campaign/route.ts", "apps/vmc-web/src/lib/vmc/trading-v2/trading-v2-wf-campaign*.ts", "apps/vmc-web/src/lib/vmc/__tests__/routes/trading-v2-wf-campaign*.test.ts", "config/vmc-web-crontab", "docs/runbooks/wf-campaign-stage2-hardening.md", "docs/modules/trading-v2/README.md", "apps/vmc-web/src/lib/vmc/projects/project-seeds.ts", ".orchestrator/stage-rail-recovery/P7/**"]
- forbidden: ["apps/vmc-web/src/lib/vmc/trading-v2/*stage2*", "apps/vmc-web/src/lib/vmc/trading-v2/*authority*", "apps/vmc-web/src/app/api/cron/trading-v2-wf-stage2-watchdog/**", "scripts/trading-research/**", "systemd/**"]
- acceptance: `bash -lc 'cd apps/vmc-web && npm run typecheck && node --import tsx --test src/lib/vmc/__tests__/routes/trading-v2-wf-campaign*.test.ts && cd ../.. && ./scripts/wterm-preflight.sh --mode pre-commit'`
- role: builder
- competitive: false

### P8 — M3, M6, M7 evidence packets
- deliverables: read-only probe scripts (evidence directory, unique names) and Hub packets for: protective cadence and C/D isolation (M3) with a signed live-exercise design that seeds nothing; R8 attribution for the historical 137 exits and the empty 60-day denominator (M6); regate validity, idempotency replay, and B+ unsupported visibility (M7); storage→API agreement through key-authenticated routes and an operator UI confirmation step. Each packet lists owner, observation time, epoch, unknowns.
- depends_on: [P2]
- owns: [".orchestrator/stage-rail-recovery/P8/**"]
- forbidden: ["scripts/**", "apps/**", "src/**", "config/**", "systemd/**", "tests/**"]
- acceptance: `python C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/validate_ledger.py C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/ledger.json --max-age-hours 24`
- role: planner
- competitive: false

### P9 — M8 operations contract completion
- deliverables: durable `cron_executions` outcome for the orphan watchdog tick (parity with the freshness watchdog); consumption of the TASK-1689 rollout receipt (read only; no edits to monitor code, units, env, or receipts); alert-receipt evidence for the 06:21Z CloudWatch alarm email (Vince confirmed receipt on 2026-09-15; record it with the alarm timestamps); debounce/one-in-flight proof consumed from TASK-1689 tests or added as read-only contract tests; the VMC DocOps crontab drift is Infra's TASK-1698, not changed here.
- depends_on: [P2, P6]
- owns: ["apps/vmc-web/src/app/api/cron/trading-v2-orphan-watchdog/route.ts", "apps/vmc-web/src/lib/vmc/trading-v2/trading-v2-orphan-watchdog-store.ts", "apps/vmc-web/src/lib/vmc/__tests__/trading-v2-orphan-watchdog-contracts.test.ts", "docs/runbooks/trading-v2-orphan-watchdog.md", "apps/vmc-web/src/lib/vmc/projects/project-seeds.ts", ".orchestrator/stage-rail-recovery/P9/**"]
- forbidden: ["scripts/trading-research/dispatcher_monitor.py", "systemd/**", "config/**", "apps/vmc-web/src/lib/vmc/trading-v2/market-data-freshness*.ts"]
- acceptance: `bash -lc 'cd apps/vmc-web && npm run typecheck && node --import tsx --test src/lib/vmc/__tests__/trading-v2-orphan-watchdog-contracts.test.ts && cd ../.. && ./scripts/wterm-preflight.sh --mode pre-commit'`
- role: builder
- competitive: false

### P10 — Restore re-pin for the frozen candidate
- deliverables: after the last code phase merges and deploys, capture hash-bound API (build + source + Node), dependency supplement, and worker archives from the executing hosts under `/var/tmp/task1588-restore-<date>/` with immutable flags, copy create-only to `plx-tradingbox-forensics/task1588/<date>/`, verify SHA256 after download, rehearse isolated boot (`/health` 200), import, and focused tests as on September 14; state S3 expiry and renewal owner in TASK-1588. No production restart or deploy.
- depends_on: [P2, P3, P4, P5, P6, P7, P9]
- owns: [".orchestrator/stage-rail-recovery/P10/**"]
- forbidden: ["scripts/**", "apps/**", "src/**", "config/**", "systemd/**", "tests/**"]
- acceptance: `python C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/validate_ledger.py C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/ledger.json --max-age-hours 24`
- role: planner
- competitive: false

### P11 — P1 48-hour window packet and extraction-predicate ledger
- deliverables: exact packet for Vince signature: candidate identity pins (source, BUILD, config, schema hashes), observers (TASK-1689 timers, Lambda alarm, freshness watchdog, 15-minute read-only sampler with 192 intervals / 193 endpoints), due-event checklist for every cadence in AM-v1, invalidation rules (deploy epoch change, unknown/stale evidence, protected-state change), updater-control decision (merge freeze versus updater pause), abort and restart criteria, owner and window. Extraction-predicate ledger covering P1_48h, M1–M9, P4A checks (TASK-1546/1577), and the required Vince acknowledgment. No clock is started.
- depends_on: [P8, P10]
- owns: [".orchestrator/stage-rail-recovery/P11/**"]
- forbidden: ["scripts/**", "apps/**", "src/**", "config/**", "systemd/**", "tests/**"]
- acceptance: `python C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/validate_ledger.py C:/Users/vince/.codex/stage-rail-reliability-20260914/ledger/ledger.json --max-age-hours 24`
- role: planner
- competitive: false

## Risks & Rollback

- Automatic deploy on merge (Deploy VMC) and TRADINGBOX self-update mean every merge opens a new identity epoch on production. Mitigation: one PR per phase, merges sequenced (P2 first), post-merge pins recorded in TASK-1588, no merges during a future 48-hour window. Rollback: reviewed revert PR per phase; the entry hold, exits, NAV marks, and watchdogs are untouched by any phase.
- P2 changes when the run row is created. If the DB is unreachable the refusal stays log-only (unchanged behavior); tests must prove that a stale lifecycle never triggers execution and that the terminal row is written by the owning session only.
- P3 must not add a promotion path. A dry-run parity test proves zero `promoted_at` writes; the provenance constraint remains the authority.
- P4 touches the TypeScript watchdog mirror (VMC product surface): risk:high classification, delivery-closeout gate (project seeds), and `## Rollback Plan` naming the calendar change. Adding Good Friday can only reduce false-stale pages.
- P5 adds ledger rows of a new kind. The idempotency key `metadata.rebalance_month` is never written by outcome rows; a test asserts the monthly idempotency check ignores them.
- P7 may prove that M5 needs a flag or worker change. That is a Vince decision packet, not a code change in this project.
- Monitoring branch collision: TASK-1689 files (`dispatcher_monitor.py`, `systemd/stage-rail-*`, `/etc/stage-rail-monitor.env`, receipts) are forbidden in every phase until the Codex session posts its receipt; after that they remain read-only for this project.
- Hard stops: acceptance failure twice in one phase, any scope violation reaching a PR, credential or Hub checkout failure, an unexplained protected-state change in any snapshot, or a new deploy epoch during a phase's live observation. Each writes `BLOCKER.md` and pauses for Vince.

## Worktree Plan

- base branch: `proj/stage-rail-recovery` is not used; every phase branches from freshly fetched `petralabx/main` in its own WSL Ubuntu clone `/home/vince/stage-rail-recovery-<phase>` (never the monitoring checkout `/home/vince/stage-rail-no-work`), with a disposable PostgreSQL 18 cluster per phase on a unique local port and `STAGE_RAIL_TEST_DSN` pointing only at it.
- phase branches: `codex/stage-rail-recovery-<phase>-<slug>` (repository convention), one reviewed PR each, merge commits only, `## Rollback Plan` present, PR body carries that phase's Hub stamp.
- integration branch: none. Deviation from the skill default is deliberate: the repository's compliance gate binds each PR to one Hub checkout and risk classification, and every merge auto-deploys to production consumers, so batching phases into one integration PR would create one large untracked deploy epoch.
- delivery: per-phase PRs merged in dependency order; ledger refreshed and pins recorded in TASK-1588 after each deploy; hardening pass (`project-hardener`) runs per phase branch before its PR opens.
- gates before commit/push: `./scripts/wterm-preflight.sh --mode pre-commit` and `--mode pre-push`; skipped tests reported separately.

## Approval record and decisions

Vince Alton approved this spec and the model plan in the Claude Code session on September 15, 2026 at 03:44 AM ET (07:44 UTC), with these decisions:

1. Spec and model plan: approved as written.
2. Stale lifecycle: option A. Keep dispatch refused until a governed re-promotion, make the refusal durable (P2), no threshold change. Options B and C stay documented in the P3 packet as reference only.
3. Provider evidence: up to 10 read-only Polygon GETs through the existing TRADINGBOX credential are allowed for the XRP and GBP gaps (P4). No bars are written.
4. Rails re-sync: the restricted Hub note on TASK-1588 is the channel. Rails is the Mission Control steward and reads that task; no other message is sent.
5. M8 alert receipt: Vince confirmed the CloudWatch dispatcher alarm email of 02:21 AM ET reached his inbox. This is the receipt evidence for the external observer chain.
6. VMC DocOps crontab drift: routed to Infra as Hub task TASK-1698 (bucket BKT-INFRA). Not changed by this project.

Everything else in this spec remains gated: hold release, breaker reset, rebalance, backfill, threshold changes, promotions, clock start, and legacy retirement each need a separate signed packet.
