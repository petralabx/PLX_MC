# Module: github-app

## What

Server-side GitHub authentication for read-only repository Contents reads. Mints
short-lived **GitHub App installation access tokens** (JWT RS256 → installation
token, scoped to read-only Contents + Metadata), caches them, and exposes one
shared resolver — `resolveGithubToken()` — that every server-side GitHub read
goes through. It is NOT a general GitHub client and performs no writes; it only
produces a bearer token (or null).

## Why

The loop-ledgers observatory and self-service repo validation previously read a
long-lived classic `GITHUB_TOKEN` PAT. A hardening audit flagged that the
provisioned PAT was broadly scoped (`repo, admin:org, workflow, …`) — a
least-privilege violation. A GitHub App issues **short-lived (≤1h), narrowly
scoped, fully API-managed** installation tokens instead, so a leak has a bounded
blast radius and credentials rotate automatically. The App is the path to
retiring the broad PAT entirely.

## How

- `mintAppJwt(creds, now?)` — RS256 JWT signed with the App private key via
  `node:crypto` (no extra dependency); `iat` backdated 60s, `exp` ≤10 min.
- `requestInstallationToken(creds, opts?)` — `POST /app/installations/{id}/access_tokens`
  with the JWT, requesting `{ permissions: { contents: read, metadata: read } }`
  (defence in depth even if the App grant is broader). Throws an honest error on
  non-2xx; never returns a bogus token.
- `getInstallationToken(opts?)` — module-cached token, refreshed 60s before
  expiry to avoid boundary races.
- `resolveGithubToken(opts?)` — the one accessor consumers use:
  App installation token when `githubAppConfigured()` (all three `GITHUB_APP_*`
  secrets present), else the static `GITHUB_TOKEN`, else `null` (callers then
  emit an honest degraded result — never a throw at the call site). If the App is
  configured but a mint transiently fails, it warns and falls back to the PAT so
  the surface stays up.
- Default-off: with no App secrets, behavior is identical to the prior PAT path,
  so this ships dormant and is safe to merge before the App is provisioned.

### Skills Directory Write Scope Addendum

Phase 4 P5 adds an approval-time publish hook for Skills Directory submissions.
This hook does **not** reuse or broaden the read-only GitHub App token above.
Writes stay default-off behind:

- `SKILLS_SUBMIT_GITHUB_WRITE_ENABLED` — must be `1` or `true`; absent/anything
  else returns `publish-instructions.md` content in the API response instead of
  writing to GitHub.
- `SKILLS_SUBMIT_GITHUB_TOKEN` — fine-scoped token with write access to the publish
  target repo (legacy default `taylorvalton/plx-cursor-skills` in `publish.ts`;
  catalog reads use `petralabx/skills`), used to create `submit/<id>-<ts>` branches,
  write `skills/<id>/SKILL.md` + `manifest.json`, and open a PR.

The reader module remains least-privilege read-only; the writer lives in
`src/lib/skills-directory/publish.ts` and is gated independently.

## Dependencies

- `node:crypto` (RS256 signing) — no new package.
- `@/lib/secrets` — `githubAppConfigured()` / `githubAppCredentials()`.
- Depended on by: `loop-ledgers` (github-api source adapter, **owner-aware** token
  routing), `sync` (`validateRepoInOrg`), and **`skills-directory`** (`GithubSkillsSource`
  reads `petralabx/skills` per `config/skills-catalog.json`; org App install must
  cover the catalog repo — see `docs/runbooks/github-app-provisioning.md` Step 2b).
  All import `resolveGithubToken` through this barrel.

### Key Files

- `src/lib/github-app/token.ts` — JWT mint, installation-token exchange + cache, `resolveGithubToken`
- `src/lib/github-app/index.ts` — module barrel
- `src/lib/secrets.ts` — `githubAppConfigured` / `githubAppCredentials`
- `src/lib/skills-directory/publish.ts` — separately gated Skills Directory write-to-PR hook
- `tests/github-app.test.ts` — JWT/mint/cache/fallback contract tests

## Owner

Vince

## Criticality

Medium
