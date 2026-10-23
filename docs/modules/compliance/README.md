# Module: compliance

## What

The enforcement brain for EN-007 — PLX MC as the system of record. It decides
whether a pull request against a tracked repo is compliant: what **risk tier** a
change is, what **bundle** that tier requires (rollback plan, PRD, evidence), and
the final **pass/block verdict** for an agent vs operator PR. It is pure logic —
no I/O, no GitHub, no DB. The GitHub status check, checkout/dispatch ledger,
`mc_events` log, git→MC ingestion, and metadata-only routing propose wrap this
core.

## Why

Every change to a tracked repo must resolve to governed MC work; agents are gated
on a complete bundle, operators are recorded but ungated (EN-007 decisions 2, 5,
9, 12). Keeping the verdict logic pure makes the gate deterministic, fast on the
PR hot path, and unit-testable without a live Postgres or GitHub App — so the
truth table is proven before any plumbing exists.

## How

- `classifyRiskTier(changedPaths, labels)` — `low | standard | high`. Explicit
  labels (`risk:high`/`risk:low`) win, then high-risk paths (migrations, auth/
  permissions, infra, `.github/workflows`, deploy), then docs/test-only = low,
  else standard. Mirrors the governance contract's Database Safety / External
  Integrations risk surface.
- `bundleRequirementsFor(tier)` — the floor per tier: high = full evidence +
  rollback + bucket PRD; standard = complete checklist + rollback note; low =
  minimal summary.
- `evidenceCompleteForTier(evidence, tier)` — reuses EN-003 `evidenceComplete`;
  adds the rollback-note and (for high) change-appropriate-proof checks
  (screenshots **or** a test run).
- `verifyCompliance({ task, actor, tier, bucketHasPrd })` — the verdict. Operator
  PRs pass (recorded, ungated); an agent PR with no checked-out task is blocked;
  agent PRs must carry a human accountable owner (EN-003) + the tier bundle. The
  soft-vs-hard (warn vs block) decision belongs to the caller.
- Agent commits (TASK-3336, `commit-signals.ts`). `verifyPr` reads the PR's head
  commits, whoever opened the PR. A commit is agent work when it has a `[bot]`
  or `plx-agents` identity, the name `PLX Agent`, a lane email
  (`cos@`/`uat@petrasoap.com`), a Claude, Codex or Cursor `Co-Authored-By`, or an
  `Agent:`/`On-Behalf-Of:`/`MC-Checkout:` trailer. Agent commits with no body
  stamp block. On a stamped PR, each agent commit must end with `Agent:`,
  `On-Behalf-Of:`, then `MC-Checkout:` as the last line, naming a body stamp.
  On-Behalf-Of must equal the checkout's accountable person. When the checkout
  was minted through a shared service alias (`cos@…`, not a person), the task's
  human accountable owner is accepted too (TASK-3483); `mc_checkout_task`
  returns that person as `accountablePerson`, and `mc_get_task` and
  `mc_list_checkouts` list every accepted value as `accountablePeople`. Agent must equal
  the `<runtime>/<lane>` passed as `agent` to `mc_checkout_task`, or the
  checkout's runtime when it is not the default `cursor`; otherwise it only
  warns. The merge queue skips the read; a GitHub error holds the gate.
- Human-verification evidence standard (TASK-3165, `evidence-standard.ts`,
  `ste-lite.ts`). It applies when a person must verify the work: label
  `verify:human`, a `kind:human-test` task, or a high-risk change. The agent's
  text must pass STE-lite, the measurable part of ASD-STE100. A numbered step
  has 20 words or fewer. Any other sentence has 25 or fewer. A prose paragraph
  has 6 sentences or fewer. Code, links, paths and IDs count as one word.
  Passive voice is advice only. The verifier checks the evidence summary. The
  MCP layer checks the task description at create and update, and the summary
  at `mc_complete_task` (before anything is recorded; `filesChanged` gives the
  likely tier, and the PR gate stays the authority). Until `EVIDENCE_STANDARD_ENFORCE_FROM` (2026-10-24, Toronto
  midnight) a finding is a note; after it, a blocking reason and a 400
  `evidence_standard`. Operators are never gated.
