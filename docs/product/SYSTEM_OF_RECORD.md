# PLX MC as the Enforced System of Record — Build Spec (EN‑007)

> **Status:** build-ready spec (resolves EN‑007). Scope + the 15 aligned decisions
> live in `docs/product/enhancements/README.md` (EN‑007). This doc turns those
> decisions into a phased, testable implementation.
>
> **Builds on (reuse, do not duplicate):** EN‑002 repo allow‑list
> (`src/lib/mc-data/repos.ts`), EN‑003 accountability + evidence gate
> (`src/lib/mc-data/policy.ts`), EN‑006 sync engine (`src/lib/sync/*` — audit log,
> push‑error/sweep, conflict queue), and `docs/product/SHAREPOINT_INTEGRATION.md`.

## 1. Mission & success criteria

Make PLX MC the **enforced, self‑authorizing, automatically‑maintained database of
project record** for the company. Every change to a tracked repo resolves to
governed MC work; agents are gated, operators are recorded; MC keeps itself current
from git; the canonical record is a first‑class event log that doubles as the
Second‑Brain substrate.

**Success criteria (measurable):**

1. 100% of merged PRs on enrolled repos are linked to an MC task.
2. An **agent** PR cannot merge unless its task carries a complete, tier‑appropriate
   bundle (rollback + PRD + change‑appropriate evidence).
3. An **operator** PR with no task auto‑creates a sparse task (recorded, ungated).
4. MC unreachable ⇒ **no compliance bypass**: checks hold (pending), work queues and
   reconciles on recovery; break‑glass is audited.
5. Every governed action emits an append‑only, typed **event**; the log is
   exportable and replayable.

## 2. Actors & identity (decision 9, 14)

Identity is the **checkout credential**, resolved server‑side — never the git author
(Cursor/Claude commit as the human and spawn ephemeral sub‑agents).

| Actor | Authenticates via | Bundle gate | Accountable owner |
|---|---|---|---|
| **Operator** | Human SSO | No (optional detail) | Self |
| **Agent run** | MC‑minted **per‑dispatch token** | Yes (tier‑appropriate) | Dispatching human (decision 7) |
| **Sub‑agent** | Inherits parent run's token | Yes (via parent task) | Same as parent |

**Dispatch ledger** (the "registry" — credentials, not personas):
`token → task → accountable human → repo → issued/expires/revoked`.

**Gate decision table** (resolved from the ledger + PR link, not git metadata):

| PR linked to a checked‑out task? | Resolved actor | Action |
|---|---|---|
| Yes, agent token | agent | enforce tier bundle ⇒ pass/block |
| Yes, human SSO | operator | pass (recorded) |
| No checkout | operator (default) | auto‑create sparse task ⇒ pass |
| No checkout, repo policy = strict | — | require task link ⇒ one‑click sparse |

**Anti‑spoofing:** a human cannot forge an agent token; autonomous/cloud/swarm
agents have no keyboard, so they *must* use the token path to act; the only escape
(a human hand‑committing AI output without checkout) is operator‑accountable work
under their own name — acceptable.

## 3. Domain model (extend existing types — `src/lib/mc-data/types.ts`)

Most of the bundle already exists on `Evidence`; we extend rather than invent.

```ts
// EXTEND Evidence (already has summary, items, shots, qa, rollback):
//   - shots  → screenshots (UI changes)
//   - qa     → test results (backend/logic changes)
//   - rollback → rollback plan (string today; keep, formalize per tier)
// ADD:
type RiskTier = "low" | "standard" | "high";

interface Task {
  // ...existing...
  riskTier?: RiskTier;        // derived at PR time; overridable by an approver
  checkoutId?: string;        // links the task to the dispatch ledger entry
  // evidence.rollback / evidence.shots / evidence.qa carry the bundle (reuse)
}

// Bucket.prd already exists (per-bucket PRD — decision 12). Prd type exists.

// Dispatch ledger (new — server side):
interface Dispatch {
  id: string;                 // = checkoutId
  actorKind: "agent" | "operator";
  runtime: string;            // "cursor-cloud" | "cursor-local" | "swarm" | ...
  taskId: string;
  accountableHuman: string;   // dispatching operator (decision 7)
  repo: string;
  issuedTs: string;
  expiresTs: string;
  revoked: boolean;
}

// Compliance check record (new — server side):
interface ComplianceCheck {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  taskId: string | null;
  actorKind: "agent" | "operator";
  verdict: "pass" | "block" | "pending";
  reasons: string[];
  queuedTs: string;
  resolvedTs?: string;
}
```

**Persistence:** new migration `db/migrations/005_compliance.sql` (next serialized
prefix after `004_entity_mirror.sql`) adds `mc_dispatch`, `mc_compliance_check`, and
the event log (§7). Idempotent INSERTs, parameterized SQL, numbered‑migration runner
(governance Database Safety rules).

