# Sync engine v1 — live verification against /sites/plx-mission-control-dev

- **Date:** 2026-06-11 (ET)
- **Scope:** outbound push + inbound delta poll (ToDos, Risk Register),
  conflict queue, push-error retry, audit log, in-app scheduler.
- **Stack under test:** Next.js dev server (port 3010) + `plx_mc` staging
  Postgres + the staging SharePoint site, real Microsoft Graph calls.

## Flows verified (chronological)

### 1. Seed + first sweep (outbound create)

`GET /api/state` seeded the mirror: `tasks=13 risks=4 files=21 conflicts=2 errors=1`
(fixture "synced" states reset to pending — nothing had actually been pushed).

`POST /api/sync/sweep` №1:

```
pushed=14 pushErrors=0 → todos {synced:12, conflict:1}, risks {synced:2, conflict:1, error:1}
```

### 2. Idempotence

Sweep №2: `pushed=0 pulled=0 conflicts=0 errors=0`.

### 3. §5.2 push-error retry (Likelihood normalization)

`POST /api/sync/errors/er-risk4/retry` → `{retried:true}`; RISK-4 → synced; audit:

```
Retried push for RISK-4 · Likelihood — value normalized ("Medium" → "Med") and accepted.
```

### 4. Clean inbound pull

SharePoint-side edit (Graph PATCH item 12: `Priority=High`) → sweep №3
`pulled=1` → MC `TASK-219.priority == high`.

### 5. Two-sided conflict (§5.1) — including a caught+fixed ordering bug

First attempt EXPOSED A BUG: with outbound running before inbound, the MC
edit (`due=Jun 25`) was pushed over SharePoint's edit (`Jun 26`) —
last-write-wins, which §5.1 forbids. **Fix:** the sweep now runs inbound
delta BEFORE outbound push, so dirty-field conflicts are raised first and
conflicted entities are held back from push. Re-test (MC `Jun 27` vs SP
`Jun 28`):

```
sweep5: pushed=0 pulled=0 conflicts=1
{"id":"cf-task-219-due-…","field":"Due Date","mcVal":"Jun 27","spVal":"Jun 28", …}
TASK-219 sync state: conflict
```

### 6. Manual resolution (human picks the winner)

`POST /api/sync/conflicts/{id}/resolve {winner:"sp"}` → `due=Jun 28`,
state `synced`, only the 2 seeded fixture conflicts remain open.

### 7. Create → push (spec §6 pending semantics)

`POST /api/tasks` → `TASK-220 state=pending`; sweep №6 `pushed=1` →
`"sp":"ToDos · item 13","state":"synced"`. Graph read-back of item 13:

```
TaskID=TASK-220 Priority=Low DueDate=2026-06-30T00:00:00Z Status=Backlog
```

### 8. Persistence + in-app scheduler

`delta_links` rows persisted for `todos` and `risks` (343-char Graph
deltaLinks); 17 audit rows. Dev server restart with `PLX_MC_SYNC_ENABLED=1`:

```
✓ Ready in 285ms
[sync] scheduler started — sweeping every 5 min
[sync] sweep ok — pushed=0 pulled=0 conflicts=0 errors=0
```

With the flag unset the scheduler logs `disabled` and never starts (kill
switch, TOOLS.md).

## Also fixed during verification

- Inbound date rendering now pads single-digit days (`Jun 06`) to match the
  canonical MC display format — the unpadded form caused two phantom inbound
  "changes" on the initial delta.

## Known deferrals (documented in docs/modules/sync/README.md)

Person columns, lookup columns, documents library sync, webhooks, directory
and notifications — all wait on the directory increment / public deploy.
