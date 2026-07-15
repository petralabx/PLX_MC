# Mission Control for colleagues

**Audience:** Petra humans getting productive on MC  
**Owner:** Vince · **Effective:** 2026-07-15 (updated for non-technical path)  
**Click path:** https://mc.plxcustomer.io/welcome

This is the canonical prose. Prefer the `/welcome` page for day-one setup.

---

## Most people (browser only)

1. Open https://mc.plxcustomer.io/welcome
2. Click **Open Mission Control**
3. Sign in with your work Microsoft account

You’re done. You do **not** need Cursor, MCP, a terminal, or company skills to use Mission Control in the browser.

---

## Optional: Cursor + AI agents

Only if you run agents in Cursor that check out MC tasks.

### Connect Cursor (MCP)

1. Ask Vince (or your admin) to add you to the **team PLX-MC Cursor MCP** — they provide the API key. Do not dig for secrets yourself.
2. In Cursor → Settings → MCP (or [cursor.com/agents](https://cursor.com/agents)), add the server.
3. Paste this URL with **Copy** from `/welcome`:

   `https://mc.plxcustomer.io/api/cursor/mcp`

4. **Do not open that URL in Chrome/Edge.** It is an API for Cursor, not a web page. A browser tab without a key will show an error on purpose (or a help page). That does not mean MC is down.

Details: [plx-mc-mcp-team-registration.md](./plx-mc-mcp-team-registration.md)

### Company skills

Skills are files on your laptop for Cursor agents.

**Easiest (Windows):** download and double-click
[`scripts/Install-Company-Skills.cmd`](../../scripts/Install-Company-Skills.cmd)
from this repo (GitHub → file → Download raw file). It finds or clones `PLX_MC`,
runs the bootstrap, and installs into `~/.cursor/skills`. No secrets. Then fully
quit and reopen Cursor.

**Still stuck:** 10 minutes with Vince — same installer.

**Technical self-serve:** clone `petralabx/PLX_MC`, then:

```powershell
.\scripts\bootstrap-company-skills.ps1
```

Full SOP: [SKILLS-SOP.md](../SKILLS-SOP.md). MCP ≠ skills — do both if you use Cursor agents.

Do **not** download env/secret zip files. Secrets stay in AWS / team Cursor MCP.

---

## When you open a PR

These repos emit a **suggestion** deep link in the Actions job summary (not a candidate dump in GitHub):

| Repo | Mode |
|------|------|
| `petralabx/PLX_MC` | suggestion |
| `petralabx/plx-customer-portal` | suggestion |
| `petralabx/for-and-against` | suggestion |
| `petralabx/skills` | suggestion |

Open the link → review the proposal in Mission Control Routing Inbox.

Still off (by design):

- Confirmation (no auto attach / task create from GitHub)
- Fuzzy auto-link

Agent PRs still need `MC-Checkout: dsp_…` and a human accountable owner. Humans can open PRs without a checkout; agents cannot.

---

## Kill switch

Set repository Actions variable `PLX_MC_ROUTING_METADATA_ENABLED=0` to skip the routing job. Compliance stays enforced. Remove the override (or set `1`) to restore org inheritance.

---

## Deeper reading

- Human SOP: [HUMAN-MC-SOP.md](../HUMAN-MC-SOP.md)
- Collaborator / PR discipline: [COLLABORATOR-SOP.md](../COLLABORATOR-SOP.md)
- Routing rollout: [mc-routing-rollout.md](./mc-routing-rollout.md)
