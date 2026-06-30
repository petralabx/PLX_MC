# plx-cursor-skills — Repository Layout (Phase 2)

**Proposed GitHub repo:** `taylorvalton/plx-cursor-skills` (private)  
**Purpose:** Versioned **company-tier** skill content only. PLX Mission Control owns catalog metadata and approval; this repo is the installable artifact.

## Top-level tree

```
plx-cursor-skills/
├── README.md                 # Contributor + consumer overview
├── manifest.json             # Canonical catalog (schema: manifest.schema.json)
├── CHANGELOG.md              # Human release notes per manifest version
├── skills/                   # One directory per skill id
│   ├── quality-gate/
│   │   ├── SKILL.md          # Required — Cursor/Claude skill entrypoint
│   │   ├── references/       # Optional — linked docs, checklists
│   │   └── scripts/          # Optional — helper scripts (no secrets)
│   ├── wterm-preflight/
│   │   └── SKILL.md
│   └── …
├── packages/                 # Optional future: bundled skill sets
│   └── plx-engineering-core/
│       └── package.json      # { "skills": ["quality-gate", "wterm-preflight", …] }
└── schemas/
    └── manifest.schema.json  # Copy or $ref from PLX_MC docs (single source TBD)
```

## Skill directory rules

| Rule | Detail |
|------|--------|
| **Id** | Kebab-case directory name matches `manifest.json` → `skills[].id` and YAML `name:` in `SKILL.md` |
| **Required file** | `skills/<id>/SKILL.md` with YAML frontmatter (`name`, `description`) |
| **No secrets** | Never commit API keys, tokens, or operator-only paths |
| **Self-contained** | Prefer in-skill instructions; link to PLX_MC docs for org-specific runbooks |
| **Size** | Keep each skill ≤ ~500 KB; large assets live in PLX_MC or SharePoint with URLs |

## Install targets (consumer layout)

Bootstrap / MCP install copies from `skills/<id>/` to:

| Runtime | Path |
|---------|------|
| Cursor (global) | `~/.cursor/skills/<id>/` |
| Claude (global) | `~/.claude/skills/<id>/` |
| Project mirror | `<project>/.cursor/skills/<id>/`, `<project>/.agents/skills/<id>/` |

Same layout as today’s `bootstrap-company-skills.sh` — Phase 2 swaps the **source** from agentic-swarm allowlist clone to this repo + signed manifest pin.

## Release flow

1. PR adds or updates `skills/<id>/` + `manifest.json` entry (`status: published`).
2. Reviewer merges → tag `manifest.json` `version` (semver).
3. PLX_MC Skills Directory indexes the tag (or `main` HEAD pin).
4. Contributors run bootstrap with `--source plx-cursor-skills` or MCP `mc_install_skills`.

## Initial seed (one-time)

Copy the 29 ids from `PLX_MC/config/company-skills-allowlist.json` from `agentic-swarm` `@ main` into `skills/`. Do **not** mirror the full agentic-swarm catalog. See `PHASE2-SEED-PLAN.md`.

## Related

- `manifest.schema.json` — catalog contract
- `manifest.example.json` — seeded example
- `../SKILLS-DIRECTORY-ARCHITECTURE.md` — MC module + tiers
