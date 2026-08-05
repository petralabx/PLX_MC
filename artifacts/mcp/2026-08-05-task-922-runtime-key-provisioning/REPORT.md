# TASK-922 runtime key provisioning

## Scope

Provision every reviewed dedicated MCP runtime identity, preserve all existing
credentials, synchronize the authoritative registry to Vercel Production, and
verify identity resolution without exposing key values.

Accountable owner: Vince.

## Result

- Added missing registry entries for `sp_mcp_codex`, `sp_mcp_grok`,
  `sp_mcp_hermes`, and `sp_mcp_swarm`.
- Preserved the existing `sp_mcp_claude_code` key and shared
  `sp_mcp_cursor` key byte-for-byte.
- Preserved all unrelated `prod/ec2-secrets` fields.
- Kept `plx/prod/mc/mcp-agent-keys/v1` and the compatibility mirror equal.
- Updated Vercel Production variable `PLX_MC_MCP_AGENT_KEYS` as sensitive.
- Redeployed production from `main` at
  `7642ea8f4d044290893e71aa5d3ad50e85419d4c`.
- Updated the local Hermes environment to use `sp_mcp_hermes`; the legacy
  `PLX_MC_MCP_API_KEY` name is absent.

## Redacted production evidence

- Registry SHA-256:
  `437764930725116fb38942bf4d60831ea41eceab845684e84144f85107a20ad6`
- Shared-key SHA-256, unchanged:
  `4a0358b3ca040131b684bba2897d4ef7f6776d93a29eb87960bc1d8a1921067b`
- Dedicated secret version:
  `8a4088f8-6833-4752-a817-4bab8976091a`
- Compatibility mirror version:
  `c12e552f-4b74-4f46-9d14-1a5a75f927ab`
- Vercel environment variable ID: `5yq0ailHk5KXjgNI`
- Previous deployment: `dpl_8nYhTVhi3d6oNiwhLGXCifLWJLPn`
- Active deployment: `dpl_BKHm1JQWGSqtGU2MjZGU3QfMjUwG`
- Deployment status: `READY`
- Production domain active: `true`
- Identity checks: Cursor, Claude Code, Codex, Grok, Hermes, and swarm all
  resolved to their expected service principals.

The first write attempt failed an immediate `AWSCURRENT` readback and restored
both original values successfully. The successful attempt verified the exact
returned version IDs before polling current-version activation.

## Verification

- Failing controls observed before implementation:
  - Hermes client runtime resolved to `sp_mcp_claude_code`.
  - Grok and Hermes were absent from both client principal registries.
  - The sync path reported only Claude and shared-Cursor identity checks.
- `npm test -- tests/mcp-client-key-selection.test.ts tests/mcp-agent-keys.test.ts`
- `.venv/Scripts/python -m pytest tests/test_bootstrap_windows_secrets.py tests/test_sync_mcp_agent_keys.py -q`
- `npm run typecheck`
- Ruff lint and format checks for changed Python files.
- `bash scripts/local-agent-preflight.sh --online` with the scoped Hermes
  environment: `READY`.

## Rollback plan

1. Restore the prior version of `plx/prod/mc/mcp-agent-keys/v1`.
2. Restore the matching prior `PLX_MC_MCP_AGENT_KEYS` mirror value in
   `prod/ec2-secrets`.
3. Run `scripts/sync-mcp-agent-keys.py` to restore Vercel Production and
   redeploy.
4. Confirm the active domain points to the rollback deployment and rerun all
   remaining identity checks.
5. Revert the principal-selector commit and local Hermes configuration only if
   the reviewed Grok/Hermes service-principal registration is also rolled back.