- Review links (TASK-3168, `review-links.ts`). `config/review-links-map.json`
  maps file paths to modules, and modules to a live screen and a doc, for the
  portal, PLX_MC and Trading Lab. An agent PR that touches a mapped module needs
  a link to it in the body's `## Review links` section. A screen link on any
  host counts, so a per-PR preview works. A doc link is a GitHub blob link on any
  branch. Unmapped paths need no link. `verifyPr` reads the PR body from GitHub
  only when a mapped module is touched, and never in the merge queue. Until
  `REVIEW_LINKS_ENFORCE_FROM` (2026-11-01, Toronto midnight) a missing link is a
  note; after it, a blocking reason. Both start with `review_links_missing`. An
  unreadable body is the note `review_links_unchecked` and never blocks.
- Repository binding requires matching full `owner/name` identities, compared
  case-insensitively. Bare dispatch identities and callers supplying only a bare
  name fail closed. Generated workflows retain the bare `repo` display/event key
  and send `repoFullName`; OIDC binds the latter to its signed repository claim.
  `PLX_MC_COMPLIANCE_FULL_REPO_BINDING_ENABLED` remains readable and defaults to
  `1`, preferring `repoFullName` (or a full `repo` when absent). With `0`, only the
  `repo` field is used, and it must still be a full identity; disabling the flag
  cannot restore the retired bare-name shim. Before merging this removal, operators
  must confirm every fleet compliance gate is refreshed, all pre-refresh dispatches
  have expired, and the flag remains on. These are runtime rollout preconditions.
- `verifyPr` (service) wraps the pure verdict for a PR: it reads **every**
  `MC-Checkout` stamp, verifies each checked-out task, and passes only if **all**
  pass — one incomplete task blocks the PR (a PR may complete N related tasks).
  Each task's verdict is recorded as its own check + `gate.passed/blocked` event;
  a single stamp is the back-compat subset. Bucket PRD is resolved from the
  persisted `buckets` table (`bucket-prd.ts`) — high-risk agent PRs block when
  the task's bucket has no PRD link. `verifyPr(input, { record: false })`
  computes the same verdict without the check row or gate event — used only by
  the read-only MCP `mc_verify_pr`, whose inputs come from `github-pr.ts`.
- TASK-3408: a task labelled `approval:merge-required` (`MERGE_APPROVAL_LABEL`)
  passes only when one of its approval gates is a person's signed, unexpired
  merge approval for this repo, PR and head SHA (`checkApproval`); otherwise the
  gate blocks and names the reason. Unlabelled tasks are unaffected.
- TASK-3409: a push to, or reopen of, an open PR whose body carries a stamp
  extends that checkout to at least now + 8 h (`renewDispatches`, audited as
  `checkout.renewed`); revoked or released leases are never extended.
  `checkout({ reuse: true })` hands back the caller's own live lease (same
  authenticated principal, recorded agent, runtime and operator, event `checkout.reused`). A checkout of a task that
  another holder (any of those four differs) has a live lease on is logged as `checkout.concurrent` with
  the holders and any `forceReason`; with `PLX_MC_CHECKOUT_TAKEOVER_ENFORCE=1`
  it is refused (`checkout_held`, 409) unless `forceReason` is given. Each
  `verifyPr` task result carries `checkout` (live, expiresAt, releasedReason,
  blockReason) and the task's approval gates as `approvals`. The merge SHA was
  already stamped on the task by the PR projection.
- TASK-3410 (lease chain, `lease-chain.ts`, migration 047): every checkout
  records the principal that minted it (`mc_dispatch.launcher_id`) and an
  optional `baseSha`; a principal listed in `PLX_MC_LAUNCHER_PRINCIPALS` may
  also attach a `launchId` (anyone else gets 403 `not_a_launcher`).
  `mc_dispatch_heads` is the checkout's ordered head chain, audited as
  `checkout.head`. A head joins it when the owning launcher records it
  (`mc_record_checkout_head`), when the `pull_request` webhook sees the first
  head with verified base ancestry or a push that GitHub compare proves
  descends from a recorded head (a staging merge included); forced pushes
  never extend the chain, or when GitHub compare proves the gate's requested
  head itself descends from a chain head (never the PR's current commits, which
  a delayed run or replay of an old head would borrow). The gate seeds an empty
  chain that has a `baseSha` only when GitHub compare proves the head descends
  from it; an unproven or failed compare leaves the head untrusted. Only
  launcher checkouts let a failed webhook compare queue the event. The first
  head with a PR number binds the chain to that PR; a head recorded before its
  PR existed binds (guarded `pr IS NULL` update, audited as
  `checkout.head_bound`) to the first PR the webhook, gate or launcher sees it
  on, and a head bound to another PR fails verification. For a checkout with a launch record, `verifyPr` reports a PR head
  outside the chain (rewritten history) or a chain bound to another PR. A
  commit whose `Agent:` trailer names a lane in `PLX_MC_LAUNCH_LANES` (exact
  values, or prefixes ending in `*`; empty = none) needs a checkout with a
  launch record. Both rules warn until `PLX_MC_LEASE_CHAIN_ENFORCE=1`, then
  block. Checkouts without a launch record (Claude web, Cursor cloud, Codex,
  people) are never held to them; the actor rule (Agent and On-Behalf-Of
  against the checkout) is unchanged. The merge queue skips the chain check,
  as it never reads GitHub.
