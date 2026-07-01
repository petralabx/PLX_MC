# PLX Company Skills — Team SOP

**Audience:** PLX contributors using Cursor, Claude Code, or other agent runtimes on
personal laptops against PLX-tracked repos (`PLX_MC`, `plx-customer-portal`, etc.)

**Owner:** Vince · **Status:** active · **Effective:** 2026-06-30

> **TL;DR** — **PLX-MC access ≠ skills installed.** Register the PLX-MC MCP server for
> task checkout, then run the **company skills bootstrap once per machine**. Skills come
> from **`taylorvalton/plx-cursor-skills`** (29 published skills) — **not** the full
> `agentic-swarm` catalog. Start a **new** Cursor session after bootstrap. To share a
> skill company-wide, use Mission Control **Skills directory** (submit UI) or `mc_submit_skill`.

---

## 1. Skills vs PLX-MC MCP (do both)

These are **separate systems**. Many teammates register PLX-MC MCP and assume skills
appear automatically — they do not.

| System | What it does | What it does **not** do |
|--------|----------------|---------------------------|
| **PLX-MC MCP** | Task checkout, progress, complete, swarm dispatch | Install skill files on your laptop |
| **Company skills bootstrap** | Copies approved `SKILL.md` trees to your machine | Check out MC tasks or pass the compliance gate |

**Do both once per laptop:**

1. **Skills bootstrap** (this SOP) — so agents can use company workflows (`quality-gate`, `vmc-sync`, etc.)
2. **PLX-MC MCP registration** — so agent PRs link to MC tasks ([Collaborator SOP §4](docs/COLLABORATOR-SOP.md) / runbook below)

---

## 2. Three skill tiers (what you can access)

