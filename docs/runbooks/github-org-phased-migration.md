# Runbook: GitHub Org — Phased Migration (EN-008)

> **CURRENT STATE (post EN-008, 2026-07-09):** Platform repos **`PLX_MC`**,
> **`plx-customer-portal`**, and **`agentic-swarm`** live under **`petralabx/*`**.
> New repos are created on `petralabx`. Legacy `taylorvalton/*` slugs are historical
> only — do not treat them as the live operator path.
>
> **Below:** superseded migration checklist preserved for audit trail. Use current
> slugs (`petralabx/...`) and [`docs/runbooks/REPO-ONBOARDING.md`](REPO-ONBOARDING.md)
> for onboarding.

## Policy (decided 2026-06-30) — historical

| Phase | Repos | GitHub owner | MC registry |
|---|---|---|---|
| **Legacy (pre-migration)** | `plx-customer-portal`, `PLX_MC`, `agentic-swarm` | `taylorvalton` | `owner: taylorvalton` |
| **New registrations** | `local-inference`, brands, tooling, … | [`petralabx`](https://github.com/petralabx) | `owner: petralabx` |
| **Migration (EN-008) — DONE** | Platform trio transferred | `petralabx` | `owner: petralabx` |

MC registry **ids** (`portal-web`, `plx-mc`, …) do **not** change — only `owner` and
`owner/repo` slugs change at migration time.

Canonical constants (`src/lib/mc-data/data.ts`):

- `REPO_ORG_LEGACY` = `taylorvalton`
- `REPO_ORG_PLX` = `petralabx`
- `ALLOWED_REPO_ORGS` = both (during the transition window)
- `DEFAULT_NEW_REPO_ORG` = `petralabx` (self-service repo requests)

---

## What new repos must do today

1. **Org owner/admin** creates the GitHub repo under **`petralabx/<repo-name>`**.
2. **Request repo** in MC → Owner/Admin **approves** (MC allow-list).
3. Register in fleet via [`REPO-ONBOARDING.md`](REPO-ONBOARDING.md) (`tracked-repos-registry.json`).
4. Set `plx-brand.json` → `mc.github` = `petralabx/<repo-name>` (brand repos).
5. Follow [`marketing-brand-repo-setup.md`](marketing-brand-repo-setup.md) for brand repos.

GitHub App / token used by MC must be granted access to **`petralabx`** before
validation and loop-ledgers will succeed for new repos.

---

## Follow-up: migrate legacy platform repos (EN-008) — COMPLETED

> **Superseded procedure.** Platform trio is on `petralabx`. Keep this checklist
> as historical evidence only. Residual: org required-workflow rulesets still need
> GitHub Team (API currently reports plan `free`).

**Status (2026-07-09):** Platform trio transferred to `petralabx` (`PLX_MC`, `plx-customer-portal`, `agentic-swarm`). Registry/MCP/GEN_REPO updates land in the leftovers PR. Org required-workflow rulesets still need GitHub Team (API currently reports plan `free`).

When the [`petralabx`](https://github.com/petralabx) org is ready and the operator schedules migration:

### Per-repo checklist

| Repo | MC id | Current slug | Target slug |
|---|---|---|---|
| PLX Portal | `portal-web` | `taylorvalton/plx-customer-portal` | `petralabx/plx-customer-portal` |
| PLX Mission Control | `plx-mc` | `taylorvalton/PLX_MC` | `petralabx/PLX_MC` |
| Agentic Swarm | `agentic-swarm` | `taylorvalton/agentic-swarm` | `petralabx/agentic-swarm` |

### GitHub

- [ ] Transfer each repo (or recreate + mirror — transfer preserves history).
- [ ] Reinstall / extend GitHub App to cover `petralabx`.
- [ ] Update branch protection and required checks on new locations.
- [ ] Leave a pointer README on old `taylorvalton/*` URLs if repos are archived.

### Mission Control

- [ ] Update `REPOS[*].owner` to `petralabx` for migrated entries.
- [ ] `UPDATE repos SET owner = 'petralabx' WHERE id IN (...)` on staging → prod.
- [ ] Update `config/loop-ledgers-registry.json` full slugs.
- [ ] Update `.cursor/mcp.json` / `MC_REPO` defaults and runbooks.
- [ ] Refresh tests and fixtures that hardcode `taylorvalton/...`.
- [ ] Re-push SharePoint Repo Registry mirror with new owner values.

### Each consumer repo

- [ ] `git remote set-url origin git@github.com:petralabx/<name>.git`
- [ ] `.cursor/mcp.json` → `MC_REPO=petralabx/<name>`
- [ ] Vercel / CI reconnect to new GitHub path (Portal is critical).
- [ ] Compliance gate: confirm App installation covers new location.

### Operator environment

- [ ] Update Cursor rules that reference `taylorvalton/plx-customer-portal`.
- [ ] Update clone URLs (e.g. `.cursor/environment.json` swarm dependency).
- [ ] Confirm `GITHUB_TOKEN` / App token scopes include `petralabx`.

### Close-out

- [ ] When all platform repos are on `petralabx`, consider removing `REPO_ORG_LEGACY`
  from `ALLOWED_REPO_ORGS` (breaking change — only after every registry row migrated).
- [ ] Mark EN-008 **Done** in `docs/product/enhancements/README.md`.

---

## Why phased (not big-bang) — historical context

- Platform repos **were** live on `taylorvalton` with Vercel, compliance, and MCP
  wired to those slugs before EN-008 transfer (2026-07-09).
- Brand and inference repos started on `petralabx` with no migration cost.
- MC supported **two allowed orgs** during the transition window.

---

## Related

- EN-008 backlog entry: `docs/product/enhancements/README.md`
- Brand onboarding: `docs/runbooks/marketing-brand-repo-setup.md`
- GitHub App: `docs/runbooks/github-app-provisioning.md`
- Repo allow-list: `docs/product/enhancements/README.md` → EN-002

## Owner

Vince