- TASK-2011: expired checkouts fall back to live GitHub open-PR/stamp proof,
  once per PR verification/ingestion, failing closed when GitHub is unavailable.
  Revoked/released credentials, repo mismatches, and deleted/verified tasks
  cannot use that fallback. PR close/merge releases after attribution and
  projection; reopen clears release for unrevoked matching stamps. Release
  and its audit event are atomic; release is separate from revocation so
  exact-head merge attribution survives webhook replay. Schema:
  `db/migrations/026_dispatch_release.sql`.
- TASK-3813: a close/merge keeps a stamp that another open PR in the same repo
  still carries (a stacked PR), and records `checkout.release_refused` with code
  `open_pr_holds_checkout`. The check is `openPrHoldingCheckout`; a GitHub
  error fails closed, so `ingestOrQueue` queues the close for replay. On the
  pull_request gate, a stamp released by another PR's merge/close (the
  `releasingPrForDispatch` event lookup) still passes for this PR's commits
  whose trailer names it, with a note; it stays released and its SHA chain is
  not extended. Revoked, manually released, foreign-repo stamps, the releasing
  PR itself, and a PR with no such commit still block. The merge queue reads no
  commits: it accepts such a stamp only when the gate passed that exact head
  (the P16 expiry rule), and blocks it as released otherwise. A trailer has the
  same trust as any trailer: MC cannot tell a trailer copied onto a new commit
  from an original, since commit dates are caller-set.
- `verify` route auth is dual-path: GitHub Actions OIDC is the preferred
  first-class auth for `POST /api/compliance/verify`, with
  `COMPLIANCE_CI_TOKEN` bearer as fallback/break-glass during dogfood. The route
  stays fail-closed (503 when neither path is configured; 401 on bad/missing
  bearer) while remaining carved out from the UI session middleware.
- Merge queue (frontier P16): the generated gate also triggers on
  `merge_group` (`checks_requested`, no `paths` filter). The job keeps id
  `compliance`. On `merge_group` it parses PR `N` from the queue ref
  `gh-readonly-queue/<base>/pr-<N>-<sha>`, reads PR `N`'s body, head SHA,
  labels and changed files with `gh api`, and posts the usual verify payload
  plus `event: "merge_group"` for PR `N`'s head. When it cannot resolve PR `N`,
  it prints `merge_group: could not resolve the pull request` and takes the
  normal block path (exit 1 in hard mode, the soft-mode notice otherwise). So
  a queue must keep `max_entries_to_merge` at 1: the job verifies only PR `N`.
  The verify body's optional `event` defaults to `pull_request`. For OIDC,
  `event` must equal the signed `event_name`; `merge_group` also needs the
  queue ref with `pr-<N>` equal to `prNumber`, and a token without
  `event_name` never enters that mode. A bearer caller's `event` is trusted.
  In `merge_group` mode `verifyPr` never reads GitHub: it applies the usual
  checkout checks, and accepts an expired stamp only when the gate already
  passed this exact head for its task; otherwise it blocks the stamp as
  expired. The verdict replaces the check row for that head and task.
