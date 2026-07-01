# Module: skills-directory (MC Skills Directory)

## What

A read-only company-skills catalog in the Mission Control shell (Screen
`skills-directory`, **System of record** sidebar group, label "Skills directory").
It browses approved Cursor/Claude skills from the `plx-cursor-skills` git repo
via `config/company-skills-allowlist.json` (pointer + pin + allowlist ids).
Operators see skill metadata and rendered `SKILL.md` content; install still
happens through `scripts/bootstrap-company-skills.{sh,ps1}` (Phase 3 MVP — no
in-app install yet).

## Why

The team needs one place to discover what company skills exist, read their
instructions, and confirm the pinned release — without cloning operator-only
agentic-swarm skills or hunting markdown in GitHub. PLX_MC owns metadata and
workflow; git owns versioned skill files.

## How

1. **Allowlist pointer** — `config/company-skills-allowlist.json` (`v2`):
   `sourceRepo`, `manifestPath`, `packageId`, `pinTag`/`pinSha`, and `skills[]`.
   Parsed by `parseAllowlistJson` (zod; never throws).
2. **GitHub source** — `GithubSkillsSource` fetches `manifest.json` and
   `skills/<id>/SKILL.md` via GitHub Contents API using `resolveGithubToken`.
   Injected into the loader for unit tests.
3. **Manifest** — `parseManifestJson` validates `plx-cursor-skills` manifest;
   `publishedSkills` filters by package, allowlist, and `status: published`.
4. **Loader** — `listSkillCatalog` / `getSkillDetail` return `ready` or
   `degraded` catalog meta; one failed fetch never hides the allowlist ids.
5. **Markdown** — detail view reuses the governance-sops `MarkdownReader` on
   parsed `MdNode` trees (no raw HTML injection).
6. **API** — `GET /api/skills-directory` (catalog) and
   `GET /api/skills-directory/[id]` (detail) via shared `route()` wrapper,
   auth-gated by middleware.
7. **UI** — `SkillsDirectoryView`: index (meta strip + search/tag filters +
   hairline catalog) and detail (folio + reader + TOC).

```
allowlist.json → GithubSkillsSource → manifest + SKILL.md → loader
    → GET /api/skills-directory[*] → SkillsDirectoryView (index | detail)
```

## Dependencies

Depends on: **web** (MC shell, `api()` + `route()`), **github-app**
(`resolveGithubToken` — **`plx-cursor-skills` must be on the App installation**;
runbook Step 2a), **governance-sops** (markdown parser + reader UI),
**design-system** (`--p-*` tokens). Depended on by: Company Skills SOP
(`docs/SKILLS-SOP.md`), bootstrap scripts.

Future (out of scope for MVP): MCP `mc_list_skills` / `mc_install_skills`,
submit-for-review workflow, deprecate static allowlist JSON.

### Key Files

- `config/company-skills-allowlist.json` — catalog pointer + allowlist
- `src/lib/skills-directory/` — domain module
- `src/app/api/skills-directory/` — list + `[id]` routes
- `src/components/mc/skills-directory/` — screen UI
- `src/styles/mc-skills-directory.css` — scoped styles
- `tests/skills-directory.test.ts`, `e2e/skills-directory.spec.ts`
