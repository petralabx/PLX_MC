# PLX Skills Directory — Architecture (draft)

**Status:** Phase 1 shipped (allowlist + bootstrap). Phase 2+ below is the target system of record.

## Decision summary

| Question | Recommendation |
|----------|----------------|
| Separate repo for skills? | **Yes** — dedicated `plx-cursor-skills` (name TBD) for **company-tier** content only |
| One-time extraction from agentic-swarm? | **Yes, for initial seed only** — not ongoing sync of the full operator catalog |
| Keep agentic-swarm as team upstream? | **No** — team never pulls the full `.cursor/skills` tree; operator/internal skills stay in agentic-swarm |

## Three tiers

| Tier | Location | Who sees it | How it moves |
|------|----------|-------------|--------------|
| **Operator / internal** | `agentic-swarm` | Vince + infra agents | Existing `install-skills.sh`, fleet installer |
| **Company approved** | PLX Skills Directory + git content repo | All PLX contributors | Bootstrap / MCP install from directory |
| **Personal** | `~/.cursor/skills`, `~/.claude/skills` | Individual | Opt-in **Share to PLX** → review → promote to company |

Do **not** expose all 54+ agentic-swarm skills to the team. The allowlist (`config/company-skills-allowlist.json`) is the interim gate until the directory module replaces it.

## Hybrid system of record

PLX Mission Control owns **metadata and workflow**; git owns **versioned skill files**.

```
┌─────────────────────────────────────────────────────────────┐
│  PLX_MC — Skills Directory (system of record)               │
│  • catalog UI, search, tags, owner, approval state          │
│  • audit trail (who published, who installed)               │
│  • MCP: mc_list_skills, mc_install_skills, mc_submit_skill  │
└──────────────────────────┬──────────────────────────────────┘
                           │ approved releases only
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  plx-cursor-skills (git) — content store                    │
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
3. Submit creates a **pending_review** record + branch/PR in `plx-cursor-skills` (or upload bundle to MC API).
4. Reviewer (tech lead / ops) approves → status **published**, semver or date tag, notify subscribers.
5. Teammates run bootstrap refresh or `mc_install_skills --ids foo,bar`.

Rejected submissions stay private; no automatic pull from personal dirs.

## Phase roadmap

| Phase | Deliverable |
|-------|-------------|
| **1 (now)** | Allowlist, `bootstrap-company-skills.{sh,ps1}`, COLLABORATOR-SOP §9 |
| **2** | Create `plx-cursor-skills`; one-time seed from allowlist; pin manifest in PLX_MC |
| **3** | PLX_MC module: browse/install UI + MCP tools |
| **4** | Submit-for-review + approval workflow; deprecate static allowlist JSON |

## MCP boundary (unchanged)

PLX-MC MCP today is **task governance** (checkout, progress, complete, dispatch). Skills install is a **separate concern** — add explicit tools in Phase 3 rather than overloading repo parity.

## Related files

- `config/company-skills-allowlist.json` — interim curated list
- `scripts/bootstrap-company-skills.sh` — machine install
- `docs/COLLABORATOR-SOP.md` §9 — contributor runbook
- `docs/plx-cursor-skills/` — Phase 2 repo layout, manifest schema, seed plan
