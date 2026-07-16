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

Bottom line: **keep all six as themes; the peer had the right disease, this report sizes the surgery.**
The direction the peer set stood up under scrutiny — what changed is effort and framing, not aim. The
highest-ROI move is a focused observability pass (a thin honesty-oracle v1 in ~2 days; the full,
probe-and-tests version in 3–4), not the multi-day *rebuilds* implied by #3 and #5, which are largely
already built.

> **Revision note (2026-07-16).** This version folds in five corrections from an adversarial review of
> the first draft. They are called out inline with **[rev]** and summarised in §8. Net effect: P1 sized
> honestly (thin-v1 vs full), P2's checkout half downgraded from "possible redesign" to "proof + audit
> field" (the doors already share one core — evidenced below), the §6 exit gate replaced with a
> non-stalling version, the fixture-vs-live check promoted to P1's hard acceptance gate, and the tone
> corrected to credit the peer's direction.

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

6. **The fallback checkout is already subordinate — and already shares one core. [rev]**
   `compliance-checkout.mjs` is `DEFAULT-OFF`, header-labeled "operator-local tooling," and
   `AGENTS.md:97,107` positions it as the fallback "when MCP metadata is missing or mis-scoped." Beyond
   the doc hierarchy, the two server doors **converge on the same verification function**: the MCP door
   `/api/cursor/checkout` → `actionCheckout` (`src/lib/mcp/actions.ts:112`) and the fallback door
   `/api/compliance/checkout` **both call `checkout()` at `src/lib/compliance/service.ts:131`**. The only
   difference is doorway auth — `requireMcpActor` (API key) vs `requireSessionActor` (Entra oid) — each
   resolving an `actor` handed to the identical core, which emits the identical `MC-Checkout` stamp
   verified by the identical downstream gate (`/api/compliance/verify`). So there is **no divergence to
   unify**; the residual work is proof + provenance, not a redesign.

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
| 3 | Collapse agent entry paths to one, deprecate compliance-checkout | **ALREADY SHARES ONE CORE → PROVE + RECORD** [rev] | Verified before scheduling any redesign: both doors already call the same `checkout()` core (`compliance/service.ts:131`; see §3.6). Don't *deprecate* a break-glass path for offline/mis-scoped cases and don't "unify" what is already one. Residual work is a test proving the equivalence + an audit field recording which door ran. |
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

**The load-bearing one is `dataSource: seed | live`. [rev]** It is the sharpest claim and the easiest
to under-deliver: if the oracle reports freshness and cadence but cannot distinguish a fixture-seeded DB
from a Graph-backed mirror, it is still lying — just more politely. The discriminator is concrete and
already computable: **"has any required register ever recorded a completed inbound delta
(`sync_register_freshness`), *and* is a real Graph token acquirable at probe time?"** If neither, the
app is running on `ensureSeeded()` fixtures and self-check must say so in as many words. This is P1's
hard acceptance gate (§6), not a nice-to-have.

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
Each item has a success criterion (per CLAUDE.md: no task without one). Estimates below were corrected
by the adversarial review **[rev]**: P1 is split into a thin v1 and a full version, and P2's checkout
half drops sharply now that the shared core is verified rather than assumed.

### P0 — Correct the architecture table (hours) · Rec #1

- Split `AGENTS.md:36` into two truths: **Sync engine (delta) — current** (outbound push + inbound
  delta on ToDos/Risk/Projects/Roadmap, conflict queue, audit log, freshness API) and **Graph
  change-notifications — deferred (P11)**. Mirror the phrasing already in `docs/modules/sync/README.md`
  and `TOOLS.md:14` (single source of truth for the fact).
- **Success:** the AGENTS.md sync rows and TOOLS.md agree verbatim on maturity; a reviewer reading only
  AGENTS.md cannot conclude the engine is unbuilt.

### P1 — Make self-check the honesty oracle · Recs #2, #4, and the fixture-vs-live gap

Split into a thin v1 and a full version so the honesty win lands fast without waiting on the probe. **[rev]**

**P1a — thin v1 (~2 days).** Extend `actionSelfCheck` (and `GET /api/cursor/self-check`) to report,
read-only, everything computable from local state without a network call: `syncMode`
(`in-app` | `cron` | `off`), `cronConfigured`, `syncEnabled`, `databaseBound`, `lastSweepAgeMs`,
**per-register freshness** by reusing `evaluateSyncFreshness` (`src/lib/sync/freshness.ts`),
`webhooksEnabled:false`, and — the load-bearing field — **`dataSource: seed | live`** derived from
"has any required register recorded a completed inbound delta." Un-hardcode `mcpEnabled`.

**P1b — full (+1–2 days, total 3–4).** Add the live `graphTokenOk` probe (token acquisition +
site/list resolution at probe time, reusing the sweep-start health check) and fold it into `dataSource`
(`live` requires *both* a recorded inbound delta *and* an acquirable token). Add tests that a
fixture-seeded DB reports `seed` and a real inbound sweep flips it to `live`.

- **Hard acceptance gate (blocks P1 "done"):** on a freshly seeded DB the endpoint returns
  `dataSource: "seed"`; after a real inbound delta it returns `"live"`. If it cannot tell the two apart,
  P1 is not done — the oracle is still lying politely.
- **Success:** one GET answers "is the mirror live-or-seed, fresh, and on what cadence" without reading
  logs; the seed→live transition is covered by a test.