- `POST /api/routing/propose` (P6) is the **authoritative** metadata-only proposal
  path for PR opened/reopened/synchronize/closed. Auth is GitHub Actions OIDC
  only. Verified claims bind to submitted full/numeric repository identity,
  `pull_request` event, PR ref/number, approved workflow ref, and merge/head SHA;
  fork/cross-repository/replay mismatches are rejected. The durable
  `sp_github_actions_routing` principal must pass `authorize(routing.propose)`.
  PR body is processed in memory for markers/hash only — never persisted raw.
  Operator PRs land in non-blocking `action_required` proposal state with an
  authenticated MC deep link. Agent hard-gate remains unchanged.
- `projectPullRequest` (projection) — after `mc_events` are appended, mutates sync
  tasks for **checked-out** work: open/sync → `progress`, merge → `merged` +
  `prs[]` + `task.promoted`. Every mutation requires
  `authorize(...)` for durable `sp_compliance_projection` (`task.progress` /
  `task.link`). **Sparse operator Task creation is retired** — unrouted operator
  PRs do not create Tasks. Kill switch: `COMPLIANCE_PROJECTION_ENABLED=0`.
  Proposal kill switch: `PLX_MC_ROUTING_PROPOSALS_ENABLED=0` (never restores
  silent sparse creation). Optional HMAC compatibility:
  `PLX_MC_ROUTING_HMAC_PROPOSE=1` may call the same propose service from the
  webhook (not a phase-one prerequisite).

Landed in P1b: the checkout/complete/verify handshake (`service.ts` + `repo.ts` +
`/api/compliance/*`), the dispatch ledger + compliance-check ledger, and the
first-class append-only `mc_events` log with keyset export (`GET /api/events`) —
schema in `db/migrations/005_compliance.sql`. The service resolves actor + task
from the checkout credential (never git metadata) and records every verdict as an
event. Server logic is proven hermetically (mocked DB seam,
`tests/compliance-server.test.ts`); applying the migration + live integration on
staging is the deploy step.

Landed after P1b: Cursor/Claude auto-checkout hooks (P2), GitHub App +
branch protection + git→MC ingestion + reconciliation queue (P3), and
OIDC-first verify auth with bearer fallback for the compliance gate dogfood path.
P6 adds OIDC propose + sparse-task retirement. Deferred: fleet rollout and the
embedding/index feed over the event log.

## Dependencies

`@/lib/mc-data` (the `Task`/`Evidence` types, `evidenceComplete`,
`hasHumanAccountableOwner` from EN-003 `policy.ts`). The pure core has no
external services and no DB. The server wrapper uses Postgres repositories,
GitHub webhook HMAC, GitHub Actions OIDC verification (`jose` JWKS), the
permissions kernel (`authorize`), and the routing control-plane repo for
proposals/revisions. Depended on by: the `/api/compliance/*` routes,
`/api/routing/propose`, and the GitHub status-check / routing metadata workflows.

### Runtime approval gates (TASK-629/630)

`src/lib/compliance/approvals.ts` — the A2A "input-required" primitive. An
agent raises a gate mid-run (`POST /api/cursor/request-approval`,
`approval.request`); the task's stage freezes (`mc-data/policy`) until a human
with `approval.decide` — never the requester (separation of duties, 403) —
decides it via `POST /api/approvals/decide`. Transitions append
`approval.requested` / `approval.decided` to `mc_events`; the Approvals inbox
(`/?screen=approvals`) lists pending gates from `GET /api/approvals`.
Both the inbox and decide apply the project ACL (TASK-3713): a non-member never sees a restricted
project's gate, and deciding one returns 403 `project_acl_denied`.
The inbox displays every scope field and the source reference beside the decision controls.
Scoped approval requests must echo that exact displayed scope and source; missing or stale
review data returns 409 `approval_scope_not_reviewed` before signing.
A self-approval attempt still returns 403 `separation_of_duties` and now also
appends one `approval.denied` event (actor = the attempting identity, payload
`gateId`, `reasonCode: "separation_of_duties"`, `attemptedDecision`,
`requestedBy`) without changing the gate. `GET /api/approvals/audit`
(`task.read`, project-ACL filtered; read-only, no new permission) is the audit
export: `approval.requested` joined to `approval.decided` by `gateId` into
proposal+decision rows (proposer, decider, decision, reason, timestamps,
`pending` when undecided) with each gate's `denials` attached
(`pairApprovalEvents` / `listApprovalAudit`).
Gates live in the task jsonb (DB-only; never mirrored to SharePoint).

### Questions for a named person (TASK-3567)

