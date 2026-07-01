# Runbook: GitHub Org — Phased Migration (EN-008)

> **Status:** Active policy · legacy repos stay on `taylorvalton` until transferred;
> **new** repos (inference, marketing brands, …) are created under the PLX org slug.
> Full migration of platform repos is a **follow-up** tracked as EN-008.

## Policy (decided 2026-06-30)

| Phase | Repos | GitHub owner | MC registry |
|---|---|---|---|
| **Now — legacy (unchanged)** | `plx-customer-portal`, `PLX_MC`, `agentic-swarm` | `taylorvalton` | `owner: taylorvalton` |
| **Now — new registrations** | `local-inference`, `for-and-against`, `furgenics`, `1hr-after`, future brands | [`petralabx`](https://github.com/petralabx) | `owner: petralabx` |
| **Later — migration (EN-008)** | Transfer legacy platform repos to the PLX org | `petralabx` | Update `owner` + all full slugs |

MC registry **ids** (`portal-web`, `plx-mc`, …) do **not** change — only `owner` and
`owner/repo` slugs change at migration time.

Canonical constants (`src/lib/mc-data/data.ts`):

- `REPO_ORG_LEGACY` = `taylorvalton`
- `REPO_ORG_PLX` = `petralabx`
- `ALLOWED_REPO_ORGS` = both (during the transition window)
- `DEFAULT_NEW_REPO_ORG` = `petralabx` (self-service repo requests)

---

## What new repos must do today

1. Create the GitHub repo under **`petralabx/<repo-name>`** (not `taylorvalton/`).
2. Register in MC (seed or request → approve) with `owner: petralabx`.
3. Set `plx-brand.json` → `mc.github` = `petralabx/<repo-name>`.
4. Follow [`marketing-brand-repo-setup.md`](marketing-brand-repo-setup.md) for brand repos.

GitHub App / token used by MC must be granted access to **`petralabx`** before
validation and loop-ledgers will succeed for new repos.

---

## Follow-up: migrate legacy platform repos (EN-008)

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

## Why phased (not big-bang)

- Portal, MC, and swarm are live on `taylorvalton` with Vercel, compliance, and MCP wired to those slugs.
- Brand and inference repos **do not exist yet** on GitHub — no migration cost to start on the PLX org.
- MC already supports **two allowed orgs** so both coexist during the transition.

---

## Related

- EN-008 backlog entry: `docs/product/enhancements/README.md`
- Brand onboarding: `docs/runbooks/marketing-brand-repo-setup.md`
- GitHub App: `docs/runbooks/github-app-provisioning.md`
- Repo allow-list: `docs/product/enhancements/README.md` → EN-002

## Owner

Vince
