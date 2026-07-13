# PLX Skills Directory — Architecture

**Status:** Phase 4 shipped (2026-07-01). Browse, MCP install/list/sync/submit, submit-for-review UI, approval workflow, and GitHub publish hook are live. Static allowlist JSON is deprecated — use `config/skills-catalog.json`.

## Decision summary

| Question | Recommendation |
|----------|----------------|
| Separate repo for skills? | **Yes** — dedicated **`petralabx/skills`** for **company-tier** content (legacy: `taylorvalton/plx-cursor-skills`) |
| One-time extraction from agentic-swarm? | **Yes, for initial seed only** — not ongoing sync of the full operator catalog |
| Keep agentic-swarm as team upstream? | **No** — team never pulls the full `.cursor/skills` tree; operator/internal skills stay in agentic-swarm |

## Three tiers

| Tier | Location | Who sees it | How it moves |
|------|----------|-------------|--------------|
| **Operator / internal** | `agentic-swarm` | Vince + infra agents | Existing `install-skills.sh`, fleet installer |
| **Company approved** | PLX Skills Directory + git content repo | All PLX contributors | Bootstrap / MCP install from directory |
| **Personal** | `~/.cursor/skills`, `~/.claude/skills` | Individual | Opt-in **Share to PLX** → review → promote to company |

Do **not** expose all 54+ agentic-swarm skills to the team. Skill ids come from the pinned **`petralabx/skills`** manifest (`packages[].skillIds`), not a static allowlist file.

## Hybrid system of record

PLX Mission Control owns **metadata and workflow**; git owns **versioned skill files**.

```
┌─────────────────────────────────────────────────────────────┐
│  PLX_MC — Skills Directory (system of record)               │
│  • catalog UI, search, tags, owner, approval state          │
│  • audit trail (who published, who installed)               │
│  • MCP: mc_list_skills, mc_install_skills, mc_sync_skills,  │
│         mc_submit_skill                                     │
│  • Postgres skill_submissions + approval → publish hook       │
└──────────────────────────┬──────────────────────────────────┘
                           │ approved releases only
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  petralabx/skills (git) — content store                     │
│  skills/<id>/SKILL.md  +  manifest.json                     │
│  Compatible with ~/.cursor/skills layout                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ bootstrap / MCP install
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Contributor machine                                        │
│  ~/.cursor/skills  ~/.claude/skills  project .cursor/skills │
└─────────────────────────────────────────────────────────────┘
```

**Why not skills-only in PLX_MC DB?** Cursor and Claude expect filesystem trees with `SKILL.md`. Git gives diff review, rollback, and the same layout as today without reinventing package format.

**Why not only agentic-swarm?** Mixed operator tooling (trading loops, VMC autopilot, fleet secrets patterns) must not become default team surface area.

## Personal skill → company flow

1. Contributor creates or edits a skill locally (Cursor **create-skill** or Claude equivalent).
2. Optional prompt (IDE hook or MCP): **“Share with PLX Skills Directory?”**
3. Submit via Mission Control UI or `mc_submit_skill` → **pending_review** record in Postgres.
4. Reviewer approves → publish hook opens PR in the skills content repo (`petralabx/skills`; legacy automated writes may still target `taylorvalton/plx-cursor-skills`) or returns operator instructions when GitHub writes are disabled.
5. Teammates run bootstrap refresh, `mc_install_skills`, or `mc_sync_skills`.

Rejected submissions stay private; no automatic pull from personal dirs.

## Phase roadmap

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **1** | Allowlist, `bootstrap-company-skills.{sh,ps1}`, COLLABORATOR-SOP §9 | Shipped |
| **2** | Create skills content repo; one-time seed; pin manifest in PLX_MC (`petralabx/skills`) | Shipped |
| **3** | Browse/install UI + MCP list/install/sync | Shipped |
| **4** | Submit-for-review + approval + publish; deprecate static allowlist JSON | **Shipped** |

## MCP boundary

PLX-MC MCP combines **task governance** (checkout, progress, complete, dispatch) with **Skills Directory** tools. Skills install is explicit — use `mc_install_skills` / `mc_sync_skills` rather than assuming MCP registration installs files.

## Related files

- `config/skills-catalog.json` — canonical catalog pointer (v3)
- `config/company-skills-allowlist.json` — deprecated legacy redirect (empty `skills[]`)
- `scripts/bootstrap-company-skills.sh` — machine install (defaults to v3 catalog)
- `docs/COLLABORATOR-SOP.md` §9 — contributor runbook
- `docs/SKILLS-SOP.md` — team SOP (install, MCP, submit)
- `docs/plx-cursor-skills/` — repo layout, manifest schema, seed plan
- `docs/modules/skills-directory/README.md` — module contract