### P1 — Cron cadence + labeling cleanup (0.5 day) · Rec #4

- Demote `sync-notifications` from `* * * * *` (every minute) to hourly, or remove it from `vercel.json`
  until P11 — a guaranteed no-op should not consume 1,440 invocations/day. Label both webhook crons
  "deferred (P11)" in `TOOLS.md` and surface `enabled:false` via the self-check `webhooksEnabled` field.
- **Success:** no every-minute no-op cron in `vercel.json`; TOOLS.md and self-check both show the push
  path as deferred, not live.

### P2 — Prove the shared checkout core + record the door (~0.5–1 day) · Rec #3 [rev]

Verified, not assumed: both doors already call `checkout()` at `compliance/service.ts:131` (§3.6), so
this is *not* a redesign. Residual work:

- Add a test asserting `/api/cursor/checkout` and `/api/compliance/checkout` reach the identical core
  with equivalent guarantees (the fallback cannot produce a *less-verified* completion), so a future
  refactor can't silently fork them. Record which door ran in the audit event and expose it on
  self-check. Keep the fallback; add a one-line "fallback path — prefer MCP checkout" banner to its
  output.
- **Success:** a test pins both routes to the shared core; an audit row names the door; no code path can
  stamp `MC-Checkout` without passing `checkout()`.

### P2 — Promote the conflict console to first-class (2–3 days) · Rec #5

- Give `sync-console.tsx` a first-class nav entry; add a fail-closed **staleness banner** driven by the
  freshness API (when required registers are stale, the queue reads "sync stale — resolutions paused"
  rather than silently showing old data); confirm the queue is fed by `repo.openConflicts()` on live
  data and add an integration test that a real inbound conflict (not the seed fixture) appears and
  resolves.
- **Success:** a human can find the queue from the main nav, sees a clear staleness state, and an
  end-to-end test drives a real conflict → resolve → audit.

### P3 — Replace the freeze with an exit gate (policy, zero build) · Rec #6

Instead of "freeze all new planes," define a checkable **"mirror is boring" gate** — and design it so it
*converges* rather than stalling in a small-ops world where conflicts legitimately wait on a human and a
single staging flake would reset a calendar-day streak. **[rev]** No new plane (Knowledge Hub UI,
OpenFlowKit, new MCP transports, swarm expansion) merges until **all** of:

- the self-check schema is green (all honesty fields present and well-formed);
- the AGENTS.md↔TOOLS.md **parity check passes in CI** (below);
- self-check reports `dataSource: live` + fresh for **N consecutive cron ticks** (e.g. 7 ticks, not 7
  calendar days — a tick count can't be reset by an unrelated flake).

The **conflict SLO is a warning, not a hard merge block, until conflict volume actually exists** — a
low-volume queue with items legitimately awaiting a human must not deadlock the gate. Record the gate in
`SOUL.md`/`AGENTS.md` as the entry condition.

- **Success:** the gate is a named, measurable, *terminating* condition tied to self-check output — it
  can actually be reached, not just asserted.

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

---

## 8. Corrections Folded From Adversarial Review [rev]

The first draft was reviewed adversarially; five corrections were folded in. Recording them (per
"Evidence Over Assertion" / the learning loop) so the bundle *is* the corrected backlog:

1. **P1 estimate was optimistic.** The draft's "~2-day observability pass" understated a P1 that
   honestly includes a live Graph token probe, `dataSource` discrimination, and tests. Now split:
   **P1a thin v1 (~2d)** local-only fields incl. `dataSource: seed|live`; **P1b full (+1–2d)** adds the
   token probe. (§6 P1)
2. **The "mirror is boring" gate could stall forever.** A hard "zero conflicts >24h + 7 green calendar
   days" gate deadlocks in low-volume ops and resets on unrelated flakes. Replaced with a *terminating*
   gate: schema-green + parity-in-CI + **N consecutive green cron ticks**, with the **conflict SLO as a
   warning, not a block, until volume exists**. (§6 P3)
3. **Fixture-vs-live was the easiest claim to under-deliver.** Promoted from a nice-to-have to **P1's
   hard acceptance gate**, with a concrete discriminator (recorded inbound delta **and** acquirable
   Graph token → `live`, else `seed`). (§4 unifying insight, §6 P1)
4. **"One checkout core" assumed a possible redesign — it isn't one.** Verified in code: both doors
   already call `checkout()` at `compliance/service.ts:131`. Downgraded from "1–2 days, possibly a
   redesign" to **~0.5–1 day of proof + an audit field**. (§3.6, §4 row 3, §6 P2)
5. **Tone: "peer refuted" was half-true.** The peer's *direction* was right (right disease); only the
   *effort estimates and the #2/#5 build-framing* needed correcting. Framing adjusted throughout so the
   plan is sold as "right disease, corrected surgery," not a refutation.

### Sources (external)

- [Use delta query to track changes — Microsoft Learn](https://learn.microsoft.com/en-us/graph/delta-query-overview)
- [Set up change notifications — Microsoft Learn](https://learn.microsoft.com/en-us/graph/change-notifications-overview)
- [Reduce missing change notifications & removed subscriptions (lifecycle events) — Microsoft Learn](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events)
- [subscription resource type (expiration limits) — Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)
- [Microsoft Graph Webhooks — What, Why, How & Best Practices (Voitanos)](https://www.voitanos.io/blog/microsoft-graph-webhook-delta-query/)
