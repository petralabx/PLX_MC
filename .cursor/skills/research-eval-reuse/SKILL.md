---
name: research-eval-reuse
description: >-
  Researches and scores existing open-source options before building a custom
  chat surface, tool, adapter, knowledge path, or integration. Use when someone
  says "we should just build X", before a new integration, or when reliability
  and maintainability are a concern. Skip for trivial one-liners, explicit
  custom-required product decisions, and emergency hotfixes.
compatibility: >-
  Cursor, Cursor Cloud, Claude Code, Grok, Hermes, Codex, and other SKILL.md
  runtimes. Requires a web search/fetch capability and optional gh + X search.
---

# Research → Eval → Reuse (before custom build)

Gate custom builds. Prefer reuse or a thin adapter when an existing option is
as reliable or better. Do not implement or write a build plan until this
process finishes.

This skill is a **reuse gate**, not a full project brief. After a **build
custom** recommendation, hand off to `project-researcher` / `project-orchestrator`
if a spec is still needed. Do not expand dual-run or rewrite the intake engine
to make a library fit.

## When to invoke

- Before building a new chat surface, tool, adapter, knowledge path, or integration
- When someone says “we should just build X”
- When reliability or maintainability is a concern

## When to skip

- Trivial one-liners, pure domain logic already owned by intake engine
- Explicit product decision that custom is required
- Emergency hotfix with no research window

## Process (mandatory order)

1. **Frame** — One sentence: what capability do we need? Constraints (Next.js, thin adapter, RBAC, dual-run, no intake rewrite)?
2. **Research**
   - GitHub: search repos/code for open-source solutions (stars, recent commits, license, Next.js/React fit)
   - Docs: official docs of shortlisted options
   - X / community: recent practitioner tips, failure modes, “don’t use for X”
3. **Eval** (score each candidate)
   - Fit with current stack (portal, assistant-ui path, thin adapter)
   - Production reliability signals (stars, maintenance, issue hygiene)
   - Safety (allow-lists, HITL, no unrestricted DOM/execution)
   - Cost to integrate vs build custom
   - License / vendor lock-in
4. **Recommend**
   - Reuse as-is / adapt / build custom — with one-paragraph rationale
   - Explicit non-goals if recommending reuse
5. **Only then** implement or write a build plan

## Runtime adapters

Use whatever tools this runtime exposes. Do not stall because a Cursor-named
tool is missing. Record the tool actually used next to each source.

| Need | Prefer (any runtime) | Fallbacks |
|---|---|---|
| GitHub repos/code | `gh search repos`, `gh search code`, GitHub web search | Web search for `site:github.com` |
| Official docs | Fetch the vendor docs URL | Web search `official docs <name>` then fetch |
| X / community | X search MCP (`search_posts`) | Web search `site:x.com` / practitioner posts |
| Internal fit | Repo search for portal, assistant-ui, adapters, RBAC, dual-run | Ask the operator if the repo is unavailable |

Score only from fetched evidence. Do not invent stars, licenses, or commit dates.

## Output format

- Problem frame
- Candidates table (name | source | fit | risks)
- Recommendation (reuse / adapt / build)
- Next concrete step

Use this shape:

```markdown
## Problem frame
<one sentence capability + constraints>

## Candidates
| name | source | fit | risks |
|---|---|---|---|
| <option> | <url or repo> | <high/med/low + why> | <license, safety, lock-in, maintenance> |

## Recommendation
**reuse as-is | adapt | build custom**

<one-paragraph rationale>

Non-goals (if reuse/adapt): <what this option will not do>

## Next concrete step
<one action: vendor install, thin adapter sketch, or custom build plan>
```

A worked example is in [examples.md](examples.md).

## Hard rules

- Prefer reuse when reliability is equal or better
- Do not expand dual-run or rewrite intake engine to “make a library fit”
- Capability expansions still go through AgentVersion + capability ∩ RBAC
