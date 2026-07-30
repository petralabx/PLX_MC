# Cursor Cloud parity closeout

**Date:** 2026-07-30  
**Bucket:** `BKT-MISSION-CONTROL-OPS`  
**Accountable owner:** Vince  
**Primary task:** [TASK-845](https://mc.plxcustomer.io/tasks/TASK-845)  
**Checkout:** `MC-Checkout: dsp_ms7dv6kdja7tl2`

## Verdict

Practical governed closeout parity passed through a Hub-only inline MCP launch
with encrypted session-scoped REST identity fallback. Direct multi-server
parity remains partial: when Hub and Portal share the exact MCP endpoint, one
server receives the 15-tool catalog and the other is left empty. A Portal-only
Cloud launch reversed the result (Portal 15 tools, Hub empty), proving an
endpoint attachment collision rather than Portal auth failure. The Cloud MCP
presentation also omitted the outer `{ data, meta }` envelope from
`mc_self_check`; REST self-checks with the same repo/runtime headers supplied
the required actor identity before lifecycle writes.

The saved dashboard environment was not attached to explicit `repos[]` API
launches. Those runs did not inherit its Runtime Secrets or install state.
This is now documented; it is not reported as proof that the saved environment
is missing its configured secrets. Dashboard inspection found an existing
active ten-repository Team environment (`1hr-after +9`); it still needs the
five environment-scoped operational secrets copied from the six-repository
environment before it can replace inline secret injection.

The stale/seed-backed Mission Control diagnosis was resolved during closeout.
Microsoft returned `AADSTS7000222` for the expired server Graph client secret.
The replacement value was validated against the production SharePoint site and
required lists, written to AWS Secrets Manager and Vercel, and deployed at the
exact prior production SHA. The next scheduled sweep restored
`graphTokenOk=true`, `dataSource=live`, and `freshness.ok=true`.

## Success criteria

1. **Governed Cloud lifecycle — passed with identity fallback.** Agent
   `bc-ac87225b-9a78-496e-addb-b3f727deb703` saw 15 Hub tools, received
   `mc_self_check: ok=true, mcpEnabled=true`, confirmed
   `meta.actor.repo=petralabx/PLX_MC` and
   `meta.actor.runtime=cursor-cloud` through REST, then completed
   `mc_checkout_task -> mc_report_progress -> mc_complete_task` on TASK-847.
2. **Dashboard fallback SOP — passed.** The inline launch, one-retry policy,
   exact REST headers/bodies, and explicit-repo environment limitation are
   documented in the canonical runbooks.
3. **Evidence bundle — passed.** This report and `index.md` contain commands,
   outcomes, agent URLs, task/checkouts, failures, and human-only follow-ups.
4. **Runbook drift — passed.** Cloud Team/inline HTTP now consistently uses
   `x-mc-runtime: cursor-cloud`; Desktop retains `cursor`.
5. **MC hygiene — passed for verification task.** TASK-847 was created in
   `BKT-MISSION-CONTROL-OPS`, checked out and completed by the Cloud Agent with
   evidence. TASK-846 was subsequently checked out through the Portal MCP with
   exact `petralabx/plx-customer-portal` actor identity and completed with the
   Portal-only evidence. TASK-845 is the governed documentation/evidence task.
6. **Production sync recovery — passed.** The expired Graph client secret was
   rotated in AWS and Vercel; production deployment
   `dpl_BKC5nigZE1z8QDVEjMLcQ7foCYe1` reached Ready at SHA
   `83d56c3c8b66a78a216ac5817b1fba1e48ba75f2`, and
   `mc.plxcustomer.io` resolved to that deployment.
7. **Workstation hydrate — passed.** The generated fragments were refreshed
   from AWS, sourced, and the matched workstation Graph credential set acquired
   a token. `boto3` is now declared in `requirements.txt`; this repository has
   no `pyproject.toml` manifest to update in parallel.

## Cloud Agent evidence

### Multi-server catalog run

- Agent: `bc-076df4d0-df4f-434c-b3fa-78e6f2332346`
- URL: https://cursor.com/agents/bc-076df4d0-df4f-434c-b3fa-78e6f2332346
- Run: `run-c1e2eacb-b7a5-4127-a093-55f7c5cb42e1`
- Hub: non-empty 15-tool catalog; `mc_self_check` returned
  `ok=true`, `mcpEnabled=true`.
- Portal: empty catalog; direct invocation reported the server unavailable.
- Team Rules: all four `cursor-cloud-team-rules.v1` titles visible.
- Lifecycle: correctly not run because Portal actor identity could not be
  verified.

### Single permitted multi-server retry

- Agent: `bc-a43642d3-0bc6-4931-8ddb-a1f0689f9adc`
- URL: https://cursor.com/agents/bc-a43642d3-0bc6-4931-8ddb-a1f0689f9adc
- Run: `run-4976c6c8-9299-4fcc-9657-7bf2bbd1dfbe`
- Hub: non-empty catalog; outer `meta.actor` omitted from the MCP result shown
  to the agent.
- Portal: empty catalog again.
- Team Rules: all four titles visible.
- Runtime Secrets: not present because explicit `repos[]` does not attach a
  named saved environment.
- Cloud E2E: failed before authentication (`playwright` absent, no inherited
  E2E/DB environment values). No install was attempted.
- Lifecycle: correctly not run because repo identity could not be proven.

### Hub-only governed lifecycle proof

- Agent: `bc-ac87225b-9a78-496e-addb-b3f727deb703`
- URL: https://cursor.com/agents/bc-ac87225b-9a78-496e-addb-b3f727deb703
- Run: `run-8f50e2fd-eecd-4403-9320-6713bd2ea001`
- Hub catalog: 15 `mc_*` tools.
- MCP self-check: `ok=true`, `mcpEnabled=true`,
  `freshness.ok=false (sync_stale)`, `dataSource=seed`.
- Encrypted session `envVars`: `PLX_MC_MCP_API_KEY` present, length 62.
- REST identity: `meta.actor.repo=petralabx/PLX_MC`,
  `meta.actor.runtime=cursor-cloud`,
  `meta.actor.operatorEmail=cos@petrasoap.com`.
- TASK-847 checkout:
  `MC-Checkout: dsp_ms7ejiaek7r6sf`.
- Progress: stage `progress`, 75%, accepted.
- Completion: evidence recorded, sync queued.
- Code/PR/deploy mutations: none.

### Portal-only isolation and reconciliation

- Agent: `bc-0e350085-90e0-427a-9005-95044ec25e49`
- URL:
  https://cursor.com/agents/bc-0e350085-90e0-427a-9005-95044ec25e49
- Run: `run-ddaabfbb-6c8e-407a-94dc-81fe6c3dc2ff`
- Portal catalog: 15 `mc_*` tools; `mc_self_check` returned
  `ok=true`, `mcpEnabled=true`.
- Hub remained registered but had an empty catalog.
- REST identity:
  `meta.actor.repo=petralabx/plx-customer-portal`,
  `meta.actor.runtime=cursor-cloud`,
  `meta.actor.operatorEmail=cos@petrasoap.com`.
- Portal reconciliation checkout:
  `MC-Checkout: dsp_ms7kmljwrk777a`; TASK-846 completed with evidence.
- Code/PR/deploy mutations: none.

### Attachment collision status

The previously described Hub/Portal empty-catalog behavior is now localized to
an endpoint attachment collision. Hub was non-empty in the multi-server agents,
while Portal was non-empty when launched alone and Hub became empty. A
distinct-query-string experiment failed during Cloud run setup before a catalog
was produced, so it is not an accepted workaround. Inline one-server launches
plus REST identity verification remain the reliable SOP.

## IDE and REST smokes

- Secret hydrate:
  the initial system-Python run failed with `ModuleNotFoundError: boto3`.
  After declaring/installing `boto3`, the script regenerated
  `~/.secrets-env.staging.ps1`, `~/.secrets-env.github.ps1`, and
  `~/.secrets-env.github`; sourcing the staging fragment and acquiring a
  workstation Graph token passed.
- Initial supported fallback: `. $HOME\load-secrets.ps1` loaded the AWS secret set.
  Required values were present with lengths only:
  `CURSOR_CLOUD_SERVICE_API_KEY=69`, `PLX_MC_MCP_API_KEY=62`,
  `PETRALABX_GITHUB_TOKEN=93`, `PLX_E2E_EMAIL=17`,
  `PLX_E2E_PASSWORD=16`, `VERCEL_TOKEN=60`.
- Hub MCP self-check from IDE: passed with
  `meta.actor.repo=petralabx/PLX_MC`; mirror freshness was stale/seed-backed.
- REST fallback:
  `GET https://mc.plxcustomer.io/api/cursor/self-check` with
  `x-mc-runtime: cursor-cloud` passed and returned the exact Hub actor repo.
- GitHub:
  `gh api user` and `gh api repos/petralabx/PLX_MC` passed as
  `taylorvalton`; repository visibility returned `public`.
- Vercel:
  `GET https://api.vercel.com/v9/projects?limit=100` authenticated and found
  both `plx-customer-portal` and `plx-mission-control`.
- Graph root cause and recovery:
  - the old server credential failed with `AADSTS7000222`;
  - the replacement token and production SharePoint site/list resolution
    passed before rotation;
  - AWS current secret version:
    `771ed3d4-9f86-4a3c-b8e5-1443abe8db0b`;
  - Vercel `MICROSOFT_GRAPH_CLIENT_SECRET` update passed;
  - final self-check returned `graphTokenOk=true`, `dataSource=live`,
    `freshness.ok=true`, `freshness.code=ok`, and `boringGateMet=true`.
- Local auth-gated E2E fallback:
  `node -e "<Playwright chromium: /login -> fill process.env.PLX_E2E_EMAIL and process.env.PLX_E2E_PASSWORD -> Sign in -> assert /dashboard and Dashboard heading>"`
  exited 0 against `https://staging.plxcustomer.io`; final page was
  `/dashboard` with `Welcome back, COS Agent`.
- Production deploy:
  - repository/ref/SHA: `petralabx/PLX_MC`, `main`,
    `83d56c3c8b66a78a216ac5817b1fba1e48ba75f2`;
  - previous deployment (rollback):
    `dpl_CcYWGJUnCW4tvU7rva4F1FRyjGuf`;
  - replacement deployment:
    `dpl_BKC5nigZE1z8QDVEjMLcQ7foCYe1`;
  - environment/domain: production, `https://mc.plxcustomer.io`;
  - provider state, custom-domain binding, live self-check, and scheduled sweep
    were all verified.

## Documentation changes

- `docs/runbooks/cloud-agent-fleet-wiring.md`
  - inline MCP is the primary reliable API-launch path;
  - one retry only for an empty inline catalog;
  - REST is the dashboard empty-catalog fallback;
  - explicit `repos[]` launch does not inherit named-environment secrets.
- `docs/runbooks/cursor-cloud-service-account-api-key.md`
  - v1 `{ agent, run }` response and run polling;
  - `repos[]` versus named `env` behavior;
  - encrypted `envVars` caveat;
  - exact REST lifecycle commands and `cursor-cloud` headers.
- `docs/runbooks/plx-mc-mcp-team-registration.md`
  - `cursor-cloud` for Cloud Team/inline HTTP and `cursor` for Desktop;
  - known attach caveat and no-thrash fallback.

## Verification

- `git diff --check` — passed.
- `.venv/Scripts/python -m pip install -r requirements.txt` followed by
  `.venv/Scripts/python scripts/bootstrap-windows-secrets.py` — passed;
  `boto3==1.43.59` resolved from the manifest and all three workstation
  fragments regenerated.
- `bash ./scripts/preflight.sh --mode pre-commit` — passed; 4 canary tests
  passed, TypeScript typecheck passed, ESLint reported 0 errors and 10
  pre-existing warnings.
- `bash ./scripts/preflight.sh --mode pre-push` — passed; full Playwright
  result was 224 passed and 5 skipped.

## Human follow-ups

- [ ] **Team MCP attach:** open a dashboard-launched Cloud Agent with no inline
      MCP and track Cursor's duplicate-endpoint attachment defect. Portal-only
      and Hub-only launches work; retain inline/REST as the SOP and do not churn
      Integrations.
- [x] **Team Rules refresh:** unnecessary in this run; all four rules were
      visible in two fresh Cloud Agents.
- [ ] **Ten-repository environment secrets:** copy
      `PETRALABX_GITHUB_TOKEN`, `PLX_E2E_EMAIL`, `PLX_E2E_PASSWORD`,
      `PLX_MC_MCP_API_KEY`, and `VERCEL_TOKEN` into environment
      `322383e5-86cd-11f1-a7d1-d6b4613131ce`. Secret values require human entry.
- [ ] **Enterprise service account key (optional):** replace the personal
      `CURSOR_CLOUD_SERVICE_API_KEY` in `prod/ec2-secrets` when shared CI is
      ready.
- [x] **GitHub App / Cloud repo access:** explicit API launches accessed both
      `petralabx/PLX_MC` and `petralabx/plx-customer-portal`; dashboard
      inspection confirmed one Team environment includes all ten fleet repos.
- [x] **Graph secret rotation:** expired server credential replaced in AWS and
      Vercel without printing the value; exact-SHA redeploy and sweep recovery
      verified.
- [ ] **Cursor platform:** track the one-server-empty Team/inline MCP attach
      flake and the Cloud MCP result-envelope omission (`meta.actor`) with
      Cursor.
