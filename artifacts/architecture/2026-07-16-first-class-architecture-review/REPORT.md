# PLX_MC Architecture Review — Toward a First-Class Design

**Date:** 2026-07-16
**Author:** Architecture review (Claude Code session, branch `claude/plx-mc-architecture-review-w3h2au`)
**Scope:** Validate / enhance / simplify a peer agent's six recommendations, grounded in a codebase
investigation and external research, and turn them into a sequenced project plan.

---

## 1. Verdict

**The peer agent is directionally right and the diagnosis is honest: the gap to "first-class" is
operational honesty and compression, not a rewrite.** But three of its six recommendations describe
work that is *already substantially built* and one rests on a premise the code refutes. Acting on the
recommendations verbatim would spend days rebuilding things that exist (a conflict UI, a chosen sync
cadence) and would *delete correct-shaped scaffolding* for a genuinely hard feature (Graph webhooks).

The sharper framing the six recommendations circle but never name: **the system has no single surface
that tells a human or agent the truth about its own runtime state** — is sync live or seeded from
fixtures, is the mirror fresh, which entry door verified this checkout. Every one of the six is a
symptom of that missing "honesty oracle." Fix that one surface and four of the six collapse into it.

Bottom line: **keep all six as themes, re-weight the effort. The highest-ROI move is a ~2-day
observability pass, not the multi-day builds implied by #3 and #5.**

---

## 2. Method & Evidence Base

- **Internal:** read the canonical docs (`AGENTS.md`, `TOOLS.md`, `SOUL.md`, `docs/modules/sync/README.md`),
  the sync engine (`src/lib/sync/*` — `engine.ts` is 1,372 lines), all six Vercel crons (`vercel.json`,
  `src/app/api/cron/*`), the self-check action (`src/lib/mcp/actions.ts`), the conflict UI
  (`src/components/mc/sync-console.tsx`), the data/store hydration path (`src/lib/mc-data/{store,data}.ts`,
  `src/app/api/state/route.ts`, `src/lib/sync/state.ts`), the fallback checkout (`scripts/compliance-checkout.mjs`),
  and the governance generators (`scripts/generate-governance-surfaces.py`, `scripts/check-brand-portal-parity.py`).
- **External:** Microsoft Graph guidance on change-notifications vs delta query, subscription lifecycle,
  and missed-notification handling (sources in §7).

---

## 3. Ground Truth — What the Codebase Actually Is

The architecture is **more real than AGENTS.md admits and less live than a casual reader assumes** —
and nothing surfaces which.

1. **The sync engine is shipped, not planned.** `docs/modules/sync/README.md` and `TOOLS.md:14`
   describe a two-way Graph mirror shipped 2026-06-11: outbound PATCH on mutation, inbound delta poll,
   a bounded-staleness freshness API (`src/lib/sync/freshness.ts`, fail-closed `sync_stale` with
   per-register `missing_register:*` / `stale_register:*` reasons), an authority matrix (who-wins per
   field), and an audit log. `engine.ts` is 1,372 lines of real reconciliation. **But
   `AGENTS.md:36` still labels the row "Sync engine (planned)".**

2. **The data path is Postgres-backed, fixture-seeded.** `GET /api/state` → `snapshot()`
   (`src/lib/sync/state.ts:51`) reads live from the pg repo (`repo.getEntities`, `repo.openConflicts`,
   `repo.lastSweepAt`). On a fresh DB, `ensureSeeded()` inserts 3 canonical fixture rows
   (`ON CONFLICT DO NOTHING`) so the shell renders. The store (`store.ts`) is optimistic-local-first
   and hydrates from that snapshot. `data.ts:1` self-labels: *"PROTOTYPE FIXTURE … Replaced at the
   sync-engine milestone."* **So the app can be showing live-mirror data or seed data, and no surface
   distinguishes them.**

3. **A conflict-resolution UI already exists.** `sync-console.tsx` renders a "Review queue" with, per
   conflict, the MC value vs the SharePoint value, `resolve(mc)` / `resolve(sp)` buttons, a deep-link
   to the Task, and error rows with retry. The resolve API (`/api/sync/conflicts/[id]/resolve`) is
   session-gated on `sync.mutate`. It reads `repo.openConflicts()` — live DB, not a log.

4. **The sync cadence is already decided.** `TOOLS.md:54-89` ("In-app sync scheduler — dev-only
   enablement") pins the deployed cadence to **Vercel Cron** (`vercel.json` → `/api/cron/sweep`,
   `CRON_SECRET` bearer); the in-app `setInterval` scheduler is dev-only and default-OFF because
   serverless timers are unreliable. This is documented, tested (`tests/sync-scheduler.test.ts`), and
   consistent.

