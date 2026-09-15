# Stage Rail recovery — approved execution spec (Mission Control record)

Recorded September 15, 2026, 03:50 AM ET (07:50 UTC). Owner and evidence replies: Vince Alton. Restricted Hub project PRJ-STAGE-RAIL-TRADING-LAB-S; coordination tasks TASK-1588 (recovery packet) and TASK-1541 (sign page); frozen contract TASK-1540. Mission Control checkout for this bundle: `MC-Checkout: dsp_mu2czw9ydq6waq`.

## Readout

Vince approved the execution spec in [SPEC.md](./SPEC.md) at 07:44 UTC. The receiving agent (Claude Code) owns the broader M1–M9 recovery track. The Codex session keeps the TASK-1689 monitoring rollout. **Recovery stays HOLD / NO-GO.** The spec authorizes engineering and read-only evidence only; hold release, breaker reset, rebalance, backfill, threshold changes, rule promotion, clock start, and legacy retirement each still need a separate signed packet.

## Why now

Read-only probes at 07:22–07:35 UTC found a live blocker. Since 03:05 UTC every B, B+, C and D dispatcher run refuses with a stale-lifecycle error (rules last promoted 2026-06-17; 90-day ceiling) and writes no run row. The daily lifecycle-promote job has failed since at least August 1 on a provenance check constraint. The entry hold keeps this harmless for trading, but it breaks the frozen M2 durability rule and is an M9 silent drop. The external CloudWatch alarm fired at 06:21 UTC and Vince confirmed the email reached his inbox.

Other proven defects: both paper-book rebalances failed on September 1 with a Polygon 429 and July weights remain; the walk-forward campaign has produced no jobs since July 23; the Stage Rail loop driver crashes every 15 minutes on a permission error; XRP 1h has a 24-hour hole on September 9; the equity calendar omits Good Friday.

## Plan shape

Eleven phases, one reviewed PR each, merged in dependency order, every merge re-pinned as a new identity epoch:

1. Evidence spine (ledger, validator, Hub acknowledgment) — done.
2. Durable dispatcher refusal outcomes.
3. Lifecycle-promote durability and the staleness decision packet (option A chosen: keep refused, no threshold change).
4. Market-data coverage audit tool, Good Friday calendar fix, daily-finality contract, up to 10 read-only provider GETs.
5. Paper-book due-cycle durability and bounded 429 handling.
6. Loop-driver and resolver outcome durability.
7. Walk-forward campaign decision durability and M5 diagnosis.
8. M3, M6, M7 evidence packets.
9. M8 operations contract completion.
10. Restore re-pin for the frozen release candidate.
11. 48-hour window packet and extraction-predicate ledger (no clock start).

## Decisions recorded

Spec and model plan approved; stale lifecycle option A; provider evidence up to 10 GETs; Rails re-sync through the restricted Hub note on TASK-1588; alarm email receipt confirmed; VMC DocOps crontab drift routed to Infra as TASK-1698.

## Boundaries

No trading activity is manufactured. No protected rule, cap, weight, threshold, or origin marker changes. The monitoring branch, timers, env, and receipts of TASK-1689 are read-only for this track. Restricted operational evidence (probe payloads, snapshots) stays in the restricted Hub project and the operator evidence directory; this bundle carries the plan only.