## 4. Risk tiering (decision 12)

Tier is derived from the change, overridable by an approver:

| Tier | Triggers (any) | Required bundle |
|---|---|---|
| **high** | DB migration touched, prod deploy, auth/permissions, infra, external‑integration change | rollback plan **+** PRD (bucket) **+** change‑appropriate evidence |
| **standard** | feature / bug fix (default code change) | evidence **+** rollback note |
| **low** | docs / chore / test‑only | minimal evidence (link/summary) |

Triggers are computed from changed paths + labels (e.g. `db/migrations/**`,
`**/auth/**`, `infra/**`, presence of an External Integrations declaration). The
classifier is a **pure function** (`classifyRiskTier(changedPaths, labels)`),
unit‑tested against fixtures.

## 5. The gate (decision 2, 3) — verification + checkout APIs

All routes use the shared wrapper `src/lib/api/route.ts` (`route()` + `parseBody()`,
Zod on mutations, `{ data } | { error }` envelope).

| Route | Purpose |
|---|---|
| `POST /api/compliance/checkout` | Mint a dispatch token, claim a task (reference VMC's checkout loop; no runtime coupling). |
| `POST /api/compliance/complete` | Attach/refresh the bundle (evidence/rollback/PRD link) + promotion stage. |
| `POST /api/compliance/verify` | The status‑check brain: `{repo, prNumber, headSha}` → `{verdict, reasons}`. |
| `POST /api/compliance/webhook` | GitHub App webhook (signed) — git → MC ingestion (§6). |
| `GET  /api/events` | Append‑only event export (§7), keyset‑paginated. |

**Core verifier is pure + testable** (no I/O), wrapped by the route:

```ts
function verifyCompliance(input: {
  task: Task | null;
  dispatch: Dispatch | null;
  changedPaths: string[];
  labels: string[];
}): { verdict: "pass" | "block"; reasons: string[] };
```

It reuses `policy.ts`: `stageAdvanceViolation` already blocks done‑stages without a
complete `evidence` bundle and requires a human accountable owner — we extend it with
the tier‑appropriate bundle check (`evidenceCompleteForTier(evidence, tier)`).

**The GitHub status check** (one uniform reusable workflow / GitHub App, decision 11)
calls `/api/compliance/verify` and posts a required status. Per‑repo `soft` (warn) vs
`hard` (block) flag.

## 6. Git → MC ingestion (decision 8) — auto‑maintained record

GitHub App webhook → `/api/compliance/webhook` (HMAC‑verified):

| Event | MC action |
|---|---|
| `pull_request.opened` / `.synchronize` | attach/create task link; move stage → `progress`; run verify; post status |
| `pull_request.closed` (merged) | promote task → `merged`; attach `merge: {sha, on}` (existing `Task.merge`); emit event |
| operator PR, no task | auto‑create **sparse** task (accountable = PR author); link |

**Reconciliation (decision 10):** reuse the sync engine's queue + sweep
(`src/lib/sync/engine.ts runSweep`, push‑error/conflict tables). While MC is
unreachable, CI checks stay **pending**; inbound webhook deliveries + outbound
verification requests queue durably and **auto‑resolve on recovery** + a periodic
reconciliation sweep re‑scans recent PRs. **Break‑glass:** a named role
(owner/admin) overrides a held PR → MC records a **debt event** and auto‑creates a
reconciliation task; bounded pending window then escalates.

## 7. First‑class event log / Second‑Brain substrate (decision 13)

The canonical record is an **append‑only, typed event log** — a generalization of the
existing sync audit log (migration `003_audit_log.sql`, `appendAudit`/`auditRows` in
`src/lib/sync/repo.ts`). Migration `005` introduces `mc_events` as the superset; sync
audit entries become one `kind` among many.

```sql
-- mc_events (append-only; no UPDATE/DELETE — enforced by convention + a guard)
seq        BIGSERIAL PRIMARY KEY,   -- monotonic, the export cursor
ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
kind       TEXT NOT NULL,           -- task.created | pr.opened | gate.blocked | breakglass | ...
actor      TEXT NOT NULL,           -- human id or agent runtime
repo       TEXT, task_id TEXT, pr   TEXT,
payload    JSONB NOT NULL
```

- **Export:** `GET /api/events?after=<seq>` (keyset pagination) — clean, replayable.
- **Stream:** SSE/webhook fan‑out (Phase 5).
- **Retrieval/embedding‑ready:** stable typed schema so a downstream embedder/index
  can consume the stream without scraping app tables. The log *is* the record — the
  Second Brain reads it; it is not a side table. (Open item resolved: extend the
  audit log into `mc_events`; embedding feed lands in Phase 5.)

**Consumer contract (shipped):** `GET /api/events?after=<seq>&limit=<n>&kind=<kind>`
returns `{ data: { events, nextCursor } }`. Pagination is **keyset** on the
monotonic `seq` — a consumer pages forward with `after=<nextCursor>` until
`nextCursor` is null, and never misses or double-reads an event (append-only ⇒
replayable). `limit` is clamped to 500; `kind` optionally filters to one event type
(e.g. `gate.blocked`, `pr.merged`). Each event is `{ seq, ts, kind, actor, repo,
taskId, pr, payload }`. The Second-Brain feed is exactly this stream; the embedding/
index build (P5) consumes it without new coupling.

## 8. External Integrations declaration (governance‑required)

The GitHub App is a new external provider — declared per the governance contract
before merge:

| Field | Value |
|---|---|
| **Owner** | Vince |
| **Scope** | Runtime (server‑side PR gate + webhook), per‑repo |
| **Auth source** | GitHub App private key via the shared secrets accessor (no hardcoded keys) |
| **Default state** | Off; per‑repo `soft` → `hard` opt‑in (decision 11) |
| **Kill switch** | Global env flag + per‑repo flag; disabling reverts to "record‑only" |
| **Health check** | `/api/compliance/health` (App reachable, webhook fresh, queue depth) |
| **Fallback** | Pending + reconciliation queue (§6); never silent‑pass |
| **Data/audit boundary** | All actions emit `mc_events`; PR metadata only — no repo source ingested |

**Hosting/auth (open item resolved):** the verify + webhook endpoints are routes in
the PLX MC Next.js app. This introduces MC's **first public service** (today
`AGENTS.md` notes "no services yet") — a real prerequisite: MC must be deployed with a
public URL. External‑repo CI calls `/api/compliance/verify` with a short‑lived token
(GitHub OIDC preferred); webhooks are HMAC‑verified.

