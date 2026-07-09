# Rollback plan requirements

**Audience:** anyone opening a PR beyond docs/tests on a PLX-tracked repo.

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-09

> **TL;DR** — If the change is not docs/tests-only, the PR body needs a
> **`## Rollback Plan`** section that says how to undo it safely. High-risk
> changes also need evidence and a linked PRD. The compliance gate checks this
> for agent PRs; `agentic-swarm` also enforces it in its own evidence check.

Companion to [`docs/COLLABORATOR-SOP.md`](COLLABORATOR-SOP.md) §2 and
[`docs/AGENT-PR-SOP.md`](AGENT-PR-SOP.md).

---

## 1. When a rollback plan is required

| Change class | Rollback plan? |
|--------------|----------------|
| Docs-only / test-only (`risk:low` or auto-tier low) | Optional (still useful) |
| Normal product / platform code (**standard**) | **Required** |
| DB migrations, auth/permissions, infra, `.github/workflows`, deploy (**high**) | **Required** + evidence + linked PRD |
| `petralabx/agentic-swarm` non-docs PRs | **Required** (repo evidence check) |

Override auto-tier with PR labels `risk:low` or `risk:high` when classification
is wrong — do not use `risk:low` to dodge a real rollback need.

---

## 2. What the section must contain

Use this exact heading (gate / evidence parsers look for it):

```markdown
## Rollback Plan
```

The body should answer, in plain language:

1. **How to undo** — revert PR, feature flag off, restore prior config, migrate
   down, redeploy previous SHA, etc.
2. **Data / schema impact** — none, forward-only, or explicit restore steps.
3. **Blast radius** — who/what is affected if rolled back.
4. **Verification after rollback** — one or two checks that prove the prior
   state is back (health URL, smoke test, query).

### Good (standard)

```markdown
## Rollback Plan
Revert this PR. No schema or data changes; reverting fully restores prior behavior.
Confirm `GET /api/health` returns 200 on staging after revert.
```

### Good (high — migration)

```markdown
## Rollback Plan
1. Stop writers that depend on the new column.
2. Deploy previous release SHA (or revert this PR).
3. Do **not** DROP the additive column in production without a follow-up
   migration owned by Vince — leave it nullable/unused.
4. Verify: staging smoke + `scripts/assert-staging-context.sh` before any DB op.
```

### Bad

```markdown
## Rollback Plan
Revert if needed.
```

Too vague — no impact, no verify step.

---

## 3. High-risk extras

For **high** tier, also attach:

- **Evidence** — test output, screenshots, or command transcripts in the PR or
  an `artifacts/<domain>/<yyyy-mm-dd>-<slug>/` bundle.
- **Linked PRD** — bucket/PRD URL or path the change implements.

Missing either is a common hard-gate block for agent PRs.

---

## 4. Relationship to other gates

- **Compliance gate** — verifies rollback (and high-tier extras) on agent PRs
  with `MC-Checkout`.
- **Repo CI** — still must pass; green compliance ≠ green CI.
- **Portal** — staging-first; never push `master` without operator approval
  (`docs/runbooks/CONTRIBUTING.md`).

---

## 5. Related

- Collaborator SOP — `docs/COLLABORATOR-SOP.md`
- Agent PR SOP — `docs/AGENT-PR-SOP.md`
- Hygiene / evidence placement — `docs/REPO_HYGIENE_SOP.md`
