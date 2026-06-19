# Module: agents

## What

The agent roster and its operational model (EN-005 / WS-5). Owns the four-agent
fixture (Vibes/Atlas/Sentry/Scribe), each agent's `capabilities`, advisory
`defaultRepos`, and `mode` (`auto` vs needs-approval); the **mode-enforcement
policy** that gates an approve-mode agent's run; **derived presence** (active vs
idle); and the **activity feed** derived from real task events. It is explicitly
NOT the swarm runtime (`agentic-swarm`, a separate repo — no runtime coupling in
v1), and NOT the human directory (that is EN-003's roster).

## Why

EN-003 made the human directory real but left agents as the four prototype
personas with a fabricated `online: true`, no operational model, an unused `mode`
label, an empty feed, and a stubbed command-palette assignment. EN-005 turns the
roster into a real, governed model: `mode` now changes behavior, presence and the
feed are honest (no fabrication — Truth Before Action), and operator assignment is
wired to the real mutation spine.

## How

- **Source of truth = the in-repo fixture** `AGENTS` in `src/lib/mc-data/data.ts`,
  hydrated via the existing client store like `REPOS` (no DB/SharePoint persistence
  for agents in v1; the operator can swap in live swarm names later).
- **Mode enforcement** lives in `src/lib/mc-data/policy.ts` `stageAdvanceViolation`:
  an `approve`-mode agent executor cannot advance a task into the doing band
  (`progress`+) until `task.agentRunApproved` is set by an operator. `auto`-mode
  agents are subject only to the EN-003 owner/evidence gates. Enforced in lockstep
  on the client store (`patchTaskFields`) and the server (`sync/state.ts patchTask`).
- **Operator approval** is `store.setAgentRunApproved` (DB-only patch, no SharePoint
  column), surfaced in task detail when the executor is a needs-approval agent.
- **Presence is derived, not fabricated:** `helpers.agentIsActive` /
  `helpers.liveAgentCount` mark an agent active only when it executes an in-flight
  (doing-band) task. `Agent.online` is honestly `false` (there is no heartbeat).
- **Feed is derived:** `components/mc/record-logic.deriveAgentFeed(tasks)` builds the
  feed from agent-authored task `activity` — empty until agents actually pick up
  work. There is no static `AGENT_FEED` fixture.
- **Assignment is operator-driven:** the command palette's "Assign open task to
  {agent}" routes through `store.reassignTask` (which enforces the human-only
  policy); no autonomous swarm-pull loop in MC.
- **Real presence (future):** the EN-007 dispatch ledger (`mc_dispatch`) is the
  natural source for true "running now" presence; wiring it is a later increment.

## Dependencies

`@/lib/mc-data` (the `Agent`/`Task` types, `policy.ts`, `helpers.ts`), the task
store (assignment + the `agentRunApproved` patch path), and the server task
mutation (`@/lib/sync` `patchTask`, which enforces the same mode gate). Advisory
`defaultRepos` reference the `repos` module's registry ids. Depended on by:
`components/mc/agent-feed.tsx`, `command-palette.tsx`, `people-picker.tsx`,
`task-detail.tsx`, and `chrome.tsx` (live-agent count).

### Key Files

- `src/lib/mc-data/data.ts` — the `AGENTS` roster + operational model (source of truth) and the `MODE` label map
- `src/lib/mc-data/types.ts` — `Agent` (capabilities / defaultRepos / mode / online), `AgentMode`, `Task.agentRunApproved`
- `src/lib/mc-data/policy.ts` — `stageAdvanceViolation` (the mode gate + EN-003 gates), `isAgentId`
- `src/lib/mc-data/helpers.ts` — `agentIsActive`, `liveAgentCount` (derived presence)
- `src/lib/mc-data/store.ts` — `setAgentRunApproved`, `reassignTask` (assignment spine)
- `src/components/mc/record-logic.ts` — `deriveAgentFeed` (feed from real task events)
- `src/components/mc/agent-feed.tsx` — the Agent activity screen (derived feed + presence)
- `src/components/mc/command-palette.tsx` — wired "Assign open task to {agent}"
- `src/components/mc/task-detail.tsx` — the "Approve agent run" control
- `tests/mc-agents.test.ts` — roster model, mode enforcement, presence + feed derivation

## Owner

Vince

## Criticality

Medium
