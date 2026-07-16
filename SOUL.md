# SOUL.md

<!-- The mission anchor. Keep this under one page, forever. Every agent and
     contributor reads this first. Pillar 1 (Mission First) points here. -->

## Mission

Give Petra Lab-X staff one cockpit — Mission Control — to direct, review, and
trace the work of background agents, with SharePoint as the canonical system
of record mirrored two-way and every reconciliation audited.

## Operating Principles

- Everything resolves to a Task: a task is the atom of work; every screen and
  integration exists to create, route, or verify tasks.
- The record outranks the lens: SharePoint (`/sites/plx-mission-control`) is
  authoritative; the UI is a fast, opinionated view over it, never a fork.
- Work is traceable end-to-end: PRD requirement → task(s) → PR(s) → evidence →
  test status → merge commit; unmet requirements surface as visible GAPs.
- Humans decide: agents do the work, humans review, approve, assign, and
  resolve. No silent automation of judgment calls.

## Non-Negotiables

<!-- Hard constraints that no task, deadline, or agent may override.
     Make each one testable/checkable, not aspirational. -->

- Sync conflicts are resolved manually by a human choosing the winner — never
  automatic last-write-wins.
- Every sync reconciliation (push, pull, conflict resolution, error retry)
  appends a timestamped, actor-attributed audit log entry.
- Only `@petralabx.com` and `@petrasoap.com` people can be tasked or assigned;
  the domain rule is enforced server-side, not just in the picker.
- All UI color comes from `--p-*` design tokens behind the opt-in `.brand-plx`
  boundary; token values change only upstream in `plx-customer-portal`
  (brand authority — see `docs/design-system/decisions/ADR-003`).
- Secrets come from AWS Secrets Manager (`prod/ec2-secrets`) through one shared
  accessor — no hardcoded keys, no scattered env lookups.
- Timestamps are stored and compared in UTC; rendering localizes.
- New planes wait on the terminating **mirror is boring** gate: schema-green
  self-check + AGENTS.md↔TOOLS.md parity in CI + N consecutive green cron
  ticks (default N=7). Conflict SLO is warning-only until volume exists
  (full criteria: `AGENTS.md` → "Mirror Is Boring Entry Gate").

## Canonical Runtime Docs

- Architecture and roles: [AGENTS.md](AGENTS.md)
- Tooling policy: [TOOLS.md](TOOLS.md)
- Operational lessons: [LESSONS.md](LESSONS.md)
- Repo hygiene: [docs/REPO_HYGIENE_SPEC.md](docs/REPO_HYGIENE_SPEC.md)
