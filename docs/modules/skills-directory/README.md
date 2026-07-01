# Module: skills-directory (MC Skills Directory)

## What

Company-skills catalog and workflow in the Mission Control shell (Screen
`skills-directory`, **System of record** sidebar group, label "Skills directory").
It browses approved Cursor/Claude skills from the `plx-cursor-skills` git repo
via `config/skills-catalog.json` (v3 catalog pointer + pin). Operators and
contributors search skill metadata, read rendered `SKILL.md`, submit proposals,
and reviewers approve → publish. Local install uses bootstrap scripts or MCP
install/sync tools (scripts returned for operator/agent execution).

## Why

The team needs one place to discover what company skills exist, read their
instructions, submit improvements, and confirm the pinned release — without
cloning operator-only agentic-swarm skills or hunting markdown in GitHub.
PLX_MC owns metadata, submissions, and workflow; git owns versioned skill files.

## How

1. **Catalog pointer** — `config/skills-catalog.json` (`plx-skills-catalog/v3`):
   `sourceRepo`, `manifestPath`, `packageId`, `pinTag`/`pinSha`. Skill ids come
   from `manifest.json` `packages[].skillIds`, not a static `skills[]` list.
   Legacy `config/company-skills-allowlist.json` is deprecated (empty `skills[]`,
   `redirectTo` → v3 file). Parsed by `parseAllowlistJson` / `loadCatalogConfig`.
2. **GitHub source** — `GithubSkillsSource` fetches `manifest.json` and
   `skills/<id>/SKILL.md` via GitHub Contents API using `resolveGithubToken`.
   Injected into the loader for unit tests.
3. **Manifest** — `parseManifestJson` validates `plx-cursor-skills` manifest;
   `publishedSkills` filters by package and `status: published`.
4. **Loader** — `listSkillCatalog` / `getSkillDetail` return `ready` or
   `degraded` catalog meta.
5. **Markdown** — detail view reuses the governance-sops `MarkdownReader` on
   parsed `MdNode` trees (no raw HTML injection).
6. **API** — `GET /api/skills-directory`, `GET /api/skills-directory/[id]`,
   submissions CRUD + approval PATCH under `/api/skills-directory/submissions`.
7. **UI** — browse, detail, submit form, reviewer queue (`SkillsDirectoryView`).
8. **MCP tools** (stdio + Streamable HTTP, same as task governance server):
   - `mc_list_skills` — list/filter catalog (`q`, `tag`, `status`)
   - `mc_install_skills` — build bash/PowerShell install scripts (`ids`, `mode`, `runtimes`, `projectRoot`, `localRegistry`)
   - `mc_sync_skills` — compare local registry vs pinned package
   - `mc_submit_skill` — create submission (`id`, `name`, `description`, `skillMd`, optional `tags`/`owner`)
9. **Submissions store** — Postgres table `skill_submissions` when
   `PLX_MC_DATABASE_URL` is set; in-memory fallback for dev/tests.
10. **Publish hook** — on approval, `publishApprovedSkillSubmission` opens a
    GitHub PR (when `SKILLS_SUBMIT_GITHUB_WRITE_ENABLED=1`) or returns
    `publish-instructions.md` content for manual operator steps.

```
skills-catalog.json → GithubSkillsSource → manifest + SKILL.md → loader
    → GET /api/skills-directory[*] → SkillsDirectoryView
    → MCP mc_*_skills → install scripts / submissions API
    → approval PATCH → publish.ts → plx-cursor-skills PR
```

## Dependencies

Depends on: **web** (MC shell, `api()` + `route()`), **github-app**
(`resolveGithubToken` — **`plx-cursor-skills` must be on the App installation**;
runbook Step 2a), **governance-sops** (markdown parser + reader UI),
**design-system** (`--p-*` tokens), **Postgres** (submissions, optional dev
memory fallback). Depended on by: Company Skills SOP (`docs/SKILLS-SOP.md`),
bootstrap scripts, PLX-MC MCP (`tools/plx-mc-mcp/`, `src/lib/mcp/skills-actions.ts`).

### Key Files

- `config/skills-catalog.json` — canonical catalog pointer (v3)
- `config/company-skills-allowlist.json` — deprecated legacy redirect
- `src/lib/skills-directory/` — domain module (catalog, loader, submissions, publish, installer)
- `src/lib/mcp/skills-actions.ts` — MCP tool handlers
- `src/app/api/skills-directory/` — list, detail, submissions routes
- `src/components/mc/skills-directory/` — screen UI
- `src/styles/mc-skills-directory.css` — scoped styles
- `tools/plx-mc-mcp/index.ts` — stdio MCP tool registration
- `tests/skills-directory.test.ts`, `tests/skills-mcp.test.ts`, `e2e/skills-directory.spec.ts`
