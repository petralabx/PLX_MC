# MC go-live Teams announcer

**Task:** TASK-1454  
**Accountable:** `vince@petrasoap.com`  
**Channel:** `BC go-live` in Team `PLX Projects`  
**Transport:** Teams Workflow webhook (not Graph channel-message send)

Mission Control checkout remains the only claim. A Teams line is never authorization.

## Kill switches

All default **off**. Set on the Mission Control host (Vercel project `plx-mission-control`).

| Variable | Default | Effect |
|---|---|---|
| `MC_GO_LIVE_ANNOUNCER_ENABLED` | off | Master switch |
| `MC_GO_LIVE_ANNOUNCE_CHECKOUT` | off | Checkout lines |
| `MC_GO_LIVE_ANNOUNCE_PR_OPEN` | off | PR-open lines |
| `MC_GO_LIVE_ANNOUNCE_COMPLETE` | off | Completion lines |
| `MC_GO_LIVE_ANNOUNCER_DRY_RUN` | off | When `1`, never contacts Teams |
| `MC_GO_LIVE_TEAMS_WORKFLOW_URL` | empty | Workflow URL from the shared secret store |
| `MC_GO_LIVE_TEAM_ID` | approved Team | Must match `73b1b6fb-ea03-493c-b1a0-3af4883a2953` |
| `MC_GO_LIVE_CHANNEL_ID` | approved channel | Must match `19:046f10be721e4782906a2309e8a7492d@thread.tacv2` |

Missing, malformed, or non-allowlisted config fails closed (no send). Checkout and complete still succeed.

## Immediate rollback

1. Set `MC_GO_LIVE_ANNOUNCER_ENABLED=0` on the host. Posts stop.
2. Or set any per-event switch to `0`.
3. Or set `MC_GO_LIVE_ANNOUNCER_DRY_RUN=1`.
4. Or turn the Workflow **Off** in Power Automate. The Team and channel stay.

Do not delete the Team, the three people, or the human introduction.

## Lines

- Checkout: `<actor> claimed TASK-#### (<title>)`
- PR open: `PR opened for TASK-####: https://github.com/petralabx/<repo>/pull/<n>`
- Complete: `TASK-#### complete`

Dedup key: `announce:<eventId>` in `mc_events`. Replays do not post twice.
