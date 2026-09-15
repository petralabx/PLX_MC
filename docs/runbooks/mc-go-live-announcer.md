# MC go-live Teams announcer

**Task:** TASK-1454 / TASK-1524 / TASK-1699  
**Accountable:** `vince@petrasoap.com`  
**Live dest:** Teams chat Workflow (`MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL`) — intended live path  
**Optional dest:** channel Workflow (`MC_GO_LIVE_TEAMS_WORKFLOW_URL`); leave empty when chat is the live path  
**Transport:** Teams Workflow webhook (not Graph channel-message send, not Graph Chat.ReadWrite / Chat.Send / ChannelMessage.Read.*)

Mission Control checkout remains the only claim. A Teams line is never authorization.

## Kill switches

All default **off**. Set on the Mission Control host (Vercel project `plx-mission-control`).

| Variable | Default | Effect |
|---|---|---|
| `MC_GO_LIVE_ANNOUNCER_ENABLED` | off | Master switch |
| `MC_GO_LIVE_ANNOUNCE_CHECKOUT` | off | Checkout lines. **Keep off** unless operators explicitly re-enable. Checkout chatter is noisy; PR-open + complete are the live events. |
| `MC_GO_LIVE_ANNOUNCE_PR_OPEN` | off | PR-open lines |
| `MC_GO_LIVE_ANNOUNCE_COMPLETE` | off | Completion lines |
| `MC_GO_LIVE_ANNOUNCER_DRY_RUN` | off | When `1`, never contacts Teams |
| `MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL` | empty | Intended live path: Workflow that posts into the operator chat. |
| `MC_GO_LIVE_TEAMS_WORKFLOW_URL` | empty | Optional channel Workflow. Used only when the chat URL is empty/malformed. Do not set both expecting dual posts. |
| `MC_GO_LIVE_TEAM_ID` | approved Team | Must match `73b1b6fb-ea03-493c-b1a0-3af4883a2953` |
| `MC_GO_LIVE_CHANNEL_ID` | approved channel | Must match `19:046f10be721e4782906a2309e8a7492d@thread.tacv2` |
| `MC_GO_LIVE_STORAGE_CONNECTION_STRING` | empty | Optional Azure Blob overlay on account `stvmcresearch` (alias `AZURE_STORAGE_CONNECTION_STRING`). |
| `MC_GO_LIVE_DELIVERY_CONTAINER` | `mc-go-live-delivery` | Private container on that account. Create it once; this code never prints the connection string. |

Missing, malformed, or non-allowlisted team/channel IDs fail closed (no send). Checkout and complete still succeed. At least one HTTPS Workflow URL (chat preferred, else channel) is required when the announcer is enabled.

## Single delivery path

The announcer POSTs `{ text: line }` to **one** dest:

1. Chat Workflow, when `MC_GO_LIVE_TEAMS_CHAT_WORKFLOW_URL` is a valid HTTPS URL.
2. Else the channel Workflow, when `MC_GO_LIVE_TEAMS_WORKFLOW_URL` is a valid HTTPS URL.

It does **not** fan out to channel+chat. Dual posting was the TASK-1524 optional path and is retired as the default. The chat dest is Workflow-only — no Graph Chat.ReadWrite or ChannelMessage.Read.*.

## Lines

Markdown deep links, never bare ids or raw GitHub URLs:

- Checkout (only if `MC_GO_LIVE_ANNOUNCE_CHECKOUT=1`): `<actor> claimed [TASK-#### — <title>](https://mc.plxcustomer.io/tasks/TASK-####)`
- PR open: `PR opened for [TASK-#### — <title>](https://mc.plxcustomer.io/tasks/TASK-####) — [PR #n](https://github.com/petralabx/<repo>/pull/<n>)`
- Complete: `[TASK-#### — <title>](https://mc.plxcustomer.io/tasks/TASK-####) complete`
- Combined complete (when the complete payload carries a PR URL and no PR-open was already announced): `[TASK-#### — <title>](...) complete — [PR #n](...)`

`pr.opened` events store a bare repo slug (`plx-customer-portal`, `agentic-swarm`, `PLX_MC`). The announcer normalizes those allowlisted slugs to `petralabx/<slug>` before building the GitHub URL. Already-qualified `petralabx/...` is accepted. An unknown bare slug fails closed.

## Hard dedupe

At most one successful post per `(taskId, eventType)`:

- Dedup key: `announce:<kind>:<taskId>` in `mc_events` (for example `announce:task.completed:TASK-1697`).
- Claim **before** the Workflow POST (`INSERT … ON CONFLICT DO NOTHING RETURNING seq`). Re-fires, webhook retries, and a second `complete()` with a different checkout id do not post again.
- Optional Azure Blob overlay on `stvmcresearch` / `mc-go-live-delivery` uses `If-None-Match: *`. TASK-1454 approved that container; it was never wired until TASK-1699. When the connection string is unset, Postgres is the gate. Blob is written **after** a won Postgres insert. A 409/412 from Blob must not revoke that win or block a retry that has no `mc_events` row.

`appendEvent` skips the announcer when a keyed `mc_events` insert is a no-op (webhook replay).

## Coalesce

If `pr.opened` and `task.completed` fire within 15 minutes for the same task, the later event is skipped (`coalesced`) only when the sibling row is `payload.status = sent`. A claimed-but-unsent sibling (failed Workflow POST) does not suppress the other kind. When complete arrives first with a PR URL, one combined line is posted and the PR key is claimed **after** that POST succeeds so a lagging GitHub webhook does not add a second message. Overlapping in-flight claims may post both lines rather than drop to zero.

## Immediate rollback

1. Set `MC_GO_LIVE_ANNOUNCER_ENABLED=0` on the host. Posts stop.
2. Or set any per-event switch to `0`.
3. Or set `MC_GO_LIVE_ANNOUNCER_DRY_RUN=1`.
4. Or turn the Workflow **Off** in Power Automate. The Team, chat, and channel stay.

Do not delete the Team, the three people, or the human introduction. Do not flip host env from this PR — CIP / operators own Vercel.