5. **The webhook crons are gated, not fake.** `sync-subscriptions/route.ts` and
   `sync-notifications/route.ts` both check `graphWebhookEnabled() && graphWebhookConfigured()` and
   return `enabled: false` with **zero** work when webhooks aren't configured. They do not fabricate
   freshness. They do, however, run on Vercel Cron regardless — `sync-notifications` **every minute**
   (1,440 guaranteed no-op invocations/day) — and nothing labels them deferred.

6. **The fallback checkout is already subordinate.** `compliance-checkout.mjs` is `DEFAULT-OFF`,
   header-labeled "operator-local tooling," and `AGENTS.md:97,107` positions it as the fallback "when
   MCP metadata is missing or mis-scoped." Commits #145/#146 are actively hardening the MCP checkout
   handshake.

7. **The architecture table is undefended by governance.** `generate-governance-surfaces.py`
   regenerates the `governance:auto` block, but the architecture table (`AGENTS.md:30-37`) sits *above*
   the `governance:auto:start` marker — hand-maintained, covered by no drift gate. That is exactly why
   it drifted to "(planned)."

---

## 4. Recommendation-by-Recommendation Adjudication

| # | Peer recommendation | Verdict | Why |
|---|---|---|---|
| 1 | Kill the sync maturity lie in AGENTS.md | **VALIDATE + ENHANCE** | Real contradiction. But don't just flip "planned→current" — split the row so the *correctness-critical delta engine* reads current and *webhook notifications* read deferred (P11). Then defend it with a parity check so it can't drift again. |
| 2 | One cadence, one kill-switch story + ops panel | **SIMPLIFY** | Cadence is *already chosen and documented* (Vercel Cron deployed, in-app dev-only). Drop that half. Keep and sharpen the observability half — it's the real gap and it subsumes #4 and the fixture-vs-live question. |
| 3 | Collapse agent entry paths to one, deprecate compliance-checkout | **REFRAME** | The hierarchy already exists (MCP primary, compliance-checkout fallback). Don't *deprecate* a break-glass path for offline/mis-scoped cases. Instead guarantee both doors call **one verification core** and self-check records which door ran. |
| 4 | Delete/quarantine dead webhook theater | **SIMPLIFY** | Not theater — the crons are gated and return `enabled:false`. External research confirms webhooks are genuinely hard and the scaffolding is correct-shaped. Fix the *cadence* (kill the every-minute no-op) and *label* them deferred. Keep the code. |
| 5 | Make conflict resolution a product surface, not a log | **LARGELY DONE → PROMOTE** | The screen exists and is live-wired. Reframe to: make it discoverable (nav), prove it shows *real* (not seed) conflicts, and add a fail-closed staleness banner driven by the existing freshness API. |
| 6 | Freeze new planes until the mirror is boring | **ENHANCE** | Sound instinct (aligns with SOUL.md "Simplify Relentlessly"). But a blanket freeze with no unlock condition gets ignored or overstays. Replace with an explicit "mirror is boring" **exit gate** tied to the self-check SLOs from #2. |

### The unifying insight

Recommendations #2, #4, #5, and the fixture-vs-live ambiguity are all **the same missing surface**:
`mc_self_check` today (`actions.ts:30-40`) returns only `ok`, a **hardcoded** `mcpEnabled: true`,
`operator`, `taskCount`, `bucketCount`, `lastSweep`. It cannot answer: *Is sync enabled? Is a cron
secret configured? Is the DB bound? Can we get a Graph token? How old is the last real inbound delta
per register? Are we on live data or seed?* Make self-check answer those, and the "trust failure" the
peer agent worried about is closed at the source rather than in six places.

---

## 5. External Validation — Why the Sequencing Is Defensible

Microsoft's own guidance is that reliable Graph sync is a **hybrid**: change-notifications (push) for
low latency **plus a long-interval delta sweep as the safety net you keep regardless**, because
webhooks have *no guaranteed delivery*, subscriptions expire (≤7 days, ≤1 day with resource data,
min 45 min), require renewal via PATCH `expirationDateTime`, need a `lifecycleNotificationUrl` for
`reauthorizationRequired`, and can silently drop for ~1–1.5 hours.

**Implication:** PLX_MC's shipped 5-minute delta sweep *is the correctness backbone Microsoft says you
must keep* — not a placeholder for webhooks. Deferring webhooks (P11) is a defensible latency-vs-cost
sequencing decision, and the gated subscription/notification crons are the correct shape for when P11
lands. This is why #1 should *elevate* the delta engine (it's the reliable half) and #4 should *keep*
the scaffolding.

---

## 6. Proposed Project Plan

Sequenced by ROI × dependency. Total core effort ≈ **5–8 working days**, front-loaded on trust.
Each item has a success criterion (per CLAUDE.md: no task without one).

### P0 — Correct the architecture table (hours) · Rec #1

- Split `AGENTS.md:36` into two truths: **Sync engine (delta) — current** (outbound push + inbound
  delta on ToDos/Risk/Projects/Roadmap, conflict queue, audit log, freshness API) and **Graph
  change-notifications — deferred (P11)**. Mirror the phrasing already in `docs/modules/sync/README.md`
  and `TOOLS.md:14` (single source of truth for the fact).
