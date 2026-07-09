# Repo hygiene & evidence bundles

**Audience:** contributors and agents adding files, docs, or evidence to a
PLX-tracked repo.

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-09

> **TL;DR** — Every file has one canonical home. Reports go in **dated artifact
> bundles**, not the repo root. No status adjectives in filenames. New modules
> need a contract README under `docs/modules/<name>/`.

This SOP is the operator-facing summary of `docs/REPO_HYGIENE_SPEC.md` (canonical
detail) and the hygiene rules in `config/governance-contract.yaml`.

---

## 1. Document classes

| Class | Where it lives |
|-------|----------------|
| **Canonical** | Approved root set + `docs/` |
| **Operational** | `docs/`, `docs/runbooks/`, `docs/architecture/` |
| **Evidence** | `artifacts/<domain>/<yyyy-mm-dd>-<slug>/` |
| **Archived** | `archive/<yyyy-mm-dd>-<reason>/` (with `README.md`) |

---

## 2. Root directory

Do **not** create at repo root:

- `FINAL_*`, `QA_*`
- `*_SUMMARY.md`, `*_REPORT.md`, `*_ASSESSMENT.md`, `*_COMPLETION*.md`
- `*_CHECKLIST.md`, `*_SPECIFICATION.md`
- Date-stamped status docs (e.g. `*_20260610.md`)

Approved root files are listed in `config/governance-contract.yaml`
(`repo_hygiene.approved_root_files`). Everything else goes under `docs/`,
`artifacts/`, or `archive/`.

---

## 3. Evidence bundles

```text
artifacts/<domain>/<yyyy-mm-dd>-<slug>/
  REPORT.md   # or VERDICT.md
  index.md    # or artifacts.json
  …supporting files only inside this folder
```

- Slugs: lowercase kebab-case.
- No loose files directly under `artifacts/`.
- No status adjectives in filenames: `FINAL`, `COMPLETE`, `LATEST`, `NEW`, `FIXED`.
- No case-variant duplicates.

---

## 4. Module contracts

Every new module needs `docs/modules/<module>/README.md` with at least:
**What, Why, How, Dependencies, Owner**. Update `docs/modules/README.md` when
adding a domain. Import through module barrels, not internal paths.

---

## 5. Canonical source policy

One canonical location per document. Secondary copies are only **generated
consumers** (automation-written, never hand-edited as a second SSOT).

---

## 6. Enforcement

- Local / CI: `scripts/check-repo-hygiene.py` (via `./scripts/preflight.sh`)
- Portal twin: `docs/REPO_HYGIENE_SPEC.md` + `npm run audit:hygiene` in that repo

---

## Related

- Spec: `docs/REPO_HYGIENE_SPEC.md`
- Collaborator SOP: `docs/COLLABORATOR-SOP.md`
- Agent PR SOP: `docs/AGENT-PR-SOP.md`