`src/lib/compliance/questions.ts` — a bot asks one person a question with
options and a recommendation (`mc_ask_question`, `question.ask`). A person who
could never see the task (outside its restricted project) is refused at asking
time (400 `addressee_no_access`), and bot-written text is stored on one line so
it cannot add lines to the person's answer comment. The question
appears only on that person's Approvals screen: `GET /api/questions` returns
the session person's open questions, filtered on the server by addressee
(`sessionAuthorId`) and by project ACL. `POST /api/questions/answer`
(`question.answer`, which members hold and agents are context-denied) answers
only when the session person is the addressee — any other person, an owner
included, gets 403 `not_addressee` and an appended `question.denied` event.
Under the task row lock the answer is stored on the question (`answer.choice`,
`answer.text`, `answeredBy`, ISO `answeredAt`, `commentId`) and posted to the
task as a `CMT-*` comment authored by the person; `question.answered` lands in
the same transaction. A second answer is 409 `question_already_answered`. An
open question never freezes the stage. `/?screen=approvals&question=<q_id>`
selects that question in the Approvals queue and opens it in the decision
sheet (TASK-3721). Questions live in the task jsonb
(DB-only; never mirrored to SharePoint). PLX_MC sends no notice to the person;
the asking bot passes on the `questionLink` it gets back (TASK-3559 covers
notifications).

### Approvals: My projects, decided history, reminders (TASK-3720)

`src/lib/compliance/my-projects.ts` resolves the viewer's projects: a project
is theirs when they are on its member list, own it, or are assigned (assignee
or coassignee) an open task in it. Open means not `isClosedStage` (merged,
verified, cancelled) and not in an archived bucket or project (`isArchived`).
An archived or closed project is never listed, whatever the reason.
The hierarchy is scoped with `scopeHierarchy` first, so a restricted project
the viewer cannot access is never theirs, even with a task assigned to them.
Ids match with `normalizeMemberToken` over the principal's email, oid and
directory ids, as the ACL does. Reasons come in the order member, owner,
assignee.

- `GET /api/approvals/projects` (`task.read`) returns `{ projects, questions,
  gates }`: every open question (to anyone) and every pending gate on the
  tasks of those projects, oldest first, each row with `projectId`. A
  question's text is already on the task's activity, and the whole task is
  readable through `GET /api/state` by everyone the ACL admits, so this widens
  nothing.
- `GET /api/approvals/decided?days=N` (`task.read`, `src/lib/compliance/decided.ts`)
  returns `{ decided }`, newest first, on ACL-visible tasks: questions whose
  `answer.answeredBy` is the session `sessionAuthorId`, and approved or
  rejected gates whose `decidedBy` equals the session audit label
  (case-insensitive; that is what `decideApprovalGate` stores). `days`
  defaults to 14 and is clamped to 1..90; a non-number is 400 `invalid_query`.