## 9. Rollout phases (decomposes WS‑7)

Soft → hard, **dogfood `PLX_MC` first**, then `agentic-swarm`, then
`plx-customer-portal` (no big‑bang on the live go‑live repo).

| Phase | Scope | Exit criteria |
|---|---|---|
| **P1 — MC foundation** (in‑repo, no external infra) | Data model (§3), risk classifier (§4), `verifyCompliance` + `evidenceCompleteForTier` extending `policy.ts`, `mc_events` migration + `appendEvent`, the API routes (§5) behind a flag, unit + contract tests | `preflight` green; verifier truth‑table tested; events emitted; **dogfoggable** via MC's own preflight |
| **P2 — Checkout & capture** | `/checkout` + `/complete`, dispatch ledger, Cursor/Claude hooks (auto‑checkout + PR stamp) | An agent run auto‑links a PR with zero manual steps in a fixture |
| **P3 — Gate on PLX_MC** | GitHub App + reusable workflow + branch protection on `PLX_MC`; webhook ingestion + reconciliation queue | Required check live (soft→hard) on `PLX_MC`; merged PR auto‑updates its task |
| **P4 — Cross‑repo** | Enroll `agentic-swarm`, then `plx-customer-portal` (soft→hard) | 100% of merged PRs linked on enrolled repos |
| **P5 — Second Brain** | Event stream + export hardening + embedding/index feed | Downstream consumer reads the stream end‑to‑end |

## 10. Test plan (governance: tests assert invariants)

- **Unit:** `classifyRiskTier` fixtures; `verifyCompliance` truth table (agent/operator
  × bundle complete/incomplete × tier); `evidenceCompleteForTier`; sparse auto‑create;
  stage promotion on merge; `mc_events` append + immutability guard.
- **Integration:** `/api/compliance/*` pass/fail with the shared envelope; webhook
  handlers against GitHub fixture payloads; queue hold + reconcile on simulated
  MC‑down; break‑glass emits a debt event + reconciliation task.
- **Contract:** a new `Task`/bundle field must be classified (gated or not) — fails CI
  if unclassified (mirrors the EN‑006 mapping‑coverage idea).
- **Gate:** `./scripts/preflight.sh --mode pre-push`.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| MC as a hard dependency on every merge | Pending + reconciliation queue + audited break‑glass (§6) |
| Agent skips checkout to dodge the bundle | Cursor/Claude auto‑checkout hooks; autonomous agents must use the token to act; unlinked human PRs are operator‑accountable |
| Disrupting the live `plx-customer-portal` team | Soft→hard, phased, `PLX_MC` first; record‑only kill switch |
| Verify latency on the PR hot path | Pure verifier + cached dispatch/task lookups; status posts async |
| New public surface for MC | Explicit prerequisite (§8); HMAC + OIDC; health check + kill switch |

## 12. Open items (now build/PRD‑time only)

Both EN‑007 "Open for alignment" items are resolved above: **event‑log schema** =
extend the audit log into `mc_events` with keyset export, embedding feed in P5;
**hosting/auth** = routes in the MC app (new public service prerequisite), GitHub App
key via the secrets accessor, OIDC for CI, HMAC for webhooks.