| Tier | Where it lives | Who | How you get it |
|------|----------------|-----|----------------|
| **Personal** | `~/.cursor/skills`, `~/.claude/skills` | You only | Create locally; stays private until you opt to share |
| **Company approved** | [`taylorvalton/plx-cursor-skills`](https://github.com/taylorvalton/plx-cursor-skills) | All PLX contributors | Bootstrap script (below) |
| **Operator / internal** | `agentic-swarm` full catalog | Operator fleet only | **Do not use** on personal laptops |

The company catalog is intentionally **not** the full ~54-skill operator set. Trading
loops, VMC autopilot, fleet internals, and similar tools stay in `agentic-swarm`.

---

## 3. One-time install (every laptop)

### Prerequisites

| Platform | Required |
|----------|----------|
| **All** | Git, Python 3 (`python3`, `python`, or Windows `py -3`) |
| **Windows** | [Git for Windows](https://git-scm.com/download/win) (Git Bash), PowerShell 5.1+ |
| **Any** | Clone of `PLX_MC` or `plx-customer-portal` (for bootstrap scripts) |

### Windows

```powershell
cd C:\path\to\PLX_MC
git pull origin main
.\scripts\bootstrap-company-skills.ps1
```

Optional dry run (prints actions only):

```powershell
.\scripts\bootstrap-company-skills.ps1 -DryRun
```

### macOS / Linux

```bash
cd /path/to/PLX_MC
git pull origin main
./scripts/bootstrap-company-skills.sh
```

Optional dry run:

```bash
./scripts/bootstrap-company-skills.sh --dry-run
```

### What bootstrap does

1. Clone or update `~/plx-cursor-skills` (Windows: `%USERPROFILE%\plx-cursor-skills`).
2. Check out catalog pin **`v1.0.0`** (see `config/skills-catalog.json`).
3. Install **published** skills from `manifest.json` into:
   - `~/.cursor/skills/<id>/`
   - `~/.claude/skills/<id>/`
4. Merge **project-native** skills from the repo you bootstrapped from (e.g. `mc-sync` in PLX_MC).
5. Mirror the combined set into the project `.cursor/skills/` and `.agents/skills/`.
6. Write `~/.agentic/skills.registry.json` (local inventory for some runtimes).

### After bootstrap — required

**Start a new Cursor Agent session.** Skills load at session start, not mid-chat.
Restart Claude Code similarly if you rely on global Claude skills.

---

## 4. What you get (company catalog v1.0.0)

The default bundle is **`plx-engineering-core`** — **29 skills**, including:

| Category | Skills |
|----------|--------|
| Workflow | `automate`, `babysit`, `canvas` |
| Quality & verification | `autonomous-verifier`, `quality-gate`, `reliable-tdd-loop`, `review-bugbot`, `review-security`, `uat-runner`, `wterm-preflight` |
| Debugging | `codebase-investigation`, `root-cause-debugger`, `dead-code-triage` |
| Project lifecycle | `project-orchestrator`, `project-hardener`, `project-researcher`, `project-research-runner`, `pre-plan-recalibrator` |
| Refactoring & git | `isomorphic-refactor`, `safe-deletion`, `split-to-prs` |
| Meta / tooling | `create-hook`, `create-rule`, `create-skill`, `migrate-to-skills`, `claude-code-context-hygiene` |
| Design | `taste-skill`, `ui-ux-design-loop` |
| VMC integration | `vmc-sync` |

**Plus** any skills shipped natively in the repo you bootstrap from (PLX_MC adds `mc-sync`
and may add others under `.cursor/skills/`).

Authoritative list: `manifest.json` in [plx-cursor-skills](https://github.com/taylorvalton/plx-cursor-skills).

---

## 5. Verify install

**Quick check (bash or Git Bash):**

```bash
ls ~/.cursor/skills | wc -l
cat ~/.agentic/skills.registry.json | head -20
```

You should see **at least 29** company skills (more if project-native skills merged).

**Dry run after catalog update:**

```bash
./scripts/bootstrap-company-skills.sh --dry-run
```

Expect `Installing 29 published skills from plx-cursor-skills`.

---

## 6. Refresh when the catalog changes

When PLX announces a new skills release (new tag in `plx-cursor-skills` or updated pin in PLX_MC):

**Option A — bootstrap (all machines):**

```bash
cd /path/to/PLX_MC && git pull origin main
./scripts/bootstrap-company-skills.sh
```

**Option B — MCP drift check (PLX-MC registered):**

1. Call `mc_sync_skills` with your local registry (`~/.agentic/skills.registry.json`) to see missing or stale skill ids.
2. Call `mc_install_skills` to receive bash/PowerShell install scripts for the pinned package (or specific `ids`).
3. Run the returned script in your project root, then **start a new agent session**.

Bootstrap scripts default to `config/skills-catalog.json` (v3). The legacy
`config/company-skills-allowlist.json` is deprecated — empty `skills[]`, redirect only.

You do **not** need to re-clone `agentic-swarm` for routine skill updates.

---

## 7. Personal skills (local only)

You may create personal skills on your machine:

- Cursor: use the **create-skill** skill or add folders under `~/.cursor/skills/<id>/SKILL.md`
- Claude Code: `~/.claude/skills/<id>/SKILL.md`

Personal skills are **private by default**. They are **not** uploaded automatically.

**Rules for personal skills:**

- No secrets, credentials, or customer data in skill files
- Do not copy operator-only `agentic-swarm` skills wholesale onto team machines
- If a personal skill references org-specific runbooks, link to approved docs — do not embed unreleased infra details

---

## 8. Share a skill with the company

**Primary path (Mission Control + MCP):**

1. **Author** the skill locally and test it in a fresh agent session.
2. **Submit for review** via either:
   - Mission Control → **System of record → Skills directory → Submit skill**, or
   - MCP tool `mc_submit_skill` with `id`, `name`, `description`, `skillMd`, optional `tags` / `owner`.
3. Submissions persist in Postgres (`skill_submissions`) when `PLX_MC_DATABASE_URL` is set; dev falls back to in-memory store.
4. **Reviewer** approves in the Skills Directory UI (or `PATCH /api/skills-directory/submissions/[id]`).
   Approval triggers the publish hook: GitHub PR in `plx-cursor-skills` when writes are enabled, or `publish-instructions.md` for manual operator steps.
5. After merge + tag, operator bumps `pinTag` / `pinSha` in `config/skills-catalog.json` if needed.
6. **Team refresh:** bootstrap (§6) or `mc_install_skills` / `mc_sync_skills`.

**Fallback — direct PR to content repo** (when MC is unavailable):

1. Copy the skill folder to a branch of [`taylorvalton/plx-cursor-skills`](https://github.com/taylorvalton/plx-cursor-skills):
   - Path: `skills/<kebab-case-id>/SKILL.md`
   - Match layout in existing skills (see `docs/plx-cursor-skills/REPO-LAYOUT.md` in PLX_MC).
2. **Update** `manifest.json` with a `skills[]` entry (`pending_review` or `published`), bump semver, open PR.
3. Reviewer merges → tags release → operator updates catalog pin → team refresh (§6).

### What reviewers look for

- Self-contained `SKILL.md` with clear trigger phrases
- No operator/trading/VMC-internal scope creep
- No secrets or environment-specific paths that won't work for peers
- Fits company tier — reusable across PLX repos

### Rejected submissions

Stay on your machine only. Nothing is pulled from personal dirs without an approved merge to `plx-cursor-skills`.

---

## 9. PLX-MC MCP registration (task governance)

Skills bootstrap does **not** replace MCP setup. For agent PR compliance:

Follow `docs/runbooks/plx-mc-mcp-team-registration.md`:

- Set `MC_MCP_API_KEY`, `MC_OPERATOR_EMAIL`, `PLX_MC_MCP_ENABLED=1`
- Register `https://mc.plxcustomer.io/api/cursor/mcp` (remote) or stdio via `tools/plx-mc-mcp/`
- Windows helper: `scripts/run-plx-mc-mcp.ps1`
- Set `MC_REPO` to the repo you work in (`taylorvalton/PLX_MC`, etc.)
- Verify with MCP tool `mc_self_check`

Full PR/compliance context: **SOP guide → Collaborator SOP** in [Mission Control](https://mc.plxcustomer.io/).

---

## 10. Do not do this

| Don't | Why |
|-------|-----|
| Run `agentic-swarm` full `.cursor/install-skills.sh` on a team laptop | Installs operator/trading/VMC-internal skills |
| Assume PLX-MC login installs skills | MCP is task governance only |
| Edit skills only in a project folder without bootstrap | Global agents won't see them; peers won't either |
| Commit secrets into skill files | Skills sync via git — treat like code |
| Skip a new Cursor session after bootstrap | Skills load at session start only |

---

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Bootstrap says `0 skills` or parse error | Install Python 3; on Windows ensure `py -3` works in Git Bash |
| `Git Bash required` on Windows | Install Git for Windows; script path: `C:\Program Files\Git\bin\bash.exe` |
| Skills missing in agent mid-chat | Start a **new** session — skills don't hot-reload |
| `WARN: skip missing skill: …` | Catalog pin may reference a skill not in your local clone; `git pull` PLX_MC and re-run bootstrap |
| Duplicate or stale skill | Re-run bootstrap (it replaces target dirs per skill id) |
| Want operator-only skill | Request explicit promotion via §8 — don't pull from `agentic-swarm` yourself |

---

## 12. Roadmap (Mission Control Skills Directory)

**Phase 4 — shipped (2026-07-01):**

| Capability | How |
|------------|-----|
| Browse catalog | MC → **Skills directory**; `mc_list_skills` |
| Install / sync | Bootstrap (§3), `mc_install_skills`, `mc_sync_skills` |
| Submit for review | MC submit UI, `mc_submit_skill` |
| Approval + publish | MC reviewer UI; Postgres submissions; GitHub publish hook |
| Catalog pointer | `config/skills-catalog.json` (v3); legacy allowlist deprecated |

**Planned next** ([architecture](docs/SKILLS-DIRECTORY-ARCHITECTURE.md)):

- In-app one-click install (MCP returns scripts today; agent/operator runs them locally)
- Opt-in IDE prompt when you create a personal skill: **Share with PLX?**
- Subscriber notifications on new published skills

Until in-app install lands, **`mc_install_skills` + bootstrap** remain the install paths.

---

## 13. Reference links

| Resource | Location |
|----------|----------|
| Content repo | https://github.com/taylorvalton/plx-cursor-skills |
| Bootstrap scripts | `PLX_MC/scripts/bootstrap-company-skills.{sh,ps1}` |
| Catalog pin | `PLX_MC/config/skills-catalog.json` |
| MC browse UI | Mission Control → System of record → **Skills directory** |
| MCP runbook | `PLX_MC/docs/runbooks/plx-mc-mcp-team-registration.md` |
| Repo layout / manifest schema | `PLX_MC/docs/plx-cursor-skills/` |
| PR compliance | `PLX_MC/docs/COLLABORATOR-SOP.md` |

**Questions or false blocks:** Vince (owner).