- **Success:** the AGENTS.md sync rows and TOOLS.md agree verbatim on maturity; a reviewer reading only
  AGENTS.md cannot conclude the engine is unbuilt.

### P1 — Make self-check the honesty oracle (1–2 days) · Recs #2, #4, and the fixture-vs-live gap

- Extend `actionSelfCheck` (and `GET /api/cursor/self-check`) to report, read-only:
  `syncMode` (`in-app` | `cron` | `off`), `cronConfigured`, `syncEnabled`, `databaseBound`,
  `graphTokenOk` (from the existing sweep-start probe), `lastSweepAgeMs`, and **per-register freshness**
  by reusing `evaluateSyncFreshness` (`src/lib/sync/freshness.ts`) — plus `webhooksEnabled:false` so
  the deferred push path is explicit. Un-hardcode `mcpEnabled`.
- **Success:** one GET answers "is the mirror live and fresh right now, and by what cadence" without
  reading logs; a test asserts a stale/seed state flips the relevant fields.

### P1 — Cron cadence + labeling cleanup (0.5 day) · Rec #4

- Demote `sync-notifications` from `* * * * *` (every minute) to hourly, or remove it from `vercel.json`
  until P11 — a guaranteed no-op should not consume 1,440 invocations/day. Label both webhook crons
  "deferred (P11)" in `TOOLS.md` and surface `enabled:false` via the self-check `webhooksEnabled` field.
- **Success:** no every-minute no-op cron in `vercel.json`; TOOLS.md and self-check both show the push
  path as deferred, not live.

### P2 — One checkout core, two doors (1–2 days) · Rec #3

- Confirm (and, if they diverge, unify) that the MCP checkout path and `compliance-checkout.mjs` call
  the **same** verification function — one core, two front doors — so the fallback cannot produce a
  *less-verified* completion. Record which door ran in the audit event and expose it on self-check.
  Keep the fallback; add a one-line "fallback path — prefer MCP checkout" banner to its output.
- **Success:** a checkout via either door produces byte-identical verification and an audit row naming
  the door; no code path can stamp `MC-Checkout` without passing the shared core.

### P2 — Promote the conflict console to first-class (2–3 days) · Rec #5

- Give `sync-console.tsx` a first-class nav entry; add a fail-closed **staleness banner** driven by the
  freshness API (when required registers are stale, the queue reads "sync stale — resolutions paused"
  rather than silently showing old data); confirm the queue is fed by `repo.openConflicts()` on live
  data and add an integration test that a real inbound conflict (not the seed fixture) appears and
  resolves.
- **Success:** a human can find the queue from the main nav, sees a clear staleness state, and an
  end-to-end test drives a real conflict → resolve → audit.

### P3 — Replace the freeze with an exit gate (policy, zero build) · Rec #6

- Instead of "freeze all new planes," define a checkable **"mirror is boring" gate**: no new plane
  (Knowledge Hub UI, OpenFlowKit, new MCP transports, swarm expansion) merges until self-check has been
  green (fresh, live, cron-configured) for 7 consecutive days **and** zero conflicts sit unattended
  > 24h **and** the AGENTS.md parity check (below) passes. Record it in `SOUL.md`/`AGENTS.md` as the
  entry condition.
- **Success:** the gate is a named, measurable condition tied to self-check output, not a vibe.

### Enforcement — defend the fix (0.5 day) · Enhancement to #1

- Add `scripts/check-arch-parity.py` (reuse the `check-brand-portal-parity.py` pattern; wire into
  `preflight.sh`) asserting the AGENTS.md sync-maturity cell matches the TOOLS.md runtime status.
- **Success:** editing one without the other fails preflight — the "(planned)" drift cannot recur.

---

## 7. What "First-Class" Means Here

First-class is not more planes. It is: **every claim the docs make is enforced by a check, and one
endpoint tells the whole truth about runtime state.** The peer agent's instinct — honesty and
compression over features — is correct. This plan delivers it by *reusing what exists* (the freshness
API, the conflict console, the parity-check pattern, the chosen cadence) instead of rebuilding it, and
by concentrating effort on the single missing surface that four of the six recommendations are really
asking for.

### Sources (external)

- [Use delta query to track changes — Microsoft Learn](https://learn.microsoft.com/en-us/graph/delta-query-overview)
- [Set up change notifications — Microsoft Learn](https://learn.microsoft.com/en-us/graph/change-notifications-overview)
- [Reduce missing change notifications & removed subscriptions (lifecycle events) — Microsoft Learn](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events)
- [subscription resource type (expiration limits) — Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)
- [Microsoft Graph Webhooks — What, Why, How & Best Practices (Voitanos)](https://www.voitanos.io/blog/microsoft-graph-webhook-delta-query/)