- `POST /api/questions/remind {taskId, questionId}` (`task.progress` plus the
  task's project ACL) lets a person on the task's project remind the
  addressee. `remindQuestion` in `questions.ts` refuses, in every enforcement
  mode: a task outside the person's projects (403 `not_my_project`), an
  unknown task or question (404 `not_found`), an answered question (409
  `question_already_answered`), the addressee (400 `self_reminder`) and a
  second reminder from the same person within `QUESTION_REMIND_COOLDOWN_MS`
  (12 h; 409 `already_reminded`). Under the task row lock it appends `{ by,
  at, commentId }` to `question.reminders`, posts the person's `CMT-*`
  comment `@`-mentioning the addressee (`mentions: [addressee]`) and appends
  `question.reminded`. It returns `{ question }`. The server sends no
  notification; the addressee sees the stored reminder on their Approvals
  screen.
- `mc_ask_question` takes an optional `context` (trimmed, at most
  `QUESTION_CONTEXT_MAX` = 2000 characters, omitted when empty) shown under
  the question. `context` is not part of the re-ask match: asking the same
  open question again returns the stored question with its original context.

### UAT tickets view (TASK-3706)

The BKT-UAT initiative page (`/?screen=bucket&bucketId=BKT-UAT`) shows one row
per UAT ticket task (`kind:code` plus `uat:<feedbackId>`): portal step, attempt,
stage, lease, PR, staging, holder, age, and a link to the portal ticket
(`https://staging.plxcustomer.io/uat?ticket=<feedbackId>`). Filters: All, Needs
a human (the bucket table's rule), In flight, Waiting on submitter (`uat:hold`,
or merged and awaiting re-test) and Verified. No row cap.

Portal step and staging come from the portal's read-only ticket snapshot, off by
default (`PLX_MC_UAT_PORTAL_READ_ENABLED`). The portal endpoint does not exist
yet: `GET /api/internal/uat-feedback/mc-snapshot`, Bearer
`PLX_MC_PORTAL_READ_TOKEN`, answering `{ "tickets": PortalTicket[] }` (the type
in `src/lib/tasks/uat-tickets.ts`) for open tickets and those closed in the last
30 days. Declaration: `config/integrations.yaml` → `uat-portal-read`.

Above the table, the portal ↔ Mission Control check lists each disagreement
with a one-click fix. Fixes run through `PATCH /api/tasks/{id}` and
`POST /api/tasks` under the person's session, so the usual capabilities and
audit apply. Mission Control never verifies a ticket task from this check.

| Case | Needs the portal read | Fix |
|---|---|---|
| Open ticket with no task | yes | Create the ticket task, with `needs-vince` so Steward waits for a person |
| Final task while the portal expects one | yes | Reopen a cancelled task to backlog; after Verified, create the next attempt |
| Open task while the ticket is closed | yes | Cancel as `obsolete`; a merged task on a resolved ticket has no fix (only the portal verifies) |
| More than one open task per ticket | no | Cancel the older ones as `superseded` by the newest attempt |
| Expired lease with no PR, past backlog | no | Requeue to backlog |

The check runs on page open, on **Check now**, after each fix, and daily:
`GET /api/cron/uat-drift` (`CRON_SECRET`, kill switch
`PLX_MC_UAT_DRIFT_CRON_ENABLED`, default off) records one `uat.drift.checked`
event and fixes nothing.

### Key Files

- `src/lib/compliance/risk.ts` — risk-tier classifier + per-tier bundle floor
- `src/lib/compliance/verify.ts` — `evidenceCompleteForTier` + `verifyCompliance`
- `src/lib/compliance/commit-signals.ts` — agent signals and the trailer block on a PR's head commits (`agentSignals`, `commitTrailers`)
- `src/lib/compliance/ste-lite.ts` — deterministic STE-lite writing check (`steLiteFindings`)
- `src/lib/compliance/evidence-standard.ts` — human-verification scope, warn-only week, blocking findings (TASK-3165); the MCP 400 lives in `src/lib/mcp/evidence-standard-guard.ts`. Also the visual-evidence week (`VISUAL_EVIDENCE_ENFORCE_FROM`, 2026-10-25) and `visualEvidenceMode`: a missing artifact blocks only after that date and only while the task can upload: uploads on, not Trading Lab and not a restricted project. An uploaded screenshot also counts as full-tier proof (TASK-3166). The explainer video (TASK-3167): `complexityReasons` (high-risk, more than 5 numbered steps in the description or evidence summary, 2 or more task repos) and `videoEvidenceMode` (`VIDEO_EVIDENCE_ENFORCE_FROM`, 2026-11-01, same upload rule). The gate reason starts `no explainer video:` and lands in the `gate.*` event `reasons`
- `src/lib/compliance/evidence-artifacts.ts` — visual evidence rules (TASK-3166): kinds and content types, a content sniff that must match the declared type, the 3 MiB limit, SharePoint-safe names, the `<system>/<project>/<bucket>/<task id>` folder and `hasVisualArtifact`; the upload is `src/lib/mcp/evidence-actions.ts`. Also the `video` kind (TASK-3167): mp4 or webm, sniffed from its bytes, 100 MiB or less (`MAX_VIDEO_BYTES`), named with its extension; a video is not visual evidence (`VISUAL_ARTIFACT_KINDS`), `hasVideoArtifact` checks it on its own
- `src/lib/compliance/types.ts` — `RiskTier`, `ActorKind`, `VerifyInput/Result`
- `src/lib/compliance/index.ts` — pure-core barrel (import through here)
- `src/lib/compliance/tracked-repos.ts` — fleet registry accessor (`TRACKED_REPO_SLUGS`, build-time JSON import of `config/tracked-repos-registry.json`) + pure `registryDrift()`; the Hub MCP checkout allowlist is derived from its `status: active` entries (`ACTIVE_TRACKED_REPO_SLUGS`, so pending/sandbox entries stay fail-closed) and `tests/tracked-repos-drift.test.ts` pins every subset list (pilots, go-live, loop ledgers, REPOS seed) to it
- `src/lib/compliance/service.ts` — server service: checkout / complete / verifyPr /
  ingest / `proposeRoutingFromPr` / listEvents
- `src/lib/compliance/repo.ts` — Postgres accessors (dispatch ledger, mc_events, check ledger)
- `src/lib/compliance/github-oidc.ts` — GitHub Actions OIDC verify + propose claim binding
- `src/lib/compliance/projection.ts` — PR lifecycle → sync task projection (authorize-gated)
- `src/lib/compliance/bucket-prd.ts` — bucket PRD resolution for verifyPr
- `src/lib/compliance/webhook.ts` — HMAC verify + PR-event parse (in-memory body)
- `src/lib/compliance/github-pr.ts` — GitHub PR → `VerifyPrInput` (stamps, labels, changed files) for `mc_verify_pr`; `loadPrReviewLinks` for the gate; `loadPrCommits` for the agent-commit check
- `src/lib/compliance/review-links.ts` — path → module → link map lookup, `## Review links` parser, warn-then-block rule (TASK-3168; data in `config/review-links-map.json`)
- `src/lib/compliance/go-live-announcer.ts` — one-line Teams Workflow posts on `checkout` / `pr.opened` / `task.completed` (TASK-1454/1699/1701; chat-primary, hard dedupe per task+event, coalesce only on sibling `sent`, kill switches default off; `ANNOUNCE_CHECKOUT` stays off unless operators re-enable)
- `src/lib/compliance/backfill.ts` — nightly GitHub backfill: merged PRs (last N days) per registry repo with no resolvable `MC-Checkout` stamp and no task `prs[]` link; injected GitHub client (stubbed in tests), fail-open per repo, one `github.backfill.report` row in `mc_events`; cron `src/app/api/cron/github-backfill/route.ts`, kill switch `PLX_MC_GITHUB_BACKFILL_ENABLED` (default off)
- `src/lib/compliance/activity.ts` — per-registry-repo activity summary (last activity, open/unstamped PRs, unattributed merges from the newest backfill report, 30-day gate block rate, freshness), a pure fold over `mc_events` served by session-gated `GET /api/activity` to the Activity screen (`/?screen=activity`, `src/components/mc/activity-view.tsx`); unknown is `null`, never 0
- `src/lib/compliance/in-flight.ts` — the Dashboard's live In flight view (TASK-2592): open checkouts grouped by task with each task's latest event, flags (several open checkouts, quiet 2 h+, ending within the hour), the newest 30 events of the last 24 h, and a task-write marker the client uses to reload its snapshot. A pure fold (`computeInFlight`) plus a loader that filters by project access like `/api/events` and `mc_list_checkouts`; it sends no checkout ids and no raw payloads. Served by session-gated `GET /api/in-flight`, polled every 20 s by `src/components/mc/dashboard-live.tsx`
- `src/lib/compliance/uat-tickets.ts` — the BKT-UAT tickets loader (TASK-3706): ticket tasks' filed time and lease (no checkout ids), the portal read (`uat-portal-read.ts`), the drift findings (`findUatDrift`) and `recordUatDriftCheck`; cron `src/app/api/cron/uat-drift/route.ts`. Types: `src/lib/tasks/uat-tickets.ts`; route `src/app/api/uat-tickets/route.ts`; view `src/components/mc/uat-tickets.tsx`
- `src/app/api/compliance/{checkout,complete,verify,webhook}/route.ts`, `src/app/api/events/route.ts`
- `src/app/api/routing/propose/route.ts` — OIDC propose (middleware carve-out exact)
- `src/middleware.ts` — exact self-auth carve-outs including `api/routing/propose`
- `.github/workflows/compliance-gate.yml` — the required PR status check (default-off; soft→hard)
- `scripts/compliance-checkout.mjs` + `.cursor/compliance-hooks.json` — the capture hook
- `db/migrations/005_compliance.sql` — `mc_events`, `mc_dispatch`, `mc_compliance_check`
- `docs/product/SYSTEM_OF_RECORD.md` — the governing spec (EN-007)

## Owner

Vince

## Criticality

Critical
