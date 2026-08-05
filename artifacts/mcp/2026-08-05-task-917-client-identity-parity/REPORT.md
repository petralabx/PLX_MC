# TASK-917 MCP client identity parity

## Scope

Close client-side identity selection parity without changing server grants or
retiring the shared Cursor compatibility key.

## Before

- The launcher and workstation bootstrap defaulted every client to
  `PLX_MC_MCP_API_KEY`.
- A Claude, Hermes, Codex, or swarm client could silently authenticate as
  `sp_mcp_cursor`.
- Operator docs did not consistently distinguish Cursor Cloud's shared identity
  from dedicated agent identities.

## After

- `MC_MCP_PRINCIPAL_ID` selects one reviewed durable principal.
- Known runtimes map to Cursor, Claude/Hermes, Codex, or swarm identities.
- Cursor alone may use `PLX_MC_MCP_API_KEY`.
- Dedicated principals read only `plx/prod/mc/mcp-agent-keys/v1`; a missing
  registry entry fails closed.
- Non-Cursor workstation bootstraps write isolated loader files and do not
  overwrite Cursor's default loader.
- Authenticated launcher smokes resolved `sp_mcp_cursor` and
  `sp_mcp_claude_code` as requested.

## Verification

- Red controls:
  - Node selector test failed before `key-resolution.mjs` existed.
  - Six Python bootstrap tests failed before `select_mcp_key` existed.
  - Missing `sp_mcp_codex` registry entry produced
    `missing_dedicated_key_fail_closed=True`.
- Targeted green:
  - 22 Node identity tests passed.
  - 11 Python bootstrap/sync tests passed.
  - Cursor and Claude authenticated launcher smokes passed.
  - Typecheck, ESLint, Ruff check, and Ruff format check passed.
- Canonical gates:
  - `scripts/preflight.sh --mode pre-commit` passed.
  - First pre-push attempt encountered `EADDRINUSE` on E2E port 3931; four
    browser tests then received connection refusals.
  - The listener cleared without a code change. The unchanged pre-push gate
    then passed: 106 Python, 1,412 Node, and 224 E2E tests.

## Residual risk

The dedicated registry currently proves the Claude/Hermes identity. Codex and
swarm selection is implemented and fail-closed, but those clients remain
disabled until an operator provisions their registry entries and client
registrations.

## Rollback

Revert the TASK-917 commit. Keep `PLX_MC_MCP_SHARED_KEY_ENABLED=1` and restore
Cursor clients to the unchanged shared key path. No secret rotation or database
rollback is required.
