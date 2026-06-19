# Mission Control — Enhancements & Fixes Spec

> **Living document.** This is the shared backlog of feature enhancements and
> bug fixes for PLX Mission Control. Vince drops screenshots + a one‑line note;
> we align on the high‑level requirement; the agent writes it up here as a
> structured entry. Once items are captured and aligned, they roll up into a
> concrete implementation plan (see [§ Implementation Plan](#implementation-plan)).

---

## How this doc works

1. **Capture** — Vince adds a screenshot to `screenshots/` and describes the
   issue or desired change in one or two sentences.
2. **Align** — We discuss until the *high‑level requirement* is clear and agreed.
3. **Write** — The agent adds an entry to the [Backlog](#backlog) with:
   status, area, the screenshot, observed vs. desired behavior, and notes.
4. **Plan** — When enough items are aligned, we formalize them into the
   [Implementation Plan](#implementation-plan): ordered, scoped, with verification.

**Screenshots:** save to `docs/product/enhancements/screenshots/` using the
convention `NN-short-slug.png` (e.g. `01-sync-pill-overflow.png`). Reference
them from the entry. Keep slugs lowercase kebab‑case.

**Status values:** `Triage` (captured, not yet discussed) → `Aligned`
(requirement agreed) → `Planned` (in the implementation plan) → `In Progress`
→ `Done` → `Wontfix` / `Deferred`.

**Type values:** `Fix` (something is broken) · `Enhancement` (improve existing)
· `Feature` (net‑new).

---

## Backlog

> Newest entries at the top. Each entry has a stable `EN‑NNN` id. Don't reuse
> ids even after an item is Done or Wontfix.

<!-- ENTRY TEMPLATE — copy this block for each new item
### EN‑NNN — <short title>

| | |
|---|---|
| **Status** | Triage |
| **Type** | Fix / Enhancement / Feature |
| **Area** | <screen / module, e.g. Sync console, Inbox, Board> |
| **Screenshot** | `screenshots/NN-slug.png` |
| **Priority** | P0 / P1 / P2 / P3 (set during alignment) |

**Observed / current behavior**
<what happens today, or what's missing>

**Desired behavior / requirement**
<the agreed high‑level requirement>

**Notes / open questions**
<edge cases, dependencies, decisions still needed>

---
-->

### EN‑007 — PLX MC as the enforced system of record (cross‑repo compliance gate)

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Feature |
| **Area** | New capability — cross‑repo enforcement; touches a new MC verification/API surface, the task/bucket data model (`types.ts`, `store.ts`, `sync/state.ts`), the completion/accountability gate (`policy.ts`), repo governance (EN‑002), and a GitHub PR status‑check + webhook integration in each tracked repo |
| **Screenshot** | _none (open‑ended architecture ask)_ |
| **Priority** | TBD (set during planning) |

**The ask (operator)**

Make PLX MC the **enforced, self‑authorizing, automatically‑maintained database of
project record** for the whole company. Any work against a PLX‑MC‑tracked repo must
follow the same governed process at commit/PR time. Agents are held to a strict
contract; operators have optionality. End state: **all PLX work flows through MC**,
and MC becomes the backbone of Petra's Second Brain.

**The compliance contract**

- **Agents (strict, gated):** every effort resolves to `bucket → task → sub‑task`.
  If the operator didn't provide one at dispatch, the agent **derives** the
  bucket/task/description. To merge a PR, the linked task must carry a complete
  bundle — **rollback plan, PRD, and evidence (screenshots / change‑appropriate
  proof)** — enforced **once per PR**.
- **Operators (optional detail, still recorded):** operator work must still
  **attach to an MC task** (a record always exists), but detail is optional and
  operators are **not blocked** by the bundle gate.

**Aligned decisions (this session)**

1. **Authority — PLX MC is its own company‑wide system of record**, separate from
   VMC (Vince's personal MC). Borrow VMC's proven patterns (checkout →
   complete‑with‑evidence loop; `agent_done → qa‑review → merged → deployed`
   promotion ladder) as a **reference design only — no runtime coupling** to the
   vmc‑context MCP. Folding VMC pieces in later stays optional.
2. **Gate — a required GitHub PR status check** that **blocks merge**
   (authoritative, server‑side) on every tracked repo.
3. **Linkage — checkout handshake:** an agent must **check out an MC task before
   working**; the PR gate verifies the active checkout ↔ this PR (commit SHA /
   branch). Hardest to fake; mirrors VMC's checkout loop.
4. **Granularity — one full bundle per PR** (per shippable unit), not per commit.
5. **Operator floor — operator work is still recorded** in MC (a task exists;
   detail optional). Nothing merges without *a* task; only the *bundle* is
   operator‑optional.
6. **Self‑authorizing — auto‑accept when the bundle is complete:** MC
   self‑authorizes an agent‑created bucket/task and the gate passes; humans review
   only exceptions / at QA.
7. **Accountability — defaults to the dispatching operator:** agent‑initiated work
   is accountable to the human who dispatched it (satisfies EN‑003's "a human is
   always accountable"); reassignable.
8. **Auto‑maintained — git → MC ingestion:** PR events (opened **and** merged) flow
   back into MC and update/attach the task automatically (SHA + PR link, stage
   promotion). This is the inbound direction EN‑006 didn't cover.
9. **Identity follows the checkout credential** — *not* the git author (Cursor/Claude
   commit as the human and freely spawn ephemeral sub‑agents, so git metadata can't
   classify the actor). Agent runs authenticate with a per‑dispatch **agent token**
   (scoped to task + dispatching human); humans use SSO; sub‑agents inherit the
   parent run's token. The "registry" is **agent runtime credentials + a dispatch
   ledger** (token → task → accountable human → repo), **not** named personas. Every
   PR resolves to a task: human no‑checkout → auto/one‑click **sparse task**
   (recorded, ungated); agent → active checkout + complete bundle, or blocked.
10. **Failure mode — fail‑closed with a reconciliation queue.** While MC/the gate is
    unreachable the required check stays **pending (merge held)** and never silently
    passes; verification requests + inbound git events **queue durably and
    auto‑resolve on recovery** (reuse EN‑006's sync push‑error/sweep + conflict
    queue). Audited **break‑glass** override for emergencies.
11. **Cross‑repo authority granted.** One **uniform** reusable workflow / GitHub App
    + branch protection on every tracked repo; respects the staging‑branch rules
    (required status check on protected branches; master keeps explicit approval).
    Roll out **soft → hard, dogfooding `PLX_MC` first**, then `agentic-swarm`, then
    `plx-customer-portal` (no big‑bang on the live go‑live repo).
12. **Bundle — risk‑tiered, change‑appropriate.** *High* (DB migrations, prod deploy,
    auth/permissions, infra, external integrations) → full rollback plan + PRD +
    evidence; *standard* (feature/fix) → evidence + rollback note; *low* (docs/chore)
    → minimal evidence. **PRD lives per‑bucket** (reuse EN‑003 bucket‑PRD; tasks carry
    description/acceptance per EN‑001). **Evidence is change‑appropriate** (UI =
    screenshot, backend = test/log/API output, data = query result).
13. **Second Brain seam is first‑class.** MC's canonical record is an append‑only,
    well‑typed **event log** (every governed action = a typed event; extend EN‑006's
    `sync_audit_log`), exposed as a clean export + event stream and built
    retrieval/embedding‑ready — a core module, not an afterthought.
14. **Token minting + seamless capture.** MC mints a **short‑lived per‑dispatch agent
    token**; **Cursor/Claude hooks auto‑checkout + stamp the PR** at run start, so
    undefined or spawned sub‑agents are captured with zero manual steps (the PR
    carries the task pointer the gate verifies).
15. **Break‑glass = role override + debt.** A named role (repo owner/admin) can
    override a held PR; MC records a **debt event** and **auto‑creates a
    reconciliation task**; a bounded pending window then escalates. Never silent.

**What this implies (architecture)**

- A **CI‑reachable MC verification API**: the PR check asks *"is this PR's task
  checked out by this actor, bundle complete, human accountable owner present?"* →
  pass/fail. (Overlaps EN‑006's "where does MC's public endpoint live" question.)
- **Task model grows:** `rollbackPlan`, `prd` (or link), and `evidence/screenshots`
  attachments on the task, gated complete before merge (extends EN‑003's evidence
  gate + EN‑001's description/PRD surface).
- A **PR ↔ task link** record (checkout issues a handle the PR carries; MC stores
  the mapping) + the **git → MC ingestion** path (a GitHub App / webhook per repo).
- **Identity = the checkout credential, not the git author.** Actor type is set
  server‑side at checkout (agent token vs human SSO); ephemeral sub‑agents inherit
  the parent run's token + dispatcher. The gate resolves PR → task → actor from the
  **dispatch ledger**, so it never has to trust git metadata.
- A **reconciliation queue** (reuse EN‑006's sync push‑error/sweep + conflict infra)
  holds verification requests + inbound git events while MC is unreachable and
  **auto‑resolves on recovery**; held checks stay pending (fail‑closed).
- A **first‑class, append‑only event log** (extend EN‑006's `sync_audit_log`) is
  MC's canonical record *and* the Second‑Brain substrate — clean export + stream,
  retrieval/embedding‑ready.

**Agent's recommendation**

- This is the **capstone** that ties EN‑002 (repo allow‑list), EN‑003
  (accountability + evidence gate), and EN‑006 (enforcement plumbing + reverse
  mirror) into one enforced loop — build it **on** those, don't duplicate.
- Ship behind a **per‑repo feature flag in "soft" mode first** (record + warn,
  don't block) to populate MC and surface false positives, then flip to hard‑block
  per repo (consistent with the local‑CI rule against promoting gates to `error`
  with unfixed violations).
- Start the enforced rollout on **`PLX_MC` itself** (we own it; dogfood), then
  `agentic-swarm`, then `plx-customer-portal`.

**Open for alignment** _(only build/PRD‑time details remain; decisions 1–15 cover the rest)_

1. **Event‑log schema & substrate:** canonical event types + storage (extend
   `sync_audit_log` vs a dedicated event store), the export/stream contract for the
   Second Brain, and whether an embedding/index feed is in v1.
2. **Hosting/auth** of the verification API + GitHub App (shared with EN‑006).

**Dependencies:** EN‑002 (repo registry/allow‑list — done), EN‑003 (accountability +
evidence gate — done), EN‑006 (enforcement plumbing + reverse mirror — proposed).
Sequence after EN‑006's webhook/endpoint hosting decision.

---

### EN‑006 — Two‑way mirror completeness, compliance & enforcement

| | |
|---|---|
| **Status** | Triage |
| **Type** | Feature + Enhancement |
| **Area** | `sync` module (`src/lib/sync/*`: `engine.ts`, `mapping.ts`, `graph.ts`, `state.ts`, `repo.ts`, `scheduler.ts`), `config/sharepoint-schema.json`, `SP_LISTS` (`data.ts`); governance tooling (`config/governance-contract.yaml`, `scripts/generate-governance-surfaces.py`, `scripts/check-repo-hygiene.py`, `scripts/preflight.sh`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`) |
| **Screenshot** | _none (architecture / code investigation)_ |
| **Priority** | TBD (set during alignment) |

**Context (important correction):** the sync engine is **shipped v1, not "planned."** There is a real two‑way mirror for **ToDos + Risk Register** — opt‑in 5‑minute in‑process scheduler (`PLX_MC_SYNC_ENABLED=1`), inbound Graph delta + outbound sweep, conflict/error queues, and a Postgres audit log — evidenced in `artifacts/sync/2026-06-11-sync-engine/REPORT.md`. This entry is about **completeness + enforcement**, not greenfield. Governance drift, repo hygiene, and migration serialization are already gated in `preflight`/CI; module‑contract and most TypeScript doctrine rules are still documented‑only.

**Observed / current behavior**

_Mirroring:_

1. **Only 2 of 5 registers sync.** Engine covers ToDos + Risk Register; Roadmap, Milestone Register, and Project Documents are provisioned in `sharepoint-schema.json`/`SP_LISTS` but excluded from `DELTA_LISTS`/`PUSHABLE` (`engine.ts`, `state.ts`).
2. **Outbound is sweep‑batched, not "on mutation."** A mutation marks `pending`/`dirty_fields`; the actual Graph PATCH only runs in `runSweep` (`state.ts`, `engine.ts`). The spec §6 wording implies push‑on‑mutation.
3. **No Graph change webhooks** (spec §1/§6) — polling only, default **off** (`scheduler.ts`).
4. **Person + lookup columns deliberately not mapped.** Assigned To, Accountable Owner, Reporter, Owner, and Initiative/bucket are deferred to the directory/notification increment (explicit comment in `mapping.ts`, `$comment` in `sharepoint-schema.json`).
5. **Several task fields push on create only.** `reqs`, `estimate`, `repos`, `evidence` are in `outboundFields` but excluded from `PUSHED_FIELDS` (`state.ts`), so edits don't re‑push.
6. **No Document‑library delta;** engine defaults to the `‑dev` site path even though the schema defines the production site (`graph.ts`).

_Compliance / enforcement:_

7. **Enforced today (preflight policy + CI):** contract→surface drift gate (`generate-governance-surfaces.py --check`), repo hygiene (`check-repo-hygiene.py`), migration‑prefix serialization, ruff, canary pytest, `npm run typecheck`. Full pytest/vitest/build/Playwright on `pre-push`/CI.
8. **Documented‑only (NOT gated):** module‑README existence; the TS doctrine rules (Zod on every mutating route, shared route/fetch wrapper, `{ data } | { error }` envelope, `--p-*` tokens, barrel‑shadowing); shim‑expiry. `npm run lint` exists but is **not** in `preflight`.
9. **`AGENTS.md` architecture is stale** — sync is labeled "(planned)" and "no cron jobs, webhooks, or services yet," contradicting the shipped engine + scheduler.

**Desired behavior / requirement** _(to align)_

_Mirror completeness:_ extend the engine to the remaining registers (Roadmap, Milestones, Documents) per the `SHAREPOINT_INTEGRATION` mapping; resolve person + lookup columns (depends on the directory increment); dirty‑track and re‑push the push‑only fields; decide the outbound‑latency model (keep sweep vs add near‑real‑time PATCH and/or Graph webhooks + subscription renewal); define the production‑site cutover.

_Compliance / enforcement:_ promote selected governance rules from documented → gated (candidate first: a module‑README coverage gate + an API‑envelope/Zod lint in `preflight`); add sync mapping‑coverage contract tests (a new model field must be classified mirrored or deferred); fix the `AGENTS.md` "planned" drift.

**Agent's recommendation**

- Treat as two sub‑tracks under one theme: **(a) mirror completeness** (more lists + fields + identity) and **(b) enforcement** (move rules from prose to gates). They share the "SharePoint is the system of record + everything is enforced" mission and co‑evolve.
- Sequence anything identity‑related **behind the person‑column/directory increment** (EN‑003 gave us real identities; the sync layer still has to map them).
- Keep **webhooks as a later phase** — spec'd but needs a public endpoint + renewal job; declare per External Integrations before building.
- For enforcement, graduate **one or two high‑value gates first** (module‑README presence; envelope/Zod lint) rather than promoting every documented rule to `error` at once (per the local‑CI‑before‑push rule: never promote to `error` with unfixed violations).

**Open questions / for alignment**

1. Outbound latency: is sweep acceptable, or must some fields PATCH synchronously on mutation?
2. Webhook hosting surface (Vercel staging vs a dedicated worker) for the public `notificationUrl`?
3. Register priority after person/lookup: Roadmap, Milestones, or Documents first?
4. Should `reqs`/`repos`/`estimate`/`evidence` become dirty‑tracked + re‑pushed on change?
5. Which TS doctrine rules graduate to preflight‑enforced first?
6. When to cut `PLX_MC_SHAREPOINT_SITE_PATH` from `‑dev` to production?
7. Fix the `AGENTS.md` "planned" drift inside this workstream or as a separate hygiene PR?

**Dependencies:** person/lookup mirroring depends on the EN‑003 directory increment; overlaps with EN‑005 (a SharePoint "Repo Registry" list could land as part of this sync work).

---

### EN‑005 — Agent roster management & repo‑registry governance (next increment)

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Enhancement + Feature |
| **Area** | Agents (`src/lib/mc-data/data.ts` `AGENTS`, `types.ts` `Agent`, `people-picker.tsx`, `agent-feed.tsx`, `command-palette.tsx`, `store.ts`); Repos (`mc-data/repos.ts`, `REPOS`, `store.ts` registry, `sync/state.ts`, `atoms.tsx` `RepoChip`, `repos-view.tsx`) |
| **Screenshot** | _none (code investigation; follows EN‑002/EN‑003)_ |
| **Priority** | TBD (set during alignment) |

**Context:** builds on **EN‑002** (repo governance — delivered) and **EN‑003** (directory/accountability — delivered, *except* its agent‑roster items, which are still open). This is the "make agents and repos real and persisted" increment.

**Observed / current behavior**

_Agents:_

1. **Roster is still the 4 prototype agents** (Vibes, Atlas, Sentry, Scribe) with fabricated `online: true`. EN‑003's "trim `AGENTS` to the real roster" was **never executed** — humans were fixed in WS‑1, agents were not (`data.ts`).
2. **No agent operational model.** `Agent` has no capabilities/permissions/repo‑binding/health; `mode: auto|approve`, `team`, and `model` are display‑only labels (the `MODE` map is unused) with no enforcement (`types.ts`, `data.ts`).
3. **Agent activity is empty / stubbed.** `AGENT_FEED = []`; the command‑palette "assign open task to {agent}" commands are no‑ops (`run: () => {}`); there is no pickup / autonomous‑assignment loop (`agent-feed.tsx`, `command-palette.tsx`).
4. **Presence/health is a static fixture** (all agents hardcoded online); no heartbeat or run status (`chrome.tsx`, `helpers.ts`).
5. **No agent governance flow** — repos have request→approve; agents have no equivalent registration/governance.

_Repos (hardening the EN‑002 prototype):_

6. **Registry + requests are in‑memory only** — `resetStore()` wipes them; no persistence and no SharePoint "Repo Registry" list (`store.ts`, `docs/WS2-NOTES.md` "Deferred").
7. **Client/server registry drift (correctness bug).** Client `addTask`/`allRepos()` use runtime `state.repos`, but server `createTask` validates against the **static `REPOS` import** — a repo approved in the UI fails the server mirror on `POST /api/tasks` (`sync/state.ts`).
8. **UI inconsistency:** `RepoChip` reads static `REPOS`, so a newly‑approved repo renders as a raw id (`atoms.tsx`).
9. **Task repos are read‑only after creation** — no patch path for `repos` (`task-detail.tsx`).
10. **No per‑agent↔repo binding** (an agent can be assigned to any task regardless of `task.repos`); **no in‑app repo health** (the `vmc_get_repo_health` MCP tool is out‑of‑band).
11. **Doc debt:** no `docs/modules/agents/` or `docs/modules/repos/` contract README; `docs/product/DATA_MODEL.md` is stale (still shows fake humans + `openPRs`).

**Desired behavior / requirement** _(to align)_

1. **Real agent roster** — replace/validate the 4 prototype agents against the actual agentic‑swarm roster; choose the source of truth (fixture+API vs DB vs SharePoint).
2. **Agent operational model** — capabilities / default repos / autonomy mode that actually gate assignment + stage advance (make `mode: approve` mean something).
3. **Agent activity** — populate the feed from real task events / swarm signals; wire (or remove) the stubbed pickup + palette assignment.
4. **Real presence/health** instead of hardcoded online.
5. **Repo registry as system‑of‑record** — persist registry + requests (Postgres and/or a SharePoint "Repo Registry" list) and make the **server read the same allow‑list as the client** (kill the static‑`REPOS` drift).
6. **Repo UX consistency** — `RepoChip`/server use the runtime registry; allow editing a task's `repos` post‑creation (allow‑list enforced).
7. _(Optional)_ per‑agent repo binding + an in‑app repo‑health surface.
8. **Module contracts** for agents + repos; refresh `DATA_MODEL.md`.

**Agent's recommendation**

- Two tightly‑related sub‑tracks under one theme: **(a)** finish the EN‑003 agent leftovers + give agents a real operational model, and **(b)** harden EN‑002 from "in‑store prototype" to a **persisted, server‑consistent registry.**
- **Resolve the client/server allow‑list drift first** — it's a correctness bug (an approved repo can't be used server‑side), not polish.
- **Reuse the repo request→approve pattern** for agent registration rather than inventing a new governance shape.
- Keep **agent↔repo binding optional for v1** (the shared task‑level allow‑list already governs humans and agents); add hard constraints only if the operator wants them.

**Aligned decisions (2026‑06‑19)** _(adopted as the recommended defaults when the operator chose to proceed without changing them; reversible — flag any to revisit)_

1. **Agent roster source of truth — in‑repo fixture (`data.ts`), hydrated via the
   existing API seam** (the same pattern `REPOS` used). No runtime coupling to
   agentic‑swarm. The four agents (Vibes/Atlas/Sentry/Scribe) are retained as the
   curated v1 roster and given a **real operational model** (capabilities, default
   repos, honest presence/status, enforced `mode`); the operator can swap in the
   live swarm names later. No DB/SharePoint persistence for agents in v1.
2. **Repo registry + requests persist in Postgres** — a numbered migration (008) +
   a server accessor mirroring the sync/compliance entity store. The server task
   mutation validates against the **DB registry** (killing the static‑`REPOS`
   drift, obs. #7); the client hydrates the registry from the server. A SharePoint
   "Repo Registry" list is **deferred to the EN‑006 sync increment** (the site is
   still unprovisioned — claiming an SP mirror now would be fabricated evidence).
3. **No hard per‑agent↔repo binding in v1.** `defaultRepos` is **advisory** on the
   Agent model (informs assignment + UI); enforcement stays at the shared
   task‑level allow‑list (humans and agents alike).
4. **Repo health — honest derived status in‑app; live GitHub health stays
   MCP‑only.** The app surfaces only values it can prove (tracked, open‑PR/task
   counts, last GitHub validation). A live in‑app GitHub health fetch is a
   declared, default‑off integration deferred to a later increment.
5. **Operator‑driven assignment for v1; `mode` is enforced.** No autonomous
   swarm‑pull loop in MC — the palette "Assign to {agent}" no‑ops are wired to the
   real `reassignTask` spine. An **`approve`‑mode agent executor** blocks a task
   from advancing into the In‑Progress band (or done) without an explicit operator
   approval, enforced in the shared `policy.ts` (mirroring the EN‑003
   accountable‑owner gate). `auto`‑mode agents advance subject only to the existing
   EN‑003 gates.
6. **Single PR (combine).** The never‑executed EN‑003 "trim `AGENTS`" leftover is
   finished **inside this epic** (one branch / one PR, branch hygiene), not split
   out — the trim here means giving the roster a real operational model, not
   deleting agents.

**Dependencies:** EN‑002 (done) and EN‑003 (done minus agent items); registry persistence overlaps the EN‑006 sync person‑column increment.

---

### EN‑004 — Meeting → Mission Control bridge (Teams capture to governed tasks)

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Feature |
| **Area** | New capability — meeting intake; touches `sync` module, Inbox/triage, task creation, SharePoint mirror |
| **Screenshot** | _none (open-ended architecture ask)_ |
| **Priority** | TBD (set during planning) |

**The ask (operator)**

Team meetings (usually MS Teams) generate tasks/notes/action items by hand. Make
this automated and tied into Mission Control. What's the first-class path —
voice-transcribing LLM, MS Teams / Loop integration — and how do we bridge the
human gap between meetings and action items while keeping the governance,
organization, and project-plan rigor that Mission Control provides?

**Agent's recommendation — native Microsoft Graph, post-meeting ingestion**

The first-class path is **Microsoft Graph**, not a third-party transcriber or a
real-time media bot. Microsoft already owns identity, recording consent,
compliance, and (with Copilot) action-item extraction — so we ingest its
artifacts rather than rebuild them. Two tiers by licensing:

- **Tier A — raw transcript (no Copilot license):**
  `GET /users/{id}/onlineMeetings/{id}/transcripts/{id}/content` returns a `.vtt`
  transcript. We run our own extraction LLM to pull action items. (Transcript
  APIs are no longer metered as of Aug 2025.)
- **Tier B — native Meeting AI Insights (needs M365 Copilot license):**
  `GET /copilot/users/{id}/onlineMeetings/{id}/aiInsights` returns structured
  `actionItems` (`title`, `text`, `ownerDisplayName`), meeting notes, and
  `@mention` events with timestamps — no AI infra to maintain.

**Proposed flow (bridges the human gap with governance):**

1. **Trigger** — subscribe to Graph change notifications for meeting
   transcripts; fire when a meeting ends (insights can lag up to ~4h).
2. **Capture** — pull AI-insight action items (Tier B) or transcript + extract
   (Tier A).
3. **Draft** — a Scribe-style agent normalizes each item into a **proposed
   task**: suggested title, owner (resolved against the EN‑003 real directory via
   `@mention`/displayName), candidate bucket, due date — with the transcript
   snippet + timestamp attached as **evidence**.
4. **Human confirm (the governance bridge)** — proposed items land in a
   **Meeting Intake / triage queue**, *not* the live board. A human (the EN‑003
   accountable owner) reviews, edits, assigns, links to bucket/PRD, then
   **promotes** to a governed Task. Nothing auto-enters the plan unconfirmed
   (Truth Before Action).
5. **Mirror + trace** — on promotion, create the Task, mirror to SharePoint, and
   keep the meeting source as a traceability artifact.

**On Loop:** Loop's programmatic surface is immature for action-item extraction
(.loop/.fluid files live in SharePoint/OneDrive but there's no rich API). Use
Teams meeting artifacts as the first-class source for v1; revisit Loop later as a
collaborative-notes surface if desired.

**Why not the alternatives (for the record):**

- *Real-time media bot* (Graph cloud communications): heavier infra + consent
  complexity, marginal benefit over post-meeting recap.
- *Third-party voice LLM* (e.g. Whisper/external): pushes meeting data outside
  the M365 tenant — a data-boundary/governance problem. Only a fallback if Teams
  transcription is unavailable.

**Aligned decisions**

- **Source (both tiers):** use native **Meeting AI Insights** when users are
  M365 Copilot-licensed; **fall back to raw transcript + our own extraction**
  when not. One pipeline, two capture adapters.
- **Human-in-the-loop:** meeting-derived items land in a **Meeting Intake /
  triage queue** and require a human to **promote** them into governed tasks —
  never auto-entered into the plan.
- **Data boundary:** any self-run extraction stays **in-tenant (Azure OpenAI)**;
  meeting transcripts never leave M365/Azure (no external LLM for transcripts).
- **Scope (v1):** **opt-in** — only specific/recurring team meetings we
  designate feed the bridge, not every transcribed meeting in the tenant.
- **Loop:** **deferred** — Teams meeting artifacts only for v1; revisit Loop as a
  collaborative-notes surface later.

**Open for planning stage**

- Capability declaration per External Integrations governance (owner, scope,
  auth source, default state = off, kill switch, health check, audit boundary).
- How meetings opt in (calendar tag, channel, or an explicit register).
- Confirm M365 Copilot licensing status for the 6 users (determines how often
  Tier B vs Tier A runs).
- Owner-resolution rules from `ownerDisplayName`/mentions → EN‑003 directory.

---

### EN‑003 — Real directory, assignment policy & accountability governance

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Fix + Feature |
| **Area** | Directory/assignment (`src/lib/mc-data/data.ts` `HUMANS`/`AGENTS`/`DIRECTORY_EXTRA`, `src/components/mc/people-picker.tsx`, `new-task-modal.tsx`, `task-detail.tsx`, `bucket-detail.tsx`) |
| **Screenshot** | `screenshots/02-assign-dropdown-fake-directory.png` |
| **Priority** | TBD (set during planning) |

**Real people (per operator):** Greg, Rishi, Ricardo, Stephen, Ross, Vince.

**Observed / current behavior**

1. **Entire directory is fabricated.** `HUMANS` (Maya, Tariq, Lena, Evan, Noor),
   `DIRECTORY_EXTRA` (Priya, Felix, Dana, Sam, Inès, Omar, Grace, Rubén), and
   `AGENTS` (Vibes, Atlas, Sentry, Scribe) are all placeholder identities; only
   `vince` is real (and itself a placeholder identity). The assign dropdown
   surfaces these fake people (screenshot).
2. **"Core team" grouping is hardcoded** to the fake ids in `people-picker.tsx`
   (`CORE_TEAM_IDS`).
3. **Agent gating partially exists but is unused.** `PeoplePicker` accepts
   `allowAgents` (default `true`) — there is no per-task policy to mark a task
   human-only and enforce it across the picker, reassignment, and agent pickup.
4. **No enforced accountability.** Tasks/buckets can sit unassigned (the
   screenshot task is "Assigned To · Unassigned"); nothing requires a human to
   be accountable, and ownership changes aren't governed.
5. **No completion governance gate.** Nothing requires a PRD / evidence before a
   task or bucket is considered complete (the agent evidence gate exists in
   `task-detail.tsx` but isn't a universal completion contract).

**Desired behavior / requirement**

1. **Real directory** — replace the fake roster with the actual people (Greg,
   Rishi, Ricardo, Stephen, Ross, Vince) with correct emails, domains, and roles.
2. **Assignment policy at creation** — a human authoring a task can assign **any
   person or any agent**, or mark the task **human-only** to disallow agents
   (reuse the existing `allowAgents` capability, surfaced as a per-task policy).
3. **Strict accountability** — every task *and* bucket is accountable to a real
   person who takes and executes it; enforced (no orphan work past a defined
   stage), with ownership/hand-off logged and mirrored.
4. **Completion governance** — completing a task/bucket requires governance
   artifacts (e.g. PRD present, evidence/acceptance met) before it can be marked
   done. Ties into EN‑001 (description/PRD surface).

**Agent's thoughts / recommendations** *(for discussion)*

- **A human is always accountable, even when an agent executes.** Recommend an
  explicit **accountable owner (human)** distinct from the **executor** (human
  or agent). Agents can do the work, but a named human is on the hook —
  consistent with the governance doctrine (Ownership & Precision).
- **Reuse, don't rebuild:** the `allowAgents` flag already exists; extend it into
  a per-task `humanOnly` policy enforced in every assignment surface.
- **Resolve identities from the source of truth:** pull real emails/roles from
  the Microsoft 365 directory via Graph (credentials available) rather than
  hand-typing, so the directory stays truthful.
- **Make "done" a contract:** a task isn't complete without its evidence; a
  bucket isn't complete without a PRD and all requirements satisfied (the
  Traceability matrix already models GAP vs satisfied — enforce it as a gate).

**Aligned decisions**

- **Directory:** replace the fake roster with **exactly 6 humans** — Greg,
  Rishi, Ricardo, Stephen, Ross, Vince; delete all fabricated human entries and
  the hardcoded `CORE_TEAM_IDS`.
- **Identity source:** resolve each person's **email, domain, and role from the
  Microsoft 365 directory via Graph** (credentials available) so the directory
  is truthful — no hand-typed identities.
- **Agents:** keep an agent roster; agents are **assignable by default**, with a
  per-task **human-only opt-out** (extend the existing `allowAgents` flag into a
  task policy enforced across picker / reassign / agent pickup).
- **Accountability (split model):** every task and bucket has a **human
  accountable owner** distinct from the **executor** (human or agent). A human is
  always accountable; agents may execute but never hold final accountability.
  Enforce: no task/bucket advances past a defined stage without a human owner;
  ownership hand-offs are logged and mirrored.
- **Completion gate:** **Task** complete requires evidence/acceptance met;
  **Bucket** complete requires a PRD present + **all requirements satisfied**
  (no GAP rows in Traceability) + tests pass.

**Open for planning stage**

- Exact Graph lookup + mapping of the 6 identities (emails/roles/domains) and
  how invited-but-unprovisioned people (e.g. Greg, Stephen) are handled.
- Where `accountable owner` vs `executor` live in the data model and SharePoint
  columns.
- Which stage is the hard gate for "must have a human owner".

---

### EN‑002 — Repo registry, seeding, self-service & governance

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Fix + Feature |
| **Area** | Repos (`src/lib/mc-data/data.ts` `REPOS`, `src/components/mc/repos-view.tsx`, `new-task-modal.tsx`, `task-detail.tsx`, `bucket-detail.tsx`) |
| **Screenshot** | _none (code investigation)_ |
| **Priority** | TBD (set during planning) |

**Canonical repos (per operator):** the only repos PLX MC should track right now are
[`plx-customer-portal`](https://github.com/taylorvalton/plx-customer-portal),
[`agentic-swarm`](https://github.com/taylorvalton/agentic-swarm), and
[`PLX_MC`](https://github.com/taylorvalton/PLX_MC).

**Observed / current behavior (root-cause investigation)**

1. **Stale registry.** `REPOS` (`data.ts` lines 106–112) holds five repos:
   `plx-customer-portal` (matches) plus four demo leftovers
   (`plx-portal-api`, `plx-mrp-core`, `plx-design-system`, `plx-infra`) with
   **fabricated** PR/task counts. `agentic-swarm` and `PLX_MC` are **missing
   entirely**.
2. **Buckets/tasks seeded without repos.** Nearly every bucket is `repos: []`
   (only `BKT-DAPI`→`portal-api`, `BKT-INFRA`→`infra`) and nearly every task is
   `repos: []` (only `TASK-222`, `TASK-235`). So opening a bucket/task (e.g.
   `TASK-223`) shows Repos = "—". **This confirms the operator's hypothesis:
   the items were initiated without repos attached.**
3. **Picker sources the wrong list.** New Task modal `repoOptions` = bucket
   repos if any, else `Object.keys(REPOS)`; Repos screen lists the whole
   registry. So the chooser/list surface the placeholder repos.
4. **No self-service, no editing.** `REPOS` is a hardcoded constant — there is
   no UI to register a repo; task detail renders repos read-only.
5. **No governance layer.** No allow-list, ownership, validation, or hygiene
   enforcement tying repo usage (human or agent) to the org's standards.

**Desired behavior / requirement**

1. **Correct the registry** to the three canonical repos; remove the demo
   placeholders; replace fabricated counts with real or honestly-empty values.
2. **Seed/backfill** repo associations on existing buckets and tasks so the work
   already in flight points at the right codebase(s).
3. **Self-service repo registration (future-proof):** let collaborators add
   their own repos through the UI, governed (not free-for-all).
4. **Repo governance + hygiene for humans *and* agents:** an allow-list with
   required metadata (owner, default branch, visibility, scope), enforced at
   registration; agents bound to the same allow-list; new-repo registration
   follows the repo's External Integrations declaration (owner, scope, auth
   source, default state, kill switch, health check) per the governance
   contract.

**Aligned decisions**

- **Registry:** reduce to exactly the **3 canonical repos**
  (`plx-customer-portal`, `agentic-swarm`, `PLX_MC`); delete the 4 demo
  placeholders; replace fabricated PR/task counts with real or honestly-empty
  values.
- **Backfill:** **curated mapping per workstream** (proposed below) — backfill
  existing buckets/tasks rather than auto-attaching everything.
- **Attach level:** **both** bucket and task level (matches the data model).
- **Self-service:** **request → approve** — any collaborator can request a new
  repo; an owner/admin approves before it joins the registry.
- **Governance (strict):** allow-list + required metadata (owner, default
  branch, visibility, scope), **agents bound to the same allow-list**, and new
  repos **validated against the GitHub org via API**. Registration follows the
  External Integrations declaration in the governance contract.

**Backfill mapping (confirmed by operator 2026-06-17)**

All current buckets are PLX Portal go-live workstreams, so **every bucket and
its tasks attach `plx-customer-portal`**. `agentic-swarm` and `PLX_MC` remain in
the registry but are **not attached** to any current bucket/task — they attach
when relevant work appears.

| Bucket | Repo(s) |
|---|---|
| BKT-WMS · WMS Integration | `plx-customer-portal` |
| BKT-DAPI · Decoupling API | `plx-customer-portal` (was `portal-api`) |
| BKT-PROD · Product Development | `plx-customer-portal` |
| BKT-FIN · Finance | `plx-customer-portal` |
| BKT-QMS · QMS | `plx-customer-portal` |
| BKT-SHOP · Shopify → Business Central | `plx-customer-portal` |
| BKT-INFRA · Backend Infra | `plx-customer-portal` (was `infra`) |
| BKT-UAT · UAT | `plx-customer-portal` |

Tasks inherit their bucket's repo(s) unless overridden.

---

### EN‑001 — Collaborative task & sub-task workspace (description + comments)

| | |
|---|---|
| **Status** | Aligned |
| **Type** | Enhancement |
| **Area** | Task detail (`mc-task.jsx` / production task page) **and** Bucket/Initiative detail (`mc-bucket.jsx`) |
| **Screenshot** | `screenshots/01-task-subtasks-no-description-comments.png` |
| **Priority** | TBD (set during planning) |

**Observed / current behavior**

On a task (screenshot: `TASK-223 · Product Development`), the work item is not a
usable collaboration surface:

- **Description** — read-only. The field renders a fallback string and cannot be
  edited in-app (`mc-task.jsx` `/ Description` block, lines 213–218).
- **Sub-tasks** — a flat checklist only: `id · title · done · one avatar`
  (lines 220–234). No per-sub-task description, due date, assignee control, or
  any discussion. (The live app already supports add + check; depth is still
  missing.)
- **Activity** — system-generated only (logged from actions like reassign /
  evidence toggle). There is **no comment composer**, so colleagues and agents
  cannot post free-form notes or have a threaded back-and-forth on the task.
- **Bucket detail** (`mc-bucket.jsx`) has PRD / ToDos / docs / milestones /
  risks but **no discussion thread** at the initiative level either.

**Desired behavior / requirement**

Make the task (and the bucket) a robust, multi-user collaboration workspace so
people and agents can actually work a problem together:

1. **Editable rich description** on the task — inline edit, persisted, mirrored
   to the system of record.
2. **Comments / discussion thread** — free-form notes where humans *and* agents
   can go back and forth: author + avatar, timestamp, `@mention` of colleagues
   and agents, edit/delete own comments. Multi-user.
3. **More robust sub-tasks** — each sub-task gains its own description, assignee
   (human or agent), status, and due date; create / edit / reorder / complete;
   optionally its own short comment thread; ability to promote a sub-task to a
   full task.
4. **Multi-user & traceable** — concurrent users, notifications on mention /
   assignment (Teams + email, consistent with existing assignee flow), and
   two-way mirror to SharePoint as system of record.

**Aligned decisions**

- **Scope:** both — a discussion thread on the **task** *and* a separate
  discussion thread at the **bucket/initiative** level.
- **Comments + Activity:** one **unified timeline** — human/agent comments
  interleaved with system-generated events, newest-first, with clear visual
  distinction between a comment and a system event.
- **Sub-task depth (medium):** each sub-task gains **description, assignee
  (human or agent), due date, and status**, plus create / edit / reorder /
  complete and **promote-to-task**. No per-sub-task comment thread in v1.
- **@mentions:** mentioning a colleague or agent fires the **same Teams + email
  notification + SharePoint mirror path** used by assignment today.
- **SharePoint mirroring:** v1 mirrors **description + sub-task fields** to the
  ToDos list; **comments stay app-only** (no comment column added yet).

**Open for planning stage**

- Priority/sequencing vs. other backlog items.
- Concrete data-model additions (comment entity, sub-task fields) and where they
  live in the production store + SharePoint columns.
- Real-time/concurrency approach for multi-user threads.

---

## Implementation Plan

> Populated once the backlog is aligned. Groups entries into ordered,
> independently shippable workstreams with scope, approach, and verification.
> Each plan item links back to the `EN‑NNN` entries it resolves.

Formalized 2026-06-17 for EN‑001…EN‑004. Each workstream is **one branch / one
PR** (branch hygiene), gated by `./scripts/preflight.sh` and the standard TS
contracts (shared route wrapper, Zod on mutations, `{ data } | { error }`
envelope, `--p-*` tokens). SOPs + module READMEs + SharePoint/VMC roadmap are
updated in the same PR per the repo rules.

### Sequencing & dependencies

```
WS-1 (EN-003)  ──►  WS-2 (EN-002)  ┐
  foundation        repos          ├──►  WS-4 (EN-004)
               └►  WS-3 (EN-001)   ┘     meeting bridge
                    collaboration
```

**WS-1 is the foundation** — the directory/identity + accountability model is
what the sync layer has been deferring (`mapping.ts`: person columns "NOT mapped
yet… deferred directory/notification increment"), and what every other
workstream resolves people through. WS-2 and WS-3 can run in parallel after WS-1.
WS-4 lands last (depends on the directory, triage promotion, and repo linkage).

### WS‑1 — Directory, accountability & assignment policy  · resolves **EN‑003** · P0

| | |
|---|---|
| **Data model** | `types.ts`: add `accountableOwner: string` (always human) distinct from `assignee` (executor, human/agent); add `humanOnly?: boolean` to `Task`; add the three to `TaskFieldPatch` (store.ts) + server `PatchTaskInput` (state.ts). |
| **Directory** | `data.ts`: replace `HUMANS`/`DIRECTORY_EXTRA` with the 6 real people (Greg, Rishi, Ricardo, Stephen, Ross, Vince) resolved from M365 Graph; remove all fakes. Add a `scripts/` Graph resolver to fetch email/role/domain (uses existing Graph creds). Trim `AGENTS` to the real roster. |
| **Picker** | `people-picker.tsx` + `store.ts directory()`: delete hardcoded `CORE_TEAM_IDS`/`core` array; group by role/online; honor a per-task `humanOnly` → `allowAgents={false}` (reuse the existing prop). |
| **Authoring/enforce** | `new-task-modal.tsx`: accountable-owner picker (human-only) + executor picker + human-only toggle. `task-detail.tsx`/`bucket-detail.tsx`: surface owner vs executor; block advancing past a gate stage without a human owner. |
| **Completion gate** | Generalize the agent evidence gate into a universal "done contract": task done ⇒ evidence/acceptance met; bucket done ⇒ PRD present + zero Traceability GAP rows + tests pass. |
| **SharePoint** | Implement the deferred person columns (Assigned To, Accountable Owner, Reporter) in `mapping.ts` + `config/sharepoint-schema.json` + `SP_LISTS`, now that identities are real. |
| **Verify** | Unit: `directory()` ordering, human-only enforcement, owner-required gate, completion contract. Integration: person-column mirror round-trip. `preflight --mode pre-push`. |

### WS‑2 — Repo registry, seeding, self-service & governance · resolves **EN‑002** · P1

| | |
|---|---|
| **Registry** | `data.ts REPOS`: reduce to the 3 canonical repos with honest metadata (no fabricated counts); remove the 4 placeholders. |
| **Seeding** | Backfill `bucket.repos = ["portal-web"]` for all 8 buckets and inherit on their tasks (per the confirmed mapping). `repos-view.tsx` + modal `repoOptions` self-correct once the registry is right. |
| **Self-service** | `request → approve` flow: a repo-request entity + approval action restricted to owner/admin roles (from WS‑1). Repo metadata: owner, visibility, scope, default branch. |
| **Governance** | Allow-list enforced everywhere repos are chosen; **agents bound to the same allow-list**. Validate new repos against the GitHub org via API (`GITHUB_TOKEN`) at registration. Declare per External Integrations contract. |
| **Verify** | Unit: registry shape, backfill correctness, request/approve transitions, allow-list rejection. GitHub validation mocked in tests. `preflight`. |

### WS‑3 — Collaborative task & sub-task workspace · resolves **EN‑001** · P1

| | |
|---|---|
| **Data model** | `types.ts`: new `Comment` (`id`, `author`, `body`, `ts`, `mentions[]`, `editedTs?`) + `comments: Comment[]` on `Task` and `Bucket`; enrich `Subtask` with `description?`, `assignee` (augment `who`), `due?`, `status?`. |
| **Description** | Make description editable: add `description` to `TaskFieldPatch` + inline editor in `task-detail.tsx` (mapping already mirrors `Description`). |
| **Unified timeline** | Merge system activity + human/agent comments into one newest-first stream with a comment composer; `@mention` resolves against the WS‑1 directory; edit/delete own comments. Reuse the component on `bucket-detail.tsx`. |
| **Sub-tasks (medium)** | Per-subtask description/assignee/due/status, reorder/complete, **promote-to-task** (reuse `addTask`). Extend `addSubtask`/`toggleSubtask` already in `store.ts`. |
| **Notifications** | `@mention` fires the existing assignment notify path (Teams + email + mirror). |
| **SharePoint** | Mirror description + sub-task fields; **comments app-only** (app DB), per decision. |
| **Verify** | Unit: comment CRUD, mention→notification, subtask promotion, description patch+mirror. `preflight`. |

### WS‑4 — Meeting → Mission Control bridge · resolves **EN‑004** · P2

| | |
|---|---|
| **New module** | `src/lib/meeting-intake/` (+ `docs/modules/meeting-intake/README.md`). Off by default; kill switch + health check; declared per External Integrations contract. |
| **Capture** | Graph adapters: Tier B `aiInsights` (Copilot-licensed) and Tier A transcript `.vtt` + in-tenant (Azure OpenAI) extraction. Change-notification subscription on meeting end. Opt-in meeting register. |
| **Draft → triage** | Scribe agent normalizes action items into **proposed tasks** in a Meeting Intake triage UI (reuse Inbox patterns), owner resolved via WS‑1 (`ownerDisplayName`/mentions), transcript snippet attached as evidence. |
| **Promote** | Human confirm → `addTask` (governed), repo linkage via WS‑2, mirror to SharePoint, keep meeting source as traceability artifact. |
| **Verify** | Adapter unit tests on fixture payloads; extraction eval; promotion creates a governed task; integration disabled-by-default assertion. `preflight`. |

### WS‑5 — Agent roster & repo‑registry hardening · resolves **EN‑005** · _aligned 2026‑06‑19_ · P1

> Formalized per the EN‑005 aligned decisions (roster = in‑repo fixture; registry
> persists in Postgres; binding advisory; health derived in‑app; operator‑driven
> assignment with enforced `mode`). One branch / one PR; gated by
> `./scripts/preflight.sh`.

| | |
|---|---|
| **Agents** | Replace/validate `AGENTS` against the real swarm roster; extend `Agent` with capabilities / default‑repos / health; enforce `mode: auto\|approve` in the picker + stage advance; populate `AGENT_FEED` from task events and wire (or remove) the stubbed palette pickup. |
| **Repo persistence** | Persist `repos` + `repoRequests` (Postgres, mirroring the sync entity store) and/or a SharePoint "Repo Registry" list in `sharepoint-schema.json` + `SP_LISTS` + `mapping.ts`; make `sync/state.ts createTask` read the **runtime** registry, not the static `REPOS` (fix the client/server drift). |
| **Repo UX** | `RepoChip` + server use `allRepos()`/runtime registry; allow editing a task's `repos` post‑create (allow‑list enforced; add `repos` to the patch path + server `PatchTaskInput`). |
| **Governance reuse** | Reuse the repo request→approve pattern for agent registration if agents become governed; agents stay bound to the shared task allow‑list (optional per‑agent repo binding only if aligned). |
| **Docs** | Add `docs/modules/agents/README.md` + `docs/modules/repos/README.md` (What/Why/How/Dependencies/Owner); refresh `docs/product/DATA_MODEL.md`. |
| **Verify** | Unit: roster shape, mode enforcement, registry‑persistence round‑trip, server/client allow‑list parity, repos patch. `preflight --mode pre-push`. |

### WS‑6 — Mirror completeness, compliance & enforcement · resolves **EN‑006** · _proposed (pending alignment)_ · P2

> Not yet formalized — depends on the EN‑006 open questions (latency model,
> webhook hosting, register priority, which rules graduate to gates). Sequence
> identity‑related mirroring behind the directory increment.

| | |
|---|---|
| **Registers** | Extend engine `PUSHABLE`/`DELTA_LISTS` to Roadmap, Milestone Register, and Project Documents per the `SHAREPOINT_INTEGRATION` mapping; add the Document‑library delta. |
| **Fields** | Dirty‑track + re‑push `reqs`/`repos`/`estimate`/`evidence` (add to `PUSHED_FIELDS`); map person + lookup columns once the directory increment lands. |
| **Latency / webhooks** | Decide sweep vs synchronous outbound; _(later phase)_ Graph change‑notification endpoint + subscription‑renewal job, declared per External Integrations. |
| **Enforcement** | Promote 1–2 governance rules documented → gated: a module‑README coverage gate + an API‑envelope/Zod lint in `preflight`; add sync mapping‑coverage contract tests. |
| **Hygiene** | Fix the `AGENTS.md` architecture drift (sync = shipped v1, not planned); define the production‑site cutover path. |
| **Verify** | Unit/integration: per‑register round‑trip, field dirty‑tracking, mapping‑coverage test, new‑gate exit‑code tests. `preflight --mode pre-push`. |

### WS‑7 — PLX MC enforced system of record · resolves **EN‑007** · _proposed (pending alignment)_ · P1

> Core semantics aligned (EN‑007 decisions 1–13); remaining open items are
> token‑minting, break‑glass, event‑log schema, hosting. Build on EN‑002/003/006,
> reuse the sync queue + audit log; roll out soft → hard, dogfooding `PLX_MC` first.

| | |
|---|---|
| **Verification API** | New CI‑reachable MC endpoint: given a PR (repo + branch + head SHA), return pass/fail on `{ task checked out by this actor, bundle complete, human accountable owner }`. Standard `{ data } \| { error }` envelope; auth for external‑repo CI. |
| **Task model + bundle** | Add `rollbackPlan`, `prd` (per‑bucket, reuse EN‑003), and **change‑appropriate evidence** (UI screenshot / backend test‑log / API output / data query) to the task; **risk‑tiered** requirement (high/standard/low); extend `policy.ts` so a PR can't pass the gate until the tier's bundle is complete (agents). |
| **Checkout handshake** | MC `checkout` issues a PR‑linkable handle; gate maps PR ↔ task ↔ actor. Reference VMC's checkout/complete loop (no runtime coupling). |
| **PR status check** | One **uniform** GitHub App / reusable workflow on every tracked repo + **branch protection** (required check on protected branches; master keeps explicit‑approval); soft (warn) → hard (block) per‑repo flag; dogfood `PLX_MC` → `agentic-swarm` → `plx-customer-portal`. |
| **Git → MC ingestion** | Webhook per repo: PR opened ⇒ attach/create + move to in‑progress; PR merged ⇒ promote task (merged/deployed) + attach SHA/PR. Operator PR with no task ⇒ auto‑create a sparse task (accountable = author). |
| **Reconciliation queue** | **Reuse EN‑006's sync push‑error/sweep + conflict queue:** while MC is unreachable, hold verification requests + inbound git events and auto‑resolve on recovery; held PR checks stay pending (fail‑closed). **Break‑glass:** role override → **debt event + auto‑created reconciliation task**, bounded window then escalate. |
| **Event log (Second Brain)** | First‑class append‑only event log (extend `sync_audit_log`): every governed action = a typed event; clean export + stream, retrieval/embedding‑ready. The canonical record substrate, not an add‑on. |
| **Identity** | Actor type from the **checkout credential** (MC‑minted short‑lived agent token vs human SSO), not git author; **dispatch ledger** (token → task → accountable human → repo); sub‑agents inherit the parent token. **Cursor/Claude hooks auto‑checkout + stamp the PR** (zero‑friction capture). Declare the GitHub App + webhook per External Integrations contract. |
| **Docs** | Module README for the gate; update `AGENTS.md` (MC = enforced system of record, not just a mirror); SOPs. |
| **Verify** | Unit: bundle‑complete gate, actor‑type resolution, sparse‑task auto‑create, stage promotion on merge. Integration: PR‑check pass/fail against fixtures; soft‑mode default. `preflight --mode pre-push`. |

### Risks / dependencies to confirm before build

- **M365 Copilot licensing** for the 6 users (decides Tier A vs B default in WS‑4).
- **Server-side parity:** each WS that adds a Task field must update `state.ts`
  `PatchTaskInput`, the `/api/tasks` Zod schemas, and the sync engine together
  (no client-only fields).
- **Concurrency** for multi-user comment threads (WS‑3) — optimistic + refresh,
  matching the existing `patchTaskFields` reconcile/rollback pattern.
- **Identity provisioning:** invited-but-unprovisioned people (e.g. Greg,
  Stephen) handling in WS‑1.
