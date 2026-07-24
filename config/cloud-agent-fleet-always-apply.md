# Cloud Agent fleet always-apply slice (paste source)

**Owner:** Vince  
**Canonical for:** Cursor Team Rules / Cloud Agent always-applied workspace rules  
**Do not** paste PLX portal `--p-*` token rules here — those stay repo-scoped  
(`plx-brand.json` / adopting apps only).

Copy each section below into a separate Cursor **Team Rule** with
`alwaysApply: true` (or one combined team rule). Keep kill switches explicit.

---

## Rule 1 — Mission Control checkout & evidence

```markdown
# Cross-Repo Mission Control Checkout and Evidence
Version: cursor-cloud-team-rules.v1

Mission Control is the task-state source of truth for governed work. Before
implementation, inspect current context and check out the relevant task. Include
the returned checkout reference in delivery evidence when required. Report
material progress at phase boundaries and complete the task only after attaching
verification evidence such as tests, diffs, logs, or artifact links.

If Mission Control is unavailable, continue safe in-scope work using repository
context, record the desynchronization, and reconcile task state when access
returns. Never invent a checkout reference or claim completion without evidence.
```

---

## Rule 2 — Thin fleet governance pillars

```markdown
# Cross-Repo Fleet Governance Pillars
Version: cursor-cloud-team-rules.v1

These pillars apply to every petralabx Cloud Agent session. Repo-local
`governance.mdc` / design-system rules may add stricter constraints; they do not
weaken these.

1. Mission First — every change ties to a stated goal / MC task.
2. Simplify Relentlessly — simplest correct change; no speculative abstraction.
3. Reuse Before Create — search existing modules before adding new ones.
4. Truth Before Action — do not guess requirements or fabricate status.
5. Evidence Over Assertion — show commands/tests/logs for completion claims.
6. Prune Ruthlessly — remove dead code you introduced; avoid drive-by refactors.
7. Ownership and Precision — name accountable human for agent-driven work.

Never edit, disable, or bypass a repo compliance gate to force a green check.
```

---

## Rule 3 — Openable file paths (Cloud-safe)

```markdown
# Cross-Repo Openable File Paths
Version: cursor-cloud-team-rules.v1

When sharing a file or path with the user in chat, use an inline backtick path
(absolute in multi-root / Cloud VM workspaces), e.g.
`/agent/repos/PLX_MC/docs/FOO.md`.

Do NOT use markdown links with leading-slash workspace hrefs such as
`[FOO.md](/agent/repos/PLX_MC/docs/FOO.md)` — on cursor.com/agents those become
site-relative URLs and 404.

For line ranges, use Cursor code citation fences (`startLine:endLine:filepath`).
Optional: add a GitHub blob URL after the file is pushed.
```

---

## Rule 4 — PLX-MC MCP expected in Cloud

```markdown
# Cross-Repo PLX-MC MCP Expectation
Version: cursor-cloud-team-rules.v1

Cloud Agents working petralabx governed repos should prefer Team MCP Streamable
HTTP servers `PLX-MC-Hub` / `PLX-MC-Portal` when present in the tool catalog
(see `docs/runbooks/plx-mc-mcp-team-registration.md` and
`docs/runbooks/cloud-agent-fleet-wiring.md`).

- Prefer `mc_checkout_task` / `mc_report_progress` / `mc_complete_task` over inventing stamps.
- Confirm `meta.actor.repo` matches the repo being edited before checkout.
- Swarm dispatch stays default-OFF (`SWARM_DISPATCH_ENABLED=0`) unless explicitly enabled.
- Kill switch: disable the Team MCP server or set server-side `PLX_MC_MCP_ENABLED=0`.

If PLX-MC MCP tools are missing from the session catalog (known Cursor Cloud
attach bug even when Integrations lists Hub/Portal):

1. Record the gap.
2. Use REST `https://mc.plxcustomer.io/api/cursor/*` with
   `PLX_MC_MCP_API_KEY` hydrated from AWS Secrets Manager `prod/ec2-secrets`,
   or `scripts/compliance-checkout.mjs`.
3. Never invent `MC-Checkout` lines.

Optional: launch agents with inline `mcpServers` via a Cursor **service account**
API key — `docs/runbooks/cursor-cloud-service-account-api-key.md`.
```

---

## Explicitly out of fleet always-apply

| Topic | Where it lives |
|---|---|
| `--p-*` tokens / BrandBoundary / no raw hex | Adopting repos only (`PLX_MC`, portal) |
| Staging-only portal DB / secrets rules | `plx-customer-portal` repo rules |
| DGX / local-inference routing | `local-inference` repo rules |
| Full PLX_MC hygiene / preflight doctrine | `PLX_MC` `.cursor/rules/governance.mdc` |
