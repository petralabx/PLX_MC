# Quality-Ledger Template (`vmc-quality-ledger/v1`)

One **versioned, canonical** template for the cross-repo quality-ledger feed that
Mission Control's Loop Ledgers module pulls (read-only) from each tracked repo. Use
this so every repo publishes the *same* shape and MC never sees schema drift.

- **Schema:** `vmc-quality-ledger/v1` (enforced by `src/lib/loop-ledgers/validator.ts`).
- **Registry:** each repo is one row in `config/loop-ledgers-registry.json`
  (`plx-loop-ledger-registry/v1`) — `repo`, `default_branch`, `ledger_glob`,
  `human_ledger_glob`, `evidence_dir`.
- **Pull, not push:** MC reads committed `*.artifacts.json` (+ generated `*.md` +
  `evidence/*`) via the GitHub API on the repo's `default_branch`. A repo never
  pushes into `PLX_MC`. A missing/stale/invalid source renders as a **loud degraded
  row** (never hidden); freshness warns >7d, stale >30d.

## Canonical layout (per consumer repo)

```
docs/<repo-slug>/quality-ledger/
  <module>.artifacts.json   # machine source of truth (this template)
  <module>.md               # human mirror (generated from the JSON)
  evidence/<id>.txt         # evidence / roadmap attachments referenced by `source`
```

Registry globs that pair with this layout:

```jsonc
{
  "repo": "taylorvalton/<owner-repo>",
  "display_name": "<Human Name>",
  "default_branch": "<the branch ledgers live on>",
  "ledger_glob": "docs/<repo-slug>/quality-ledger/*.artifacts.json",
  "human_ledger_glob": "docs/<repo-slug>/quality-ledger/*.md",
  "evidence_dir": "docs/<repo-slug>/quality-ledger/evidence"
}
```

## Artifact field contract

| Field | Required | Allowed / shape |
|---|---|---|
| `artifact_id` | yes | stable id, e.g. `MOD-001` |
| `module` | yes | matches the ledger `module` |
| `artifact_type` | yes | `user_story` \| `defect` \| `risk` \| `test_gap` \| `ticket` \| `blocker` |
| `title` | yes | one line |
| `status` | yes | `unknown` \| `works_observed` \| `broken` \| `partially_broken` \| `missing_test` \| `covered` \| `fixed_pending_regression` \| `verified` \| `deferred` \| `waived` \| `blocked` |
| `severity` | yes | `critical` \| `high` \| `medium` \| `low` |
| `safety_class` | yes | `green` \| `yellow` \| `red` |
| `confidence` | yes | 0.0–1.0 |
| `blast_radius`, `owner`, `source`, `linked_routes[]`, `linked_files[]`, `tests_existing[]`, `tests_needed[]`, `evidence[]`, `next_action`, `blocked_reason` | optional | see `src/lib/loop-ledgers/types.ts` |

The top-level `summary` counts MUST agree with `artifacts` (the validator recomputes).

## How to adopt in a new repo (folds a repo into MC parity)

1. Create `docs/<repo-slug>/quality-ledger/` using `example.artifacts.json` here.
2. Generate the `.md` mirror in your repo's CI (don't hand-edit it).
3. Add the repo row to `config/loop-ledgers-registry.json` (PLX_MC).
4. Confirm MC's `GITHUB_TOKEN` can read the repo.
5. Verify the row renders non-degraded: `GET /api/loop-ledgers`.

## Versioning

The schema is pinned at `vmc-quality-ledger/v1`. Evolve by introducing a new
`schema_version` (e.g. `/v2`) and a migration window — never silently change the
shape under `/v1`. The registry schema is pinned at `plx-loop-ledger-registry/v1`.

Owner: Vince.
