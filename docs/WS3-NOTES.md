# WS-3 — Collaborative task & sub-task workspace (EN-001)

Branch: `feat/enh-ws3-collaboration` (from `feat/enh-ws1-directory-accountability`).
Scope: the collaboration surface only — comments, the unified timeline, an
editable description, and enriched sub-tasks. No repo-registry / governance work
(that is WS-2's lane).

## What changed

### Data model — `src/lib/mc-data/types.ts`
- New `Comment` (`id`, `author`, `body`, `ts`, `mentions[]`, `editedTs?`).
- New `SubtaskStatus` (`todo` | `doing` | `blocked` | `done`).
- `Subtask` enriched (all optional, additive): `description?`, `assignee?`
  (augments the existing single-avatar `who`), `due?`, `status?`.
- `comments?: Comment[]` on **`Task`** and **`Bucket`** (optional to keep the
  change surgical — no churn across the 15 task / 8 bucket fixtures, consistent
  with the existing `description?` / `evidence?` optional-field convention).

### Pure helpers — `src/lib/mc-data/collab.ts` (new, exported via the barrel)
- `parseMentions(body, validIds)` — extracts `@id` tokens, keeps only ids that
  resolve to a known actor, dedupes. Never invents a recipient.
- `mergeTimeline(comments, activity)` + `epochFromStamp` / `epochFromAge` — the
  ONE newest-first stream that interleaves comments with system activity. Items
  with a resolvable time sort by it descending; unparseable relative ages sink
  to the tail in input order (stable).

### Store — `src/lib/mc-data/store.ts`
- `description` and `comments` added to `TaskFieldPatch` (the persisted-mutation
  allow-list).
- `setTaskDescription` — SP-tier (Description IS mapped two-way, so the trail
  honestly claims a pending push).
- Task comments: `addComment` / `editComment` / `deleteComment` — persist through
  the existing optimistic `patchTaskFields` spine (reconcile-on-success /
  rollback+notice-on-failure). Edit/delete are author-gated.
- Sub-tasks: `updateSubtask` (keeps `done` ⇄ `status` consistent),
  `reorderSubtasks`, `promoteSubtaskToTask` (reuses `addTask`; inherits the
  parent bucket + repos and removes the sub-task with a traceable activity line).
- Bucket comments: `addBucketComment` / `editBucketComment` /
  `deleteBucketComment` + `commentsForBucket` getter, backed by a new
  store-authoritative `bucketComments` map (see persistence note below).
- `mentionables()` getter (directory humans + agent roster) for the composer.
- `@mention` notify path: `notifyMentions` reuses the existing inbox-notification
  + audit pattern — an in-app `mention` notification is created now, and the
  audit row records that the **Teams + email mirror is deferred** to the
  directory/notification increment. No fabricated delivery (same honest narrative
  as `reassignTask`).

### Server lockstep
- `src/lib/sync/state.ts` `PatchTaskInput` — added `comments?` (DB-only; not in
  `PUSHED_FIELDS`, so never pushed to SharePoint).
- `src/app/api/tasks/[id]/route.ts` — `subtaskSchema` extended with the optional
  enriched fields (`done` stays required); new `commentSchema`; `comments`
  added to `patchTaskSchema` (client/server lockstep).

### UI
- `src/components/mc/timeline.tsx` (new) — unified timeline + mention-aware
  composer (`@` autocomplete against the real directory, ⌘/Ctrl+↵ to post,
  edit/delete own comments, clear comment-card vs system-event styling). Reused
  on both task and bucket detail.
- `src/components/mc/subtask-list.tsx` (new) — enriched sub-task rows with an
  expandable detail editor (description / assignee picker / due / status),
  up/down reorder, and promote-to-task.
- `src/components/mc/task-detail.tsx` — editable Description block; the flat
  sub-task list replaced by `SubtaskList`; the read-only `/ Activity` log
  replaced by the unified `/ Timeline`.
- `src/components/mc/bucket-detail.tsx` — became a client component; added a
  `/ Discussion` thread.
- `src/styles/mc-task.css` — token-only (`--p-*`) styles for the new surfaces.

## Comment persistence approach (decision)

- **Task comments → server-persisted.** They route through `patchTaskFields` →
  PATCH `/api/tasks/{id}` → the task jsonb blob, on the **DB-only tier** (never
  mirrored to a SharePoint comment column, per the aligned EN-001 decision).
  This reuses the existing optimistic reconcile/rollback spine, so they survive
  a hydrate.
- **Bucket comments → store-authoritative for v1.** Buckets currently have **no
  server persistence layer at all** (they are static `BUCKETS` fixtures; there is
  no `/api/buckets` route or engine entity). Standing up bucket persistence is a
  heavy, out-of-lane change, so per the WS-3 brief ("store-authoritative is
  acceptable for v1 if a server endpoint is heavy — note it") bucket comments
  live in a reactive store map and do not survive a reload. **Needs a decision
  before integration** if bucket-thread durability is required for v1.

## Deferred / TODO (honestly labelled)

- **Sub-task fields → SharePoint mirror (SHOULD):** deferred. `Description` is
  already mirrored (mapping.ts), but sub-tasks are a DB-only `Subtask[]` with no
  SharePoint column; serializing them needs a schema/mapping change that risks
  colliding with the sync increment and is out of WS-3's surgical scope. Left as
  a TODO, consistent with the existing "person/lookup columns deferred" narrative.
- **Bucket comment durability:** see persistence note above.
- **@mention delivery (Teams + email):** intentionally NOT implemented as real
  delivery — reuses the existing deferred-mirror narrative (in-app inbox + audit
  now; external delivery lands with the directory/notification increment).
- **Heavy Playwright E2E:** skipped per the brief; covered by unit/store tests.

## Verification (all from the worktree)

```
npm run typecheck   → exit 0 (clean)
npm run test        → 20 files, 285 passed (257 baseline + 28 WS-3)
npm run build       → success (7/7 static pages, no type errors)
./scripts/preflight.sh --mode pre-commit → all checks passed
```

ESLint: the only error is the pre-existing `src/components/mc/shell.tsx:134`
(`react-hooks/set-state-in-effect`) — out of WS-3 scope, untouched, and not in
the preflight gate.

New tests:
- `tests/mc-collab.test.ts` — `parseMentions`, `mergeTimeline`, epoch helpers.
- `tests/mc-collab-store.test.ts` — comment CRUD, mention→notification (+ no
  self-notify), sub-task field edits / status⇄done / reorder, promote-to-task,
  editable description (optimistic + reconcile), bucket-thread CRUD + author gate.
- `tests/api-route.test.ts` — enriched sub-task schema, comment schema.
- `tests/mc-patch.test.ts` — comments round-trip DB-only at the server boundary.
